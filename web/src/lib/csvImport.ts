// CSV import: parsing, column detection, and normalisation (pure functions, no network).
// Money becomes exact decimal strings via integer cents; dates become plain local "YYYY-MM-DD".
import { centsToDb } from "./money";
import type { TxnType } from "./api";

export type Field = "date" | "description" | "amount" | "debit" | "credit" | "type" | "category" | "notes" | "income_source";
export type Mapping = Partial<Record<Field, number>>;
export type DateFormat = "YMD" | "MDY" | "DMY";
export type SignMode = "negative_is_expense" | "positive_is_expense" | "all_expense" | "all_income";

export interface ImportRow { date: string; description: string; amount: string; type: TxnType; category: string; notes: string; income_source: string }
export interface RowResult { line: number; row?: ImportRow; error?: string }

/** RFC-4180 style parser: quotes, escaped quotes, CRLF/LF, BOM; auto-detects , ; or tab. */
export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const HINTS: Record<Field, RegExp> = {
  date: /^(date|txn.?date|transaction.?date|posted|posting.?date|booking.?date|value.?date)$/i,
  description: /^(description|desc|memo|payee|name|merchant|details|narrative|transaction|reference)$/i,
  amount: /^(amount|value|amt|transaction.?amount|sum)$/i,
  debit: /^(debit|withdrawal|withdrawals|money.?out|paid.?out|out)$/i,
  credit: /^(credit|deposit|deposits|money.?in|paid.?in|in)$/i,
  type: /^(type|txn.?type|transaction.?type|kind)$/i,
  category: /^(category|categories|cat|goal)$/i,
  notes: /^(notes?|comment|comments|remarks)$/i,
  income_source: /^(income.?source|source)$/i,
};
export function guessMapping(header: string[]): Mapping {
  const m: Mapping = {};
  header.forEach((h, i) => {
    const t = h.trim();
    for (const f of Object.keys(HINTS) as Field[]) if (m[f] === undefined && HINTS[f].test(t)) { m[f] = i; break; }
  });
  return m;
}

const pad = (n: number) => String(n).padStart(2, "0");
function validYMD(y: number, m: number, d: number) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(y, m, 0).getDate()) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
export function parseDate(raw: string, fmt: DateFormat): string | null {
  const s = raw.trim().replace(/T.*$/, "").replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i, "");
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return validYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return fmt === "DMY" ? validYMD(y, +m[2], +m[1]) : validYMD(y, +m[1], +m[2]);
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-,]*(\d{4})$/) ; // 31 Oct 2026
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mo ? validYMD(+m[3], mo, +m[1]) : null; }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/); // Oct 31, 2026
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; return mo ? validYMD(+m[3], mo, +m[2]) : null; }
  return null;
}
/** Pick MDY vs DMY by looking for a first number > 12 in slash dates. */
export function guessDateFormat(values: string[]): DateFormat {
  let mdy = 0, dmy = 0;
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    const a = +m[1], b = +m[2];
    if (a < 1 || b < 1 || a > 31 || b > 31 || (a > 12 && b > 12)) continue; // impossible date: ignore it
    if (a > 12) dmy++; else if (b > 12) mdy++;
  }
  return dmy > mdy ? "DMY" : "MDY";
}

/** "$1,234.50", "(12.00)", "-12", "12.00-", "1.234,50" -> signed cents, or null */
export function parseAmount(raw: string): number | null {
  let s = raw.trim(); if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/[\s$£€¥]|USD|GBP|EUR|CAD|AUD/gi, "");
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s) || /^\d{1,3}(\.\d{3}){2,}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,50
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [w, fr = ""] = s.split(".");
  const f3 = (fr + "000").slice(0, 3);
  const cents = +w * 100 + +f3.slice(0, 2) + (+f3[2] >= 5 ? 1 : 0);
  return neg ? -cents : cents;
}

const TYPE_WORDS: Record<string, TxnType> = {
  expense: "expense", debit: "expense", withdrawal: "expense", purchase: "expense", payment: "expense",
  income: "income", credit: "income", deposit: "income",
  transfer: "transfer", goal_contribution: "goal_contribution", goal: "goal_contribution", investment: "investment",
};

