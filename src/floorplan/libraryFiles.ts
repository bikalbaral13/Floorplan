/** Client side of the dev-server Library file bridge (the `library-bridge` middleware in
 *  vite.config.ts). The browser can't write to the repo by itself, so saves POST to the dev server,
 *  which persists assets into `public/Library` — Flows / Designs / Parametric Objects — the single
 *  home for bundled files. Every call degrades gracefully (ok:false / null) when the bridge is
 *  unavailable (production/static hosting), so callers fall back to download-only behaviour. */

export interface LibrarySaveResult { ok: boolean; path?: string; error?: string }

/** Subfolder of public/Library/Parametric Objects that hosts each hostKind's .pobj files. */
export const POBJ_SUBFOLDER: Record<"node" | "segment" | "space" | "canvas", string> = {
  node: "Nodes",
  segment: "Segments",
  space: "Spaces",
  canvas: "Canvas",
};

/** Write one JSON file inside public/Library. `relPath` is Library-relative, e.g.
 *  "Parametric Objects/Nodes/fan.v1.pobj.json" or "Flows/my-flow.json". */
export async function saveLibraryFile(relPath: string, content: string): Promise<LibrarySaveResult> {
  try {
    const res = await fetch("/__library/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content }),
    });
    // `body.ok` must be checked too: SPA fallbacks answer unknown routes with 200 + index.html.
    const body = (await res.json().catch(() => null)) as (LibrarySaveResult & { ok?: unknown }) | null;
    return res.ok && body?.ok === true
      ? { ok: true, path: typeof body.path === "string" ? body.path : relPath }
      : { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** List every .json under a public/Library subfolder (paths relative to it, e.g.
 *  "Nodes/fan.v1.pobj.json" for dir "Parametric Objects") — null when the bridge is unavailable,
 *  so callers fall back to the bundled manifest. */
export async function listLibraryFiles(dir: string): Promise<string[] | null> {
  try {
    const res = await fetch(`/__library/list?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { files?: unknown } | null;
    return Array.isArray(body?.files) ? body.files.map(String) : null;
  } catch {
    return null;
  }
}

/** Delete the .pobj files under public/Library/Parametric Objects whose meta.id matches one of
 *  `ids` (the server scans and matches by file content, so renamed files are found too). */
export async function deleteLibraryObjectFiles(ids: string[]): Promise<{ deleted: string[] } | null> {
  try {
    const res = await fetch("/__library/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { ok?: unknown; deleted?: unknown } | null;
    return body?.ok === true ? { deleted: Array.isArray(body.deleted) ? body.deleted.map(String) : [] } : null;
  } catch {
    return null;
  }
}
