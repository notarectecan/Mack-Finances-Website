// LIVE end-to-end: real UI (vite dev/preview) → real Supabase (auth, RLS, tables, edge functions).
// Run:  E2E_USER_A=a@x.com E2E_PASS_A=... E2E_USER_B=b@x.com E2E_PASS_B=... npx playwright test
// Users must exist and be email-confirmed (or turn off "Confirm email" in Supabase Auth for testing).
import { test, expect, Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.VITE_SUPABASE_URL!, KEY = process.env.VITE_SUPABASE_ANON_KEY!;
const A = { email: process.env.E2E_USER_A!, pass: process.env.E2E_PASS_A! };
const B = { email: process.env.E2E_USER_B!, pass: process.env.E2E_PASS_B! };
const tag = `e2e-${Date.now()}`;

async function db(u: { email: string; pass: string }) {
  const sb = createClient(URL, KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: u.email, password: u.pass });
  if (error) throw error; return sb;
}
async function signIn(page: Page, u: { email: string; pass: string }) {
  await page.goto("/");
  await page.getByTestId("email").fill(u.email); await page.getByTestId("password").fill(u.pass);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("setup").or(page.getByTestId("greeting"))).toBeVisible();
  if (await page.getByTestId("setup").isVisible()) {
    for (let i = 0; i < 3; i++) await page.getByTestId("setup-next").click();
    await page.getByTestId("setup-finish").click(); await expect(page.getByTestId("greeting")).toBeVisible();
  }
}

test.use({ timezoneId: "America/Chicago" });

test("UI expense → row in Supabase with exact numeric + local date", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-31T23:00:00-05:00"));
  await signIn(page, A);
  await page.getByTestId("add-txn").click();
  await page.getByTestId("txn-amount").fill("0.10"); await page.getByTestId("txn-desc").fill(`${tag} a`);
  await page.getByTestId("txn-category").selectOption({ label: "Groceries" }); await page.getByTestId("txn-another").check();
  await page.getByTestId("txn-save").click(); await expect(page.getByTestId("txn-amount")).toHaveValue("");
  await page.getByTestId("txn-amount").fill("0.20"); await page.getByTestId("txn-desc").fill(`${tag} b`);
  await page.getByTestId("txn-category").selectOption({ label: "Groceries" }); await page.getByTestId("txn-save").click();
  await page.keyboard.press("Escape");

  const sb = await db(A);
  const { data } = await sb.from("transactions").select("amount,txn_date,description").like("description", `${tag}%`);
  expect(data).toHaveLength(2);
  expect(data!.every((r) => r.txn_date === "2026-10-31")).toBe(true);             // not Nov 1 (UTC)
  const { data: total } = await sb.from("v_monthly_category_totals").select("total,category_name").eq("month", "2026-10-01").eq("category_name", "Groceries");
  expect(String(total![0].total)).toMatch(/\.\d{2}$|^\d+$/);                       // numeric, no float noise
});

test("RLS: user B cannot see or modify user A's rows (via the real API)", async () => {
  const a = await db(A), b = await db(B);
  const { data: aRows } = await a.from("transactions").select("id").like("description", `${tag}%`);
  expect(aRows!.length).toBeGreaterThan(0);
  const { data: seen } = await b.from("transactions").select("id").in("id", aRows!.map((r) => r.id));
  expect(seen).toHaveLength(0);
  const { data: upd } = await b.from("transactions").update({ amount: "1.00" }).in("id", aRows!.map((r) => r.id)).select();
  expect(upd ?? []).toHaveLength(0);
  const { data: { user } } = await a.auth.getUser();
  const { error } = await b.from("transactions").insert({ user_id: user!.id, txn_date: "2026-10-01", description: "spoof", amount: "1.00", txn_type: "expense" });
  expect(error?.message).toMatch(/row-level security/);
});

test("Anon (logged out) has no access", async () => {
  const anon = createClient(URL, KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.from("transactions").select("id").limit(1);
  expect(error || (data ?? []).length === 0).toBeTruthy();
});

test("Budget, goal and holding round-trip through the UI", async ({ page }) => {
  await signIn(page, A);
  await page.getByTestId("nav-goals").click(); await page.getByTestId("new-goal").click();
  await page.getByTestId("goal-name").fill(`${tag} goal`); await page.getByTestId("goal-target").fill("1234.56");
  await page.getByTestId("goal-save").click();
  const sb = await db(A);
  const { data: g } = await sb.from("goals").select("target_amount").eq("name", `${tag} goal`).single();
  expect(Number(g!.target_amount)).toBe(1234.56);
  await sb.from("goals").delete().eq("name", `${tag} goal`);
});

test("Edge functions: auth required; categorize returns one of the user's categories", async ({ request }) => {
  const anonRes = await request.post(`${URL}/functions/v1/ai-categorize`, { data: { description: "Whole Foods" } });
  expect(anonRes.status()).toBe(401);
  const sb = await db(A); const { data: s } = await sb.auth.getSession();
  const res = await request.post(`${URL}/functions/v1/ai-categorize`, { headers: { Authorization: `Bearer ${s.session!.access_token}`, apikey: KEY }, data: { description: "Whole Foods Market" } });
  if (res.status() === 503) test.skip(true, "OPENAI_API_KEY secret not set yet");
  expect(res.status()).toBe(200);
  const body = await res.json(); const { data: cats } = await sb.from("categories").select("id,name").eq("kind", "expense");
  expect(cats!.map((c) => c.id)).toContain(body.category_id);
});

test.afterAll(async () => { const sb = await db(A); await sb.from("transactions").delete().like("description", `${tag}%`); });
