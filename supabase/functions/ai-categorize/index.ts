import { AIConfigError, corsHeaders, json, openaiJSON, userClient } from "../_shared/common.ts";

/**
 * POST { description: string, kind?: "expense" | "income" }
 * -> { category_id, category_name, confidence }
 *
 * Privacy: ONLY the description string is sent to OpenAI (no amount, date, account, notes).
 * Drift control: the model must choose one of the user's own category names (JSON enum);
 * anything else is rejected server-side. The user can always override in the UI.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const ctx = await userClient(req);
  if (ctx instanceof Response) return ctx;
  const { sb } = ctx;

  let body: { description?: unknown; kind?: unknown };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 200) : "";
  const kind = body.kind === "income" ? "income" : "expense";
  if (!description) return json({ error: "description is required" }, 400);

  const { data: cats, error } = await sb
    .from("categories").select("id,name").eq("kind", kind).eq("archived", false).order("sort_order");
  if (error) return json({ error: error.message }, 500);
  if (!cats?.length) return json({ error: "no categories" }, 400);
  const names = cats.map((c) => c.name);

  try {
    const out = await openaiJSON<{ category: string; confidence: number }>(
      "You categorize personal finance transactions. Choose exactly one category from the provided list. " +
        "Never invent a new category. If unsure, pick the closest match and give low confidence.",
      `Categories: ${JSON.stringify(names)}\nTransaction description: ${JSON.stringify(description)}`,
      "categorization",
      {
        type: "object",
        additionalProperties: false,
        required: ["category", "confidence"],
        properties: {
          category: { type: "string", enum: names },
          confidence: { type: "number" },
        },
      },
    );
    const match = cats.find((c) => c.name === out.category);
    if (!match) return json({ error: "model returned an unknown category", category_id: null }, 422);
    return json({
      category_id: match.id,
      category_name: match.name,
      confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
    });
  } catch (e) {
    if (e instanceof AIConfigError) return json({ error: e.message, ai_unavailable: true }, 503);
    return json({ error: String(e) }, 502);
  }
});
