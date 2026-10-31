// Offline UI end-to-end: drives the real React app in Chromium (Chicago time zone, clock frozen at
// 11:00pm on Oct 31 to exercise the month-boundary risk) and asserts on every request the UI makes.
import { chromium } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:4173/index.html";
const results = []; let page;
const step = async (name, fn) => {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message.split("\n")[0], (e.stack.match(/ui\.e2e\.mjs:(\d+)/) || [])[1]]); await page?.screenshot({ path: `../docs/screenshots/FAIL-${results.length}.png` }).catch(() => {}); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const log = () => page.evaluate(() => window.__db.log);
const lastWrite = async (table, op = "insert") => (await log()).filter((l) => l.table === table && l.op === op).at(-1)?.payload;
mkdirSync("../docs/screenshots", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ timezoneId: "America/Chicago", viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.clock.setFixedTime(new Date("2026-10-31T23:00:00-05:00")); // = 2026-11-01 04:00 UTC
await page.goto(BASE);

await step("01 login screen renders; wrong password shows error", async () => {
  await page.getByTestId("auth-form").waitFor();
  await page.getByTestId("email").fill("nobody@test.local"); await page.getByTestId("password").fill("wrongpass1");
  await page.getByTestId("auth-submit").click();
  assert((await page.getByTestId("auth-error").textContent()).includes("Incorrect email or password"), "no error shown");
});

await step("02 sign up rejects weak password / mismatch", async () => {
  await page.getByTestId("to-signup").click();
  await page.getByTestId("name").fill("Jordan"); await page.getByTestId("email").fill("jordan@test.local");
  await page.getByTestId("password").fill("short"); await page.getByTestId("password2").fill("short");
  await page.getByTestId("auth-submit").click();
  assert(await page.getByTestId("auth-error").isVisible(), "weak password accepted");
});

await step("03 sign up → first-run setup (start fresh, custom goal, dark theme) → dashboard", async () => {
  await page.getByTestId("password").fill("Str0ng!Pass"); await page.getByTestId("password2").fill("Str0ng!Pass");
  await page.getByTestId("auth-submit").click();
  await page.getByTestId("setup").waitFor();
  await page.getByTestId("setup-name").fill("Jordan"); await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-next").click(); // income sources (defaults)
  await page.getByTestId("setup-next").click(); // goal (House Deposit 60000)
  await page.getByText("Dark", { exact: true }).click();
  await page.getByTestId("setup-finish").click();
  await page.getByTestId("greeting").waitFor();
  assert((await page.getByTestId("greeting").textContent()).includes("Jordan"), "greeting missing name");
  const g = await lastWrite("goals");
  assert(g.target_amount === "60000.00" && g.is_primary === true, "goal payload wrong: " + JSON.stringify(g));
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "theme not dark");
  await page.screenshot({ path: "../docs/screenshots/01-dashboard-empty-dark.png" });
});

await step("04 add expense at 11pm Oct 31 (Chicago): txn_date stays 2026-10-31, amount sent as exact decimal string", async () => {
  await page.getByTestId("add-txn").click();
  await page.getByTestId("txn-amount").fill("12.34"); await page.getByTestId("txn-desc").fill("Corner shop snacks");
  await page.getByTestId("txn-category").selectOption({ label: "Groceries" });
  await page.getByTestId("txn-save").click(); await page.getByTestId("txn-modal").waitFor({ state: "detached" });
  const p = await lastWrite("transactions");
  assert(p.txn_date === "2026-10-31", "txn_date was " + p.txn_date);
  assert(p.amount === "12.34" && typeof p.amount === "string", "amount sent as " + JSON.stringify(p.amount));
  assert(p.category_origin === "manual", "origin " + p.category_origin);
  await page.waitForTimeout(700); assert((await page.getByTestId("kpi-spent").textContent()).includes("12"), "dashboard spent not updated: " + await page.getByTestId("kpi-spent").textContent());
});

await step("05 AI unavailable (no key) → app degrades gracefully, manual category still works", async () => {
  await page.getByTestId("add-txn").click();
  await page.getByTestId("txn-amount").fill("8"); await page.getByTestId("txn-desc").fill("Bus fare"); await page.getByTestId("txn-desc").blur();
  await page.waitForTimeout(150);
  assert(!(await page.getByTestId("ai-suggestion").isVisible()), "AI suggestion shown with no key");
  await page.getByTestId("txn-category").selectOption({ label: "Transport" });
  await page.getByTestId("txn-save").click(); await page.getByTestId("txn-modal").waitFor({ state: "detached" });
  assert((await lastWrite("transactions")).amount === "8.00", "amount");
});

