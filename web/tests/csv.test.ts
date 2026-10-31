import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSV, guessMapping, parseDate, parseAmount, guessDateFormat, buildRows } from "../src/lib/csvImport";

test("parses quotes, commas inside quotes, CRLF, BOM, semicolons", () => {
  assert.deepEqual(parseCSV('﻿Date,Description,Amount\r\n2026-10-01,"Coffee, large",-4.50\r\n'), [["Date", "Description", "Amount"], ["2026-10-01", "Coffee, large", "-4.50"]]);
  assert.deepEqual(parseCSV('a;b\n"say ""hi""";2\n'), [["a", "b"], ['say "hi"', "2"]]);
});
test("guesses columns from common bank headers", () => {
  assert.deepEqual(guessMapping(["Posting Date", "Payee", "Debit", "Credit", "Memo"]), { date: 0, description: 1, debit: 2, credit: 3 });
  const m = guessMapping(["date", "description", "type", "category", "income_source", "account", "amount", "currency", "notes"]);
  assert.equal(m.amount, 6); assert.equal(m.type, 2); assert.equal(m.notes, 8); assert.equal(m.income_source, 4);
});
test("dates: ISO, US, EU, short year, month names, invalid", () => {
  assert.equal(parseDate("2026-10-31", "MDY"), "2026-10-31");
  assert.equal(parseDate("10/31/2026", "MDY"), "2026-10-31");
  assert.equal(parseDate("31/10/2026", "DMY"), "2026-10-31");
  assert.equal(parseDate("1/5/26", "MDY"), "2026-01-05");
  assert.equal(parseDate("31 Oct 2026", "MDY"), "2026-10-31");
  assert.equal(parseDate("Oct 31, 2026", "MDY"), "2026-10-31");
  assert.equal(parseDate("2026-10-31T23:00:00Z", "MDY"), "2026-10-31"); // no UTC shift
  assert.equal(parseDate("02/30/2026", "MDY"), null);
  assert.equal(parseDate("hello", "MDY"), null);
  assert.equal(guessDateFormat(["31/10/2026", "01/11/2026"]), "DMY");
  assert.equal(guessDateFormat(["10/31/2026"]), "MDY"); assert.equal(guessDateFormat(["10/02/2026", "10/03/2026", "13/45/2026"]), "MDY");
});
test("amounts: currency, thousands, parentheses, trailing minus, EU decimals, exact cents", () => {
  assert.equal(parseAmount("$1,234.50"), 123450); assert.equal(parseAmount("(12.00)"), -1200);
  assert.equal(parseAmount("12.00-"), -1200); assert.equal(parseAmount("-0.10"), -10);
  assert.equal(parseAmount("1.234,50"), 123450); assert.equal(parseAmount("12,5"), 1250);
  assert.equal(parseAmount("10.555"), 1056); assert.equal(parseAmount("1.234.567"), 123456700); assert.equal(parseAmount("abc"), null); assert.equal(parseAmount(""), null);
});
test("buildRows: sign rules, debit/credit, type words, errors with line numbers", () => {
  const rows = buildRows([["2026-10-01", "Coffee", "-4.50"], ["2026-10-02", "Salary", "2750"], ["bad", "x", "1"], ["2026-10-03", "", "1"], ["2026-10-04", "Zero", "0"]],
    { date: 0, description: 1, amount: 2 }, { dateFormat: "MDY", sign: "negative_is_expense" });
  assert.deepEqual(rows[0].row, { date: "2026-10-01", description: "Coffee", amount: "4.50", type: "expense", category: "", notes: "", income_source: "" });
  assert.equal(rows[1].row!.type, "income"); assert.equal(rows[1].row!.amount, "2750.00");
  assert.match(rows[2].error!, /Date/); assert.equal(rows[2].line, 4);
  assert.match(rows[3].error!, /Description/); assert.match(rows[4].error!, /zero/);
  const dc = buildRows([["10/05/2026", "Rent", "1650.00", ""], ["10/06/2026", "Refund", "", "20"]], { date: 0, description: 1, debit: 2, credit: 3 }, { dateFormat: "MDY", sign: "negative_is_expense" });
  assert.equal(dc[0].row!.type, "expense"); assert.equal(dc[0].row!.amount, "1650.00"); assert.equal(dc[1].row!.type, "income");
  const typed = buildRows([["2026-10-01", "Fund", "-550.00", "goal_contribution", "House Deposit"]], { date: 0, description: 1, amount: 2, type: 3, category: 4 }, { dateFormat: "MDY", sign: "negative_is_expense" });
  assert.equal(typed[0].row!.type, "goal_contribution"); assert.equal(typed[0].row!.category, "House Deposit"); assert.equal(typed[0].row!.amount, "550.00");
});
