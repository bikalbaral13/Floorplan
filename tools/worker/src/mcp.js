/** MCP server on the Worker — Streamable HTTP, stateless JSON responses (POST /mcp).
 *
 * The viewer is the centre: viewer_open first, then read skills/pipelines from the library, save designs,
 * and show / check the result in the same viewer. No editor app, no pairing code.
 */
import { err } from "./util.js";
import { cleanPath } from "./util.js";
import { saveFile } from "./save.js";
import { validId, readState, writeState, patchState, readEvents, readSnapshot } from "./sessions.js";

const INSTRUCTIONS = `BuilderPluss library over MCP — the HTML viewer is the canvas; there is no editor app.
1. Start every task with viewer_open (optionally with a design path) and give the user the link it returns
   (open it in a browser pane if you can). Keep the session id for later calls.
2. Work FILE-FIRST: read skills (skills_list → library_read on the skill's .md files), designs, objects and
   pipelines with library_list / library_read; build or change the design JSON yourself.
3. Save with design_save (it needs the etag from library_read when the file exists), then viewer_show the
   path. Check your work with viewer_snapshot.
4. Never answer a questionnaire yourself: put it in front of the user with form_ask, then poll viewer_events
   until the answers arrive. viewer_events also reports what the user selected in the viewer.`;

const S = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });

