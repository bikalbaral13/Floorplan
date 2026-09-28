import { useEffect, useState } from "react";
import { CloudDownload, FileJson, Folder, Image as ImageIcon, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cloudLibraryUrl } from "../../cloudLibrary";
import { listLibraryFiles, LIB_DESIGNS } from "../../libraryFiles";
import { LibrarySourceNote } from "../LibrarySourceNote";

export interface ImportDesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which Library folder to browse — "Designs" (plans) or "Images" (underlays). */
  kind?: "design" | "image";
  /** Hand the chosen design's RAW TEXT to the host, which parses and applies it — the same
   *  entry point the file picker uses, so a library design and a dropped file take one path. */
  /** `relPath` is the file's Library-relative path, so the host can keep the design linked (live sync). */
  onImportText?: (text: string, relPath: string) => Promise<boolean> | boolean;
  /** Hand the chosen image to the host as a DATA URL. Fetched and inlined rather than passed as a
   *  remote URL, for the same two reasons the file picker produces one: the underlay's `src` is
   *  SAVED INTO THE PLAN (a bucket URL would rot), and a same-origin image cannot taint the canvas
   *  the PNG/SVG exporters read back. */
  onImportImage?: (dataUrl: string, name: string) => void;
}

/** Library root for images. Kept beside LIB_DESIGNS rather than imported, because
 *  `libraryFiles` does not export one. */
const LIB_IMAGES = "Images";

const KIND = {
  design: {
    folder: LIB_DESIGNS,
    title: "Import from Library",
    blurb: "Open a saved plan from the Library's Designs folder. This replaces what is on the canvas.",
    empty: "No designs in the Library yet.",
    exts: [".json"],
  },
  image: {
    folder: LIB_IMAGES,
    title: "Import image from Library",
    blurb: "Place an image from the Library's Images folder onto the canvas as an underlay.",
    empty: "No images in the Library yet.",
    exts: [".png", ".jpg", ".jpeg", ".webp"],
  },
} as const;

/** A listed design: its path under `Designs/`, and the folder it sits in ("" at the top level). */
interface DesignRow {
  rel: string;
  folder: string;
  name: string;
}

/** Everything the Designs folder holds that is NOT a plan to open.
 *
 *  `.meta.json` sidecars sit next to their design and describe it; `.baked.json` is a resolved
 *  snapshot with the meshes inlined, which imports as a plan but is tens of megabytes and is not
 *  what anyone means by "open a design". Both are listed by the bucket and neither belongs here. */
const isOpenable = (rel: string, exts: readonly string[]): boolean => {
  const low = rel.toLowerCase();
  if (!exts.some((e) => low.endsWith(e))) return false;
  // `.meta.json` sidecars describe a design; `.baked.json` is a resolved snapshot with the meshes
  // inlined — it imports as a plan but is tens of megabytes and is not what "open a design" means.
  return !low.endsWith(".meta.json") && !low.endsWith(".baked.json");
};

const rowsFrom = (files: string[], exts: readonly string[]): DesignRow[] =>
  files
    .filter((rel) => isOpenable(rel, exts))
    .map((rel) => {
      const cut = rel.lastIndexOf("/");
      return {
        rel,
        folder: cut < 0 ? "" : rel.slice(0, cut),
        name: (cut < 0 ? rel : rel.slice(cut + 1)).replace(/\.(json|png|jpe?g|webp)$/i, ""),
      };
    })
    .sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder.localeCompare(b.folder)));

/** Open a whole plan straight out of the Library's `Designs/` folder (Files ▸ Import from Library).
 *
 *  WHY THIS IS A SEPARATE ENTRY AND NOT A TWEAK TO THE FILE PICKER. The device picker hands over a
 *  `File`; this hands over a URL. They agree only at the end, where the raw text reaches the host's
 *  plan loader — so they share that and nothing else.
 *
 *  LISTING NEEDS THE DEV SERVER. The public read domain serves an object by key but will not
 *  enumerate a prefix — enumeration is a signed S3 call, and that signature must not reach the
 *  browser. So the list comes from the dev bridge, and a production build finds nothing here: the
 *  dialog says so plainly instead of showing an empty folder that looks like a missing library. */
export const ImportDesignDialog = ({ open, onOpenChange, kind = "design", onImportText, onImportImage }: ImportDesignDialogProps) => {
  const cfg = KIND[kind];
  // null = the listing is in flight; [] = it resolved and there is genuinely nothing to show.
  const [rows, setRows] = useState<DesignRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setRows(null);
    setFailed(false);
    void (async () => {
      // An image folder holds several extensions, so it is listed per extension and merged —
      // `listLibraryFiles` filters by ONE suffix per call.
      const lists = await Promise.all(cfg.exts.map((e) => listLibraryFiles(cfg.folder, e.slice(1))));
      if (!alive) return;
      setFailed(lists.every((l) => l === null));
      const merged = Array.from(new Set(lists.flatMap((l) => l ?? [])));
      setRows(rowsFrom(merged, cfg.exts));
    })();
    return () => { alive = false; };
  }, [open, nonce, cfg]);

  const pick = async (row: DesignRow) => {
    setBusy(row.rel);
    try {
      // Read the TEXT, not parsed JSON: the host's loader parses it itself, and a design can be
      // megabytes — parsing here only to stringify it again would double the work for nothing.
      const url = await cloudLibraryUrl(`${cfg.folder}/${row.rel}`);
      if (!url) throw new Error("the Library has no read URL configured");
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`the Library returned ${res.status}`);
      if (kind === "image") {
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error("could not read the image"));
          fr.readAsDataURL(blob);
        });
        onImportImage?.(dataUrl, row.name);
        onOpenChange(false);
      } else if (await onImportText?.(await res.text(), `${cfg.folder}/${row.rel}`)) {
        onOpenChange(false);
      }
    } catch (err) {
      console.error("Failed to open the library file", err);
      // The host toasts on a parse failure; this covers the fetch never getting that far.
      const { toast } = await import("sonner");
      toast.error(`Couldn't open ${row.name}`, { description: String((err as Error)?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  let lastFolder: string | null = null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4 text-sky-600" />
            {cfg.title}
          </DialogTitle>
          <DialogDescription>{cfg.blurb}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] min-h-[8rem] overflow-y-auto rounded-md border border-slate-200">
          {rows === null && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">Reading the Library…</p>
          )}
          {rows !== null && failed && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              The Library can't be listed from here. Listing needs the dev server — the public read
              domain serves a file by name but won't enumerate a folder.
            </p>
          )}
          {rows !== null && !failed && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">{cfg.empty}</p>
          )}
          {rows?.map((row) => {
            const header = row.folder && row.folder !== lastFolder ? row.folder : null;
            lastFolder = row.folder;
            return (
              <div key={row.rel}>
                {header && (
                  <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-500">
                    <Folder className="h-3 w-3" />
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void pick(row)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-sky-50 disabled:opacity-50"
                >
                  {kind === "image"
                    ? <ImageIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    : <FileJson className="h-4 w-4 shrink-0 text-slate-400" />}
                  <span className="truncate">{row.name}</span>
                  {busy === row.rel && <span className="ml-auto text-xs text-slate-400">opening…</span>}
                </button>
              </div>
            );
          })}
        </div>

        <LibrarySourceNote folder={cfg.folder} />

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={rows === null}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
