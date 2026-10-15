/** Cloudflare R2 from Node, signed by hand — no SDK.
 *
 *  R2 speaks the S3 API, so a PUT is an ordinary HTTPS request carrying an AWS SigV4
 *  `Authorization` header. That is ~80 lines of HMAC below. `@aws-sdk/client-s3` would do
 *  the same job and pull ~20 MB of transitive dependencies into a build that needs exactly
 *  two verbs; vite.config.ts is otherwise built from node: built-ins alone, and this keeps
 *  it that way.
 *
 *  WHERE THIS RUNS MATTERS. Only in the dev server (Node). The keys it signs with grant
 *  write and delete on the whole bucket, so nothing here may ever be imported from `src/` —
 *  Vite would bundle it, and the secret with it. Reads need no signature at all: the r2.dev
 *  domain is public, and the browser fetches definitions directly.
 */

import crypto from "node:crypto";

const ALGORITHM = "AWS4-HMAC-SHA256";

/** R2 has no regions. SigV4 requires one in the credential scope, and "auto" is what
 *  Cloudflare documents; the value is echoed back and otherwise ignored. */
const REGION = "auto";
const SERVICE = "s3";

const hmac = (key, msg) => crypto.createHmac("sha256", key).update(msg, "utf8").digest();
const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Percent-encode one path segment the way S3 canonicalises it: unreserved characters stay
 *  literal, everything else is uppercase-hex escaped. `encodeURIComponent` leaves `!'()*`
 *  alone, which S3 does not, so those are finished off by hand. A Library path holds spaces
 *  ("Architectural backup/") and this is what makes them sign correctly. */
const encodeSegment = (segment) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The signing key — HMAC chained over date → region → service, as SigV4 specifies. */
const signingKey = (secret, dateStamp) =>
  hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), REGION), SERVICE), "aws4_request");

/**
 * One signed request against the bucket.
 *
 * `extraHeaders` are signed along with the rest — SigV4 covers every header named in
 * SignedHeaders, so an `x-amz-meta-*` added here and not signed would be rejected outright
 * rather than silently dropped.
 *
 * @param {object} cfg    { endpoint, accessKeyId, secretAccessKey, bucket }
 * @param {string} method HTTP verb
 * @param {string} key    object key inside the bucket (no leading slash)
 * @param {Buffer|string} body
 */
export async function signedRequest(cfg, method, key, body = "", extraHeaders = {}) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const url = new URL(cfg.endpoint.replace(/\/+$/, ""));
  // Path-style addressing (bucket in the path, not the hostname). R2's S3 endpoint requires it.
  const canonicalUri = `/${[cfg.bucket, ...key.split("/")].map(encodeSegment).join("/")}`;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(payload);

  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), String(v)])),
  };

  // Canonical form: header names sorted, values trimmed, one per line.
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp), stringToSign).toString("hex");

  const authorization =
    `${ALGORITHM} Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`${url.origin}${canonicalUri}`, {
    method,
    headers: { ...headers, Authorization: authorization },
    body: method === "GET" || method === "HEAD" ? undefined : payload,
  });

  if (!response.ok) {
    // S3 reports failures as an XML document. The message inside it is the useful part —
    // "SignatureDoesNotMatch" and "NoSuchBucket" are different problems for the caller.
    const text = await response.text().catch(() => "");
    const detail = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 200);
    throw new Error(`R2 ${method} ${key} failed: ${response.status} ${detail || response.statusText}`);
  }
  return response;
}

/** A pre-signed URL (SigV4 query auth, UNSIGNED-PAYLOAD): lets a browser PUT one object straight to R2 without the
 *  keys and without passing the bytes through a server function (Vercel caps a request body at ~4.5 MB). The
 *  bucket's CORS must allow PUT from the app's origin (tools/r2-cors.mjs). `expires` in seconds (max 7 days). */
export function presignUrl(cfg, method, key, expires = 900) {
  const url = new URL(cfg.endpoint.replace(/\/+$/, ""));
  const canonicalUri = `/${[cfg.bucket, ...key.split("/")].map(encodeSegment).join("/")}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const q = {
    "X-Amz-Algorithm": ALGORITHM, "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`, "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.min(604800, Math.max(1, expires))), "X-Amz-SignedHeaders": "host",
  };
  const cq = Object.keys(q).sort().map((k) => `${encodeSegment(k)}=${encodeSegment(q[k])}`).join("&");
  const canonicalRequest = [method, canonicalUri, cq, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp), stringToSign).toString("hex");
  return `${url.origin}${canonicalUri}?${cq}&X-Amz-Signature=${signature}`;
}

/** Store `body` at `key`, recording its sha256 in object metadata.
 *
 *  The digest is what makes a publish incremental — new_app's `publish_library.py` reads it
 *  back with HEAD and skips files whose content has not changed. Writing it under the same
 *  `sha256` name keeps the two publishers interchangeable. */
export async function putObject(cfg, key, body, contentType = "application/json") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  await signedRequest(cfg, "PUT", key, payload, {
    "content-type": contentType,
    // Written explicitly because the ABSENCE of this header is not neutral: r2.dev then serves an ETag and
    // a Last-Modified and nothing else, and a browser is entitled to invent a freshness lifetime from the
    // object's age. A library file is MUTABLE under a stable name — republishing a workflow is the normal
    // way to edit one — so a reader guessing "fresh for two days" is guessing wrong. "no-cache" keeps the
    // bytes cached and requires the conditional request that notices they changed.
    "cache-control": "no-cache",
    "x-amz-meta-sha256": sha256hex(payload),
  });
  return key;
}

