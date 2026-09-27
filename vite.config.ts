import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// @ts-expect-error — plain ESM, no type declarations; it runs in Node only (see the file header).
import { r2ConfigFrom } from "./tools/r2.mjs";
// @ts-expect-error — plain ESM, no type declarations; shared with the Vercel function api/r2.mjs.
import { handleR2 } from "./server/r2Bridge.mjs";
// @ts-expect-error — plain ESM, no type declarations; shared with the Vercel function api/relay.mjs.
import { handleRelay, relayConfig } from "./server/relayCore.mjs";
// @ts-expect-error — plain ESM, no type declarations; shared with the Vercel function api/mcp.mjs.
import { handleLibraryMcp, libraryMcpConfig } from "./server/libraryMcp.mjs";

// ── Cloudflare R2 bridge (dev server) ─────────────────────────────────────────────────────────────
// `/__r2/*` — list / tree / get / save / upload / delete, signed with keys that stay in Node. The logic
// lives in server/r2Bridge.mjs so the Vercel function (api/r2.mjs) serves the same routes in production;
// there it signs only with keys the browser sends (Preferences ▸ Cloudflare R2), here it falls back to .env.
type R2Config = ReturnType<typeof r2ConfigFrom>;

const r2Bridge = (cfg: R2Config): Plugin => ({
  name: "r2-bridge",
  configureServer(server) {
    server.middlewares.use("/__r2", (req, res) => {
      const url = new URL(req.url ?? "/", "http://local");
      void handleR2(req, res, cfg, url.pathname, url, { allowEnvConfig: true });
    });
  },
});

// ── Hosted MCP relay (dev server) — `/mcp` + `/__relay/*`, the same code as api/relay.mjs. Uses RELAY_R2_*
// from .env, falling back to the R2_* keys (it only ever writes under relay/). ──
const relayDev = (env: Record<string, string>): Plugin => ({
  name: "mcp-relay",
  configureServer(server) {
    const cfg = relayConfig(env);
    server.middlewares.use("/__relay", (req, res) => {
      const url = new URL(req.url ?? "/", "http://local");
      void handleRelay(req, res, url.pathname, url, cfg);
    });
    server.middlewares.use("/mcp", (req, res) => {
      void handleRelay(req, res, "/mcp", new URL(req.url ?? "/", "http://local"), cfg);
    });
    // Headless library MCP — the same code as api/mcp.mjs.
    const lib = libraryMcpConfig(env);
    server.middlewares.use("/api/mcp", (req, res) => { void handleLibraryMcp(req, res, lib); });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Third argument "" loads EVERY variable, not just the VITE_-prefixed ones. That is the point:
  // the R2 keys are deliberately unprefixed so Vite cannot inline them into the client bundle, and
  // this is the only place allowed to see them.
  const env = loadEnv(mode, process.cwd(), "");
  const r2 = r2ConfigFrom(env);

  return {
  server: {
    proxy: {
      "/image-proxy": "https://api.gettaskagent.com",
      "/meshy-assets": {
        target: "https://assets.meshy.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meshy-assets/, ""),
      },
    },
    host: "::",
    port: 3000,
    // Required for SharedArrayBuffer used by web-ifc multi-threaded WASM
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    fs: {
      // @builderpluss/engine is a linked package whose entry points at TypeScript SOURCE, not a
      // build output — one source of truth for the maths, and no `dist/` that can go stale and
      // silently shadow an edit. Vite compiles it like any other source file, but it lives
      // outside the project root, so the root has to be allowed explicitly.
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, "packages/engine"),
      ],
    },
  },
  plugins: [
    react(),
    r2Bridge(r2), relayDev(env),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tell Vite to treat .wasm files as static assets (served as-is)
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    // Exclude ThatOpen packages from pre-bundling — they ship ESM workers
    // that Vite's CJS transform would break
    exclude: [
      "@thatopen/components",
      "@thatopen/components-front",
      "@thatopen/fragments",
      "web-ifc",
      // Linked source package: pre-bundling it would snapshot the maths into a cached bundle,
      // reintroducing exactly the staleness that removing `dist/` was meant to eliminate.
      // Excluded so an edit in packages/engine/src hot-reloads like any other source file.
      "@builderpluss/engine",
    ],
  },
  };
});
