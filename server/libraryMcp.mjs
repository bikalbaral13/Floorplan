/** The headless library MCP — `/api/mcp` — shared by the Vercel function (api/mcp.mjs) and the Vite dev
 *  server (vite.config.ts), the same way server/relayCore.mjs is.
 *
 *  Unlike the relay (`/mcp`), nothing here needs an editor tab: every tool is a direct read or write of the
 *  R2 library. A remote person's Claude Code can browse skills and objects, read a design, and save a new
 *  design or object into `library/` — which the deployed editor then opens like any other library file.
 *
 *  AUTH. No accounts: MCP_TOKENS in the Vercel project settings is a comma-separated list of `name:token`
 *  pairs, one per person, so one person can be cut off by deleting their entry. Tokens are compared as
 *  SHA-256 digests in constant time.
 *
 *  KEYS. This function holds write keys to the library bucket (MCP_R2_*, falling back to R2_*). So:
 *    · every path is confined to the library prefix — no `..`, no absolute keys;
 *    · writes accept only .json and .md, and a .json must parse;
 *    · an existing file is replaced only when the call says overwrite: true;
 *    · there is no delete tool.
 */

import crypto from "node:crypto";
import path from "node:path";
import { putObject, getObjectText, listObjectsDetailed } from "../tools/r2.mjs";
import { DESIGN_TOOLS, callDesignTool } from "./designMcp.mjs";

const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const READ_LIMIT = 1_000_000;           // one read_file chunk
const WRITE_LIMIT = 4_000_000;          // Vercel caps a request body at ~4.5 MB
const WRITE_MIME = { ".json": "application/json", ".md": "text/markdown; charset=utf-8" };

/* ── config ─────────────────────────────────────────────────────────────────────────────────────────── */
const unquote = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
export function libraryMcpConfig(env = process.env) {
  const pick = (k) => unquote(env[`MCP_${k}`] || env[k]);
  const cfg = {
    endpoint: pick("R2_ENDPOINT"), accessKeyId: pick("R2_ACCESS_KEY_ID"), secretAccessKey: pick("R2_SECRET_ACCESS_KEY"), bucket: pick("R2_BUCKET"),
    publicUrl: pick("R2_PUBLIC_URL").replace(/\/+$/, ""),
    prefix: (pick("R2_LIBRARY_PREFIX") || "library").replace(/^\/+|\/+$/g, ""),
    tokens: unquote(env.MCP_TOKENS).split(",").map((t) => t.trim()).filter(Boolean).map((t) => {
      const i = t.indexOf(":");
      return i > 0 ? { name: t.slice(0, i), hash: sha(t.slice(i + 1)) } : { name: "user", hash: sha(t) };
    }),
  };
  return cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket ? cfg : null;
}

/* ── helpers ────────────────────────────────────────────────────────────────────────────────────────── */
const sha = (s) => crypto.createHash("sha256").update(s).digest();
const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  for (const [k, v] of Object.entries({ "Content-Type": "application/json", "Cache-Control": "no-store", ...headers })) res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = (req, limit = WRITE_LIMIT + 200_000) => new Promise((resolve, reject) => {
  if (req.body !== undefined) { resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body)); return; } // Vercel may pre-parse
  let size = 0; const chunks = [];
  req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("body too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});
const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const errText = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });

/** The caller's name, or null. The token comes from `Authorization: Bearer …` (Claude Code) or `?token=…` —
 *  claude.ai's custom-connector form takes only a URL, with no field for headers. */
function who(cfg, req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  const token = m?.[1] ?? new URL(req.url ?? "/", "http://x").searchParams.get("token");
  if (!token) return null;
  const h = sha(token.trim());
  return cfg.tokens.find((t) => crypto.timingSafeEqual(t.hash, h))?.name ?? null;
}

