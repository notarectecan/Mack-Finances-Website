import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !key) console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see .env.example");

// Only the PUBLIC publishable key is used in the browser. RLS protects every table.
// The OpenAI key is never here: AI calls go through Supabase Edge Functions.
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
