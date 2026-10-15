/** Viewer-first sessions for the hosted connector — the agent drives the R2 HTML viewer (JSON · 2D · 3D) instead
 *  of an editor tab. No pairing, no app: `viewer.open` returns a link, the page polls this relay for what to show.
 *
 *    Projects/<CODE>/viewer/<hex>/state.json      written by the agent's tools: src, view, level, select, camera, form, snapshot ask
 *    Projects/<CODE>/viewer/<hex>/events.json     written by the page: the user's selections and form answers
 *    Projects/<CODE>/viewer/<hex>/snapshot.json   written by the page when asked: { req, data: base64 PNG }
 *  Everything a session creates belongs to its project (bucket-root Projects/, 2026-10-15). The session id is
 *  "<CODE>.<16 hex>" when viewer.open was given a project, or just "<16 hex>" — then it lives under
 *  Projects/_unassigned/viewer/<hex>/. Nothing is written at the bucket root.
 *
 *  Stored in the RELAY bucket (relayConfig), like the rest of the relay's short-lived traffic. The page talks to
 *  `<app>/__relay/viewer/<id>` (GET state · POST /events · PUT /snapshot) — see handleViewerRoute. The session id
 *  is the only key; it carries no access to the library.
 *
 *  The viewer itself lives in R2 (library/Viewer/v1/index.html, tools/viewer/), opened with
 *  ?session=<id>&api=<app>/__relay — so the page and this relay need only agree on these three routes. */

import crypto from "node:crypto";
import { putObject, getObjectText } from "../tools/r2.mjs";

const VIEWER_URL = (process.env.VIEWER_URL || "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library/Viewer/v1/index.html").trim();
const SNAPSHOT_WAIT_MS = Number(process.env.VIEWER_SNAPSHOT_WAIT_MS || 40_000);  // inside Vercel's 60 s
const SESSION_ID = /^(?:([A-Z0-9][A-Z0-9_]{0,39})\.)?([a-f0-9]{16})$/;
const PROJECT_CODE = /^[A-Z0-9][A-Z0-9_]{0,39}$/;
const UNASSIGNED = "_unassigned";
/** Session file → its key inside the project's folder. */
const K = (id, f) => { const m = SESSION_ID.exec(id); return `Projects/${m[1] || UNASSIGNED}/viewer/${m[2]}/${f}`; };
const validId = (id) => typeof id === "string" && SESSION_ID.test(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(cfg, key) {
  try { const t = await getObjectText(cfg, key, 8_000_000); return t.text ? JSON.parse(t.text) : null; } catch { return null; }
}
const putJson = (cfg, key, v) => putObject(cfg, key, JSON.stringify(v));

async function patch(cfg, id, change) {
  const cur = await getJson(cfg, K(id, "state.json"));
  if (!cur) throw new Error(`no viewer session ${id} — call viewer.open first`);
  const next = { ...cur, ...change, rev: (cur.rev || 0) + 1, updatedAt: new Date().toISOString() };
  await putJson(cfg, K(id, "state.json"), next);
  return next;
}
const cleanSrc = (p) => {
  const s = String(p ?? "").trim().replace(/^\/+/, "").replace(/^library\//i, "");
  if (!s || s.split("/").some((x) => x === ".." || x === ".") || !/\.json$/i.test(s)) throw new Error("src must be a library path ending in .json, e.g. Designs/My House.json");
  return s;
};

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v, null, 1) }] });
const errText = (m) => ({ content: [{ type: "text", text: `Error: ${m}` }], isError: true });
const session = { type: "string", description: "viewer session id from viewer.open" };

export const VIEWER_TOOLS = [
  {
    name: "viewer_open",
    description: "START HERE for any visual work: opens the HTML viewer (JSON · 2D · 3D, in R2 — no editor app, no pairing) and returns its link and a session id. Give the user the link (open it in a browser pane if you can). Then build designs as files (design.load by path / library.write) and show them with viewer.show; check with viewer.snapshot.",
    inputSchema: { type: "object", properties: {
      src: { type: "string", description: "optional library path to show first, e.g. Designs/Ramanadhapuram_Villa1_improved.json" },
      project: { type: "string", description: "project code (e.g. AD_VL01): the session's files are kept in Projects/<CODE>/viewer/. Without it they go to Projects/_unassigned/viewer/." },
      view: { type: "string", enum: ["all", "json", "d2", "d3"], description: "panes (default all)" },
    } },
  },
  {
    name: "viewer_show",
    description: "Change what the open viewer shows: another file (src), panes, level, a selection (element/attachment ids), or the camera. The page follows within ~1 s.",
    inputSchema: { type: "object", properties: {
      session, src: { type: "string", description: "library path, .json" },
      view: { type: "string", enum: ["all", "json", "d2", "d3"] }, level: { type: "string", description: "level id or name" },
      select: { type: "array", items: { type: "string" } }, camera: { type: "string", enum: ["fit", "top", "iso"] },
    }, required: ["session"] },
  },
  {
    name: "viewer_snapshot",
    description: "PNG of what the viewer shows now (the page captures its 2D/3D panes and uploads them). Needs the viewer link open.",
    inputSchema: { type: "object", properties: { session, pane: { type: "string", enum: ["visible", "d2", "d3"] } }, required: ["session"] },
  },
  {
    name: "viewer_events",
    description: "What the user did in the viewer since `since`: {type:'select'} for clicked elements, {type:'form'} for form answers.",
    inputSchema: { type: "object", properties: { session, since: { type: "number", description: "last seq you saw (default 0)" } }, required: ["session"] },
  },
  {
    name: "viewer_form",
    description: "Put a form in front of the USER in the viewer. Never answer it yourself: poll viewer.events until {type:'form', formId} arrives.",
    inputSchema: { type: "object", properties: {
      session, title: { type: "string" },
      fields: { type: "array", items: { type: "object", properties: {
        key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: ["text", "number", "select", "checkbox"] },
        options: { type: "array", items: { type: "string" } }, default: {} }, required: ["key", "label"] } },
    }, required: ["session", "title", "fields"] },
  },
];
export const VIEWER_TOOL_NAMES = new Set(VIEWER_TOOLS.map((t) => t.name));