await step("06 AI categorization: sends ONLY description+kind, picks an existing category, saved as origin=ai", async () => {
  await page.evaluate(() => (window.__db.aiMode = "on"));
  await page.getByTestId("add-txn").click();
  await page.getByTestId("txn-amount").fill("84.20");
  await page.getByTestId("txn-desc").fill("Whole Foods Market"); await page.getByTestId("txn-desc").blur();
  await page.getByTestId("ai-suggestion").waitFor();
  const inv = (await log()).filter((l) => l.op === "invoke" && l.table === "ai-categorize").at(-1).payload;
  assert(JSON.stringify(Object.keys(inv).sort()) === '["description","kind"]', "extra data sent to AI: " + JSON.stringify(inv));
  const sel = await page.getByTestId("txn-category").evaluate((s) => s.options[s.selectedIndex].text);
  assert(sel === "Groceries", "AI picked " + sel);
  await page.getByTestId("txn-save").click(); await page.getByTestId("txn-modal").waitFor({ state: "detached" });
  assert((await lastWrite("transactions")).category_origin === "ai", "origin not ai");
});

await step("07 manual override of an AI suggestion is saved as origin=manual", async () => {
  await page.getByTestId("add-txn").click();
  await page.getByTestId("txn-amount").fill("30"); await page.getByTestId("txn-desc").fill("Farmers market flowers"); await page.getByTestId("txn-desc").blur();
  await page.getByTestId("ai-suggestion").waitFor();
  await page.getByTestId("txn-category").selectOption({ label: "Shopping" });
  await page.getByTestId("txn-save").click(); await page.getByTestId("txn-modal").waitFor({ state: "detached" });
  const p = await lastWrite("transactions");
  assert(p.category_origin === "manual", "override not respected");
});

await step("08 validation: zero amount / empty description are blocked client-side", async () => {
  const before = (await log()).length;
  await page.getByTestId("add-txn").click(); await page.getByTestId("txn-amount").fill("0"); await page.getByTestId("txn-desc").fill("x");
  await page.getByTestId("txn-save").click(); assert(await page.getByTestId("txn-error").isVisible(), "no error for 0");
  await page.getByTestId("txn-amount").fill("5"); await page.getByTestId("txn-desc").fill("");
  await page.getByTestId("txn-save").click(); assert(await page.getByTestId("txn-error").isVisible(), "no error for empty desc");
  await page.keyboard.press("Escape");
  assert((await log()).filter((l) => l.op === "insert").length === (await log()).slice(0, before).filter((l) => l.op === "insert").length, "an insert happened");
});

await step("09 income with source; goal contribution from hero card updates saved amount", async () => {
  await page.getByTestId("add-txn").click(); await page.getByTestId("txn-type").getByText("Income").click();
  await page.getByTestId("txn-amount").fill("2750"); await page.getByTestId("txn-desc").fill("Owner's draw");
  await page.getByTestId("txn-category").selectOption({ label: "Owner's Draw" });
  await page.getByTestId("txn-save").click(); await page.getByTestId("txn-modal").waitFor({ state: "detached" });
  const inc = await lastWrite("transactions");
  assert(inc.txn_type === "income" && inc.income_source_id && inc.amount === "2750.00", "income payload " + JSON.stringify(inc));
  await page.getByTestId("hero-contribute").click(); await page.getByTestId("txn-amount").fill("550");
  await page.getByTestId("txn-save").click(); await page.getByTestId("txn-modal").waitFor({ state: "detached" });
  const gc = await lastWrite("transactions");
  assert(gc.txn_type === "goal_contribution" && gc.goal_id && gc.category_id === null, "goal payload " + JSON.stringify(gc));
  await page.waitForTimeout(700);
  assert((await page.getByTestId("hero-saved").textContent()).includes("550"), "hero not updated: " + await page.getByTestId("hero-saved").textContent());
});

await step("10 budget: inline edit upserts month=YYYY-MM-01 with exact amount; remaining recalculates", async () => {
  await page.getByTestId("nav-budget").click();
  const row = page.locator('[data-testid="budget-row"][data-category="Groceries"]');
  await row.getByTestId("budget-edit").click(); await row.getByTestId("budget-input").fill("500"); await row.getByTestId("budget-save").click();
  await page.waitForTimeout(100);
  const b = await lastWrite("budgets", "upsert");
  assert(b.month === "2026-10-01" && b.amount === "500.00", "budget payload " + JSON.stringify(b));
  const rem = await row.getByTestId("budget-remaining").textContent();
  assert(rem.includes("403.46"), "remaining was " + rem); // 500 - 84.20 (Whole Foods) - 12.34 (corner shop)
});

