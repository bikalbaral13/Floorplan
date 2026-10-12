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
import { groupedTools, resolveCall, describeOps } from "../packages/floorplan-bridge/toolGroups.mjs";
import { relayConfig, setRelayBaseFrom, CONNECTOR_RELAY_TOOLS, linkConnector, openEditor, connectorStatus, callConnectorTool, connectorWorkflowTools, isWorkflowTool } from "./relayCore.mjs";

/** MCP_FLAT_TOOLS=1 lists the old one-tool-per-command surface instead of the grouped one (rollback switch). */
const FLAT = /^(1|true|yes)$/i.test(String(process.env.MCP_FLAT_TOOLS ?? ""));
const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
const READ_LIMIT = 1_000_000;           // one read_file chunk
const WRITE_LIMIT = 4_000_000;          // Vercel caps a request body at ~4.5 MB
const WRITE_MIME = { ".json": "application/json", ".md": "text/markdown; charset=utf-8" };
const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const IMAGE_READ_LIMIT = 3_500_000;     // raw bytes; base64 grows it by a third and the response must stay under Vercel's cap

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
  const h = sha(token.trim().replace(/^["']+|["']+$/g, ""));   // pasted URLs often keep the quotes
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
    description: "List files in the shared R2 library. `folder` is relative to the library root, e.g. \"Designs\", \"Objects\", \"Materials\", \"Moodboards\", \"Images\", \"Workflows\", \"Skills/Floorplan Tracer\". Omit it to see the top-level folders with file counts. Designs (floor plan JSONs the editor opens) live in Designs/; pictures (moodboards, plan scans, references) in Images/; workflow definitions in Workflows/.",
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
    description: "Read one text file (JSON, Markdown, …) from the library. Large files come back in 1 MB chunks: if `truncated` is true, call again with `offset` = the returned `nextOffset`. Images (.png .jpg .webp .gif, up to 3.5 MB) come back as an image you can look at, e.g. Images/<name>.png. Other binary files (.glb, .blend) are not read — you get their public URL instead.",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "e.g. \"Designs/Windsor_park_B1.json\" or \"Skills/Floorplan Tracer/scope-the-trace.md\"" },
      offset: { type: "number", description: "byte offset to start from (default 0)" },
    }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Save a file into the library — a .json or .md (a new design in Designs/, an object in Objects/, a material, a skill note), or an image (.png .jpg .webp .gif, up to ~3 MB) into Images/ with `base64` set to the image bytes, e.g. a picture the user attached in chat. JSON must be valid. An existing file is only replaced when `overwrite` is true, so read it first and keep what you did not mean to change. Anyone opening the deployed editor sees the result in the library.",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "library-relative path ending in .json or .md" },
      content: { description: "the file body: a string, or a JSON value for a .json file" },
      base64: { type: "string", description: "for an image: its bytes, base64-encoded (a data: URL prefix is accepted); use instead of content" },
      overwrite: { type: "boolean", description: "replace the file if it already exists (default false)" },
    }, required: ["path"] },
  },
];

/** Skills and the live-editor link. A prompt is routed to a skill (list_skills → read_skill), and the skill's
 *  steps run through the canvas tools, which drive a linked editor tab live or fall back to headless. */
