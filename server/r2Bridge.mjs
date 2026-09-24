/** The R2 bridge — `/__r2/*` — shared by the Vite dev server (vite.config.ts) and the Vercel function
 *  (api/r2.mjs). It signs list / tree / get / save / upload / delete with keys that never leave Node.
 *
 *  READS OF SINGLE FILES DO NOT COME THROUGH HERE. R2_PUBLIC_URL is world-readable, so the app fetches
 *  definitions straight from the bucket. This route exists for what needs a signature: enumerating
 *  (r2.dev will not list) and every write.
 *
 *  PASSWORD. On Vercel the bridge is on the public internet, so `requirePassword` is set and every route
 *  except /status needs the `x-bucket-password` header to match R2_ACCESS_PASSWORD. The password lives
 *  ONLY in that environment variable — never in the repo — and when it is unset every locked route
 *  refuses (fail closed). The dev server runs on your own machine and does not ask. */

import path from "node:path";
import crypto from "node:crypto";
import { putObject, getObjectText, listObjects, listObjectsDetailed, deleteObject } from "../tools/r2.mjs";


/** Content types for what the Library holds; /save accepts only these. */
export const LIBRARY_MIME = {
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
};

/** Content types for uploads — wider, because the bucket also holds images and models. Anything
 *  unrecognised uploads as octet-stream rather than being refused. */
const UPLOAD_MIME = {
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

/** How much of one object the inline preview in Files ▸ Inspect reads — above the largest text object
 *  (a ~3 MB design) so a preview never cuts a JSON mid-file. */
const R2_PREVIEW_LIMIT = 4_000_000;

const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

/** The request body as BYTES — a string concatenation would mangle a .png or .glb. */
const readRawBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) return reject(new Error(`file too large — the limit is ${Math.round(limit / 1e6)} MB`));
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const readJson = async (req) => JSON.parse((await readRawBody(req, 8_000_000)).toString("utf8") || "{}");

/** A client-supplied bucket key, or null if it tries to escape the bucket or names nothing. */
const cleanBucketKey = (rel) => {
  if (typeof rel !== "string") return null;
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!clean || clean.length > 1024) return null;
  return clean.split("/").some((part) => !part || part === "." || part === "..") ? null : clean;
};

/** A Library-relative *.json / *.md path, or null. */
const cleanLibraryKey = (rel) => {
  if (typeof rel !== "string") return null;
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return LIBRARY_MIME[path.extname(clean).toLowerCase()] ? clean : null;
};

const publicUrlOf = (cfg, key) =>
  cfg.publicUrl ? `${cfg.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}` : "";