await step("11 transactions page: totals, filters, search, delete needs confirmation", async () => {
  await page.getByTestId("nav-transactions").click();
  const rows = await page.getByTestId("tx-row").count(); assert(rows === 6, "rows " + rows);
  await page.getByTestId("tx-type-filter").selectOption("income"); assert(await page.getByTestId("tx-row").count() === 1, "filter");
  await page.getByTestId("tx-type-filter").selectOption("all"); await page.getByTestId("tx-search").fill("bus");
  assert(await page.getByTestId("tx-row").count() === 1, "search"); await page.getByTestId("tx-search").fill("");
  const del = page.getByTestId("tx-row").first().getByLabel("Delete");
  await del.click(); assert(await page.getByTestId("tx-row").count() === 6, "deleted on first click");
  await del.click(); await page.waitForTimeout(100); assert(await page.getByTestId("tx-row").count() === 5, "not deleted on confirm");
});

await step("12 sign out; new account starts from scratch (no demo option) and sees none of the first user's data", async () => {
  await page.getByTestId("profile-menu").click(); await page.getByTestId("sign-out").click();
  await page.getByTestId("auth-form").waitFor();
  await page.getByTestId("to-signup").click(); await page.getByTestId("name").fill("Sam"); await page.getByTestId("email").fill("sam@test.local");
  await page.getByTestId("password").fill("An0ther!Pass"); await page.getByTestId("password2").fill("An0ther!Pass"); await page.getByTestId("auth-submit").click();
  await page.getByTestId("setup").waitFor();
  // move through demo path
  assert(!(await page.getByTestId("setup-demo").count()) && !(await page.getByText(/demo data/i).count()), "demo option still offered at sign-up");
  await page.getByTestId("setup-next").click(); await page.getByTestId("setup-next").click();
  await page.getByTestId("setup-goal-name").fill(""); // skip the first goal; sample data below brings its own
  await page.getByTestId("setup-next").click(); await page.getByTestId("setup-finish").click(); await page.getByTestId("greeting").waitFor();
  assert(await page.evaluate(() => window.__db.tables.transactions.filter((t) => t.user_id === window.__db.users.at(-1).id).length) === 0, "new account is not empty");
  await page.getByTestId("nav-transactions").click(); await page.getByText("All time").click();
  assert(await page.getByTestId("tx-empty").isVisible(), "new account should start with no transactions");
  await page.evaluate(() => window.__seedDemo()); await page.getByTestId("nav-settings").click(); await page.getByText("Sync now").click(); await page.waitForTimeout(300);
  await page.getByTestId("nav-transactions").click(); await page.getByText("All time").click();
  const descs = await page.getByTestId("tx-row").allTextContents();
  assert(!descs.some((d) => /Corner shop|Whole Foods|Bus fare/.test(d)), "user B sees user A rows");
});

await step("13 demo data: dashboard hero shows House Deposit $34,250 (57%)", async () => {
  await page.getByTestId("nav-dashboard").click(); await page.waitForTimeout(700);
  const saved = await page.getByTestId("hero-saved").textContent(); const pct = await page.getByTestId("hero-pct").textContent();
  assert(saved.includes("34,250") && pct === "57%", `hero ${saved} ${pct}`);
  await page.getByTestId("theme-toggle").click(); await page.waitForTimeout(300);
  await page.screenshot({ path: "../docs/screenshots/02-dashboard-demo-dark.png", fullPage: true });
  await page.getByTestId("theme-toggle").click(); await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.documentElement.dataset.theme) === "light", "toggle back");
  assert((await lastWrite("profiles", "update")).theme === "light", "theme not persisted");
  await page.screenshot({ path: "../docs/screenshots/03-dashboard-demo-light.png", fullPage: true });
});

await step("14 projections: month / quarter / year render; what-if slider changes outcome", async () => {
  await page.getByTestId("nav-projections").click();
  for (const p of ["Month", "Quarter", "Year"]) {
    await page.getByTestId("period-seg").getByText(p).click();
    const t = await page.getByTestId("proj-savings").textContent(); assert(/\$[\d,]+/.test(t), `${p} savings ${t}`);
  }
  const before = await page.getByTestId("proj-summary").textContent();
  await page.getByTestId("sc-spend").fill("-20"); await page.waitForTimeout(600);
  assert(before !== await page.getByTestId("proj-summary").textContent(), "scenario had no effect");
  await page.screenshot({ path: "../docs/screenshots/04-projections.png", fullPage: true });
});

