// In-memory stand-in for @supabase/supabase-js used ONLY for offline UI tests.
// Mirrors the real schema's rules (amount > 0, txn_date required, RLS-style per-user scoping,
// numeric(12,2) values) and records every request in window.__db.log for assertions.
type Row = Record<string, any>;
const uid = () => crypto.randomUUID();
const W = window as any;
const db: Record<string, Row[]> = W.__db?.tables ?? { profiles: [], categories: [], income_sources: [], accounts: [], goals: [], transactions: [], budgets: [], holdings: [], net_worth_snapshots: [], ai_insights: [], csv_imports: [] };
const users: { id: string; email: string; password: string; name: string }[] = W.__db?.users ?? [];
const log: { op: string; table: string; payload?: any }[] = W.__db?.log ?? [];
W.__db = { tables: db, users, log, aiMode: W.__db?.aiMode ?? "off" };
let session: { user: { id: string; email: string } } | null = JSON.parse(localStorage.getItem("mock-session") ?? "null");
const listeners: ((e: string, s: any) => void)[] = [];
const setSession = (s: typeof session) => { session = s; localStorage.setItem("mock-session", JSON.stringify(s)); listeners.forEach((l) => l(s ? "SIGNED_IN" : "SIGNED_OUT", s)); };
const me = () => session?.user.id;
const n2 = (v: any) => (v === null || v === undefined ? v : Math.round(Number(v) * 100) / 100);
const MONEY: Record<string, string[]> = { transactions: ["amount"], goals: ["target_amount", "starting_amount", "monthly_contribution"], budgets: ["amount"], holdings: ["current_value", "monthly_contribution"], income_sources: ["expected_monthly"] };

function bootstrap(id: string, name: string) {
  db.profiles.push({ id, display_name: name, currency_code: "USD", theme: "light", withdrawal_rate: 4, expected_return: 7, annual_expenses_override: null, birth_year: null, onboarded: false, timezone: "UTC" });
  const cats: [string, string, string][] = [["Rent/Housing", "expense", "#0F5C3F"], ["Groceries", "expense", "#2E8B62"], ["Dining Out", "expense", "#C9A227"], ["Transport", "expense", "#4A7C6A"], ["Utilities & Bills", "expense", "#6B8F71"], ["Subscriptions", "expense", "#8FAF9A"], ["Shopping", "expense", "#B08D2A"], ["Travel", "expense", "#D4AF37"], ["Other", "expense", "#9AA19B"], ["Owner's Draw", "income", "#0F5C3F"], ["Side Income", "income", "#2E8B62"], ["Dividends & Interest", "income", "#C9A227"]];
  cats.forEach(([n, k, c], i) => db.categories.push({ id: uid(), user_id: id, name: n, kind: k, icon: "circle", color: c, sort_order: i, archived: false }));
  [["Owner's Draw – Business", "business_draw"], ["Side Income – Consulting", "side_income"], ["Dividends & Interest", "passive"]].forEach(([n, t]) => db.income_sources.push({ id: uid(), user_id: id, name: n, source_type: t, expected_monthly: 0, archived: false, created_at: new Date().toISOString() }));
  [["Main Checking", "checking"], ["High-Yield Savings", "savings"]].forEach(([n, t]) => db.accounts.push({ id: uid(), user_id: id, name: n, account_type: t, archived: false, created_at: new Date().toISOString() }));
}

function validate(table: string, r: Row) {
  if (table === "transactions") {
    if (!r.txn_date) return "null value in column \"txn_date\" violates not-null constraint";
    if (!(Number(r.amount) > 0)) return "violates check constraint \"transactions_amount_check\"";
    if (r.txn_type === "goal_contribution" && !r.goal_id) return "violates check constraint (goal_id required)";
    for (const [col, t] of [["category_id", "categories"], ["goal_id", "goals"], ["income_source_id", "income_sources"], ["account_id", "accounts"]] as const)
      if (r[col] && !db[t].some((x) => x.id === r[col] && x.user_id === r.user_id)) return `violates foreign key constraint on ${col}`;
  }
  if (table === "budgets" && !/-01$/.test(r.month)) return "violates check constraint \"budgets_month_check\"";
  if (table === "goals" && r.is_primary && db.goals.some((g) => g.user_id === r.user_id && g.is_primary && g.id !== r.id)) return "duplicate key value violates unique constraint \"goals_one_primary_per_user\"";
  return null;
}
const view = (table: string): Row[] => {
  if (table === "v_goal_progress") return db.goals.map((g) => ({ ...g, saved_amount: n2(Number(g.starting_amount) + db.transactions.filter((t) => t.goal_id === g.id && t.txn_type === "goal_contribution").reduce((a, t) => a + Number(t.amount), 0)) }));
  return db[table];
};