const TOOLS = [
  {
    name: "viewer_open",
    description: "Start here. Creates a viewer session and returns its link (JSON · 2D · 3D viewer in R2). Optionally loads a design.",
    inputSchema: S({ src: str("Library path of a design to show, e.g. Designs/Ramanadhapuram_Villa1_improved.json"),
      view: { type: "string", enum: ["all", "json", "d2", "d3"] } }),
    run: async (env, who, a, origin) => {
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      const src = a.src ? cleanPath(a.src) : null;
      await writeState(env, id, { rev: 1, src, view: a.view || "all", createdAt: new Date().toISOString(), createdBy: who.user });
      const link = `${env.VIEWER_URL}?session=${id}&api=${encodeURIComponent(origin)}${src ? `&src=${encodeURIComponent(src)}` : ""}`;
      return text(`session: ${id}\nviewer: ${link}\n\nOpen the viewer link for the user. Use this session id with viewer_show / viewer_snapshot / viewer_events / form_ask.`);
    },
  },
  {
    name: "viewer_show",
    description: "Change what an open viewer shows: another design, the layout, the level, a selection, the camera.",
    inputSchema: S({ session: str("Session id from viewer_open"), src: str("Library path of the design to show"),
      view: { type: "string", enum: ["all", "json", "d2", "d3"] }, level: str("Level id or name"),
      select: { type: "array", items: { type: "string" }, description: "Element or attachment ids to select" },
      camera: { type: "string", enum: ["fit", "top", "iso"] } }, ["session"]),
    run: async (env, who, a) => {
      sess(a.session);
      const change = {};
      for (const k of ["view", "level", "select", "camera"]) if (a[k] != null) change[k] = a[k];
      if (a.src) change.src = cleanPath(a.src);
      const s = await patchState(env, a.session, change);
      return text(`viewer updated (rev ${s.rev})`);
    },
  },
  {
    name: "viewer_snapshot",
    description: "Image of what the open viewer shows right now (asks the viewer page to capture itself; needs the viewer open).",
    inputSchema: S({ session: str("Session id"), pane: { type: "string", enum: ["visible", "d2", "d3"] } }, ["session"]),
    run: async (env, who, a) => {
      sess(a.session);
      const s = await patchState(env, a.session, { snapshot: { req: Date.now(), pane: a.pane || "visible" } });
      const want = String(s.snapshot.req);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const o = await readSnapshot(env, a.session);
        if (o && o.customMetadata?.req === want) {
          return { content: [{ type: "image", data: b64(await o.arrayBuffer()), mimeType: "image/png" }] };
        }
      }
      throw err(504, "the viewer did not answer within 20 s — is the viewer link open?");
    },
  },
  {
    name: "viewer_events",
    description: "What the user did in the viewer since `since`: selections ({type:'select'}) and form answers ({type:'form'}).",
    inputSchema: S({ session: str("Session id"), since: { type: "number", description: "Last seq you have seen (default 0)" } }, ["session"]),
    run: async (env, who, a) => {
      sess(a.session);
      const list = (await readEvents(env, a.session)).filter((e) => e.seq > (a.since || 0));
      return text(JSON.stringify({ events: list, last: list.at(-1)?.seq ?? a.since ?? 0 }, null, 1));
    },
  },
  {
    name: "form_ask",
    description: "Show the user a form in the viewer. The answers arrive later as a {type:'form', formId, answers} event — poll viewer_events. Never fill a form yourself.",
    inputSchema: S({ session: str("Session id"), title: str("Form title"),
      fields: { type: "array", items: { type: "object", properties: {
        key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: ["text", "number", "select", "checkbox"] },
        options: { type: "array", items: { type: "string" } }, default: {} }, required: ["key", "label"] } } }, ["session", "title", "fields"]),
    run: async (env, who, a) => {
      sess(a.session);
      const formId = `f${Date.now().toString(36)}`;
      await patchState(env, a.session, { form: { id: formId, title: a.title, fields: a.fields } });
      return text(`form ${formId} shown — poll viewer_events for {type:"form", formId:"${formId}"}`);
    },
  },
  {
    name: "library_list",
    description: "List a library folder (folders end with /). Top level: Designs/, Master Plans/, Objects/, Materials/, Skills/, Engine/, Viewer/, …",
    inputSchema: S({ prefix: str("Folder, e.g. Skills/ or Designs/ (empty = top level)") }),
    run: async (env, who, a) => {
      const folder = (a.prefix || "").replace(/\/+$/, "");
      const pre = folder ? cleanPath(folder) + "/" : "";
      const out = [];
      let cursor;
      do {
        const r = await env.BUCKET.list({ prefix: env.PREFIX + pre, delimiter: "/", cursor, limit: 1000 });
        out.push(...r.delimitedPrefixes.map((p) => p.slice(env.PREFIX.length)));
        out.push(...r.objects.map((o) => `${o.key.slice(env.PREFIX.length)}  (${o.size} B)`));
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor && out.length < 3000);
      return text(out.filter((l) => !/^_(versions|audit|sessions)\//i.test(l)).join("\n") || "(empty)");
    },
  },
  {
    name: "library_read",
    description: "Read a library file as text, with its etag (pass that etag to design_save). Large files are cut at maxBytes.",
    inputSchema: S({ path: str("Library path"), maxBytes: { type: "number", description: "Default 400000" } }, ["path"]),
    run: async (env, who, a) => {
      const path = cleanPath(a.path);
      const o = await env.BUCKET.get(env.PREFIX + path);
      if (!o) throw err(404, `not found: ${path}`);
      const max = Math.min(a.maxBytes || 400_000, 4_000_000);
      const buf = new Uint8Array(await o.arrayBuffer());
      const body = new TextDecoder().decode(buf.subarray(0, max));
      return text(`path: ${path}\netag: ${o.httpEtag}\nbytes: ${buf.length}${buf.length > max ? ` (showing first ${max})` : ""}\n\n${body}`);
    },
  },
  {
    name: "skills_list",
    description: "The skills in library/Skills — each is a folder of .md files to read and follow.",
    inputSchema: S({}),
    run: async (env) => {
      const r = await env.BUCKET.list({ prefix: `${env.PREFIX}Skills/`, delimiter: "/" });
      return text(r.delimitedPrefixes.map((p) => p.slice(env.PREFIX.length)).join("\n") || "(no skills)");
    },
  },
  {
    name: "design_save",
    description: "Save a design (Designs/, Master Plans/) or form answers (Forms/). Overwriting needs the etag you read; the old version is kept.",
    inputSchema: S({ path: str("Library path, .json"), json: { description: "The whole document (object or JSON string)" },
      etag: str("etag from library_read (omit only when creating)"), session: str("If given, the viewer shows the saved file") }, ["path", "json"]),
    run: async (env, who, a) => {
      const path = cleanPath(a.path);
      const body = typeof a.json === "string" ? a.json : JSON.stringify(a.json);
      const r = await saveFile(env, who, path, body, a.etag ? { ifMatch: a.etag } : { ifNone: "*" });
      if (r.status >= 300) throw err(r.status, r.body.error + (r.body.etag ? ` (current etag ${r.body.etag})` : ""));
      if (a.session) { sess(a.session); await patchState(env, a.session, { src: path }); }
      return text(JSON.stringify(r.body));
    },
  },
];

export async function handleMcp(req, env, who, origin) {
  if (req.method !== "POST") return new Response("MCP endpoint — POST JSON-RPC here", { status: 405, headers: { allow: "POST" } });
  let msg;
  try { msg = await req.json(); } catch { return rpcResponse({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
  const batch = Array.isArray(msg) ? msg : [msg];
  const out = [];
  for (const m of batch) { const r = await one(m, env, who, origin); if (r) out.push(r); }
  if (!out.length) return new Response(null, { status: 202 });
  return rpcResponse(Array.isArray(msg) ? out : out[0]);
}

async function one(m, env, who, origin) {
  if (m.id === undefined || m.id === null) return null;   // notification (e.g. notifications/initialized)
  const ok = (result) => ({ jsonrpc: "2.0", id: m.id, result });
  switch (m.method) {
    case "initialize":
      return ok({ protocolVersion: m.params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "builderpluss-library", version: "0.1.0" }, instructions: INSTRUCTIONS });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) return { jsonrpc: "2.0", id: m.id, error: { code: -32602, message: `unknown tool ${m.params?.name}` } };
      try { return ok(await tool.run(env, who, m.params.arguments || {}, origin)); }
      catch (e) { return ok({ content: [{ type: "text", text: `error: ${e.message || e}` }], isError: true }); }
    }
    default: return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } };
  }
}

const rpcResponse = (o) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
const text = (t) => ({ content: [{ type: "text", text: t }] });
const sess = (id) => { if (!validId(id)) throw err(400, "bad session id"); };
function b64(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
