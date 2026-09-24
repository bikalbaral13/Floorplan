/** Client side of the Cloudflare R2 Library — the shared bucket several apps read.
 *
 *  TWO DIFFERENT PATHS, and the difference is the whole design:
 *
 *    READ   straight from the public r2.dev domain. No server, no credentials, works in a
 *           production build. `VITE_R2_PUBLIC_URL` is public by construction.
 *    WRITE  through the dev server (`/__r2/save`), which signs the request with keys that
 *           never enter this bundle. They grant write and delete on the whole bucket, so a
 *           browser holding them would hand that to every visitor.
 *
 *  Writing therefore works in dev and not in a static production build. {@link cloudLibraryStatus}
 *  reports which, so the UI can disable the option up front rather than offering a button that
 *  fails at the moment the user commits to it. Restoring it in production means a Cloudflare
 *  Worker with an R2 binding — same request shape, different origin, no client change beyond
 *  the base URL.
 */

/** Public read origin, e.g. "https://pub-….r2.dev". Empty when unconfigured — every read
 *  helper then reports unavailable rather than fetching a URL built from "undefined". */
const PUBLIC_BASE = (import.meta.env.VITE_R2_PUBLIC_URL ?? "").replace(/\/+$/, "");

/** Key namespace for the shared library inside the bucket. Matches `R2_LIBRARY_PREFIX` here and
 *  `BUILDERPLUSS_R2_LIBRARY_PREFIX` in new_app, so both apps address one tree. */
const DEFAULT_PREFIX = "library";

// ── LIBRARY PATH: the ONE base every relative reference resolves against ────────────────────────────
//
// Objects, flow tools, workflows, designs, agents, skills, image underlays — each is named by a path
// RELATIVE to this ("Objects/Architectural/plot.json"), and the absolute location is base + path.
// Nothing in the app hardcodes a library address: read it here, join, fetch.
//
// It is a user SETTING (Preferences ▸ Library Path), persisted per browser, because "which library"
// is a deployment question rather than a build-time one — a team pointing at their own bucket, or a
// developer at a local mirror, should not need a rebuild. The default is the shared bucket, so the
// setting is pre-filled rather than empty. An empty value falls back to the build's own
// `VITE_R2_PUBLIC_URL` + prefix, which is what {@link cloudLibraryStatus} reports.

/** The shared bucket every install starts pointed at. */
export const DEFAULT_LIBRARY_PATH = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";

const LIBRARY_PATH_KEY = "bp.libraryPath";

/** Cached so the hot path (every fetch) doesn't touch localStorage. `undefined` = not yet read. */
let libraryPathCache: string | undefined;

/** The configured Library Path — no trailing slash, "" when the user cleared it (fall back to the
 *  build's own bucket). Reads localStorage once; a private window / blocked storage reads as the
 *  default rather than throwing. */
export function libraryPath(): string {
  if (libraryPathCache === undefined) {
    try {
      const raw = localStorage.getItem(LIBRARY_PATH_KEY);
      libraryPathCache = (raw === null ? DEFAULT_LIBRARY_PATH : raw).trim().replace(/\/+$/, "");
    } catch {
      libraryPathCache = DEFAULT_LIBRARY_PATH;
    }
  }
  return libraryPathCache;
}

/** Point the app at a different library. Empty string restores the build's own bucket. */
export function setLibraryPath(value: string): void {
  libraryPathCache = value.trim().replace(/\/+$/, "");
  try { localStorage.setItem(LIBRARY_PATH_KEY, libraryPathCache); } catch { /* storage blocked — session-only */ }
}

/** Join the configured base to a Library-relative path. Each segment is encoded because Library
 *  folders contain spaces ("Architectural backup/"). */