/** A library-relative path → a bucket key under the prefix, or throws. */
function keyFor(cfg, rel, { dir = false } = {}) {
  const raw = String(rel ?? "").replace(/\\/g, "/").trim();
  if (/(^|\/)\.\.(\/|$)/.test(raw)) throw new Error("path may not contain ..");
  const clean = path.posix.normalize(`/${raw}`).replace(/^\/+|\/+$/g, "");
  if (!clean && !dir) throw new Error("path is required");
  // Accept a path that already starts with the prefix ("library/Designs/x.json") as well as "Designs/x.json".
  const inside = clean === cfg.prefix || clean.startsWith(`${cfg.prefix}/`) ? clean.slice(cfg.prefix.length).replace(/^\/+/, "") : clean;
  return inside ? `${cfg.prefix}/${inside}` : cfg.prefix;
}
const relOf = (cfg, key) => key.slice(cfg.prefix.length + 1);
const publicUrl = (cfg, key) => (cfg.publicUrl ? `${cfg.publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}` : undefined);

async function exists(cfg, key) {
  return (await listObjectsDetailed(cfg, key)).some((o) => o.key === key);
}

/* ── tools ──────────────────────────────────────────────────────────────────────────────────────────── */
const LIBRARY_TOOLS = [
  {
    name: "list_library",
    description: "List files in the shared R2 library. `folder` is relative to the library root, e.g. \"Designs\", \"Objects\", \"Materials\", \"Moodboards\", \"Skills/Floorplan Tracer\". Omit it to see the top-level folders with file counts. Designs (floor plan JSONs the editor opens) live in Designs/.",
    inputSchema: { type: "object", properties: {
      folder: { type: "string", description: "folder relative to the library root; omit for the overview" },
      recursive: { type: "boolean", description: "include files in sub-folders (default true)" },
    } },
  },
  {
    name: "search_library",
    description: "Find library files whose path contains every word of `query` (case-insensitive), e.g. \"chair json\" or \"tracer skill\".",
    inputSchema: { type: "object", properties: { query: { type: "string" }, folder: { type: "string", description: "limit the search to this folder" } }, required: ["query"] },
  },
  {
    name: "read_file",
    description: "Read one text file (JSON, Markdown, …) from the library. Large files come back in 1 MB chunks: if `truncated` is true, call again with `offset` = the returned `nextOffset`. Binary files (images, .glb, .blend) are not read — you get their public URL instead.",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "e.g. \"Designs/Windsor_park_B1.json\" or \"Skills/Floorplan Tracer/SKILL.md\"" },
      offset: { type: "number", description: "byte offset to start from (default 0)" },
    }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Save a .json or .md file into the library — a new design in Designs/, an object in Objects/, a material, a skill note. JSON must be valid. An existing file is only replaced when `overwrite` is true, so read it first and keep what you did not mean to change. Anyone opening the deployed editor sees the result in the library.",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "library-relative path ending in .json or .md" },
      content: { description: "the file body: a string, or a JSON value for a .json file" },
      overwrite: { type: "boolean", description: "replace the file if it already exists (default false)" },
    }, required: ["path", "content"] },
  },
];

const TOOLS = [...LIBRARY_TOOLS, ...DESIGN_TOOLS];

async function listLibrary(cfg, { folder, recursive = true }) {
  const base = keyFor(cfg, folder, { dir: true });
  const objects = await listObjectsDetailed(cfg, `${base}/`);
  if (!folder) {
    const counts = {};
    for (const o of objects) { const top = relOf(cfg, o.key).split("/")[0]; counts[top] = (counts[top] ?? 0) + 1; }
    return { root: cfg.prefix, folders: counts };
  }
  const depth = base.split("/").length + 1;
  const files = objects
    .filter((o) => recursive || o.key.split("/").length === depth)
    .map((o) => ({ path: relOf(cfg, o.key), size: o.size, modified: o.lastModified }));
  return { folder: relOf(cfg, `${base}/x`).replace(/\/?x$/, ""), count: files.length, files };
}

async function searchLibrary(cfg, { query, folder }) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) throw new Error("query is required");
  const base = keyFor(cfg, folder, { dir: true });
  const hits = (await listObjectsDetailed(cfg, `${base}/`))
    .filter((o) => { const p = relOf(cfg, o.key).toLowerCase(); return words.every((w) => p.includes(w)); })
    .map((o) => ({ path: relOf(cfg, o.key), size: o.size, modified: o.lastModified }));
  return { count: hits.length, files: hits.slice(0, 200), more: hits.length > 200 };
}

