import require_fs from "node:fs";
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
const results = []; const assert = (c, m) => { if (!c) throw new Error(m); };
const b = await chromium.launch(); const page = await (await b.newContext({ timezoneId: "America/Chicago", viewport: { width: 1440, height: 1000 } })).newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.clock.setFixedTime(new Date("2026-10-31T16:00:00-05:00"));
const id = (t) => page.getByTestId(t);
const step = async (n, fn) => { try { await fn(); results.push(["PASS", n]); } catch (e) { results.push(["FAIL", n, e.message.split("\n")[0]]); await page.screenshot({ path: `/tmp/imp-fail-${results.length}.png` }); } };
const log = () => page.evaluate(() => window.__db.log);
await page.goto("http://127.0.0.1:4174/index.html");
await id("to-signup").click(); await id("name").fill("Sam"); await id("email").fill("sam@test.local"); await id("password").fill("Str0ng!Pass1"); await id("password2").fill("Str0ng!Pass1"); await id("auth-submit").click();
for (let i = 0; i < 3; i++) await id("setup-next").click(); await id("setup-finish").click(); await id("greeting").waitFor();

await step("01 Settings: 'Load demo data' button is gone; button reads 'Import data (CSV)'", async () => {
  await id("nav-settings").click(); await id("import-card").waitFor();
  assert(!(await page.getByText("Load demo data").count()), "demo button still there");
  assert((await id("import-btn").textContent()).trim() === "Import data (CSV)", "label: " + await id("import-btn").textContent());
});
const bank = 'Posting Date,Payee,Debit,Credit,Memo\r\n10/02/2026,"Whole Foods, Austin",84.20,,weekly shop\r\n10/03/2026,Payroll,,2750.00,\r\n10/04/2026,Netflix,15.49,,\r\n13/45/2026,Broken row,1.00,,\r\n';
await step("02 Bank CSV (Debit/Credit columns, US dates): columns auto-matched, preview shows 3 ready + 1 problem", async () => {
  await id("import-file").setInputFiles({ name: "chase-october.csv", mimeType: "text/csv", buffer: Buffer.from(bank) });
  await id("import-modal").waitFor();
  const s = await id("import-summary").textContent();
  assert(s.includes("3 ready") && s.includes("1 with problems"), s);
  assert((await id("import-preview").textContent()).includes("Date not recognised"), "error row not shown");
});
await step("03 Import: one atomic call, exact decimal strings, local dates, no file name leak beyond name", async () => {
  await id("import-run").click(); await id("import-modal").waitFor({ state: "detached" });
  const call = (await log()).filter((l) => l.op === "rpc" && l.table === "import_transactions").at(-1).payload;
  assert(call.p_rows.length === 3, "rows " + call.p_rows.length);
  assert(call.p_rows[0].date === "2026-10-02" && call.p_rows[0].amount === "84.20" && call.p_rows[0].type === "expense", JSON.stringify(call.p_rows[0]));
  assert(call.p_rows[1].type === "income" && call.p_rows[1].amount === "2750.00", JSON.stringify(call.p_rows[1]));
  assert(call.p_file_name === "chase-october.csv" && call.p_skip_duplicates === true, "options");
  const n = await page.evaluate(() => window.__db.tables.transactions.filter((t) => t.import_id).length); assert(n === 3, "db rows " + n);
  assert((await id("import-history").textContent()).includes("3 added"), "history");
});
await step("04 Importing the same file again skips all duplicates", async () => {
  await id("import-file").setInputFiles({ name: "chase-october.csv", mimeType: "text/csv", buffer: Buffer.from(bank) });
  await id("import-modal").waitFor(); await id("import-run").click(); await id("import-modal").waitFor({ state: "detached" });
  const n = await page.evaluate(() => window.__db.tables.transactions.filter((t) => t.import_id).length); assert(n === 3, "duplicates imported: " + n);
  assert((await id("toast").textContent()).includes("3 already in the app"), await id("toast").textContent());
});
await step("05 Mack Finances export round-trip: type + category columns, missing category created, goal contribution matched", async () => {
  const exp = 'date,description,type,category,income_source,account,amount,currency,notes\r\n2026-09-15,House Deposit contribution,goal_contribution,House Deposit,,Main Checking,-550.00,USD,\r\n2026-09-20,Pet food,expense,Pets,,Main Checking,-42.10,USD,"cat, dog"\r\n2026-09-28,Consulting,income,Side Income,,Main Checking,600.00,USD,\r\n';
  await id("import-file").setInputFiles({ name: "mack-export.csv", mimeType: "text/csv", buffer: Buffer.from(exp) });
  await id("import-modal").waitFor(); assert((await id("import-summary").textContent()).includes("3 ready"), "summary");
  await id("import-run").click(); await id("import-modal").waitFor({ state: "detached" });
  const st = await page.evaluate(() => { const d = window.__db.tables; const g = d.goals.find((x) => x.name === "House Deposit"); const t = d.transactions.find((x) => x.description === "House Deposit contribution");
    return { goalMatched: t?.goal_id === g?.id, pets: d.categories.some((c) => c.name === "Pets" && c.kind === "expense"), note: d.transactions.find((x) => x.description === "Pet food")?.notes }; });
  assert(st.goalMatched && st.pets && st.note === "cat, dog", JSON.stringify(st));
});
await step("06 Undo needs a second click, then removes only that import's transactions", async () => {
  const before = await page.evaluate(() => window.__db.tables.transactions.length);
  await id("undo-import").first().click(); assert(await page.evaluate(() => window.__db.tables.transactions.length) === before, "removed on first click");
  await id("undo-import").first().click(); await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__db.tables.transactions.length); assert(after === before - 3, `before ${before} after ${after}`);
});
await step("07 Wrong file type / empty file are rejected politely", async () => {
  await id("import-file").setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("Date,Description,Amount\r\n") });
  await page.waitForTimeout(200); assert((await id("toast").textContent()).includes("no data rows"), await id("toast").textContent());
  assert(!(await id("import-modal").count()), "modal opened for empty file");
});
await step("08 No page errors", async () => assert(errors.length === 0, errors.join(" | ")));

