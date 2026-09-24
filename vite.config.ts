import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import type { ServerResponse, IncomingMessage } from "node:http";
import { componentTagger } from "lovable-tagger";
// @ts-expect-error — plain ESM, no type declarations; it runs in Node only (see the file header).
import { putObject, getObjectText, listObjects, listObjectsDetailed, deleteObject, r2ConfigFrom } from "./tools/r2.mjs";

// ── Shared helpers for the dev-server R2 bridge ──────────────────────────────────────────────────
// The Library lives only in the R2 bucket; the browser reads it from the public domain and writes /
// lists / deletes through `/__r2/*` below (the signing keys stay on the server).
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

/** Content types for what the Library actually holds. Everything else is refused rather
 *  than served as octet-stream: this route reaches outside the project root, so the set
 *  of things it will hand out stays explicit. */
const LIBRARY_MIME: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
};

// ── Cloudflare R2 bridge (dev server only) ────────────────────────────────────────────────────────
// "Save to Cloud Library" writes here, and this signs the PUT with keys that never leave Node.
// The browser cannot do this itself: the credentials grant write and delete on the whole bucket, so
// shipping them in the bundle would hand that to every visitor. Production has no dev server, so the
// route is absent there and the client hides the option — the same graceful degradation the local
// bridge already relies on, rather than a button that fails at the moment of use.
//
// READS DO NOT COME THROUGH HERE. R2_PUBLIC_URL is world-readable, so the app fetches definitions
// straight from the bucket. Only /list needs a signature, because r2.dev serves objects but will not
// enumerate them — that asymmetry is the whole reason this route exists alongside the public domain.
type R2Config = ReturnType<typeof r2ConfigFrom>;

/** Read a request body as BYTES. `readBody` above concatenates chunks onto a string, which is right
 *  for JSON and destroys anything binary — a .png or a .glb round-tripped through it comes back as
 *  mojibake of exactly the right length, which is the worst kind of wrong. Uploads carry the file
 *  raw, so they need this. */
const readRawBody = (req: IncomingMessage, limit: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) return reject(new Error(`file too large — the limit is ${Math.round(limit / 1e6)} MB`));
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

/** Largest single upload accepted. The whole file is buffered in memory to be signed in one PUT, so
 *  this is a memory bound rather than an R2 one — the bucket's own largest object today is ~7 MB. */
const R2_UPLOAD_LIMIT = 100_000_000;

/** How much of one object the inline preview in Files ▸ Inspect will read.
 *
 *  Set above the largest TEXT object in the bucket (a ~3 MB design) on purpose: a JSON cut off
 *  mid-file no longer parses, so a tighter cap would cost the preview its pretty-printing exactly
 *  on the files that need it most. The cap still bounds what one mistaken click can pull — the
 *  bucket's biggest objects are 25 MB models, and nothing reads more than this slice of one. */
const R2_PREVIEW_LIMIT = 4_000_000;

/** Content types for uploads. Wider than LIBRARY_MIME, which deliberately gates what the Library
 *  route will SERVE; the bucket itself already holds images, GLBs and a .blend, and an inspector
 *  that could not put one back would be a read-only tool wearing an upload button. Anything
 *  unrecognised uploads as octet-stream rather than being refused. */
const UPLOAD_MIME: Record<string, string> = {
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".ifc": "application/x-step",
  ".stl": "model/stl",
  ".dxf": "application/dxf",
  ".zip": "application/zip",
};

/** A client-supplied key, cleaned, or null if it tries to escape the bucket or names nothing.
 *
 *  Unlike {@link cleanLibraryKey} this spans the WHOLE bucket and accepts any extension, because the
 *  inspector shows the whole bucket and the folders it offers to upload into include `uploads/` and
 *  the root. Traversal is still refused: "..", "." and empty segments cannot appear, so no key can
 *  address anything but a plain path inside the bucket. */
const cleanBucketKey = (rel: unknown): string | null => {
  if (typeof rel !== "string") return null;
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean || clean.length > 1024) return null;
  return clean.split("/").some((part) => !part || part === "." || part === "..") ? null : clean;
};

/** One entry in the bucket tree the inspector renders. Folders are synthesised — R2 stores a flat
 *  keyspace with no directory objects, so "Designs/" exists only as a shared prefix of its keys. */
interface R2TreeNode {
  name: string;
  /** Full bucket key for a file; the prefix (no trailing slash) for a folder. */
  path: string;
  type: "folder" | "file";
  /** Files: byte length, mtime, and the public URL when a read domain is configured. */
  size?: number;
  lastModified?: string;
  etag?: string;
  url?: string;
  /** Folders: rolled-up totals over the whole subtree, then the children themselves. */
  files?: number;
  bytes?: number;
  children?: R2TreeNode[];
}