function joinLibrary(base: string, relPath: string): string {
  return `${base}/${relPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
}

export interface CloudLibraryStatus {
  /** The bridge answered and the bucket is fully configured — writes will be attempted. */
  writable: boolean;
  /** A public read origin is set — reads work regardless of `writable`. */
  readable: boolean;
  bucket: string;
  publicUrl: string;
  prefix: string;
}

/** Cloudflare R2 keys entered in Preferences ▸ Cloudflare R2. Kept in THIS browser only and sent to the
 *  app's own `/__r2` bridge, which signs with them — the deployed bridge has no keys of its own, so
 *  without these nothing can list or write the bucket there. Locally the dev server falls back to .env. */
export interface R2Credentials {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

const R2_CREDENTIALS_KEY = "r2Credentials";
const EMPTY_CREDENTIALS: R2Credentials = { endpoint: "", accessKeyId: "", secretAccessKey: "", bucket: "" };

export function r2Credentials(): R2Credentials {
  try {
    const raw = JSON.parse(localStorage.getItem(R2_CREDENTIALS_KEY) ?? "null") as Partial<R2Credentials> | null;
    return { ...EMPTY_CREDENTIALS, ...(raw ?? {}) };
  } catch {
    return { ...EMPTY_CREDENTIALS };
  }
}

/** Save (or, with empty fields, clear) the keys and forget the memoised status so the next ask re-checks. */
export function setR2Credentials(value: R2Credentials): void {
  const clean: R2Credentials = {
    endpoint: value.endpoint.trim().replace(/\/+$/, ""),
    accessKeyId: value.accessKeyId.trim(),
    secretAccessKey: value.secretAccessKey.trim(),
    bucket: value.bucket.trim(),
  };
  try {
    if (Object.values(clean).some(Boolean)) localStorage.setItem(R2_CREDENTIALS_KEY, JSON.stringify(clean));
    else localStorage.removeItem(R2_CREDENTIALS_KEY);
  } catch { /* storage blocked — the keys just won't persist */ }
  statusPromise = null;
}

/** `fetch` for the `/__r2/*` bridge, carrying the stored keys as headers when all four are set. */
function r2Fetch(url: string, init: RequestInit = {}): Promise<Response> {
  const c = r2Credentials();
  const keys = c.endpoint && c.accessKeyId && c.secretAccessKey && c.bucket
    ? {
        "x-r2-endpoint": c.endpoint,
        "x-r2-access-key-id": c.accessKeyId,
        "x-r2-secret-access-key": c.secretAccessKey,
        "x-r2-bucket": c.bucket,
      }
    : {};
  return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...keys } });
}

const UNAVAILABLE: CloudLibraryStatus = {
  writable: false,
  readable: false,
  bucket: "",
  publicUrl: "",
  prefix: DEFAULT_PREFIX,
};

let statusPromise: Promise<CloudLibraryStatus> | null = null;

/** Whether the cloud Library can be written, read, or neither.
 *
 *  Memoised: the answer is fixed for the life of the page (it depends on the dev server's env,
 *  not on anything the user does), and every export surface asks. `refresh` exists for the one
 *  case that isn't fixed — a dev server restarted with credentials filled in.
 */
export function cloudLibraryStatus(refresh = false): Promise<CloudLibraryStatus> {
  if (refresh) statusPromise = null;
  statusPromise ??= (async () => {
    try {
      const res = await r2Fetch("/__r2/status");
      // `body.ok` must be checked too: an SPA fallback answers unknown routes with 200 + index.html,
      // which parses as neither JSON nor a status — production must read as "not writable", not as a
      // malformed success.
      const body = (await res.json().catch(() => null)) as
        | { ok?: unknown; configured?: unknown; bucket?: unknown; publicUrl?: unknown; prefix?: unknown }
        | null;
      if (!res.ok || body?.ok !== true) return { ...UNAVAILABLE, readable: !!PUBLIC_BASE, publicUrl: PUBLIC_BASE };
      const publicUrl = typeof body.publicUrl === "string" && body.publicUrl ? body.publicUrl : PUBLIC_BASE;
      return {
        writable: body.configured === true,
        readable: !!publicUrl,
        bucket: typeof body.bucket === "string" ? body.bucket : "",
        publicUrl,
        prefix: typeof body.prefix === "string" && body.prefix ? body.prefix : DEFAULT_PREFIX,
      };
    } catch {
      // No bridge — a production build, or the dev server is down. Reads may still work.
      return { ...UNAVAILABLE, readable: !!PUBLIC_BASE, publicUrl: PUBLIC_BASE };
    }
  })();
  return statusPromise;
}

export interface CloudSaveResult {
  ok: boolean;
  /** Full bucket key, e.g. "library/Designs/floorplan-2026-08-13.json". */
  key?: string;
  /** Public URL of the saved object, when a public domain is configured. */
  url?: string;
  error?: string;
}

/** Write one file into the cloud Library. `relPath` is Library-relative — "Designs/plan.json",
 *  "Objects/Site/site.json" — the prefix is added server-side so the client cannot escape it. */
