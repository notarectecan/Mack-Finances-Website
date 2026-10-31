// Data layer. Every query runs as the signed-in user; RLS (user_id = auth.uid()) scopes all rows.
import { supabase } from "./supabase";
import { Cents, centsToDb, toCents } from "./money";
import { localTimeZone } from "./dates";

export type TxnType = "income" | "expense" | "transfer" | "goal_contribution" | "investment";

export interface Profile {
  id: string; display_name: string; currency_code: string; theme: "light" | "dark" | "system";
  withdrawal_rate: number; expected_return: number; annual_expenses_override: Cents | null;
  birth_year: number | null; onboarded: boolean; timezone: string;
}
export interface Category { id: string; name: string; kind: "income" | "expense"; icon: string; color: string; sort_order: number; archived: boolean }
export interface IncomeSource { id: string; name: string; source_type: string; expected_monthly: Cents }
export interface Account { id: string; name: string; account_type: string }
export interface Goal {
  id: string; name: string; icon: string; target: Cents; starting: Cents; saved: Cents; monthly: Cents;
  target_date: string | null; is_primary: boolean; show_on_dashboard: boolean; sort_order: number;
}
export interface Txn {
  id: string; txn_date: string; description: string; amount: Cents; txn_type: TxnType;
  category_id: string | null; income_source_id: string | null; account_id: string | null; goal_id: string | null;
  category_origin: "manual" | "ai"; notes: string | null; is_recurring: boolean;
}
export interface Budget { id: string; category_id: string; month: string; amount: Cents }
export interface Holding { id: string; name: string; asset_type: string; value: Cents; monthly: Cents; counts_toward_freedom: boolean; value_as_of: string | null }
export interface Snapshot { snapshot_date: string; net_worth: Cents }

export interface AppData {
  profile: Profile; categories: Category[]; sources: IncomeSource[]; accounts: Account[];
  goals: Goal[]; txns: Txn[]; budgets: Budget[]; holdings: Holding[]; snapshots: Snapshot[];
}

function check<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

// ---------- auth ----------
export const auth = {
  signUp: (email: string, password: string, display_name: string) =>
    supabase.auth.signUp({ email, password, options: { data: { display_name } } }),
  signIn: (email: string, password: string) => supabase.auth.signInWithPassword({ email, password }),
  signOut: () => supabase.auth.signOut(),
  resetPassword: (email: string) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
  updatePassword: (password: string) => supabase.auth.updateUser({ password }),
  getSession: () => supabase.auth.getSession(),
  onChange: (cb: (signedIn: boolean, email?: string) => void) =>
    supabase.auth.onAuthStateChange((_e, s) => cb(!!s, s?.user.email)).data.subscription,
};

// ---------- load ----------
export async function loadAll(): Promise<AppData> {
  const [p, c, s, a, g, t, b, h, n] = await Promise.all([
    supabase.from("profiles").select("*").single(),
    supabase.from("categories").select("*").order("sort_order"),
    supabase.from("income_sources").select("*").eq("archived", false).order("created_at"),
    supabase.from("accounts").select("id,name,account_type").eq("archived", false).order("created_at"),
    supabase.from("v_goal_progress").select("*").order("sort_order"),
    supabase.from("transactions").select("*").order("txn_date", { ascending: false }).order("created_at", { ascending: false }).limit(5000),
    supabase.from("budgets").select("id,category_id,month,amount"),
    supabase.from("holdings").select("*").order("current_value", { ascending: false }),
    supabase.from("net_worth_snapshots").select("snapshot_date,net_worth").order("snapshot_date"),
  ]);
  const prof = check(p) as any;
  // keep the profile's time zone in sync with the browser so server-side "today" is local
  const tz = localTimeZone();
  if (prof.timezone !== tz) { await supabase.from("profiles").update({ timezone: tz }).eq("id", prof.id); prof.timezone = tz; }
  return {
    profile: {
      ...prof, withdrawal_rate: Number(prof.withdrawal_rate), expected_return: Number(prof.expected_return),
      annual_expenses_override: prof.annual_expenses_override == null ? null : toCents(prof.annual_expenses_override),
    },
    categories: check(c) as Category[],
    sources: (check(s) as any[]).map((r) => ({ ...r, expected_monthly: toCents(r.expected_monthly) })),
    accounts: check(a) as Account[],
    goals: (check(g) as any[]).map((r) => ({
      id: r.id, name: r.name, icon: r.icon, target: toCents(r.target_amount), starting: toCents(r.starting_amount),
      saved: toCents(r.saved_amount), monthly: toCents(r.monthly_contribution), target_date: r.target_date,
      is_primary: r.is_primary, show_on_dashboard: r.show_on_dashboard, sort_order: r.sort_order,
    })),
    txns: (check(t) as any[]).map((r) => ({ ...r, amount: toCents(r.amount) })),
    budgets: (check(b) as any[]).map((r) => ({ ...r, amount: toCents(r.amount) })),
    holdings: (check(h) as any[]).map((r) => ({
      id: r.id, name: r.name, asset_type: r.asset_type, value: toCents(r.current_value), monthly: toCents(r.monthly_contribution),
      counts_toward_freedom: r.counts_toward_freedom, value_as_of: r.value_as_of,
    })),
    snapshots: (check(n) as any[]).map((r) => ({ snapshot_date: r.snapshot_date, net_worth: toCents(r.net_worth) })),
  };
}

