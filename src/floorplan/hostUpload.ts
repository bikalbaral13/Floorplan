/** Upload ONE file of any size straight from the browser to R2 (host v1). The bytes never pass through the app's
 *  server function (Vercel caps a request body at ~4.5 MB): the server only signs.
 *
 *    POST /__r2/upload-plan { key, size, contentType, grant? }  → one presigned PUT, or a multipart plan (parts)
 *    PUT  <presigned url>                                        ← the file (or each part, 3 at a time, with retry)
 *    POST /__r2/upload-complete { key, uploadId, parts }          → multipart only
 *
 *  Failures say WHY, never silently fall back for a big file: "cors" (the bucket has no CORS rule for this origin —
 *  docs/r2-cors.json), "token" (no library token in this browser), "expired" (upload link), "network". Used by
 *  pipeline UIs (window.pipeline.assets.upload) and the standalone upload page (public/upload.html has its own copy). */

export type UploadFailure = "cors" | "token" | "expired" | "network" | "server";
export class UploadError extends Error {
  constructor(public reason: UploadFailure, message: string) { super(message); }
}
export interface UploadOptions {
  contentType?: string;
  /** Upload-link grant id (public/upload.html) instead of the library token. */
  grant?: string;
  onProgress?: (loaded: number, total: number) => void;
  /** Headers for the /__r2 calls (the library token); cloudLibrary passes its own. */
  headers?: Record<string, string>;
}

const CORS_HELP = `R2 refused the upload from ${typeof location !== "undefined" ? location.origin : "this site"} — the bucket needs a CORS rule allowing PUT from it (paste docs/r2-cors.json in Cloudflare ▸ R2 ▸ the bucket ▸ Settings ▸ CORS).`;

/** PUT one blob with progress; resolves the ETag. Status 0 = the browser blocked it (CORS) or the network dropped. */
function put(url: string, body: Blob, type: string, onBytes: (n: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    if (type) x.setRequestHeader("Content-Type", type);
    x.upload.onprogress = (e) => onBytes(e.loaded);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve(x.getResponseHeader("ETag") ?? "")
      : reject(new UploadError("server", `R2 answered ${x.status}: ${(/<Message>([^<]+)</.exec(x.responseText)?.[1] ?? x.statusText)}`)));
    x.onerror = () => reject(new UploadError(x.status === 0 ? "cors" : "network", x.status === 0 ? CORS_HELP : "network error"));
    x.send(body);
  });
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const msg = String(j.error ?? `HTTP ${r.status}`);
    throw new UploadError(r.status === 401 ? "token" : r.status === 403 ? "expired" : "server", msg);
  }
  return j;
}

/** Set once a direct PUT was refused (no bucket CORS rule): later uploads on this page go straight to the relay. */
let directBlocked = false;

/** Relay: the bytes go to THIS site in 4 MiB chunks and the server puts them in R2 (it holds the keys), two chunks
 *  per 8 MiB part — no browser → R2 request, so no bucket CORS rule is needed. Slower than direct; any size. */