export function buildRows(data: string[][], map: Mapping, opts: { dateFormat: DateFormat; sign: SignMode }): RowResult[] {
  const cell = (r: string[], f: Field) => (map[f] === undefined ? "" : (r[map[f]!] ?? "").trim());
  return data.map((r, i) => {
    const line = i + 2; // +1 header, +1 human counting
    const date = parseDate(cell(r, "date"), opts.dateFormat);
    if (!date) return { line, error: `Date not recognised: "${cell(r, "date")}"` };
    const description = cell(r, "description").slice(0, 200);
    if (!description) return { line, error: "Description is empty" };
    let cents: number | null;
    if (map.amount !== undefined) cents = parseAmount(cell(r, "amount"));
    else {
      const d = parseAmount(cell(r, "debit")) ?? 0, c = parseAmount(cell(r, "credit")) ?? 0;
      cents = c - Math.abs(d); if (!c && !d) cents = null;
    }
    if (cents === null) return { line, error: `Amount not recognised: "${cell(r, "amount") || cell(r, "debit") || cell(r, "credit")}"` };
    if (cents === 0) return { line, error: "Amount is zero" };
    const typeWord = TYPE_WORDS[cell(r, "type").toLowerCase()];
    let type: TxnType;
    if (typeWord) type = typeWord;
    else if (opts.sign === "all_expense") type = "expense";
    else if (opts.sign === "all_income") type = "income";
    else if (opts.sign === "positive_is_expense") type = cents > 0 ? "expense" : "income";
    else type = cents < 0 ? "expense" : "income";
    return { line, row: { date, description, amount: centsToDb(Math.abs(cents)), type, category: cell(r, "category").slice(0, 40), notes: cell(r, "notes").slice(0, 1000), income_source: cell(r, "income_source") } };
  });
}

// ---------- Recognise Mack Finances' own export files (no column matching needed) ----------
export type FileKind =
  | { kind: "mf_transactions" }
  | { kind: "mf_income_summary" }
  | { kind: "mf_unsupported"; label: string }
  | { kind: "generic" };

export function detectFileKind(header: string[]): FileKind {
  const h = header.map((x) => x.trim().toLowerCase());
  const has = (...cols: string[]) => cols.every((c) => h.includes(c));
  if (has("date", "description", "type", "amount") && (h.includes("currency") || h.includes("income_source"))) return { kind: "mf_transactions" };
  if (h[0] === "month" && has("total_income", "total_spending")) return { kind: "mf_income_summary" };
  if (has("month", "category", "budgeted", "spent")) return { kind: "mf_unsupported", label: "Budget vs Actual" };
  if (has("goal", "target", "saved")) return { kind: "mf_unsupported", label: "Goals & Progress" };
  if (has("holding", "type", "value")) return { kind: "mf_unsupported", label: "Investments / Holdings" };
  if (has("date", "net_worth") && h.length === 2) return { kind: "mf_unsupported", label: "Net Worth History" };
  if (has("period", "income", "spending", "savings")) return { kind: "mf_unsupported", label: "Projections" };
  return { kind: "generic" };
}

/** "Owner's Draw – Business" -> "Owner's Draw" (matches the app's default income categories) */
const categoryFromSource = (s: string) => s.split(/\s+[–—-]\s+/)[0].trim();

/**
 * Income Summary export -> transactions: per month, one income entry per source column,
 * one "Monthly spending" expense and one "Saved & invested" entry. Totals/net/average rows are ignored
 * (the app recalculates them). Dated the 1st of each month so each total lands in the right month.
 */
export function buildIncomeSummaryRows(header: string[], data: string[][]): { results: RowResult[]; ignoredRows: number } {
  const h = header.map((x) => x.trim().toLowerCase());
  const iTotal = h.indexOf("total_income"), iSpend = h.indexOf("total_spending"), iSaved = h.indexOf("saved_and_invested");
  const sourceCols = header.map((name, i) => ({ name: name.trim(), i })).filter(({ i }) => i > 0 && i < iTotal);
  const results: RowResult[] = []; let ignoredRows = 0;
  data.forEach((r, idx) => {
    const line = idx + 2; const month = (r[0] ?? "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { ignoredRows++; return; } // e.g. "MONTHLY AVERAGE"
    const date = `${month}-01`;
    const push = (raw: string | undefined, row: Omit<ImportRow, "date" | "amount">, what: string) => {
      if (raw === undefined || raw.trim() === "") return;
      const c = parseAmount(raw);
      if (c === null) { results.push({ line, error: `${what}: amount not recognised "${raw}"` }); return; }
      if (c === 0) return;
      results.push({ line, row: { ...row, date, amount: centsToDb(Math.abs(c)) } });
    };
    for (const s of sourceCols) push(r[s.i], { description: `${s.name} (monthly total)`, type: "income", category: categoryFromSource(s.name), notes: "Imported from Income Summary", income_source: s.name }, s.name);
    if (iSpend >= 0) push(r[iSpend], { description: "Monthly spending (imported total)", type: "expense", category: "Other", notes: "Imported from Income Summary", income_source: "" }, "total_spending");
    if (iSaved >= 0) push(r[iSaved], { description: "Saved & invested (imported total)", type: "investment", category: "", notes: "Imported from Income Summary", income_source: "" }, "saved_and_invested");
  });
  return { results, ignoredRows };
}
