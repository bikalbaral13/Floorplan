/** Where the Library actually lives, for anything that has to SHOW it.
 *
 *  The on-disk `public/Library` folder is gone — the bucket is the source of truth (see
 *  ./libraryFiles) — so every dialog that used to tell the user "public/Library/Objects" was naming a
 *  path that cannot be opened and does not exist. This hook hands back the real address instead: the
 *  R2 public base, plus a per-file URL builder, so a listing row can link straight to the file it names.
 *
 *  Resolution is memoised inside `cloudLibraryStatus` and fixed for the life of the page, so every
 *  caller shares one answer and the hook settles on the first render after mount.
 */
import { useEffect, useState } from "react";
import { cloudLibraryBaseUrl } from "./cloudLibrary";

export interface LibraryBase {
  /** Public base URL of the Library, e.g. "https://pub-….r2.dev/library". Empty when unconfigured
   *  (no read domain) or while still resolving — `ready` tells the two apart. */
  url: string;
  /** False until the status call has answered, so a dialog can hold off on "not configured". */
  ready: boolean;
  /** Public URL of one Library-relative path ("Objects/Site/site.json"), or "" when unconfigured.
   *  Segments are encoded because Library folders contain spaces ("Architectural backup/"). */
  fileUrl: (relPath: string) => string;
}

export function useLibraryBase(): LibraryBase {
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void cloudLibraryBaseUrl().then((base) => {
      if (cancelled) return;
      setUrl(base);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  return {
    url,
    ready,
    fileUrl: (relPath: string) =>
      url ? `${url}/${relPath.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}` : "",
  };
}