/** Remove one object. Irreversible — the bucket has no versioning, so there is nothing to restore
 *  from. The caller is responsible for having confirmed the intent; this just signs the verb.
 *
 *  S3 answers DELETE with 204 for a key that was never there, so a successful return means "the key
 *  is gone", not "the key existed". That is the right contract for a delete button and the wrong one
 *  for a report of how many files were removed. */
export async function deleteObject(cfg, key) {
  await signedRequest(cfg, "DELETE", key);
  return key;
}

/** Read one object back as text, capped at `limit` bytes.
 *
 *  A signed GET rather than a fetch of the public URL: the inspector spans the whole bucket, and
 *  keys outside `library/` are not necessarily reachable on r2.dev — nor is a public domain even
 *  configured everywhere. The signature already exists here, so the preview works wherever the
 *  listing does.
 *
 *  RANGE-LIMITED, not truncated after the fact. The bucket holds 7 MB models next to 2 KB
 *  definitions; asking for the first slice means a preview opened on the wrong file costs one small
 *  request instead of pulling the whole object down to show 300 lines of it.
 *
 *  @returns {Promise<{text: string, size: number, truncated: boolean, contentType: string}>}
 */
export async function getObjectText(cfg, key, limit = 1_000_000) {
  const res = await signedRequest(cfg, "GET", key, "", { range: `bytes=0-${limit - 1}` });
  const body = Buffer.from(await res.arrayBuffer());
  // "bytes 0-999/54321" — the part after the slash is the object's real size, which a ranged
  // response's content-length does not give.
  const total = Number(/\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1]);
  const size = Number.isFinite(total) ? total : body.length;
  return {
    text: body.toString("utf8"),
    size,
    truncated: body.length < size,
    contentType: res.headers.get("content-type") ?? "",
  };
}

/** Every object under `prefix`, with the metadata ListObjectsV2 already returns for free.
 *
 *  This is the capability static hosting cannot offer, and the reason a bridge exists at all
 *  rather than the browser reading the public domain for everything: r2.dev serves objects
 *  but will not enumerate them. Paginates, because ListObjectsV2 caps at 1000 keys and the
 *  Library is already 244 files.
 *
 *  Size and mtime come back in the same `<Contents>` block as the key, so parsing them costs
 *  one extra regex rather than a HEAD per object — which is what makes the bucket inspector
 *  able to show them at all.
 *
 *  @returns {Promise<Array<{key: string, size: number, lastModified: string, etag: string}>>}
 */
export async function listObjectsDetailed(cfg, prefix = "") {
  const objects = [];
  let token;
  do {
    const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) query.set("continuation-token", token);
    // The query string is part of the canonical request, so it is signed with the path.
    const response = await signedListRequest(cfg, query);
    const xml = await response.text();
    for (const [, entry] of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = decodeXml(tagText(entry, "Key"));
      if (!key) continue;
      objects.push({
        key,
        size: Number(tagText(entry, "Size")) || 0,
        lastModified: tagText(entry, "LastModified"),
        // S3 quotes the ETag inside the XML, so it arrives as &quot;abc…&quot;.
        etag: decodeXml(tagText(entry, "ETag")).replace(/^"|"$/g, ""),
      });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decodeXml(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "")
      : undefined;
  } while (token);
  return objects;
}

/** Object keys under `prefix`, bucket-relative — the keys-only view of {@link listObjectsDetailed}. */
export async function listObjects(cfg, prefix) {
  return (await listObjectsDetailed(cfg, prefix)).map((o) => o.key);
}

const tagText = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? "";

const decodeXml = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** ListObjectsV2 addresses the BUCKET, not an object, and carries a signed query string —
 *  different enough from {@link signedRequest} that folding the two would make both harder
 *  to read than keeping the ~20 lines twice. */
async function signedListRequest(cfg, query) {
  const url = new URL(cfg.endpoint.replace(/\/+$/, ""));
  const canonicalUri = `/${encodeSegment(cfg.bucket)}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex("");

  // Canonical query: sorted by key, both halves percent-encoded.
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const headers = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": amzDate };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signature = hmac(signingKey(cfg.secretAccessKey, dateStamp), stringToSign).toString("hex");

  const response = await fetch(`${url.origin}${canonicalUri}?${canonicalQuery}`, {
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  });
  if (!response.ok) throw new Error(`R2 list failed: ${response.status} ${response.statusText}`);
  return response;
}

/** The bucket configuration from environment, or null when it is not fully set.
 *
 *  All four are required together: a half-configured bucket should present as "no cloud
 *  library" and let the UI hide the option, rather than as a save that fails at the moment
 *  the user commits to it. */
export function r2ConfigFrom(env) {
  const cfg = {
    endpoint: env.R2_ENDPOINT ?? "",
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: env.R2_BUCKET ?? "",
    publicUrl: (env.R2_PUBLIC_URL ?? "").replace(/\/+$/, ""),
    prefix: (env.R2_LIBRARY_PREFIX ?? "library").replace(/^\/+|\/+$/g, ""),
  };
  return cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket ? cfg : null;
}
