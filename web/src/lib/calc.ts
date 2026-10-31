// Pure, deterministic finance math (integer cents). Unit-testable, no I/O.
import type { AppData, Goal, Txn } from "./api";
import { Cents, centsToDb, sum } from "./money";
import { addMonths, monthKey, monthsBetween, today } from "./dates";

export interface MonthRow { key: string; income: Cents; expense: Cents; goals: Cents; invested: Cents; net: Cents }

export function monthlySeries(txns: Txn[], fromKey: string, toKey: string): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (let k = fromKey; k <= toKey; k = addMonths(k, 1)) map.set(k, { key: k, income: 0, expense: 0, goals: 0, invested: 0, net: 0 });
  for (const t of txns) {
    const r = map.get(monthKey(t.txn_date)); if (!r) continue;
    if (t.txn_type === "income") r.income += t.amount;
    else if (t.txn_type === "expense") r.expense += t.amount;
    else if (t.txn_type === "goal_contribution") r.goals += t.amount;
    else if (t.txn_type === "investment") r.invested += t.amount;
  }
  for (const r of map.values()) r.net = r.income - r.expense;
  return [...map.values()];
}

export function spendByCategory(txns: Txn[], key: string, data: AppData) {
  const m = new Map<string, Cents>();
  for (const t of txns) if (t.txn_type === "expense" && monthKey(t.txn_date) === key) m.set(t.category_id ?? "none", (m.get(t.category_id ?? "none") ?? 0) + t.amount);
  return [...m.entries()].map(([id, total]) => {
    const c = data.categories.find((c) => c.id === id);
    return { id, name: c?.name ?? "Uncategorized", color: c?.color ?? "#9AA19B", total };
  }).sort((a, b) => b.total - a.total);
}

