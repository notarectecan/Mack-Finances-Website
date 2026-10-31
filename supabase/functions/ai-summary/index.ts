import { AIConfigError, corsHeaders, json, openaiJSON, userClient } from "../_shared/common.ts";

/**
 * POST { period_start: "YYYY-MM-DD", period_end: "YYYY-MM-DD", question?: string }
 * -> { answer, highlights[], totals }
 *
 * Privacy: ONLY aggregated per-category / per-source totals and goal progress totals are sent
 * to OpenAI. No individual transaction rows, descriptions, notes or account names leave the app.
 */
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const ctx = await userClient(req);
  if (ctx instanceof Response) return ctx;
  const { sb } = ctx;

  let body: { period_start?: unknown; period_end?: unknown; question?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  if (!isDate(body.period_start) || !isDate(body.period_end)) return json({ error: "period_start and period_end (YYYY-MM-DD) required" }, 400);
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";

  // Aggregates only (RLS-scoped view)
  const { data: rows, error } = await sb
    .from("v_monthly_category_totals")
    .select("month,txn_type,category_name,income_source_name,total")
    .gte("month", body.period_start.slice(0, 7) + "-01")
    .lte("month", body.period_end);
  if (error) return json({ error: error.message }, 500);

  const sum = (f: (r: any) => boolean) => rows!.filter(f).reduce((a, r) => a + Number(r.total), 0);
  const group = (type: string, key: "category_name" | "income_source_name") => {
    const m: Record<string, number> = {};
    for (const r of rows!.filter((r) => r.txn_type === type)) {
      const k = r[key] ?? "Uncategorized";
      m[k] = Math.round(((m[k] ?? 0) + Number(r.total)) * 100) / 100;
    }
    return m;
  };
  const months = new Set(rows!.map((r) => r.month)).size || 1;
  const totals = {
    months_covered: months,
    income_total: sum((r) => r.txn_type === "income"),
    expense_total: sum((r) => r.txn_type === "expense"),
    saved_to_goals: sum((r) => r.txn_type === "goal_contribution"),
    invested: sum((r) => r.txn_type === "investment"),
    spending_by_category: group("expense", "category_name"),
    income_by_source: group("income", "income_source_name"),
  };

  const { data: goals } = await sb.from("v_goal_progress")
    .select("name,target_amount,saved_amount,monthly_contribution,target_date");

  try {
    const out = await openaiJSON<{ answer: string; highlights: string[] }>(
      "You are a calm, concise personal-finance assistant inside a budgeting app. " +
        "You only see aggregated totals. Be specific with numbers, under 150 words, and never give " +
        "regulated investment advice; frame suggestions as options.",
      JSON.stringify({ period: [body.period_start, body.period_end], totals, goals: goals ?? [], question: question || "Summarise this period." }),
      "summary",
      {
        type: "object",
        additionalProperties: false,
        required: ["answer", "highlights"],
        properties: {
          answer: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
        },
      },
    );
    await sb.from("ai_insights").insert({
      period_start: body.period_start, period_end: body.period_end,
      question: question || null, answer: out.answer, model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
    });
    return json({ ...out, totals });
  } catch (e) {
    if (e instanceof AIConfigError) return json({ error: e.message, ai_unavailable: true, totals }, 503);
    return json({ error: String(e) }, 502);
  }
});