const TEXT_EXT = /\.(json|md|txt|csv|svg|xml|yaml|yml|inp|dxf|py|mjs|js|ts)$/i;
async function readFile(cfg, { path: rel, offset = 0 }) {
  const key = keyFor(cfg, rel);
  if (!TEXT_EXT.test(key)) return { path: relOf(cfg, key), binary: true, url: publicUrl(cfg, key), note: "binary file — not read; fetch the URL if you need it" };
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  let r;
  try {
    r = start
      ? await rangedText(cfg, key, start)
      : await getObjectText(cfg, key, READ_LIMIT);
  } catch (e) {
    if (/404|NoSuchKey|Not Found/i.test(String(e?.message))) throw new Error(`no such file: ${relOf(cfg, key)}`);
    throw e;
  }
  const end = start + Buffer.byteLength(r.text, "utf8");
  return { path: relOf(cfg, key), size: r.size, offset: start, truncated: end < r.size, ...(end < r.size ? { nextOffset: end } : {}), content: r.text };
}
/** getObjectText always starts at byte 0; later chunks go through the same signed GET with a moved range. */
async function rangedText(cfg, key, start) {
  const { signedRequest } = await import("../tools/r2.mjs");
  const res = await signedRequest(cfg, "GET", key, "", { range: `bytes=${start}-${start + READ_LIMIT - 1}` });
  const body = Buffer.from(await res.arrayBuffer());
  const total = Number(/\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1]);
  return { text: body.toString("utf8"), size: Number.isFinite(total) ? total : start + body.length };
}

async function writeFile(cfg, { path: rel, content, overwrite = false }, user) {
  const key = keyFor(cfg, rel);
  const ext = path.posix.extname(key).toLowerCase();
  if (!WRITE_MIME[ext]) throw new Error("only .json and .md files can be written");
  let body;
  if (ext === ".json") {
    let value = content;
    if (typeof content === "string") { try { value = JSON.parse(content); } catch (e) { throw new Error(`content is not valid JSON: ${e.message}`); } }
    body = JSON.stringify(value, null, 2);
  } else {
    if (typeof content !== "string") throw new Error("a .md file needs string content");
    body = content;
  }
  if (Buffer.byteLength(body, "utf8") > WRITE_LIMIT) throw new Error(`file is larger than ${WRITE_LIMIT / 1e6} MB`);
  const existed = await exists(cfg, key);
  if (existed && !overwrite) throw new Error(`${relOf(cfg, key)} already exists — read it, then call again with overwrite: true to replace it, or pick a new name`);
  await putObject(cfg, key, body, WRITE_MIME[ext]);
  console.log(`[library-mcp] ${user} wrote ${key} (${body.length} bytes${existed ? ", replaced" : ""})`);
  return { ok: true, path: relOf(cfg, key), bytes: Buffer.byteLength(body, "utf8"), replaced: existed, url: publicUrl(cfg, key) };
}

/** The design tools see the library through this: library-relative paths, confined by keyFor. */
const DESIGN_READ_LIMIT = 20_000_000;
export function libraryStore(cfg) {
  return {
    get: async (rel) => (await getObjectText(cfg, keyFor(cfg, rel), DESIGN_READ_LIMIT)).text,
    put: async (rel, body) => {
      if (Buffer.byteLength(body, "utf8") > DESIGN_READ_LIMIT) throw new Error("design is too large to save");
      await putObject(cfg, keyFor(cfg, rel), body, WRITE_MIME[".json"]);
    },
    putBinary: async (rel, buf, mime) => {
      if (!/\.png$/i.test(rel)) throw new Error("only .png previews can be written as binary");
      await putObject(cfg, keyFor(cfg, rel), buf, mime);
    },
    exists: (rel) => exists(cfg, keyFor(cfg, rel)),
    list: async (prefix) => (await listObjectsDetailed(cfg, `${keyFor(cfg, prefix, { dir: true })}/`)).map((o) => relOf(cfg, o.key)),
  };
}