/** Flat S3 keys → nested folders/files, sorted folders-first then alphabetically.
 *
 *  Each key is split on "/" and walked into place, so the depth of the result is whatever the
 *  bucket actually holds rather than a fixed set of known folders. Sizes roll up on the way out
 *  so a folder can report its subtree without the client re-summing it. */
const buildR2Tree = (
  objects: Array<{ key: string; size: number; lastModified: string; etag: string }>,
  publicUrl: string,
): { root: R2TreeNode; folders: number } => {
  const root: R2TreeNode = { name: "/", path: "", type: "folder", children: [] };
  // Folder nodes by path, so a key's ancestors are created once and then reused.
  const folders = new Map<string, R2TreeNode>([["", root]]);

  const folderAt = (segments: string[]): R2TreeNode => {
    let node = root;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let next = folders.get(prefix);
      if (!next) {
        next = { name: segment, path: prefix, type: "folder", children: [] };
        folders.set(prefix, next);
        node.children!.push(next);
      }
      node = next;
    }
    return node;
  };

  for (const obj of objects) {
    const segments = obj.key.split("/").filter(Boolean);
    const name = segments.pop();
    // A key ending in "/" is a directory placeholder some tools write; it has no file of its own.
    if (!name) {
      folderAt(segments);
      continue;
    }
    folderAt(segments).children!.push({
      name,
      path: obj.key,
      type: "file",
      size: obj.size,
      lastModified: obj.lastModified,
      etag: obj.etag,
      url: publicUrl ? `${publicUrl}/${obj.key.split("/").map(encodeURIComponent).join("/")}` : undefined,
    });
  }

  /** Depth-first: sort children, then sum this folder's totals from the sorted result. */
  const finish = (node: R2TreeNode): { files: number; bytes: number } => {
    node.children!.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1,
    );
    let files = 0;
    let bytes = 0;
    for (const child of node.children!) {
      if (child.type === "file") {
        files += 1;
        bytes += child.size ?? 0;
      } else {
        const sub = finish(child);
        files += sub.files;
        bytes += sub.bytes;
      }
    }
    node.files = files;
    node.bytes = bytes;
    return { files, bytes };
  };
  finish(root);

  return { root, folders: folders.size - 1 };
};

/** A client-supplied Library-relative path, cleaned, or null if it tries to escape the prefix. */
const cleanLibraryKey = (rel: unknown): string | null => {
  if (typeof rel !== "string") return null;
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return LIBRARY_MIME[path.extname(clean).toLowerCase()] ? clean : null;
};