export async function saveToCloudLibrary(relPath: string, content: string): Promise<CloudSaveResult> {
  try {
    const res = await r2Fetch("/__r2/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content }),
    });
    const body = (await res.json().catch(() => null)) as (CloudSaveResult & { ok?: unknown }) | null;
    return res.ok && body?.ok === true
      ? { ok: true, key: typeof body.key === "string" ? body.key : relPath, url: typeof body.url === "string" ? body.url : "" }
      : { ok: false, error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Public URL of a Library-relative path, or "" when no public domain is configured.
 *  Each segment is encoded because Library folders contain spaces ("Architectural backup/"). */
export async function cloudLibraryUrl(relPath: string): Promise<string> {
  // The SETTING wins — it is the single source of the library address (see LIBRARY PATH above), and it
  // already includes the key prefix. Only when it has been cleared does the build's own bucket answer.
  const configured = libraryPath();
  if (configured) return joinLibrary(configured, relPath);
  const { publicUrl, prefix } = await cloudLibraryStatus();
  if (!publicUrl) return "";
  return joinLibrary(`${publicUrl}/${prefix.replace(/^\/+|\/+$/g, "")}`, relPath);
}

/** Fetch and parse one JSON file from the cloud Library. Null when unconfigured or absent —
 *  callers treat that as "not in the library".
 *
 *  `cache: "no-cache"` is LOAD-BEARING, not a precaution. r2.dev serves library objects with an ETag and
 *  a Last-Modified and NO Cache-Control, which leaves the browser free to invent a freshness lifetime —
 *  heuristically ~10% of the object's age, so a file last written three weeks ago reads as fresh for
 *  about two days. A workflow republished into the bucket then keeps importing at its OLD content until
 *  that window lapses, with no error and nothing to see: the listing is current (it comes from the signed
 *  `/__r2/list`, which is never cached) while the content behind the same name is stale.
 *
 *  "no-cache" means REVALIDATE, not "do not cache" — the conditional request carries the stored ETag and
 *  an unchanged file comes back 304 with no body. The cost is one round trip; the alternative is handing
 *  back a version of a file that no longer exists. */
export async function fetchFromCloudLibrary<T = unknown>(relPath: string): Promise<T | null> {
  const url = await cloudLibraryUrl(relPath);
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** One node of the bucket hierarchy returned by `/__r2/tree`. Folders are synthesised from shared
 *  key prefixes — R2's keyspace is flat, so "Designs/" is not an object, only a common prefix. */
export interface CloudTreeNode {
  name: string;
  /** Full bucket key for a file; the prefix (no trailing slash) for a folder. */
  path: string;
  type: "folder" | "file";
  size?: number;
  lastModified?: string;
  etag?: string;
  /** Public r2.dev URL, when a read domain is configured. Files only. */
  url?: string;
  /** Subtree totals on folders — already rolled up server-side. */
  files?: number;
  bytes?: number;
  children?: CloudTreeNode[];
}

export interface CloudTree {
  bucket: string;
  prefix: string;
  publicUrl: string;
  totals: { files: number; folders: number; bytes: number };
  tree: CloudTreeNode;
}

/** The whole bucket as a hierarchy, or null when the bridge is unavailable (production build,
 *  dev server down, R2 unconfigured). `prefix` narrows it; empty means the entire bucket.
 *
 *  Like {@link listCloudLibraryFiles} this cannot go direct to r2.dev: enumeration is a signed
 *  S3 call, so it only exists where the keys do — in the dev server.
 */
export async function fetchCloudTree(prefix = ""): Promise<{ tree: CloudTree | null; error?: string }> {
  try {
    const res = await r2Fetch(`/__r2/tree?prefix=${encodeURIComponent(prefix)}`);
    const body = (await res.json().catch(() => null)) as (Partial<CloudTree> & { ok?: unknown; error?: unknown }) | null;
    // `body.ok` guards the SPA fallback, which answers unknown routes with 200 + index.html.
    if (!res.ok || body?.ok !== true || !body.tree) {
      return {
        tree: null,
        error: typeof body?.error === "string" ? body.error : `HTTP ${res.status} — the R2 bridge is not available`,
      };
    }
    return {
      tree: {
        bucket: body.bucket ?? "",
        prefix: body.prefix ?? prefix,
        publicUrl: body.publicUrl ?? "",
        totals: body.totals ?? { files: 0, folders: 0, bytes: 0 },
        tree: body.tree,
      },
    };
  } catch (e) {
    return { tree: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface CloudFileText {
  ok: boolean;
  text?: string;
  /** The object's FULL size, even when `text` holds only the leading slice. */
  size?: number;
  truncated?: boolean;
  contentType?: string;
  error?: string;
}

/** Read one object back as text by full bucket key, for the inline preview in Files ▸ Inspect.
 *
 *  Through the bridge rather than the public URL, unlike {@link fetchFromCloudLibrary}: that one
 *  reads a Library-relative path that is known to be published, while the inspector shows the whole
 *  bucket — keys outside the public prefix have no r2.dev URL to fetch, and a build with no read
 *  domain configured has none at all. The server caps how much it returns and reports `truncated`.
 */
export async function fetchBucketFileText(key: string): Promise<CloudFileText> {
  try {
    const res = await r2Fetch(`/__r2/get?key=${encodeURIComponent(key)}`);
    const body = (await res.json().catch(() => null)) as (CloudFileText & { ok?: unknown }) | null;
    // `body.ok` guards the SPA fallback, which answers unknown routes with 200 + index.html.
    return res.ok && body?.ok === true
      ? { ok: true, text: body.text ?? "", size: body.size ?? 0, truncated: !!body.truncated, contentType: body.contentType ?? "" }
      : { ok: false, error: typeof body?.error === "string" ? body.error : `HTTP ${res.status} — the R2 bridge is not available` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface CloudWriteResult {
  ok: boolean;
  key?: string;
  url?: string;
  size?: number;
  error?: string;
}

/** Upload one file to an arbitrary bucket key. `key` is a FULL bucket key ("uploads/plan.png"), not
 *  Library-relative — the inspector addresses the whole bucket, including folders this app does not
 *  otherwise write to.
 *
 *  The File is sent as the raw request body rather than wrapped in JSON: the bucket holds images and
 *  GLBs, and base64 would inflate every one of them by a third. Dev server only, like every other
 *  write here — the signing keys are not in this bundle.
 */
export async function uploadToBucket(key: string, file: Blob): Promise<CloudWriteResult> {
  try {
    const res = await r2Fetch(`/__r2/upload?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
    const body = (await res.json().catch(() => null)) as (CloudWriteResult & { ok?: unknown }) | null;
    return res.ok && body?.ok === true
      ? { ok: true, key: body.key ?? key, url: body.url ?? "", size: body.size }
      : { ok: false, error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Delete one object by full bucket key. IRREVERSIBLE — the bucket has no versioning, so the caller
 *  must have confirmed with the user before this is reached. */
export async function deleteFromBucket(key: string): Promise<CloudWriteResult> {
  try {
    const res = await r2Fetch("/__r2/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const body = (await res.json().catch(() => null)) as (CloudWriteResult & { ok?: unknown }) | null;
    return res.ok && body?.ok === true
      ? { ok: true, key: body.key ?? key }
      : { ok: false, error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Folder-relative paths of everything under one cloud Library folder ("Designs", "Objects", …),
 *  or null when the listing is unavailable.
 *
 *  This needs the bridge even though reads do not: r2.dev serves objects but will not enumerate
 *  them, so listing is a signed S3 call. It is the one capability plain static hosting cannot
 *  replace, and the reason the Import browser can show the bucket's contents at all.
 */
export async function listCloudLibraryFiles(dir: string): Promise<string[] | null> {
  try {
    const res = await r2Fetch(`/__r2/list?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { ok?: unknown; files?: unknown } | null;
    return body?.ok === true && Array.isArray(body.files) ? body.files.map(String) : null;
  } catch {
    return null;
  }
}

/** The Library's own public base URL — `<publicUrl>/<prefix>`, no trailing slash — or "" when no read
 *  domain is configured. This is the address every Library-relative path in the app resolves against,
 *  and the one written into an exported plan's `settings.library_path`, so the UI can show users and
 *  agents where the files actually are rather than naming `public/Library`, which no longer exists. */
export async function cloudLibraryBaseUrl(): Promise<string> {
  const configured = libraryPath();
  if (configured) return configured;
  const { publicUrl, prefix } = await cloudLibraryStatus();
  return publicUrl ? `${publicUrl.replace(/\/+$/, "")}/${prefix.replace(/^\/+|\/+$/g, "")}` : "";
}