const CONNECTOR_TOOLS = [
  {
    name: "list_skills",
    description: "List every workflow skill in the library — each Skills/<folder> is one skill made of .md playbooks, listed with their descriptions — Floorplan Tracer, Improver, Renderer, Parametric Object Creator, Material Creator, Moodboard Creator … Call this FIRST for any request bigger than a single edit, pick the skill that fits, then read_skill it.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "read_skill",
    description: "Read a skill: a folder name (e.g. 'Floorplan Tracer') returns all its playbooks, 'Folder/file.md' returns one. Follow its steps with the canvas tools; read other referenced files with read_file.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "skill folder, or Folder/file.md" } }, required: ["name"] },
  },
  {
    name: "connect_editor",
    description: "Link this connector to the user's OPEN editor tab so canvas tools draw on it LIVE. The user opens https://floorplan-indol.vercel.app/floorplan-editor, clicks Connect Claude and reads you the short code shown there. Without a link, canvas tools edit a Library design headlessly (pick it with use_design).",
    inputSchema: { type: "object", properties: { code: { type: "string", description: "the code the editor's Connect Claude dialog shows, e.g. K7PX2M" } }, required: ["code"] },
  },
  {
    name: "open_editor",
    description: "Start a LIVE editor session without the user clicking anything: returns a one-time link (valid 10 min) that opens the floorplan editor already connected to this connector. Give the user the link — or open it beside the chat if you can open a browser — then call editor_status until tabConnected is true. Prefer this over connect_editor.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "editor_status",
    description: "Is a live editor tab linked and connected, which Library design headless edits go to, and the step-gate state. Call before a multi-step job to know whether the user is watching live.",
    inputSchema: { type: "object", properties: {} },
  },
];

/** Built on first use: relayCore imports this module back (through relayHeadless), so its tool list may not
 *  exist yet while this module is evaluating. Our own tools win a name clash (list_objects). */
let toolList = null;
const OWN_NAMES = new Set([...LIBRARY_TOOLS, ...DESIGN_TOOLS, ...CONNECTOR_TOOLS].map((t) => t.name));
function allTools() {
  if (!toolList) toolList = [...LIBRARY_TOOLS, ...DESIGN_TOOLS, ...CONNECTOR_TOOLS, ...CONNECTOR_RELAY_TOOLS.filter((t) => !OWN_NAMES.has(t.name))];
  return toolList;
}

const INSTRUCTIONS = `BuilderPluss floor plan designer: the shared R2 library — data, skills, the engine and an HTML viewer. The VIEWER is the canvas; no editor app is needed.

START HERE
1. read_file { path: "AGENT.md" } — how the library is organised and the rules that matter.
2. viewer { op: "open", src? } → give the user the link it returns (open it beside the chat if you can). Keep the session id.

TOOLS ARE GROUPED: viewer, library, skills, design, objects, workflow, … (+ await_result). Each takes an \`op\` — e.g. skills { op: "list" }, design { op: "load", path: "Designs/X.json" }. op: "describe_ops" gives a group's full arguments; old flat names (read_file, load_design, …) still work.

HOW TO HANDLE A REQUEST
1. Anything beyond a single small edit: skills { op: "list" }, read the skill that fits, follow it step by step. Read files it references with read_file.
2. Work FILE-FIRST: build or change the plan as JSON and save it ONCE — design.load { path, design } (new or whole plan) or one design.edit batch (up to 500 ops). If you can run code locally with R2 keys, do the job locally (tools/r2.mjs) and pass paths, never big JSON or image bytes, through these tools.
3. Show it: viewer { op: "show", session, src: path }. Check it: viewer { op: "snapshot", session } (or design.render with no viewer open).
4. Questions for the user — questionnaires, scope forms, choices — go in viewer { op: "form" }; poll viewer { op: "events" } for the answers and for what the user clicked. Never answer a form yourself.
5. A call that returns { pending: true, ticket } → await_result with the ticket until it finishes.
6. Steps a skill runs on the user's PC (Blender, Python/DXF, .skp) cannot run here: finish the rest, save, and give the exact local command.
The live editor tab (session.open, flows, underlays, checkpoints) is still available for work that needs it, but is not the default.`;

