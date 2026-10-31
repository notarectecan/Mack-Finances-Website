// Calendar dates are plain "YYYY-MM-DD" strings in the user's LOCAL time zone.
// Never use Date.toISOString() for a txn_date: it converts to UTC and an 11pm
// expense on the 31st would jump to the next month.

const pad = (n: number) => String(n).padStart(2, "0");

export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const today = () => localDate();
export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** "2026-10-31" -> "2026-10" (pure string op, no time zone involved) */
export const monthKey = (d: string) => d.slice(0, 7);
export const monthStart = (key: string) => `${key}-01`;

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
export function monthEnd(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${key}-${pad(new Date(y, m, 0).getDate())}`;
}
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number); const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
export const quarterOf = (key: string) => `${key.slice(0, 4)}-Q${Math.floor((Number(key.slice(5, 7)) - 1) / 3) + 1}`;

export function labelMonth(key: string, style: "short" | "long" = "short") {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: style, year: style === "long" ? "numeric" : undefined });
}
export function labelDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