/** Flat S3 keys → nested folders/files, folders first, with sizes rolled up per folder. */
const buildR2Tree = (objects, publicUrl) => {
  const root = { name: "/", path: "", type: "folder", children: [] };
  const folders = new Map([["", root]]);
  const folderAt = (segments) => {
    let node = root;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let next = folders.get(prefix);
      if (!next) {
        next = { name: segment, path: prefix, type: "folder", children: [] };
        folders.set(prefix, next);
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const obj of objects) {
    const segments = obj.key.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) {
      folderAt(segments);
      continue;
    }
    folderAt(segments).children.push({
      name,
      path: obj.key,
      type: "file",
      size: obj.size,
      lastModified: obj.lastModified,
      etag: obj.etag,
      url: publicUrl ? `${publicUrl}/${obj.key.split("/").map(encodeURIComponent).join("/")}` : undefined,
    });
  }
  const finish = (node) => {
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
    let files = 0;
    let bytes = 0;
    for (const child of node.children) {
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

/** Constant-time compare, so the password cannot be guessed one character at a time from timings. */
const passwordMatches = (given, expected) => {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/** Handle one `/__r2/<route>` request. `route` is the part after /__r2 ("/list", "/save", …).
 *  Options: `requirePassword` (Vercel), `password` (R2_ACCESS_PASSWORD; unset = every locked route refuses),
 *  `uploadLimit` in bytes. */
export async function handleR2(req, res, cfg, route, url, opts = {}) {
  try {
    const locked = !!opts.requirePassword;
    const expected = opts.password || "";

    // GET /status → whether the bucket is configured and where reads point. Open, so the UI can show
    // the option before anyone has typed the password.
    if (req.method === "GET" && route === "/status") {
      return sendJson(res, 200, {
        ok: true,
        configured: !!cfg,
        passwordRequired: locked,
        bucket: cfg?.bucket ?? "",
        publicUrl: cfg?.publicUrl ?? "",
        prefix: cfg?.prefix ?? "",
      });
    }
    if (locked && !expected)
      return sendJson(res, 503, { error: "R2_ACCESS_PASSWORD is not set on the server" });
    if (locked && !passwordMatches(req.headers["x-bucket-password"], expected))
      return sendJson(res, 401, { error: "bucket password required" });
    if (!cfg) return sendJson(res, 503, { error: "R2 is not configured — set the R2_* variables" });

    // POST /save { path, content } → one object under the library prefix.
    if (req.method === "POST" && route === "/save") {
      const body = await readJson(req);
      const rel = cleanLibraryKey(body.path);
      if (!rel || typeof body.content !== "string")
        return sendJson(res, 400, { error: "need path (*.json or *.md) + content" });
      if (rel.toLowerCase().endsWith(".json")) JSON.parse(body.content); // only well-formed JSON lands in the bucket
      const key = `${cfg.prefix}/${rel}`;
      await putObject(cfg, key, body.content, LIBRARY_MIME[path.extname(rel).toLowerCase()]);
      return sendJson(res, 200, { ok: true, key, url: publicUrlOf(cfg, key) });
    }

    // GET /list?dir=Objects → every key under that library folder, folder-relative.
    if (req.method === "GET" && route === "/list") {
      const dir = (url.searchParams.get("dir") ?? "").replace(/^\/+|\/+$/g, "");
      const prefix = dir ? `${cfg.prefix}/${dir}/` : `${cfg.prefix}/`;
      const keys = await listObjects(cfg, prefix);
      return sendJson(res, 200, { ok: true, files: keys.map((k) => k.slice(prefix.length)).filter(Boolean) });
    }

    // GET /tree?prefix= → the bucket as a folder hierarchy, for Files ▸ Inspect. No prefix = whole bucket.
    if (req.method === "GET" && route === "/tree") {
      const prefix = (url.searchParams.get("prefix") ?? "").replace(/^\/+/, "");
      const objects = await listObjectsDetailed(cfg, prefix);
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

    // GET /get?key= → the object's leading bytes as text, for the inline preview.
    if (req.method === "GET" && route === "/get") {
      const key = cleanBucketKey(url.searchParams.get("key"));
      if (!key) return sendJson(res, 400, { error: "need a key (no leading slash, no '..' segments)" });
      const file = await getObjectText(cfg, key, R2_PREVIEW_LIMIT);
      return sendJson(res, 200, { ok: true, key, ...file });
    }

    // POST /upload?key= — body is the raw file.
    if (req.method === "POST" && route === "/upload") {
      const key = cleanBucketKey(url.searchParams.get("key"));
      if (!key) return sendJson(res, 400, { error: "need a key (no leading slash, no '..' segments)" });
      const body = await readRawBody(req, opts.uploadLimit ?? 100_000_000);
      if (!body.length) return sendJson(res, 400, { error: "empty file" });
      if (key.toLowerCase().endsWith(".json")) JSON.parse(body.toString("utf8"));
      const mime = UPLOAD_MIME[path.extname(key).toLowerCase()] ?? "application/octet-stream";
      await putObject(cfg, key, body, mime);
      return sendJson(res, 200, { ok: true, key, size: body.length, contentType: mime, url: publicUrlOf(cfg, key) });
    }

    // POST /delete { key } → remove ONE object. Irreversible (no versioning); the UI confirms first.
    if (req.method === "POST" && route === "/delete") {
      const body = await readJson(req);
      const key = cleanBucketKey(body.key);
      if (!key) return sendJson(res, 400, { error: "need a key (no leading slash, no '..' segments)" });
      await deleteObject(cfg, key);
      return sendJson(res, 200, { ok: true, key });
    }

    return sendJson(res, 404, { error: "unknown /__r2 route" });
  } catch (e) {
    return sendJson(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}
