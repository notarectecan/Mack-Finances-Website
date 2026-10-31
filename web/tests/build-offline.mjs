// Offline bundle for UI tests: real app code, mock Supabase client. (Production builds use `npm run build`.)
import { build } from "/opt/npm-tools/node_modules/esbuild/lib/main.js";
import { readFileSync, writeFileSync } from "node:fs";
await build({
  entryPoints: ["src/main.tsx"], bundle: true, outfile: "tests/dist/app.js", format: "esm", jsx: "automatic",
  loader: { ".css": "css" }, nodePaths: ["/opt/npm-tools/node_modules"], sourcemap: true, logLevel: "warning",
  alias: { "@supabase/supabase-js": "./tests/mock-supabase.ts" },
  define: { "import.meta.env.VITE_SUPABASE_URL": '"https://mock.local"', "import.meta.env.VITE_SUPABASE_ANON_KEY": '"mock"' },
});
const html = readFileSync("index.html", "utf8").replace(/<link[^>]*fonts[^>]*>\s*/g, "").replace('<script type="module" src="/src/main.tsx"></script>', '<link rel="stylesheet" href="app.css"><script type="module" src="app.js"></script>');
writeFileSync("tests/dist/index.html", html);
console.log("built");