class Q {
  private filters: ((r: Row) => boolean)[] = []; private orders: [string, boolean][] = []; private lim = Infinity; private one = false;
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select"; private payload: any; private conflict?: string;
  constructor(private table: string) {}
  select() { return this; }
  insert(p: any) { this.mode = "insert"; this.payload = p; return this; }
  update(p: any) { this.mode = "update"; this.payload = p; return this; }
  upsert(p: any, o?: { onConflict?: string }) { this.mode = "upsert"; this.payload = p; this.conflict = o?.onConflict; return this; }
  delete() { this.mode = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] >= v); return this; }
  lte(c: string, v: any) { this.filters.push((r) => r[c] <= v); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = true; return this; }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve().then(() => this.exec()).then(res, rej); }
  private exec(): { data: any; error: any } {
    const u = me(); if (!u) return { data: null, error: { message: "permission denied (anon)" } };
    const own = (r: Row) => (this.table === "profiles" ? r.id === u : r.user_id === u);
    const fix = (r: Row) => { for (const c of MONEY[this.table] ?? []) if (c in r && r[c] !== null) { if (typeof r[c] === "number") log.push({ op: "FLOAT_SENT", table: this.table, payload: { [c]: r[c] } }); r[c] = n2(r[c]); } return r; };
    if (this.mode === "select") {
      let rows = view(this.table).filter(own).filter((r) => this.filters.every((f) => f(r)));
      for (const [c, asc] of [...this.orders].reverse()) rows = [...rows].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      rows = rows.slice(0, this.lim);
      return this.one ? (rows.length === 1 ? { data: { ...rows[0] }, error: null } : { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } }) : { data: rows.map((r) => ({ ...r })), error: null };
    }
    log.push({ op: this.mode, table: this.table, payload: structuredClone(this.payload) });
    if (this.mode === "insert" || this.mode === "upsert") {
      const items = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => fix({ id: uid(), user_id: u, created_at: new Date().toISOString(), category_origin: "manual", is_recurring: false, archived: false, sort_order: 0, show_on_dashboard: true, is_primary: false, counts_toward_freedom: true, ...p }));
      if (items.some((r: Row) => r.user_id !== u)) return { data: null, error: { message: "new row violates row-level security policy" } };
      const out: Row[] = [];
      for (const r of items) {
        const err = validate(this.table, r); if (err) return { data: null, error: { message: err } };
        if (this.mode === "upsert" && this.conflict) {
          const keys = this.conflict.split(","); const ex = db[this.table].find((x) => keys.every((k) => x[k] === r[k]));
          if (ex) { Object.assign(ex, { ...r, id: ex.id }); out.push(ex); continue; }
        }
        db[this.table].push(r); out.push(r);
      }
      return { data: this.one ? { ...out[0] } : out, error: null };
    }
    const rows = db[this.table].filter(own).filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === "update") {
      for (const r of rows) { const next = fix({ ...r, ...this.payload }); const err = validate(this.table, next); if (err) return { data: null, error: { message: err } }; Object.assign(r, next); }
      return { data: this.one ? (rows[0] ? { ...rows[0] } : null) : rows, error: this.one && !rows[0] ? { message: "no rows" } : null };
    }
    db[this.table] = db[this.table].filter((r) => !rows.includes(r));
    if (this.table === "goals") for (const t of db.transactions) if (rows.some((g) => g.id === t.goal_id)) t.goal_id = null;
    if (this.table === "csv_imports") db.transactions = db.transactions.filter((t) => !rows.some((i) => i.id === t.import_id));
    return { data: null, error: null };
  }
}