const r2Bridge = (cfg: R2Config): Plugin => ({
  name: "r2-bridge",
  configureServer(server) {
    server.middlewares.use("/__r2", (req, res) => {
      void (async () => {
        try {
          const url = new URL(req.url ?? "/", "http://local");

          // GET /__r2/status → whether the option should appear at all, and where reads point.
          // Returned rather than inferred from a failed save, so the UI can disable up front.
          if (req.method === "GET" && url.pathname === "/status") {
            return sendJson(res, 200, {
              ok: true,
              configured: !!cfg,
              bucket: cfg?.bucket ?? "",
              publicUrl: cfg?.publicUrl ?? "",
              prefix: cfg?.prefix ?? "",
            });
          }
          if (!cfg) return sendJson(res, 503, { error: "R2 is not configured — set R2_* in .env" });

          // POST /__r2/save { path, content } → one object under the library prefix.
          if (req.method === "POST" && url.pathname === "/save") {
            const body = JSON.parse((await readBody(req)) || "{}") as { path?: unknown; content?: unknown };
            const rel = cleanLibraryKey(body.path);
            if (!rel || typeof body.content !== "string")
              return sendJson(res, 400, { error: "need path (*.json or *.md) + content" });
            if (rel.toLowerCase().endsWith(".json")) JSON.parse(body.content); // only well-formed JSON lands in the bucket
            const key = `${cfg.prefix}/${rel}`;
            await putObject(cfg, key, body.content, LIBRARY_MIME[path.extname(rel).toLowerCase()]);
            return sendJson(res, 200, {
              ok: true,
              key,
              url: cfg.publicUrl ? `${cfg.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}` : "",
            });
          }

          // GET /__r2/list?dir=Objects → every key under that folder, folder-relative.
          if (req.method === "GET" && url.pathname === "/list") {
            const dir = (url.searchParams.get("dir") ?? "").replace(/^\/+|\/+$/g, "");
            const prefix = dir ? `${cfg.prefix}/${dir}/` : `${cfg.prefix}/`;
            const keys = (await listObjects(cfg, prefix)) as string[];
            return sendJson(res, 200, { ok: true, files: keys.map((k) => k.slice(prefix.length)).filter(Boolean) });
          }

          // GET /__r2/tree?prefix=library → the bucket as a folder hierarchy, for Files ▸ Inspect.
          // No `prefix` means the WHOLE bucket: the point of the inspector is to show what is
          // actually up there, including anything written outside the library/ namespace this app
          // uses. Read-only, and dev-server-only for the same reason /list is — enumerating needs
          // a signature that must not reach the browser.
          if (req.method === "GET" && url.pathname === "/tree") {
            const prefix = (url.searchParams.get("prefix") ?? "").replace(/^\/+/, "");
            const objects = (await listObjectsDetailed(cfg, prefix)) as Array<{
              key: string;
              size: number;
              lastModified: string;
              etag: string;
            }>;
            const { root, folders } = buildR2Tree(objects, cfg.publicUrl);
            return sendJson(res, 200, {
              ok: true,
              bucket: cfg.bucket,
              prefix,
              publicUrl: cfg.publicUrl,
              totals: { files: root.files ?? 0, folders, bytes: root.bytes ?? 0 },
              tree: root,
            });
          }

          // GET /__r2/get?key=<bucket key> → the object's leading bytes as TEXT, for the inline
          // preview a file row folds open in Files ▸ Inspect. Read-only and range-limited; the
          // response says so with `truncated` rather than quietly handing back a clipped file that
          // would look like the whole thing.
          //
          // Signed here rather than fetched from the public domain in the browser, for the same
          // reason /tree is: the inspector addresses the WHOLE bucket, and a key outside the public
          // `library/` prefix — or a deployment with no read domain at all — has no URL to fetch.
          if (req.method === "GET" && url.pathname === "/get") {
            const key = cleanBucketKey(url.searchParams.get("key"));
            if (!key) return sendJson(res, 400, { error: "need a key (no leading slash, no '..' segments)" });
            const file = await getObjectText(cfg, key, R2_PREVIEW_LIMIT);
            return sendJson(res, 200, { ok: true, key, ...file });
          }

          // POST /__r2/upload?key=<bucket key> — body is the FILE, raw. Used by Files ▸ Inspect to put
          // a file into whichever folder's button was pressed.
          //
          // The key is a full bucket key, not Library-relative, and the body is bytes rather than a
          // JSON string field: the inspector spans the whole bucket (which holds PNGs and GLBs, not
          // only JSON) and base64 in a JSON envelope would inflate a 7 MB model by a third for no
          // gain. `/__r2/save` keeps its narrower contract — Library-relative, text, *.json|*.md —
          // because "save this design" should not be able to address the bucket root.
          if (req.method === "POST" && url.pathname === "/upload") {
            const key = cleanBucketKey(url.searchParams.get("key"));
            if (!key) return sendJson(res, 400, { error: "need a key (no leading slash, no '..' segments)" });
            const body = await readRawBody(req, R2_UPLOAD_LIMIT);
            if (!body.length) return sendJson(res, 400, { error: "empty file" });
            // Only well-formed JSON lands in the bucket, same rule /save enforces — a malformed
            // definition would fail at read time in whichever app picked it up, far from here.
            if (key.toLowerCase().endsWith(".json")) JSON.parse(body.toString("utf8"));
            const mime = UPLOAD_MIME[path.extname(key).toLowerCase()] ?? "application/octet-stream";
            await putObject(cfg, key, body, mime);
            return sendJson(res, 200, {
              ok: true,
              key,
              size: body.length,
              contentType: mime,
              url: cfg.publicUrl ? `${cfg.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}` : "",
            });
          }

          // POST /__r2/delete { key } → remove ONE object. Irreversible: the bucket has no versioning,
          // so nothing here can undo it and the confirmation has to happen in the UI before the call.
          // One key per request rather than a prefix sweep — a prefix typo that deletes a folder is
          // not a mistake this route should be capable of making.
          if (req.method === "POST" && url.pathname === "/delete") {
            const body = JSON.parse((await readBody(req)) || "{}") as { key?: unknown };
            const key = cleanBucketKey(body.key);
            if (!key) return sendJson(res, 400, { error: "need a key (no leading slash, no '..' segments)" });
            await deleteObject(cfg, key);
            return sendJson(res, 200, { ok: true, key });
          }

          return sendJson(res, 404, { error: "unknown /__r2 route" });
        } catch (e) {
          return sendJson(res, 502, { error: e instanceof Error ? e.message : String(e) });
        }
      })();
    });
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
    r2Bridge(r2),
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