/** A skill is a folder under Skills/; each .md in it is one playbook with a `description:` in its front matter. */
const describe = (t) => {
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(t)?.[1] ?? "";
  const d = /^description:\s*(.+)$/m.exec(fm)?.[1] ?? t.replace(/^---[\s\S]*?---/, "").split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
  return d.trim().replace(/^["'>|]\s*|["']$/g, "").slice(0, 300);
};

async function listSkills(cfg) {
  const all = await listObjectsDetailed(cfg, `${keyFor(cfg, "Skills", { dir: true })}/`);
  const mds = all.filter((o) => /\.md$/i.test(o.key));
  const out = new Array(mds.length);
  for (let i = 0; i < mds.length; i += 24) {                           // a couple of dozen reads at a time
    await Promise.all(mds.slice(i, i + 24).map(async (o, j) => {
      let description = "";
      try { description = describe((await getObjectText(cfg, o.key, 6_000)).text); } catch { /* list it anyway */ }
      out[i + j] = { path: relOf(cfg, o.key), description };
    }));
  }
  const skills = {};
  for (const f of out) {
    const [, folder, file] = /^Skills\/(.+)\/([^/]+)$/.exec(f.path) ?? [];
    if (folder) (skills[folder] ??= []).push({ file, description: f.description });
  }
  return { count: Object.keys(skills).length, note: "Each folder is a skill; read_skill a folder for all its playbooks, or \"Folder/file.md\" for one.", skills };
}

async function readSkill(cfg, { name }) {
  const rel = String(name ?? "").trim().replace(/^Skills\//i, "");
  if (/\.md$/i.test(rel)) {
    const r = await getObjectText(cfg, keyFor(cfg, `Skills/${rel}`), READ_LIMIT).catch(() => null);
    if (!r) throw new Error(`no skill file "${rel}" — call list_skills for the names`);
    return { content: [{ type: "text", text: r.text }] };
  }
  const base = keyFor(cfg, `Skills/${rel}`, { dir: true });
  const files = await listObjectsDetailed(cfg, `${base}/`);
  const mds = files.filter((o) => /\.md$/i.test(o.key));
  if (!mds.length) throw new Error(`no skill "${rel}" — call list_skills for the names`);
  const parts = []; let size = 0;
  for (const o of mds) {
    const t = (await getObjectText(cfg, o.key, READ_LIMIT)).text;
    if (size + t.length > READ_LIMIT) { parts.push(`\n\n(… ${relOf(cfg, o.key)} and later files left out for size — read them with read_skill "${rel}/<file>.md")`); break; }
    parts.push(`\n\n===== ${relOf(cfg, o.key)} =====\n${t}`); size += t.length;
  }
  return { content: [
    { type: "text", text: JSON.stringify({ skill: rel, otherFiles: files.filter((o) => !/\.md$/i.test(o.key)).map((o) => relOf(cfg, o.key)).slice(0, 200) }) },
    { type: "text", text: parts.join("") },
  ] };
}

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
  const imageMime = IMAGE_MIME[path.posix.extname(key).toLowerCase()];
  if (imageMime) return readImage(cfg, key, imageMime);
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
async function readImage(cfg, key, mime) {
  const { signedRequest } = await import("../tools/r2.mjs");
  const meta = { path: relOf(cfg, key), url: publicUrl(cfg, key) };
  const size = (await listObjectsDetailed(cfg, key)).find((o) => o.key === key)?.size;
  if (size === undefined) throw new Error(`no such file: ${meta.path}`);
  if (size > IMAGE_READ_LIMIT) return { ...meta, size, binary: true, note: `image is ${(size / 1e6).toFixed(1)} MB — too large to return inline (limit ${IMAGE_READ_LIMIT / 1e6} MB); fetch the URL instead` };
  const buf = Buffer.from(await (await signedRequest(cfg, "GET", key)).arrayBuffer());
  return { ...meta, size, mimeType: mime, image: buf.toString("base64") };
}
/** getObjectText always starts at byte 0; later chunks go through the same signed GET with a moved range. */
async function rangedText(cfg, key, start) {
  const { signedRequest } = await import("../tools/r2.mjs");
  const res = await signedRequest(cfg, "GET", key, "", { range: `bytes=${start}-${start + READ_LIMIT - 1}` });
  const body = Buffer.from(await res.arrayBuffer());
  const total = Number(/\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1]);
  return { text: body.toString("utf8"), size: Number.isFinite(total) ? total : start + body.length };
}

async function writeFile(cfg, { path: rel, content, base64, overwrite = false }, user) {
  const key = keyFor(cfg, rel);
  const ext = path.posix.extname(key).toLowerCase();
  const mime = WRITE_MIME[ext] ?? IMAGE_MIME[ext];
  if (!mime) throw new Error("only .json, .md and image files (.png .jpg .jpeg .webp .gif) can be written");
  let body;
  if (IMAGE_MIME[ext]) {
    const b64 = String(base64 ?? (typeof content === "string" ? content : "")).replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!b64) throw new Error("an image needs its bytes in `base64`");
    body = Buffer.from(b64, "base64");
    if (!body.length) throw new Error("`base64` did not decode to any bytes");
  } else if (content === undefined) {
    throw new Error("`content` is required for a .json or .md file");
  } else if (ext === ".json") {
    let value = content;
    if (typeof content === "string") { try { value = JSON.parse(content); } catch (e) { throw new Error(`content is not valid JSON: ${e.message}`); } }
    body = JSON.stringify(value, null, 2);
  } else {
    if (typeof content !== "string") throw new Error("a .md file needs string content");
    body = content;
  }
  const bytes = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body, "utf8");
  if (bytes > WRITE_LIMIT) throw new Error(`file is larger than ${WRITE_LIMIT / 1e6} MB`);
  const existed = await exists(cfg, key);
  if (existed && !overwrite) throw new Error(`${relOf(cfg, key)} already exists — read it, then call again with overwrite: true to replace it, or pick a new name`);
  await putObject(cfg, key, body, mime);
  console.log(`[library-mcp] ${user} wrote ${key} (${bytes} bytes${existed ? ", replaced" : ""})`);
  return { ok: true, path: relOf(cfg, key), bytes, replaced: existed, url: publicUrl(cfg, key) };
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
    if (r.image) { const { image, mimeType, ...meta } = r; return { content: [{ type: "text", text: JSON.stringify(meta) }, { type: "image", data: image, mimeType }] }; }
    if (r.content === undefined) return text(r);
    const { content, ...meta } = r;
    return { content: [{ type: "text", text: JSON.stringify(meta) }, { type: "text", text: content }] };
  }
  if (name === "write_file") return text(await writeFile(cfg, args, user));
  if (name === "list_skills") return text(await listSkills(cfg));
  if (name === "read_skill") return readSkill(cfg, args);
  const rcfg = relayConfig();
  if (!rcfg) throw new Error("the live editor relay is not configured on this server (RELAY_R2_* keys)");
  if (name === "connect_editor") return text(await linkConnector(rcfg, user, args.code));
  if (name === "open_editor") return text(await openEditor(rcfg, user));
  if (name === "editor_status") return text(await connectorStatus(rcfg, user));
  return callConnectorTool(rcfg, user, name, args);
}

