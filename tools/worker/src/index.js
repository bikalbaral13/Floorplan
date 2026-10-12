/** BuilderPluss library Worker — save-back for the R2 viewer and form pages (docs/r2-worker-saveback-plan.md).
 *
 * Reads stay on the public r2.dev domain; this Worker only WRITES, through an R2 binding (no keys in any page).
 *
 *   GET  /api/me                          who is calling, may they write
 *   GET  /api/file?path=Designs/X.json    the file + its ETag (load with this when you intend to save)
 *   PUT  /api/file?path=Designs/X.json    save; If-Match: <etag> to overwrite, If-None-Match: * to create
 *   GET  /api/history?path=Designs/X.json earlier versions kept by this Worker
 *
 * Rules: only Designs/, Master Plans/, Forms/; .json only; no DELETE; JSON must parse and look like the
 * right kind of file; every overwrite first copies the old bytes to _versions/<path>/<time>.json; every save
 * writes one audit record under _audit/<day>/. WRITE_MODE "open" (W1 testing) lets anyone write.
 */

const WRITABLE = ["Designs/", "Master Plans/", "Forms/"];

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
    if (!who.canWrite) throw err(403, "not allowed to write");
    if (!WRITABLE.some((p) => path.startsWith(p))) throw err(403, `writes are allowed only under ${WRITABLE.join(", ")}`);
    if (!/\.json$/i.test(path) || /\.view\.json$/i.test(path)) throw err(400, "only design/form .json files can be saved here");

    const body = await req.arrayBuffer();
    if (body.byteLength > Number(env.MAX_BYTES)) throw err(413, `file too large (${body.byteLength} bytes)`);
    let doc;
    try { doc = JSON.parse(new TextDecoder().decode(body)); } catch { throw err(400, "body is not valid JSON"); }
    checkShape(path, doc);

    const ifMatch = req.headers.get("if-match"), ifNone = req.headers.get("if-none-match");
    const current = await env.BUCKET.head(key);
    if (current) {
      if (!ifMatch) throw err(428, "file exists — send If-Match with the ETag you loaded");
      if (stripQuotes(ifMatch) !== current.etag) return json({ error: "conflict: the file changed since you loaded it", etag: current.httpEtag }, 409);
      // Keep the old bytes before replacing them — the bucket has no versioning of its own.
      const old = await env.BUCKET.get(key);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await env.BUCKET.put(`${env.PREFIX}_versions/${path}/${stamp}.json`, old.body, {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { replacedBy: who.user, etag: current.etag },
      });
    } else if (ifNone !== "*") {
      throw err(428, "file does not exist — send If-None-Match: * to create it");
    }

    // onlyIf makes the check-then-write atomic: a save racing ours fails instead of being overwritten.
    const put = await env.BUCKET.put(key, body, {
      httpMetadata: { contentType: "application/json", cacheControl: "no-cache" },
      customMetadata: { savedBy: who.user, savedAt: new Date().toISOString() },
      ...(current ? { onlyIf: { etagMatches: current.etag } } : {}),
    });
    if (!put) return json({ error: "conflict: the file changed while saving" }, 409);

    const now = new Date();
    await env.BUCKET.put(`${env.PREFIX}_audit/${now.toISOString().slice(0, 10)}/${now.getTime()}-${crypto.randomUUID().slice(0, 8)}.json`,
      JSON.stringify({ at: now.toISOString(), who: who.user, mode: who.mode, path, bytes: body.byteLength, created: !current, previousEtag: current?.etag ?? null, etag: put.etag }),
      { httpMetadata: { contentType: "application/json" } });

    return json({ ok: true, path, etag: put.httpEtag, created: !current, bytes: body.byteLength }, current ? 200 : 201);
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

function checkShape(path, doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw err(400, "expected a JSON object");
  if (path.startsWith("Forms/")) return;
  const hasGeometry = Array.isArray(doc.levels) || Array.isArray(doc.groups) || Array.isArray(doc.nodes);
  if (typeof doc.schemaVersion !== "number" || !hasGeometry || typeof doc.settings !== "object")
    throw err(400, "does not look like a design: needs schemaVersion, settings and levels/groups/nodes");
}

function cleanPath(p) {
  if (!p) throw err(400, "missing ?path=");
  const s = p.replace(/^\/+/, "").replace(/^library\//, "");
  if (s.split("/").some((seg) => seg === ".." || seg === "." || seg === "") || s.startsWith("_")) throw err(400, "bad path");
  return s;
}

function corsHeaders(req, env) {
  const origin = req.headers.get("origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim());
  return origin && allowed.includes(origin) ? {
    "access-control-allow-origin": origin, vary: "origin",
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "access-control-allow-headers": "content-type, if-match, if-none-match",
    "access-control-expose-headers": "etag",
  } : {};
}

const stripQuotes = (s) => s.replace(/^W\//, "").replace(/^"|"$/g, "");
const err = (status, message) => Object.assign(new Error(message), { status });
const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