await step("15 goals: create goal shows required monthly; what-if slider updates date", async () => {
  await page.getByTestId("nav-goals").click(); await page.getByTestId("new-goal").click();
  await page.getByTestId("goal-name").fill("Kitchen Reno"); await page.getByTestId("goal-target").fill("12000");
  await page.getByTestId("goal-starting").fill("0"); await page.getByTestId("goal-monthly").fill("400"); await page.getByTestId("goal-date").fill("2028-10-01");
  assert((await page.getByTestId("goal-need").textContent()).includes("500"), "need: " + await page.getByTestId("goal-need").textContent()); // 12000/24
  await page.getByTestId("goal-save").click(); await page.getByTestId("goal-modal").waitFor({ state: "detached" });
  const g = await lastWrite("goals"); assert(g.target_amount === "12000.00" && g.monthly_contribution === "400.00" && g.target_date === "2028-10-01", JSON.stringify(g));
  assert(await page.locator('[data-goal="Kitchen Reno"]').isVisible(), "card missing");
});

await step("16 investments: add holding; Freedom Number = annual expenses ÷ 4%", async () => {
  await page.getByTestId("nav-investments").click();
  const fnBefore = await page.getByTestId("freedom-number").textContent();
  await page.getByTestId("fr-expenses").fill("50400"); await page.waitForTimeout(100);
  assert((await page.getByTestId("freedom-number").textContent()).includes("1,260,000"), "FN " + await page.getByTestId("freedom-number").textContent());
  await page.getByTestId("add-holding").click(); await page.getByTestId("holding-name").fill("Bond ETF"); await page.getByTestId("holding-value").fill("5000.50");
  await page.getByTestId("holding-save").click(); await page.getByTestId("holding-modal").waitFor({ state: "detached" });
  const h = await lastWrite("holdings"); assert(h.current_value === "5000.50" && h.value_as_of === "2026-10-31", JSON.stringify(h));
  assert(await page.getByTestId("holding-row").count() === 5, "holding rows"); void fnBefore;
});

await step("17 CSV export: bank/mortgage preset previews and downloads a valid CSV", async () => {
  await page.getByTestId("nav-transactions").click(); await page.getByTestId("export-btn").click();
  await page.getByTestId("preset-bank").click(); await page.getByTestId("export-preview").waitFor();
  const dl = page.waitForEvent("download"); await page.getByTestId("export-download").click();
  const d = await dl; const path = await d.path(); const csv = readFileSync(path, "utf8").replace(/^﻿/, "");
  assert(d.suggestedFilename().startsWith("income_summary_2026-10-31"), d.suggestedFilename());
  const lines = csv.trim().split("\r\n");
  assert(lines[0].startsWith("month,Owner's Draw – Business") && lines.at(-1).startsWith("MONTHLY AVERAGE"), lines[0] + " | " + lines.at(-1));
  assert(lines.length >= 13, "rows " + lines.length);
  assert(/^\d{4}-\d{2},\d+\.\d{2}/.test(lines[1]), "amount format " + lines[1]);
});

await step("18 AI assistant: chip question answered; only period + question sent", async () => {
  await page.getByTestId("ai-fab").click(); await page.getByTestId("ai-drawer").waitFor();
  await page.getByTestId("ai-chip").first().click(); await page.waitForTimeout(200);
  assert(await page.getByTestId("ai-msg").count() >= 2, "no answer");
  const inv = (await log()).filter((l) => l.op === "invoke" && l.table === "ai-summary").at(-1).payload;
  assert(JSON.stringify(Object.keys(inv).sort()) === '["period_end","period_start","question"]', JSON.stringify(inv));
  await page.getByLabel("Close assistant").click();
});

await step("19 lock app → lock screen → unlock with password", async () => {
  await page.getByTestId("profile-menu").click(); await page.getByTestId("lock-app").click();
  await page.getByTestId("lock-screen").waitFor(); await page.getByTestId("unlock-password").fill("An0ther!Pass"); await page.keyboard.press("Enter");
  await page.getByTestId("profile-menu").waitFor();
});

await step("20 no floats were ever sent for money columns; no uncaught page errors", async () => {
  const floats = (await log()).filter((l) => l.op === "FLOAT_SENT");
  assert(floats.length === 0, "floats sent: " + JSON.stringify(floats));
  assert(errors.length === 0, "page errors: " + errors.join(" | "));
});

await browser.close();
for (const r of results) console.log(r.join("  "));
console.log(`\n${results.filter((r) => r[0] === "PASS").length}/${results.length} passed`);
process.exit(results.some((r) => r[0] === "FAIL") ? 1 : 0);
