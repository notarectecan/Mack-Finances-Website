import { test } from "node:test";
import assert from "node:assert/strict";
import { toCents, centsToDb, parseMoneyInput, sum } from "../src/lib/money";
import { localDate, monthKey, addMonths, monthEnd, monthsBetween } from "../src/lib/dates";
import { freedom, toCSV, quarterRange } from "../src/lib/calc";

test("money: no float drift (0.10 + 0.20 === 0.30)", () => {
  assert.equal(centsToDb(sum([toCents("0.10"), toCents("0.20")])), "0.30");
  assert.equal(centsToDb(sum(Array(1000).fill(toCents(0.1)))), "100.00");
  assert.equal(0.1 + 0.2 === 0.3, false); // the bug we're avoiding
});
test("money: rounding & parsing match numeric(12,2)", () => {
  assert.equal(toCents("10.555"), 1056); assert.equal(toCents("10.554"), 1055); assert.equal(toCents(4195), 419500);
  assert.equal(parseMoneyInput("$1,234.5"), 123450); assert.equal(parseMoneyInput("12.345"), null); assert.equal(parseMoneyInput("abc"), null);
  assert.equal(centsToDb(-5), "-0.05"); assert.equal(centsToDb(600000), "6000.00");
});
test("dates: 11pm on Oct 31 local stays in October (no UTC conversion)", () => {
  const d = new Date(2026, 9, 31, 23, 0, 0); // local time
  assert.equal(localDate(d), "2026-10-31"); assert.equal(monthKey(localDate(d)), "2026-10");
});
test("dates: month math", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01"); assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(monthEnd("2028-02"), "2028-02-29"); assert.equal(monthsBetween("2026-10", "2028-12"), 26);
  assert.deepEqual(quarterRange("2026-10"), ["2026-10", "2026-12", "Q4 2026"]); assert.deepEqual(quarterRange("2026-10", 1), ["2027-01", "2027-03", "Q1 2027"]);
});
test("freedom number: $50,400 / 4% = $1,260,000; 7.4% progress", () => {
  const f = freedom({ annualExpenses: 5040000, withdrawalRate: 4, invested: 9290000, monthly: 90000, returnPct: 7, birthYear: 1994 });
  assert.equal(f.target, 126000000); assert.equal((f.progress * 100).toFixed(1), "7.4"); assert.ok(f.years! > 15 && f.years! < 30);
});
test("csv: escapes quotes/commas and neutralises formula injection", () => {
  const csv = toCSV(["a", "b"], [['He said "hi", ok', "=HYPERLINK(\"x\")"], ["-12.50", "+1"]]);
  assert.ok(csv.includes('"He said ""hi"", ok"')); assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes("-12.50")); assert.ok(csv.includes("'+1"));
});