// ---------- transactions ----------
export interface TxnInput {
  txn_date: string; description: string; amount: Cents; txn_type: TxnType;
  category_id?: string | null; income_source_id?: string | null; account_id?: string | null; goal_id?: string | null;
  category_origin?: "manual" | "ai"; notes?: string | null; is_recurring?: boolean;
}
const txnRow = (t: Partial<TxnInput>) => ({ ...t, ...(t.amount !== undefined ? { amount: centsToDb(t.amount) } : {}) });
export const addTxn = async (t: TxnInput) => check(await supabase.from("transactions").insert(txnRow(t)).select().single());
export const updateTxn = async (id: string, t: Partial<TxnInput>) => check(await supabase.from("transactions").update(txnRow(t)).eq("id", id).select().single());
export const deleteTxn = async (id: string) => check(await supabase.from("transactions").delete().eq("id", id));

// ---------- budgets ----------
export const upsertBudget = async (category_id: string, monthKey: string, amount: Cents) =>
  check(await supabase.from("budgets").upsert(
    { category_id, month: `${monthKey}-01`, amount: centsToDb(amount) },
    { onConflict: "user_id,category_id,month" }).select().single());

// ---------- categories ----------
export const addCategory = async (name: string, kind: "income" | "expense", color = "#2E8B62", icon = "circle") =>
  check(await supabase.from("categories").insert({ name, kind, color, icon, sort_order: 99 }).select().single());
export const updateCategory = async (id: string, patch: Partial<Category>) =>
  check(await supabase.from("categories").update(patch).eq("id", id).select().single());

// ---------- goals ----------
export interface GoalInput { name: string; icon?: string; target: Cents; starting: Cents; monthly: Cents; target_date: string | null; is_primary?: boolean; show_on_dashboard?: boolean }
const goalRow = (g: Partial<GoalInput>) => {
  const r: any = { ...g };
  if (g.target !== undefined) { r.target_amount = centsToDb(g.target); delete r.target; }
  if (g.starting !== undefined) { r.starting_amount = centsToDb(g.starting); delete r.starting; }
  if (g.monthly !== undefined) { r.monthly_contribution = centsToDb(g.monthly); delete r.monthly; }
  return r;
};
export const addGoal = async (g: GoalInput) => check(await supabase.from("goals").insert(goalRow(g)).select().single());
export const updateGoal = async (id: string, g: Partial<GoalInput>) => check(await supabase.from("goals").update(goalRow(g)).eq("id", id).select().single());
export const deleteGoal = async (id: string) => check(await supabase.from("goals").delete().eq("id", id));

// ---------- holdings ----------
export interface HoldingInput { name: string; asset_type: string; value: Cents; monthly: Cents; value_as_of: string }
const holdRow = (h: Partial<HoldingInput>) => {
  const r: any = { ...h };
  if (h.value !== undefined) { r.current_value = centsToDb(h.value); delete r.value; }
  if (h.monthly !== undefined) { r.monthly_contribution = centsToDb(h.monthly); delete r.monthly; }
  return r;
};
export const addHolding = async (h: HoldingInput) => check(await supabase.from("holdings").insert(holdRow(h)).select().single());
export const updateHolding = async (id: string, h: Partial<HoldingInput>) => check(await supabase.from("holdings").update(holdRow(h)).eq("id", id).select().single());
export const deleteHolding = async (id: string) => check(await supabase.from("holdings").delete().eq("id", id));

// ---------- profile / sources ----------
export const updateProfile = async (id: string, patch: Record<string, unknown>) =>
  check(await supabase.from("profiles").update(patch).eq("id", id).select().single());
export const addIncomeSource = async (name: string, source_type: string, expected: Cents) =>
  check(await supabase.from("income_sources").insert({ name, source_type, expected_monthly: centsToDb(expected) }).select().single());
export const updateIncomeSource = async (id: string, patch: { name?: string; expected?: Cents }) =>
  check(await supabase.from("income_sources").update({
    ...(patch.name ? { name: patch.name } : {}), ...(patch.expected !== undefined ? { expected_monthly: centsToDb(patch.expected) } : {}),
  }).eq("id", id).select().single());

/** Record this month's net worth (same formula as the dashboard) so history stays consistent. */
export const recordSnapshot = async (snapshot_date: string, assets: Cents) =>
  check(await supabase.from("net_worth_snapshots").upsert({ snapshot_date, assets: centsToDb(assets), liabilities: "0.00" }, { onConflict: "user_id,snapshot_date" }));

export const seedDemo = async () => check(await supabase.rpc("seed_demo_data")) as string;

// ---------- AI (Edge Functions; OpenAI key stays server-side) ----------
async function invoke<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data as T;
}
/** Sends ONLY the description. Returns one of the user's existing categories. */
export const aiCategorize = (description: string, kind: "income" | "expense" = "expense") =>
  invoke<{ category_id: string; category_name: string; confidence: number }>("ai-categorize", { description, kind });
/** Server aggregates per-category totals; no raw rows go to OpenAI. */
export const aiSummary = (period_start: string, period_end: string, question?: string) =>
  invoke<{ answer: string; highlights: string[] }>("ai-summary", { period_start, period_end, question });