async function relayUpload(key: string, file: Blob, type: string, o: UploadOptions) {
  const total = file.size;
  const plan = await postJson("/__r2/upload-plan", { key, size: total, contentType: type, grant: o.grant, relay: true }, o.headers);
  const chunk = Number(plan.chunkSize), n = Math.max(1, Number(plan.chunks));
  const parts: { partNumber: number; etag: string }[] = [];
  const sent = new Map<number, number>();
  const report = () => o.onProgress?.([...sent.values()].reduce((a, b) => a + b, 0), total);
  const sendChunk = async (i: number) => {
    const q = new URLSearchParams({ key, uploadId: String(plan.uploadId), index: String(i), ...(i === n - 1 ? { last: "1" } : {}), ...(o.grant ? { grant: o.grant } : {}) });
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`/__r2/upload-chunk?${q}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", ...(o.headers ?? {}) }, body: file.slice(i * chunk, (i + 1) * chunk) });
      const j = (await r.json().catch(() => ({}))) as { partNumber?: number; etag?: string; error?: string };
      if (r.ok) { sent.set(i, Math.min(chunk, total - i * chunk)); report(); if (j.partNumber) parts.push({ partNumber: j.partNumber, etag: String(j.etag) }); return; }
      if (r.status === 401 || r.status === 403 || attempt >= 2) throw new UploadError(r.status === 401 ? "token" : r.status === 403 ? "expired" : "server", j.error ?? `HTTP ${r.status}`);
    }
  };
  // chunk pairs (2k, 2k+1) in order inside a pair; 3 pairs at a time
  const pairs = Array.from({ length: Math.ceil(n / 2) }, (_, k) => k);
  let next = 0;
  const worker = async () => { while (next < pairs.length) { const k = pairs[next++]; await sendChunk(2 * k); if (2 * k + 1 < n) await sendChunk(2 * k + 1); } };
  try {
    await Promise.all([worker(), worker(), worker()]);
    await postJson("/__r2/upload-complete", { key, uploadId: plan.uploadId, parts, grant: o.grant }, o.headers);
  } catch (e) {
    void postJson("/__r2/upload-abort", { key, uploadId: plan.uploadId, grant: o.grant }, o.headers).catch(() => {});
    throw e;
  }
  o.onProgress?.(total, total);
  return { key, url: String(plan.publicUrl ?? ""), size: total };
}

export async function uploadToR2(key: string, file: Blob, o: UploadOptions = {}): Promise<{ key: string; url: string; size: number }> {
  const type = o.contentType || file.type || "application/octet-stream";
  if (directBlocked) return relayUpload(key, file, type, o);
  try {
    return await directUpload(key, file, type, o);
  } catch (e) {
    if (e instanceof UploadError && e.reason === "cors") { directBlocked = true; return relayUpload(key, file, type, o); }
    throw e;
  }
}

async function directUpload(key: string, file: Blob, type: string, o: UploadOptions): Promise<{ key: string; url: string; size: number }> {
  const total = file.size;
  const plan = await postJson("/__r2/upload-plan", { key, size: total, contentType: type, grant: o.grant }, o.headers);
  if (plan.mode === "single") {
    const etag = await put(String(plan.url), file, type, (n) => o.onProgress?.(n, total));
    if (etag === "" && total > 0) { /* ETag hidden by CORS (no ExposeHeaders) is fine for a single PUT */ }
    o.onProgress?.(total, total);
    return { key, url: String(plan.publicUrl ?? ""), size: total };
  }
  // multipart: 3 parts in flight, each retried twice
  const partSize = Number(plan.partSize);
  const parts = plan.parts as { partNumber: number; url: string }[];
  const done: { partNumber: number; etag: string }[] = [];
  const sent = new Map<number, number>();
  const report = () => o.onProgress?.([...sent.values()].reduce((a, b) => a + b, 0), total);
  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const p = parts[next++];
      const blob = file.slice((p.partNumber - 1) * partSize, p.partNumber * partSize);
      for (let attempt = 0; ; attempt++) {
        try {
          const etag = await put(p.url, blob, "", (n) => { sent.set(p.partNumber, n); report(); });
          if (!etag) throw new UploadError("cors", "R2 hid the part's ETag — the bucket's CORS rule must expose ETag (docs/r2-cors.json).");
          done.push({ partNumber: p.partNumber, etag });
          break;
        } catch (e) {
          if (attempt >= 2 || (e instanceof UploadError && e.reason === "cors")) throw e;
        }
      }
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
    await postJson("/__r2/upload-complete", { key, uploadId: plan.uploadId, parts: done, grant: o.grant }, o.headers);
  } catch (e) {
    void postJson("/__r2/upload-abort", { key, uploadId: plan.uploadId, grant: o.grant }, o.headers).catch(() => {});
    throw e;
  }
  return { key, url: String(plan.publicUrl ?? ""), size: total };
}
