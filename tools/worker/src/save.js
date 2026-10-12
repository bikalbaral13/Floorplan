/** One save path for the HTTP API and the MCP tools: prefix allowlist, shape check, etag, version copy, audit. */
import { err, stripQuotes } from "./util.js";

export const WRITABLE = ["Designs/", "Master Plans/", "Forms/"];

export async function saveFile(env, who, path, body, { ifMatch, ifNone } = {}) {
  if (!who.canWrite) throw err(403, "not allowed to write");
  if (!WRITABLE.some((p) => path.startsWith(p))) throw err(403, `writes are allowed only under ${WRITABLE.join(", ")}`);
  if (!/\.json$/i.test(path) || /\.view\.json$/i.test(path)) throw err(400, "only design/form .json files can be saved here");
  if (typeof body === "string") body = new TextEncoder().encode(body).buffer;
  if (body.byteLength > Number(env.MAX_BYTES)) throw err(413, `file too large (${body.byteLength} bytes)`);
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(body)); } catch { throw err(400, "body is not valid JSON"); }
  checkShape(path, doc);

  const key = env.PREFIX + path;
  const current = await env.BUCKET.head(key);
  if (current) {
    if (!ifMatch) throw err(428, "file exists — send If-Match with the ETag you loaded");
    if (stripQuotes(ifMatch) !== current.etag) return { status: 409, body: { error: "conflict: the file changed since you loaded it", etag: current.httpEtag } };
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
  if (!put) return { status: 409, body: { error: "conflict: the file changed while saving" } };

  const now = new Date();
  await env.BUCKET.put(`${env.PREFIX}_audit/${now.toISOString().slice(0, 10)}/${now.getTime()}-${crypto.randomUUID().slice(0, 8)}.json`,
    JSON.stringify({ at: now.toISOString(), who: who.user, mode: who.mode, path, bytes: body.byteLength, created: !current, previousEtag: current?.etag ?? null, etag: put.etag }),
    { httpMetadata: { contentType: "application/json" } });

  return { status: current ? 200 : 201, body: { ok: true, path, etag: put.httpEtag, created: !current, bytes: body.byteLength } };
}

function checkShape(path, doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw err(400, "expected a JSON object");
  if (path.startsWith("Forms/")) return;
  const hasGeometry = Array.isArray(doc.levels) || Array.isArray(doc.groups) || Array.isArray(doc.nodes);
  if (typeof doc.schemaVersion !== "number" || !hasGeometry || typeof doc.settings !== "object")
    throw err(400, "does not look like a design: needs schemaVersion, settings and levels/groups/nodes");
}