/** Run one viewer tool. `apiBase` is this deployment's relay base (e.g. https://floorplan-indol.vercel.app/__relay). */
export async function runViewerTool(cfg, name, args, apiBase) {
  try {
    if (name !== "viewer_open" && !validId(args.session)) return errText("session must be the id viewer.open returned");
    if (name === "viewer_open") {
      const project = args.project ? String(args.project).trim().toUpperCase() : "";
      if (project && !PROJECT_CODE.test(project)) return errText("project must be a project code like AD_VL01 (letters, digits, _)");
      const id = (project ? `${project}.` : "") + crypto.randomBytes(8).toString("hex");
      const src = args.src ? cleanSrc(args.src) : null;
      await putJson(cfg, K(id, "state.json"), { rev: 1, src, view: args.view || "all", createdAt: new Date().toISOString() });
      const link = `${VIEWER_URL}?session=${id}&api=${encodeURIComponent(apiBase)}${src ? `&src=${encodeURIComponent(src)}` : ""}`;
      return text({ session: id, link, next: "Give the user the link (or open it). Then viewer.show { session, src } after each saved change; viewer.snapshot to check." });
    }
    if (name === "viewer_show") {
      const change = {};
      for (const k of ["view", "level", "select", "camera"]) if (args[k] != null) change[k] = args[k];
      if (args.src) change.src = cleanSrc(args.src);
      const s = await patch(cfg, args.session, change);
      return text({ ok: true, rev: s.rev });
    }
    if (name === "viewer_snapshot") {
      const req = Date.now();
      await patch(cfg, args.session, { snapshot: { req, pane: args.pane || "visible" } });
      const until = Date.now() + SNAPSHOT_WAIT_MS;
      while (Date.now() < until) {
        await sleep(700);
        const snap = await getJson(cfg, K(args.session, "snapshot.json"));
        if (snap && String(snap.req) === String(req)) return { content: [{ type: "image", data: snap.data, mimeType: "image/png" }] };
      }
      return errText("the viewer did not answer — is the viewer link open in a browser?");
    }
    if (name === "viewer_events") {
      const all = (await getJson(cfg, K(args.session, "events.json"))) || [];
      const list = all.filter((e) => e.seq > (args.since || 0));
      return text({ events: list, last: list.at(-1)?.seq ?? args.since ?? 0 });
    }
    if (name === "viewer_form") {
      const formId = `f${Date.now().toString(36)}`;
      await patch(cfg, args.session, { form: { id: formId, title: args.title, fields: args.fields } });
      return text({ ok: true, formId, next: `poll viewer.events until {type:"form", formId:"${formId}"} arrives — the user answers, not you` });
    }
    return errText(`unknown viewer tool ${name}`);
  } catch (e) { return errText(e?.message || String(e)); }
}

/** Page routes under /__relay/viewer/<id>[/events|/snapshot]. Returns true when it handled the request. */
export async function handleViewerRoute(cfg, req, res, route, send, readBuffer) {
  const m = /^\/viewer\/([^/]+)(?:\/(events|snapshot))?$/.exec(route);
  if (!m) return false;
  const [, id, what] = m;
  if (!validId(id)) { send(res, 400, { ok: false, error: "bad session id" }); return true; }
  if (!what && req.method === "GET") {
    const s = await getJson(cfg, K(id, "state.json"));
    send(res, s ? 200 : 404, s ?? { ok: false, error: "no such viewer session" });
    return true;
  }
  if (what === "events" && req.method === "POST") {
    let ev; try { ev = JSON.parse((await readBuffer(req, 200_000)).toString("utf8")); } catch { send(res, 400, { ok: false, error: "bad JSON" }); return true; }
    if (!ev || typeof ev.type !== "string") { send(res, 400, { ok: false, error: "event needs a type" }); return true; }
    const list = (await getJson(cfg, K(id, "events.json"))) || [];
    const seq = (list.at(-1)?.seq || 0) + 1;
    list.push({ ...ev, seq, at: new Date().toISOString() });
    await putJson(cfg, K(id, "events.json"), list.slice(-500));
    send(res, 200, { ok: true, seq });
    return true;
  }
  if (what === "snapshot" && (req.method === "PUT" || req.method === "POST")) {
    const buf = await readBuffer(req, 4_000_000);
    const url = new URL(req.url ?? "/", "http://x");
    await putJson(cfg, K(id, "snapshot.json"), { req: url.searchParams.get("req") || "0", data: buf.toString("base64") });
    send(res, 200, { ok: true });
    return true;
  }
  send(res, 405, { ok: false, error: `no viewer route ${req.method} ${route}` });
  return true;
}
