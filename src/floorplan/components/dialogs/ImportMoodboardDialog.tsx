import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CloudDownload, Loader2, Palette, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchFromCloudLibrary, libraryPath, listCloudLibraryFiles } from "../../cloudLibrary";
import { activeProject, inputsDir } from "../../projectPaths";
import {
  isMoodboardFile,
  mergePicksIntoBoard,
  selectionFromBoard,
  upsertSelection,
  type MoodboardFile,
} from "../../moodboards";
import type { MoodboardSelection, Room } from "../../types";

/** Library folder the boards live in (relative to the Library Path). */
/** Boards belong to a project: Projects/<CODE>/inputs/moodboards/ of the project open in the editor. */
const boardDir = () => inputsDir(activeProject(), "moodboards").replace(/\/$/, "");

export interface ImportMoodboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Spaces of the current plan — picks are bound to these at save time. */
  rooms: Room[];
  /** The plan's current `moodboards`. */
  moodboards: MoodboardSelection[] | undefined;
  /** Write the new list back to the plan (one undoable step). */
  onStore: (next: MoodboardSelection[]) => void;
  /** Open straight into this board's picker (file name under the project's inputs/moodboards/, e.g. "x.json") — used by the
   *  bridge's open_moodboard_picker. */
  initialBoard?: string;
}

/**
 * Files ▸ Import Moodboard. Two steps in one dialog:
 *   1. choose a board — from the open project's `inputs/moodboards/` folder or a file from the device — or manage
 *      the boards already on the plan;
 *   2. pick — the moodboard picker page (public/moodboard-picker.html, the same page the R2 skill ships)
 *      in an iframe, loaded with the board plus the plan's earlier picks. "Save to plan" posts the board
 *      back; only the picked rooms are stored, bound to this plan's spaces.
 * The user makes every pick here — nothing is chosen on their behalf.
 */
