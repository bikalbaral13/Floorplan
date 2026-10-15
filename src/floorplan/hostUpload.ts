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

export async function uploadToR2(key: string, file: Blob, o: UploadOptions = {}): Promise<{ key: string; url: string; size: number }> {
  const type = o.contentType || file.type || "application/octet-stream";
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
