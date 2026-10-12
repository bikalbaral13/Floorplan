/** BuilderPluss library Worker — save-back for the R2 viewer and form pages (docs/r2-worker-saveback-plan.md).
 *
 * Reads stay on the public r2.dev domain; this Worker only WRITES, through an R2 binding (no keys in any page).
 *
 *   GET  /api/me                          who is calling, may they write
 *   GET  /api/file?path=Designs/X.json    the file + its ETag (load with this when you intend to save)
 *   PUT  /api/file?path=Designs/X.json    save; If-Match: <etag> to overwrite, If-None-Match: * to create
 *   GET  /api/history?path=Designs/X.json earlier versions kept by this Worker
 *   POST /mcp                             MCP server (Streamable HTTP, stateless) — see mcp.js
 *   …    /api/session/<id>/…              viewer sessions the agent drives — see sessions.js
 *
 * Rules: only Designs/, Master Plans/, Forms/; .json only; no DELETE; JSON must parse and look like the
 * right kind of file; every overwrite first copies the old bytes to _versions/<path>/<time>.json; every save
 * writes one audit record under _audit/<day>/. WRITE_MODE "open" (W1 testing) lets anyone write.
 */

import { saveFile, WRITABLE } from "./save.js";
import { sessionRoute } from "./sessions.js";
import { handleMcp } from "./mcp.js";
import { err, json, cleanPath } from "./util.js";

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.message || String(e) }, status, cors);
    }
  },
};

async function route(req, env) {
  const url = new URL(req.url);
  const who = identify(req, env);
  if (url.pathname === "/api/me" && req.method === "GET") return json({ ...who, writable: WRITABLE });
  if (url.pathname === "/mcp") return handleMcp(req, env, who, url.origin);
  if (url.pathname.startsWith("/api/session/")) return sessionRoute(req, env, url);

  const path = cleanPath(url.searchParams.get("path"));
  const key = env.PREFIX + path;

  if (url.pathname === "/api/file" && req.method === "GET") {
    const obj = await env.BUCKET.get(key);
    if (!obj) throw err(404, `not found: ${path}`);
    return new Response(obj.body, { headers: { "content-type": "application/json", etag: obj.httpEtag, "cache-control": "no-store" } });
  }

  if (url.pathname === "/api/history" && req.method === "GET") {
    const list = await env.BUCKET.list({ prefix: `${env.PREFIX}_versions/${path}/` });
    return json({ path, versions: list.objects.map((o) => ({ key: o.key.slice(env.PREFIX.length), size: o.size, uploaded: o.uploaded })).reverse() });
  }

  if (url.pathname === "/api/file" && req.method === "PUT") {
    const r = await saveFile(env, who, path, await req.arrayBuffer(), { ifMatch: req.headers.get("if-match"), ifNone: req.headers.get("if-none-match") });
    return json(r.body, r.status);
  }

  if (req.method === "DELETE") throw err(405, "delete is not offered");
  throw err(404, "unknown endpoint");
}

/** W1: open mode — anyone may write. Later "roles": the Cloudflare Access email checked against roles.json. */
function identify(req, env) {
  const email = req.headers.get("cf-access-authenticated-user-email");
  if (env.WRITE_MODE === "open") return { user: email || "anonymous", mode: "open", canWrite: true };
  return { user: email || "anonymous", mode: env.WRITE_MODE, canWrite: false };
}

function corsHeaders(req, env) {
  const origin = req.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  return origin && allowed.includes(origin) ? {
    "access-control-allow-origin": origin, vary: "origin",
    "access-control-allow-methods": "GET, PUT, POST, OPTIONS",
    "access-control-allow-headers": "content-type, if-match, if-none-match, mcp-protocol-version, mcp-session-id",
    "access-control-expose-headers": "etag",
  } : {};
}

