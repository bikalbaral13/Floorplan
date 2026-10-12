/** Viewer sessions — how an agent drives an open viewer without the app.
 *
 *   library/Sessions/<id>/state.json     written by the agent (MCP viewer_* tools): what the viewer shows
 *   library/Sessions/<id>/events.json    written by the viewer: user selections and form answers
 *   library/Sessions/<id>/snapshot.png   written by the viewer when state.snapshot asks for one
 *
 * HTTP, for the viewer page (polls state, posts events and snapshots):
 *   GET  /api/session/<id>                   → state
 *   POST /api/session/<id>/events            ← { type, … }        (appended, numbered)
 *   PUT  /api/session/<id>/snapshot?req=<n>  ← image/png
 */
import { err, json } from "./util.js";

export const validId = (id) => typeof id === "string" && /^[a-z0-9-]{6,40}$/.test(id);
const key = (env, id, f) => `${env.PREFIX}Sessions/${id}/${f}`;

export async function readState(env, id) {
  const o = await env.BUCKET.get(key(env, id, "state.json"));
  return o ? o.json() : null;
}
export async function writeState(env, id, state) {
  await env.BUCKET.put(key(env, id, "state.json"), JSON.stringify(state), { httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
  return state;
}
/** Merge a change into the state and bump `rev` so the viewer notices. */
export async function patchState(env, id, change) {
  const cur = await readState(env, id);
  if (!cur) throw err(404, `no session ${id} — call viewer_open first`);
  return writeState(env, id, { ...cur, ...change, rev: (cur.rev || 0) + 1, updatedAt: new Date().toISOString() });
}
export async function readEvents(env, id) {
  const o = await env.BUCKET.get(key(env, id, "events.json"));
  return o ? o.json() : [];
}
export async function readSnapshot(env, id) {
  return env.BUCKET.get(key(env, id, "snapshot.png"));
}

export async function sessionRoute(req, env, url) {
  const [, , , id, what] = url.pathname.split("/");   // /api/session/<id>/<what>
  if (!validId(id)) throw err(400, "bad session id");

  if (!what && req.method === "GET") {
    const s = await readState(env, id);
    if (!s) throw err(404, "no such session");
    return json(s, 200, { "cache-control": "no-store" });
  }
  if (what === "events" && req.method === "POST") {
    const ev = await req.json();
    if (!ev || typeof ev.type !== "string") throw err(400, "event needs a type");
    const list = await readEvents(env, id);
    const seq = (list.at(-1)?.seq || 0) + 1;
    list.push({ ...ev, seq, at: new Date().toISOString() });
    await env.BUCKET.put(key(env, id, "events.json"), JSON.stringify(list.slice(-500)), { httpMetadata: { contentType: "application/json" } });
    return json({ ok: true, seq });
  }
  if (what === "snapshot" && req.method === "PUT") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 8_000_000) throw err(413, "snapshot too large");
    await env.BUCKET.put(key(env, id, "snapshot.png"), buf, {
      httpMetadata: { contentType: "image/png" }, customMetadata: { req: url.searchParams.get("req") || "0" },
    });
    return json({ ok: true });
  }
  throw err(404, "unknown session endpoint");
}