await step("09 User's Income Summary export imports with NO column matching", async () => {
  const csv = require_fs.readFileSync("/tmp/income_summary.csv");
  await id("nav-settings").click(); await id("import-card").waitFor();
  await id("import-file").setInputFiles({ name: "income_summary_2026-10-31 (1).csv", mimeType: "text/csv", buffer: csv });
  await id("import-modal").waitFor();
  assert((await id("import-recognised").textContent()).includes("Income Summary"), "not recognised");
  assert(!(await page.getByTestId("map-date").count()), "column matching still shown");
  assert((await id("import-summary").textContent()).includes("60 ready"), await id("import-summary").textContent());
  await page.waitForTimeout(300); await page.screenshot({ path: "/tmp/summary-modal.png" });
  const before = await page.evaluate(() => window.__db.tables.transactions.length);
  const catsBefore = await page.evaluate(() => window.__db.tables.categories.length);
  await id("import-run").click(); await id("import-modal").waitFor({ state: "detached" });
  const after = await page.evaluate(() => window.__db.tables.transactions.length);
  assert(after - before === 60, `added ${after - before}`);
  const aug = await page.evaluate(() => { const d = window.__db.tables; const c = (id) => d.categories.find((x) => x.id === id)?.name;
    return d.transactions.filter((t) => t.txn_date === "2026-08-01" && t.import_id).map((t) => `${t.txn_type}|${c(t.category_id) ?? ""}|${t.amount}`).sort(); });
  assert(JSON.stringify(aug) === JSON.stringify(["expense|Other|3597.12","income|Dividends & Interest|85","income|Owner's Draw|5500","income|Side Income|15000","investment||2767"]), JSON.stringify(aug));
  const catsAfter = await page.evaluate(() => window.__db.tables.categories.length);
  assert(catsAfter === catsBefore, `categories created: ${catsAfter - catsBefore}`);
});
await step("10 Re-importing the same summary adds nothing (all duplicates)", async () => {
  await id("import-file").setInputFiles({ name: "income_summary_2026-10-31 (1).csv", mimeType: "text/csv", buffer: require_fs.readFileSync("/tmp/income_summary.csv") });
  await id("import-modal").waitFor(); await id("import-run").click(); await id("import-modal").waitFor({ state: "detached" });
  assert((await id("toast").textContent()).includes("60 already in the app"), await id("toast").textContent());
});
await step("11 Transactions list shows the 12 imported Side Income monthly totals incl. $15,000 in August", async () => {
  await id("nav-transactions").click(); await page.getByText("All time").click(); await id("tx-search").fill("Side Income – Consulting (monthly total)");
  await page.waitForTimeout(300); const rows = await id("tx-row").allTextContents();
  assert(rows.length === 12, "rows " + rows.length); assert(rows.some((r) => r.includes("Aug 1") && r.includes("15,000.00")), rows.join(" / "));
});
await step("12 No page errors (after summary import)", async () => assert(errors.length === 0, errors.join(" | ")));

await page.getByTestId("nav-settings").click(); await page.waitForTimeout(400); await page.screenshot({ path: "/tmp/settings-import.png" });
await id("import-file").setInputFiles({ name: "chase-october.csv", mimeType: "text/csv", buffer: Buffer.from(bank.replace("10/02", "10/12").replace("10/03", "10/13").replace("10/04", "10/14")) });
await id("import-modal").waitFor(); await page.waitForTimeout(300); await page.screenshot({ path: "/tmp/import-modal.png" });
await b.close(); for (const r of results) console.log(r.join("  ")); console.log(`${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
