import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Supabase client that acts AS the calling user, so RLS applies to every query. */
export async function userClient(req: Request): Promise<{ sb: SupabaseClient; userId: string } | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "missing authorization" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return json({ error: "invalid session" }, 401);
  return { sb, userId: data.user.id };
}

/** Calls OpenAI with a strict JSON schema. The key never leaves the server. */
export async function openaiJSON<T>(system: string, user: string, schemaName: string, schema: object): Promise<T> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new AIConfigError("OPENAI_API_KEY is not set on the server");
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return JSON.parse(body.choices[0].message.content) as T;
}

export class AIConfigError extends Error {}