export function incomeBySource(txns: Txn[], fromKey: string, toKey: string, data: AppData) {
  const m = new Map<string, Cents>();
  for (const t of txns) {
    const k = monthKey(t.txn_date);
    if (t.txn_type === "income" && k >= fromKey && k <= toKey) m.set(t.income_source_id ?? "none", (m.get(t.income_source_id ?? "none") ?? 0) + t.amount);
  }
  return data.sources.map((s) => ({ id: s.id, name: s.name, total: m.get(s.id) ?? 0 }))
    .concat(m.has("none") ? [{ id: "none", name: "Other", total: m.get("none")! }] : []);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stdev = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

/** Completed months only (excludes the current partial month). */
export function history(data: AppData, months: number | "all"): MonthRow[] {
  const cur = monthKey(today());
  const first = data.txns.length ? monthKey(data.txns[data.txns.length - 1].txn_date) : cur;
  const n = months === "all" ? Math.max(1, monthsBetween(first, cur)) : months;
  const from = addMonths(cur, -n) < first ? first : addMonths(cur, -n);
  return monthlySeries(data.txns, from, addMonths(cur, -1)).filter((r) => r.income || r.expense);
}

export interface Baseline { income: Cents; expense: Cents; goals: Cents; invested: Cents; incomeSd: Cents; expenseSd: Cents; months: number }
export function baseline(data: AppData, months: number | "all" = 12): Baseline {
  let h = history(data, months);
  if (h.length === 0) { const cur = monthKey(today()); h = monthlySeries(data.txns, cur, cur).filter((r) => r.income || r.expense); } // new user: use month-to-date
  return {
    income: Math.round(mean(h.map((r) => r.income))), expense: Math.round(mean(h.map((r) => r.expense))),
    goals: Math.round(mean(h.map((r) => r.goals))), invested: Math.round(mean(h.map((r) => r.invested))),
    incomeSd: Math.round(stdev(h.map((r) => r.income))), expenseSd: Math.round(stdev(h.map((r) => r.expense))),
    months: h.length,
  };
}

export function incomeStability(data: AppData) {
  const b = baseline(data, 12);
  const variance = b.income ? b.incomeSd / b.income : 0;
  return { pct: Math.round(variance * 100), label: variance < 0.08 ? "High" : variance < 0.2 ? "Medium" : "Low" };
}

export interface Scenario { incomePct: number; spendPct: number; extraSavings: Cents }
export const noScenario: Scenario = { incomePct: 0, spendPct: 0, extraSavings: 0 };

export interface PeriodProjection {
  label: string; income: Cents; expense: Cents; savings: Cents; low: Cents; high: Cents;
  actualMonths: number; projectedMonths: number; prevSavings: Cents | null; netWorthEnd: Cents;
}

/** Project a span of months: actuals for months already complete, baseline for the rest. */
export function projectSpan(data: AppData, fromKey: string, toKey: string, b: Baseline, sc: Scenario, label: string, prev: PeriodProjection | null = null): PeriodProjection {
  const cur = monthKey(today());
  const pInc = Math.round(b.income * (1 + sc.incomePct / 100));
  const pExp = Math.round(b.expense * (1 + sc.spendPct / 100));
  let income = 0, expense = 0, actualMonths = 0, projectedMonths = 0;
  const actual = new Map(monthlySeries(data.txns, fromKey, toKey).map((r) => [r.key, r]));
  for (let k = fromKey; k <= toKey; k = addMonths(k, 1)) {
    if (k < cur) { const r = actual.get(k)!; income += r.income; expense += r.expense; actualMonths++; }
    else if (k === cur) {
      // current month: whichever is larger of actual-so-far or the baseline (bills not yet logged)
      const r = actual.get(k)!; income += Math.max(r.income, pInc); expense += Math.max(r.expense, pExp); projectedMonths++;
    } else { income += pInc; expense += pExp; projectedMonths++; }
  }
  const savings = income - expense;
  const band = Math.round(Math.sqrt(projectedMonths) * (b.incomeSd + b.expenseSd));
  const nwNow = netWorth(data);
  const monthsAhead = Math.max(0, monthsBetween(cur, toKey));
  const nwEnd = nwNow + (pInc - pExp) * monthsAhead;
  return { label, income, expense, savings, low: savings - band, high: savings + band, actualMonths, projectedMonths, prevSavings: prev?.savings ?? null, netWorthEnd: nwEnd };
}

export function quarterRange(key: string, offset = 0): [string, string, string] {
  const y = Number(key.slice(0, 4)); const q = Math.floor((Number(key.slice(5, 7)) - 1) / 3) + offset;
  const yy = y + Math.floor(q / 4); const qq = ((q % 4) + 4) % 4;
  const from = `${yy}-${String(qq * 3 + 1).padStart(2, "0")}`;
  return [from, addMonths(from, 2), `Q${qq + 1} ${yy}`];
}

// ---------- goals ----------
export interface GoalOutlook { goal: Goal; pace: Cents; required: Cents | null; projected: string | null; monthsDelta: number | null; status: "Done" | "Ahead" | "On track" | "Behind" | "No plan" }

/** Pace = average monthly contribution over the last 6 completed months (fallback: planned amount). */
export function goalOutlook(data: AppData, g: Goal, extraMonthly: Cents = 0): GoalOutlook {
  const cur = monthKey(today());
  const from = addMonths(cur, -6);
  const contrib = data.txns.filter((t) => t.goal_id === g.id && t.txn_type === "goal_contribution" && monthKey(t.txn_date) >= from && monthKey(t.txn_date) < cur);
  const actualPace = Math.round(sum(contrib.map((t) => t.amount)) / 6);
  const pace = (actualPace || g.monthly) + extraMonthly;
  const remaining = g.target - g.saved;
  if (remaining <= 0) return { goal: g, pace, required: 0, projected: cur, monthsDelta: 0, status: "Done" };
  const required = g.target_date ? Math.ceil(remaining / Math.max(1, monthsBetween(cur, monthKey(g.target_date)))) : null;
  if (pace <= 0) return { goal: g, pace, required, projected: null, monthsDelta: null, status: "No plan" };
  const projected = addMonths(cur, Math.ceil(remaining / pace));
  const monthsDelta = g.target_date ? monthsBetween(projected, monthKey(g.target_date)) : null;
  const status = monthsDelta === null ? "On track" : monthsDelta > 0 ? "Ahead" : monthsDelta === 0 ? "On track" : "Behind";
  return { goal: g, pace, required, projected, monthsDelta, status };
}

/** Monthly amount needed to hit `target` by `dateKey` from `saved`. */
export const requiredMonthly = (target: Cents, saved: Cents, dateKey: string) =>
  Math.ceil(Math.max(0, target - saved) / Math.max(1, monthsBetween(monthKey(today()), dateKey)));

// ---------- net worth & freedom number ----------
export const investedTotal = (d: AppData) => sum(d.holdings.filter((h) => h.counts_toward_freedom).map((h) => h.value));
export const netWorth = (d: AppData) => sum(d.holdings.map((h) => h.value)) + sum(d.goals.map((g) => g.saved));

export function annualExpenses(d: AppData): Cents {
  if (d.profile.annual_expenses_override != null) return d.profile.annual_expenses_override;
  return baseline(d, 12).expense * 12;
}

export interface FreedomInput { annualExpenses: Cents; withdrawalRate: number; invested: Cents; monthly: Cents; returnPct: number; birthYear: number | null }
export function freedom(i: FreedomInput) {
  const target = Math.round(i.annualExpenses / (i.withdrawalRate / 100));
  const progress = target ? Math.min(1, i.invested / target) : 0;
  const r = i.returnPct / 100 / 12;
  let bal = i.invested; let months = 0;
  const path: { year: number; value: Cents }[] = [{ year: 0, value: bal }];
  while (bal < target && months < 100 * 12) {
    bal = bal * (1 + r) + i.monthly; months++;
    if (months % 12 === 0) path.push({ year: months / 12, value: Math.round(bal) });
  }
  const reached = bal >= target;
  const years = reached ? months / 12 : null;
  const yearReached = years !== null ? new Date().getFullYear() + Math.ceil(years) : null;
  return { target, progress, years, yearReached, ageReached: yearReached && i.birthYear ? yearReached - i.birthYear : null, path };
}

// ---------- CSV ----------
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // neutralise spreadsheet formula injection, then quote
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCSV = (header: string[], rows: unknown[][]) => [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
export const dec = (c: Cents) => centsToDb(c);
