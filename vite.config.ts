import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "node:fs";
import type { ServerResponse, IncomingMessage } from "node:http";
import { componentTagger } from "lovable-tagger";

// ── Library file bridge (dev server only) ─────────────────────────────────────────────────────────
// The app can't write to the repo from the browser, so agent save_object / flow & design exports POST
// here and the dev server persists the file into public/Library (Flows / Designs / Parametric
// Objects — the single home for bundled assets). GET /__library/list lets Import Objects discover
// every .pobj on disk (bundled + agent-saved). All paths are locked inside public/Library; production
// builds have no endpoints, so the client (src/floorplan/libraryFiles.ts) falls back gracefully.
const LIBRARY_ROOT = path.resolve(__dirname, "public", "Library");

/** Resolve a client-supplied Library-relative path safely inside public/Library (null on escape). */
const resolveInLibrary = (rel: string): string | null => {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const abs = path.resolve(LIBRARY_ROOT, clean);
  return abs === LIBRARY_ROOT || abs.startsWith(LIBRARY_ROOT + path.sep) ? abs : null;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c: Buffer) => {
      data += c;
      if (data.length > 8_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });

/** Every .json under `absDir`, as paths relative to it (forward slashes). */
const listJsonFiles = (absDir: string, relPrefix = ""): string[] => {
  if (!fs.existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listJsonFiles(path.join(absDir, entry.name), rel));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) out.push(rel);
  }
  return out;
};

const libraryBridge = (): Plugin => ({
  name: "library-bridge",
  configureServer(server) {
    server.middlewares.use("/__library", (req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", "http://local");
          // GET /__library/list?dir=Parametric Objects → every .json under that Library subfolder.
          if (req.method === "GET" && url.pathname === "/list") {
            const abs = resolveInLibrary(url.searchParams.get("dir") ?? "");
            if (!abs) return sendJson(res, 400, { error: "bad dir" });
            return sendJson(res, 200, { ok: true, files: listJsonFiles(abs) });
          }
          // POST /__library/save { path, content } → write one JSON file inside public/Library.
          if (req.method === "POST" && url.pathname === "/save") {
            const body = JSON.parse((await readBody(req)) || "{}") as { path?: unknown; content?: unknown };
            const abs = typeof body.path === "string" && body.path.toLowerCase().endsWith(".json") ? resolveInLibrary(body.path) : null;
            if (!abs || typeof body.content !== "string") return sendJson(res, 400, { error: "need path (*.json inside public/Library) + content" });
            JSON.parse(body.content); // only well-formed JSON lands in the Library
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, body.content, "utf8");
            return sendJson(res, 200, { ok: true, path: path.relative(LIBRARY_ROOT, abs).replace(/\\/g, "/") });
          }
          // POST /__library/delete-file { path } → remove ONE file inside public/Library (path-locked).
          // Generic (any *.json under Library) — used by the Flow Agent to delete node / workflow templates.
          if (req.method === "POST" && url.pathname === "/delete-file") {
            const body = JSON.parse((await readBody(req)) || "{}") as { path?: unknown };
            const abs = typeof body.path === "string" && body.path.toLowerCase().endsWith(".json") ? resolveInLibrary(body.path) : null;
            if (!abs) return sendJson(res, 400, { error: "need path (*.json inside public/Library)" });
            if (!fs.existsSync(abs)) return sendJson(res, 404, { error: "file not found" });
            fs.unlinkSync(abs);
            return sendJson(res, 200, { ok: true, deleted: path.relative(LIBRARY_ROOT, abs).replace(/\\/g, "/") });
          }
          // POST /__library/delete { ids } → remove the Parametric Objects .pobj files whose meta.id matches.
          if (req.method === "POST" && url.pathname === "/delete") {
            const body = JSON.parse((await readBody(req)) || "{}") as { ids?: unknown };
            const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
            if (!ids.length) return sendJson(res, 400, { error: "need ids: string[]" });
            const dir = path.join(LIBRARY_ROOT, "Parametric Objects");
            const deleted: string[] = [];
            for (const rel of listJsonFiles(dir)) {
              const abs = path.join(dir, rel);
              try {
                const meta = (JSON.parse(fs.readFileSync(abs, "utf8")) as { meta?: { id?: unknown } }).meta;
                if (meta && ids.includes(String(meta.id))) {
                  fs.unlinkSync(abs);
                  deleted.push(`Parametric Objects/${rel}`);
                }
              } catch {
                /* unreadable/non-pobj file — skip */
              }
            }
            return sendJson(res, 200, { ok: true, deleted });
          }
          return sendJson(res, 404, { error: "unknown /__library route" });
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      })();
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
    port: 2000,
    // Required for SharedArrayBuffer used by web-ifc multi-threaded WASM
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  plugins: [react(), libraryBridge(), mode === "development" && componentTagger()].filter(
    Boolean
  ),
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
    ],
  },
}));