function seed(u: string) {
  if (db.transactions.some((t) => t.user_id === u)) return "skipped: account already has transactions";
  const c = (n: string) => db.categories.find((x) => x.user_id === u && x.name === n)!.id;
  const s = (t: string) => db.income_sources.find((x) => x.user_id === u && x.source_type === t)!.id;
  const p = db.profiles.find((x) => x.id === u)!; Object.assign(p, { display_name: "Alex", birth_year: 1994, onboarded: true });
  const goals = [["House Deposit", 60000, 21050, 1100, "2028-12-01", true], ["Emergency Fund", 15000, 7800, 300, "2027-06-01", false], ["Japan Trip", 5000, 150, 167, "2027-09-01", false]] as const;
  const gid = goals.map(([name, t, st, m, d, pr], i) => { const id = uid(); db.goals.push({ id, user_id: u, name, icon: "home", target_amount: t, starting_amount: st, monthly_contribution: m, target_date: d, is_primary: pr, show_on_dashboard: true, sort_order: i }); return id; });
  const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
  for (let m = 11; m >= 0; m--) {
    const d = new Date(now.getFullYear(), now.getMonth() - m, 1); const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const add = (day: number, desc: string, amt: number, type: string, extra: Row = {}) => db.transactions.push({ id: uid(), user_id: u, txn_date: `${k}-${pad(day)}`, description: desc, amount: amt, txn_type: type, category_origin: "manual", is_recurring: false, notes: null, created_at: "", account_id: null, category_id: null, income_source_id: null, goal_id: null, ...extra });
    add(14, "Owner's Draw – Business", 2750, "income", { category_id: c("Owner's Draw"), income_source_id: s("business_draw") });
    add(28, "Owner's Draw – Business", 2750, "income", { category_id: c("Owner's Draw"), income_source_id: s("business_draw") });
    add(10, "Consulting invoice", 1200, "income", { category_id: c("Side Income"), income_source_id: s("side_income") });
    add(27, "Dividends & interest", 85, "income", { category_id: c("Dividends & Interest"), income_source_id: s("passive") });
    for (const [n, v] of [["Rent/Housing", 1650], ["Groceries", 470], ["Dining Out", 260], ["Transport", 245], ["Utilities & Bills", 205], ["Subscriptions", 92], ["Shopping", 240], ["Travel", 150]] as const) {
      add(5, n, v, "expense", { category_id: c(n) });
      db.budgets.push({ id: uid(), user_id: u, category_id: c(n), month: `${k}-01`, amount: n === "Groceries" ? 500 : v + 30 });
    }
    add(15, "House Deposit contribution", 1100, "goal_contribution", { goal_id: gid[0] });
    add(15, "Emergency Fund contribution", 300, "goal_contribution", { goal_id: gid[1] });
    add(15, "Japan Trip contribution", 167, "goal_contribution", { goal_id: gid[2] });
    add(20, "ETF purchase", 900, "investment");
    db.net_worth_snapshots.push({ id: uid(), user_id: u, snapshot_date: `${k}-28`, net_worth: 74000 + (11 - m) * 2650 });
  }
  for (const [n, t, v, mo] of [["Global Index Fund ETF", "index_fund", 48200, 900], ["Retirement Account (401k)", "retirement", 31500, 0], ["Individual Stocks", "stocks", 9800, 0], ["Crypto", "crypto", 3400, 0]] as const)
    db.holdings.push({ id: uid(), user_id: u, name: n, asset_type: t, current_value: v, monthly_contribution: mo, counts_toward_freedom: true, value_as_of: null });
  return "seeded";
}