/* ── MCP over HTTP (JSON responses, no SSE) ─────────────────────────────────────────────────────────── */
export async function handleLibraryMcp(req, res, cfg = libraryMcpConfig()) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, mcp-protocol-version");
  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  setRelayBaseFrom(req);   // viewer.open links point back at this deployment
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
      return reply({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: "floorplan-library", version: "0.3.0" }, instructions: INSTRUCTIONS });
    }
    if (method === "ping") return reply({});
    if (method === "tools/list") {
      // Opted-in workflow tools of the editor tab this user is linked to (none when not linked / no tab).
      // Grouped: ~12 tools; featured workflows are reached through workflow { op: "run" } and stay callable as wf_*.
      if (!FLAT) return reply({ tools: groupedTools(allTools()) });
      const rcfg = relayConfig();
      const wf = rcfg ? await connectorWorkflowTools(rcfg, user).catch(() => []) : [];
      return reply({ tools: [...allTools(), ...wf] });
    }
    if (method === "tools/call") {
      const r = resolveCall(params?.name, params?.arguments ?? {});
      if (r.error) return reply(errText(r.error));
      if (r.describe) return reply(text(describeOps(r.describe, allTools())));
      const name = r.name, args = r.args ?? {};
      if (!allTools().some((t) => t.name === name) && !isWorkflowTool(name)) return fail(-32602, `unknown tool: ${name}`);
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