export function ImportMoodboardDialog({ open, onOpenChange, rooms, moodboards, onStore, initialBoard }: ImportMoodboardDialogProps) {
  const [files, setFiles] = useState<string[] | null | undefined>(undefined);
  const [loading, setLoading] = useState<string | null>(null);
  const [board, setBoard] = useState<{ json: MoodboardFile; source: string } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setBoard(null); return; }
    setFiles(undefined);
    void listCloudLibraryFiles(boardDir()).then((list) => setFiles(list ? list.filter((f) => f.endsWith(".json")).sort() : null));
  }, [open]);

  // Messages from the picker. Checked by SOURCE (our own iframe), not origin: the page is served by this
  // app, but a board URL is untrusted data and nothing else may post a "save" into the plan.
  useEffect(() => {
    if (!board) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const msg = e.data as { type?: string; moodboard?: unknown };
      if (msg?.type === "moodboard:ready") {
        const { board: merged, stale } = mergePicksIntoBoard(board.json, moodboards?.find((m) => m.id === board.json.id));
        frameRef.current?.contentWindow?.postMessage({ type: "moodboard:load", json: merged, name: board.source }, "*");
        if (stale) toast.warning(`${stale} earlier pick${stale === 1 ? "" : "s"} no longer exist in this board and were cleared`);
      } else if (msg?.type === "moodboard:cancel") {
        setBoard(null);
      } else if (msg?.type === "moodboard:save" && isMoodboardFile(msg.moodboard)) {
        const sel = selectionFromBoard(msg.moodboard, board.source, rooms);
        onStore(upsertSelection(moodboards, sel));
        const locked = sel.picks.filter((p) => p.status === "locked").length;
        const unbound = sel.picks.filter((p) => !p.spaces.length).length;
        toast.success(`Stored ${sel.picks.length} pick${sel.picks.length === 1 ? "" : "s"} (${locked} locked) from ${sel.title ?? sel.id}`);
        if (unbound) toast.warning(`${unbound} pick${unbound === 1 ? "" : "s"} matched no space on this plan — label the spaces, then reopen the board`);
        setBoard(null);
        onOpenChange(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [board, moodboards, rooms, onStore, onOpenChange]);

  const openLibrary = async (rel: string) => {
    setLoading(rel);
    const json = await fetchFromCloudLibrary<unknown>(`${boardDir()}/${rel}`).catch(() => null);
    setLoading(null);
    if (!isMoodboardFile(json)) { toast.error(`${rel} is not a moodboard/1 file`); return; }
    setBoard({ json, source: `${boardDir()}/${rel}` });
  };
  const openDevice = (f: File) => {
    void f.text().then((t) => {
      let json: unknown = null;
      try { json = JSON.parse(t); } catch { /* reported below */ }
      if (!isMoodboardFile(json)) { toast.error(`${f.name} is not a moodboard/1 file`); return; }
      setBoard({ json, source: f.name });
    });
  };
  // Bridge-opened: go straight to the requested board's picker.
  useEffect(() => {
    if (open && initialBoard) void openLibrary(initialBoard.replace(/^.*\/moodboards\//, "").replace(/^Moodboards\//, ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open / board
  }, [open, initialBoard]);
  const removeBoard = (id: string) => onStore((moodboards ?? []).filter((m) => m.id !== id));

  // Images in a board are BUCKET keys ("library/Images/…"); the picker joins them onto the bucket origin,
  // which is the Library Path minus its trailing "/library".
  const publicOrigin = libraryPath().replace(/\/library$/i, "");
  const pickerUrl = `/moodboard-picker.html?embed=1${publicOrigin ? `&public=${encodeURIComponent(publicOrigin)}` : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {board ? (
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-2 p-3">
          <DialogHeader className="sr-only">
            <DialogTitle>Pick from {board.json.title ?? board.json.id}</DialogTitle>
            <DialogDescription>Choose one option per room, then Save to plan.</DialogDescription>
          </DialogHeader>
          <iframe ref={frameRef} title="Moodboard picker" src={pickerUrl} className="h-full w-full flex-1 rounded-md border border-slate-200" />
        </DialogContent>
      ) : (
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Palette className="h-4 w-4" /> Import Moodboard</DialogTitle>
            <DialogDescription>
              Open a board and pick an option per room. Only the picks are stored on this plan, under <code>moodboards</code>.
            </DialogDescription>
          </DialogHeader>

          {!!moodboards?.length && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">On this plan</p>
              {moodboards.map((m) => {
                const locked = m.picks.filter((p) => p.status === "locked").length;
                return (
                  <div key={m.id} className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{m.title ?? m.id}</div>
                      <div className="text-xs text-slate-500">{m.picks.length} picks · {locked} locked · {m.source}</div>
                    </div>
                    {m.source.startsWith(`${BOARD_DIR}/`) && (
                      <Button size="sm" variant="outline" onClick={() => void openLibrary(m.source.slice(BOARD_DIR.length + 1))}>Edit picks</Button>
                    )}
                    <Button size="sm" variant="ghost" title="Remove from plan" aria-label={`Remove ${m.title ?? m.id}`} onClick={() => removeBoard(m.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">From the Library ({BOARD_DIR}/)</p>
            {files === undefined && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Listing…</p>}
            {files === null && <p className="text-sm text-slate-500">The Library can't be listed here (listing needs the dev server). Use a file from the device.</p>}
            {files?.length === 0 && <p className="text-sm text-slate-500">No boards in {BOARD_DIR}/ yet.</p>}
            {files?.map((f) => (
              <button key={f} type="button" disabled={!!loading} onClick={() => void openLibrary(f)}
                className="flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left text-sm hover:border-sky-400 disabled:opacity-60">
                {loading === f ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4 text-sky-600" />}
                <span className="truncate">{f.replace(/\.json$/, "")}</span>
              </button>
            ))}
          </div>

          <div>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="mr-1 h-4 w-4" /> From device…</Button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) openDevice(f); e.target.value = ""; }} />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