async function callTool(cfg, name, args, user) {
  if (DESIGN_TOOLS.some((t) => t.name === name)) {
    const r = await callDesignTool(libraryStore(cfg), name, args, user);
    if (r?.__content) return { content: r.__content };
    if (name === "edit_design" && !args.dryRun) console.log(`[library-mcp] ${user} edited ${r.path} → revision ${r.revision} (${args.ops.length} ops)`);
    return text(r);
  }
  if (name === "list_library") return text(await listLibrary(cfg, args));
  if (name === "search_library") return text(await searchLibrary(cfg, args));
  if (name === "read_file") {
    const r = await readFile(cfg, args);
    if (r.content === undefined) return text(r);
    const { content, ...meta } = r;
    return { content: [{ type: "text", text: JSON.stringify(meta) }, { type: "text", text: content }] };
  }
  if (name === "write_file") return text(await writeFile(cfg, args, user));
  throw new Error(`unknown tool: ${name}`);
}

/* ── MCP over HTTP (JSON responses, no SSE) ─────────────────────────────────────────────────────────── */
export async function handleLibraryMcp(req, res, cfg = libraryMcpConfig()) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (!cfg) return send(res, 503, { error: "library storage is not configured (set MCP_R2_ENDPOINT / MCP_R2_ACCESS_KEY_ID / MCP_R2_SECRET_ACCESS_KEY / MCP_R2_BUCKET, or the R2_* equivalents)" });
  if (!cfg.tokens.length) return send(res, 503, { error: "no access tokens configured (set MCP_TOKENS=name:token,…)" });
  if (req.method === "GET") return send(res, 405, { error: "this MCP endpoint answers POST only (no SSE stream)" }, { Allow: "POST" });
  if (req.method === "DELETE") return send(res, 200, {});
  if (req.method !== "POST") return send(res, 405, { error: "POST only" }, { Allow: "POST" });

  const user = who(cfg, req);
  if (!user) return send(res, 401, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or unknown token. Ask the project owner for a floorplan library token and pass it as --header \"Authorization: Bearer <token>\", or as ?token=<token> on the URL" } });

  let msg;
  try { msg = JSON.parse(await readBody(req)); } catch { return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  const one = async (m) => {
    const { id, method, params } = m ?? {};
    if (id === undefined || id === null) return null;                    // a notification: no reply
    const reply = (result) => ({ jsonrpc: "2.0", id, result });
    const fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
    if (method === "initialize") {
      const v = PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : "2025-03-26";
      return reply({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "floorplan-library", version: "0.2.0" },
        instructions: "The shared BuilderPluss R2 library, with no editor tab needed: list, search, read and save designs (Designs/), parametric objects (Objects/), materials, moodboards and skills (Skills/ — read a skill's SKILL.md before following it). Saved designs open in the deployed editor at https://floorplan-indol.vercel.app/floorplan-editor. Draw designs HEADLESS with create_design / get_design / edit_design / list_objects — walls, doors, windows, furniture and spaces written straight into the design file in metres; the editor evaluates the objects when the design is opened. To watch it draw on a live canvas instead, use the editor's Connect Claude relay." });
    }
    if (method === "ping") return reply({});
    if (method === "tools/list") return reply({ tools: TOOLS });
    if (method === "tools/call") {
      const name = params?.name, args = params?.arguments ?? {};
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `unknown tool: ${name}`);
      try { return reply(await callTool(cfg, name, args, user)); } catch (e) { return reply(errText(e?.message || "library error")); }
    }
    return fail(-32601, `method not found: ${method}`);
  };
  try {
    if (Array.isArray(msg)) {
      const out = (await Promise.all(msg.map(one))).filter(Boolean);
      return out.length ? send(res, 200, out) : send(res, 202, "");
    }
    const out = await one(msg);
    return out ? send(res, 200, out) : send(res, 202, "");
  } catch (e) {
    send(res, 500, { jsonrpc: "2.0", id: null, error: { code: -32603, message: e?.message || "library error" } });
  }
}
