import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const firstSet = (...names: string[]) => names.map((n) => process.env[n]).find(Boolean);
const supabaseUrl = firstSet("VITE_SUPABASE_URL", "SUPABASE_URL");
const supabaseAnonKey = firstSet("VITE_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY");

export default defineConfig({
  plugins: [react()],
  define: {
    ...(supabaseUrl && { "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl) }),
    ...(supabaseAnonKey && { "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(supabaseAnonKey) }),
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
