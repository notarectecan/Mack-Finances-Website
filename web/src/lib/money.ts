// All money math happens in INTEGER CENTS. The DB stores numeric(12,2);
// we convert once on read (toCents) and once on write (centsToDb). No float sums ever.

export type Cents = number;

export function toCents(v: string | number | null | undefined): Cents {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 0;
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  // round half-up on the 3rd decimal, matching numeric(12,2)
  const f = (frac + "000").slice(0, 3);
  let cents = parseInt(whole, 10) * 100 + parseInt(f.slice(0, 2), 10) + (parseInt(f[2], 10) >= 5 ? 1 : 0);
  return neg ? -cents : cents;
}

/** Parse what a user typed ("1,234.5", "$12") into cents. Returns null if invalid. */
export function parseMoneyInput(input: string): Cents | null {
  const s = input.replace(/[\s,$£€]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return toCents(s);
}

/** Exact decimal string for the DB — never a float. */
export function centsToDb(c: Cents): string {
  const neg = c < 0;
  const a = Math.abs(Math.round(c));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

let currency = "USD";
export function setCurrency(code: string) { currency = code || "USD"; }

export function fmt(c: Cents, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  const s = new Intl.NumberFormat(undefined, {
    style: "currency", currency,
    minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0,
  }).format(Math.abs(c) / 100);
  if (opts.sign) return (c < 0 ? "–" : "+") + s;
  return c < 0 ? "–" + s : s;
}

export const sum = (xs: Cents[]) => xs.reduce((a, b) => a + b, 0);
