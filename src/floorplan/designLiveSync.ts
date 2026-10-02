/** Live sync for a design opened from the Library: while a tab has `Designs/<name>.json` open, it
 *  watches that file and picks up edits written by anyone else — the headless design MCP
 *  (server/designMcp.mjs), another tab, a script — without the user re-importing it.
 *
 *  WATCHING IS A ONE-BYTE RANGED GET. r2.dev answers it 206 with the object's ETag (exposed to the page),
 *  so an unchanged design costs a few hundred bytes per poll however large the plan is; the body is
 *  fetched only when the ETag moves. NOT a HEAD, and `no-store` rather than `no-cache`: a revalidating
 *  HEAD from the page intermittently fails CORS against r2.dev ("Failed to fetch") once the browser holds
 *  a cached copy, while a plain ranged GET that never touches the cache answers every time.
 *
 *  Polling pauses while the tab is hidden and backs off after errors, so an idle background tab does
 *  not keep hitting the bucket. */

import { cloudLibraryUrl } from "./cloudLibrary";

const POLL_MS = 3000;
const MAX_BACKOFF_MS = 60_000;

/** A version stamp for a Library file: its ETag, else Last-Modified + length. Null when unreachable. */
export async function designVersion(relPath: string): Promise<string | null> {
  // `cloudLibraryUrl` already percent-encodes each path segment; encoding again turns a space into %2520.
  const url = await cloudLibraryUrl(relPath);
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store", headers: { Range: "bytes=0-0" } });
    if (!res.ok) return null;
    return res.headers.get("etag") ?? `${res.headers.get("last-modified") ?? ""}|${res.headers.get("content-length") ?? ""}`;
  } catch {
    return null;
  }
}

/** The file's current text, revalidated. Null when unreachable. */
export async function fetchDesignText(relPath: string): Promise<string | null> {
  const url = await cloudLibraryUrl(relPath);
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Who wrote a design and at which revision — the stamp server/designMcp.mjs puts in `settings`. */
export function designStamp(text: string): { revision?: number; editedBy?: string } {
  try {
    const s = (JSON.parse(text) as { settings?: { revision?: unknown; editedBy?: unknown } }).settings ?? {};
    return {
      revision: typeof s.revision === "number" ? s.revision : undefined,
      editedBy: typeof s.editedBy === "string" ? s.editedBy : undefined,
    };
  } catch {
    return {};
  }
}

export interface DesignWatch {
  stop: () => void;
  /** Adopt `version` as seen — call after this tab writes the file itself, so its own save is not
   *  reported back to it as a remote change. */
  acknowledge: (version: string | null) => void;
}

/** Poll `relPath` and call `onChange(version)` each time its version moves past `known`. */
export function watchDesign(relPath: string, known: string | null, onChange: (version: string) => void | Promise<void>): DesignWatch {
  let seen = known;
  let stopped = false;
  let delay = POLL_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  const tick = async () => {
    if (stopped) return;
    if (!document.hidden && !busy) {
      busy = true;
      const v = await designVersion(relPath);
      if (v === null) {
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      } else {
        delay = POLL_MS;
        if (seen === null) seen = v;
        else if (v !== seen) {
          seen = v;
          try { await onChange(v); } catch (e) { console.warn("[live-sync] applying a remote change failed", e); }
        }
      }
      busy = false;
    }
    if (!stopped) timer = setTimeout(tick, delay);
  };
  const wake = () => { if (!document.hidden && !stopped) { clearTimeout(timer); void tick(); } };
  document.addEventListener("visibilitychange", wake);
  timer = setTimeout(tick, delay);

  return {
    stop: () => { stopped = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); },
    acknowledge: (version) => { if (version) seen = version; },
  };
}