function importTx(u: string, p: any) {
  const rows = p.p_rows as any[];
  if (!Array.isArray(rows) || !rows.length) return { data: null, error: { message: "the file has no rows to import" } };
  if (rows.length > 5000) return { data: null, error: { message: "too many rows (max 5000 per import)" } };
  const imp = { id: uid(), user_id: u, file_name: p.p_file_name, row_count: rows.length, imported_count: 0, skipped_count: 0, categories_created: 0, created_at: new Date().toISOString() };
  const staged: Row[] = []; let dup = 0, cats = 0; const newCats: Row[] = [];
  for (const [i, r] of rows.entries()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return { data: null, error: { message: `row ${i + 1}: invalid date "${r.date}"` } };
    if (typeof r.amount !== "string" || !(Number(r.amount) > 0)) return { data: null, error: { message: `row ${i + 1}: amount must be greater than zero` } };
    let type = r.type || "expense"; let goal_id = null, category_id = null;
    if (type === "goal_contribution") { goal_id = db.goals.find((g) => g.user_id === u && g.name.toLowerCase() === (r.category || "").toLowerCase())?.id ?? null; if (!goal_id) type = "transfer"; }
    if ((type === "income" || type === "expense") && r.category) {
      const all = [...db.categories, ...newCats];
      category_id = all.find((c) => c.user_id === u && c.kind === type && c.name.toLowerCase() === r.category.toLowerCase())?.id ?? null;
      if (!category_id && p.p_create_categories) { const c = { id: uid(), user_id: u, name: r.category, kind: type, icon: "circle", color: "#9AA19B", sort_order: 90, archived: false }; newCats.push(c); category_id = c.id; cats++; }
    }
    if (p.p_skip_duplicates && [...db.transactions, ...staged].some((t) => t.user_id === u && t.txn_date === r.date && Number(t.amount) === Number(r.amount) && t.txn_type === type && t.description.toLowerCase() === r.description.toLowerCase())) { dup++; continue; }
    staged.push({ id: uid(), user_id: u, txn_date: r.date, description: r.description, amount: Number(r.amount), txn_type: type, category_id, goal_id, income_source_id: null, account_id: null, notes: r.notes || null, category_origin: "manual", is_recurring: false, import_id: imp.id, created_at: "" });
  }
  db.categories.push(...newCats);
  if (staged.length) { imp.imported_count = staged.length; imp.skipped_count = dup; imp.categories_created = cats; db.csv_imports.push(imp); db.transactions.push(...staged); }
  return { data: { import_id: staged.length ? imp.id : null, rows: rows.length, imported: staged.length, skipped_duplicates: dup, categories_created: cats }, error: null };
}

// test-only helper: the app no longer offers demo data; tests seed sample data directly
(window as any).__seedDemo = () => (me() ? seed(me()!) : 'not signed in');

export function createClient(_url: string, _key: string, _o?: any) {
  return {
    auth: {
      async signUp({ email, password, options }: any) {
        if (users.some((x) => x.email === email)) return { data: {}, error: { message: "User already registered" } };
        const id = uid(); users.push({ id, email, password, name: options?.data?.display_name ?? "" }); bootstrap(id, options?.data?.display_name || email.split("@")[0]);
        setSession({ user: { id, email } }); return { data: { session }, error: null };
      },
      async signInWithPassword({ email, password }: any) {
        const x = users.find((x) => x.email === email && x.password === password);
        if (!x) return { data: {}, error: { message: "Invalid login credentials" } };
        setSession({ user: { id: x.id, email } }); return { data: { session }, error: null };
      },
      async signOut() { setSession(null); return { error: null }; },
      async getSession() { return { data: { session } }; },
      async resetPasswordForEmail() { return { error: null }; },
      async updateUser({ password }: any) { const x = users.find((u) => u.id === me()); if (x) x.password = password; return { error: null }; },
      onAuthStateChange(cb: any) { listeners.push(cb); return { data: { subscription: { unsubscribe() { listeners.splice(listeners.indexOf(cb), 1); } } } }; },
    },
    from: (t: string) => new Q(t),
    async rpc(name: string, params?: any) {
      log.push({ op: "rpc", table: name, payload: params ? structuredClone(params) : undefined });
      if (!me()) return { data: null, error: { message: "not authenticated" } };
      if (name === "seed_demo_data") return { data: seed(me()!), error: null };
      if (name === "import_transactions") return importTx(me()!, params);
      return { data: null, error: { message: "unknown rpc" } };
    },
    functions: {
      async invoke(name: string, { body }: any) {
        log.push({ op: "invoke", table: name, payload: structuredClone(body) });
        if (!me()) return { data: null, error: { message: "401" } };
        if (W.__db.aiMode === "off") return { data: null, error: { message: "OPENAI_API_KEY is not set on the server", context: { json: async () => ({ error: "OPENAI_API_KEY is not set on the server", ai_unavailable: true }) } } };
        if (name === "ai-categorize") {
          const cats = db.categories.filter((c) => c.user_id === me() && c.kind === (body.kind ?? "expense"));
          const pick = cats.find((c) => /food|market|grocer/i.test(body.description) && c.name === "Groceries") ?? cats.find((c) => c.name === "Other") ?? cats[0];
          return { data: { category_id: pick.id, category_name: pick.name, confidence: 0.92 }, error: null };
        }
        return { data: { answer: "You saved 38% of income this month — nice work.", highlights: ["Dining out down vs last month"] }, error: null };
      },
    },
  };
}
