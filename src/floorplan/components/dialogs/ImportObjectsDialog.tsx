import { useEffect, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Box, ChevronDown, ChevronRight, FileJson, Folder, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listParametricObjectFiles } from "../../libraryFiles";

/** One library category folder in the picker — its name + the category-relative `.pobj` paths under it. */
type FolderGroup = { folder: string; files: string[] };

export interface ImportObjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Import the ticked library files (category-relative paths under public/Library/Parametric Objects). */
  onImportSelected: (relPaths: string[]) => void;
  /** Import `.pobj.json` files / a whole folder picked from this device via the native file dialogs. */
  onImportFiles: (files: File[]) => void;
}

/** "Kitchen/oven.pobj.json" → "oven" (a nested subpath is kept, minus the extension). */
const fileLabel = (rel: string): string => {
  const slash = rel.indexOf("/");
  return (slash > 0 ? rel.slice(slash + 1) : rel).replace(/\.pobj\.json$/i, "").replace(/\.json$/i, "");
};

/** Import Objects picker (Drawing toolbar ▸ Import Objects). Lists the object library grouped by its
 *  category folders — tick whole folders and/or individual objects, then Import fetches just those.
 *  The "This device" buttons instead import external `.pobj.json` files or a folder from disk. */
export const ImportObjectsDialog = ({ open, onOpenChange, onImportSelected, onImportFiles }: ImportObjectsDialogProps) => {
  // null = the library listing is in flight (the tree shows a loading row until it resolves).
  const [groups, setGroups] = useState<FolderGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setGroups(null);
    setSelected(new Set());
    setExpandedFolders(new Set());
    void listParametricObjectFiles().then((all) => {
      if (stale) return;
      const byFolder = new Map<string, string[]>();
      for (const rel of all) {
        const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "Library";
        const list = byFolder.get(folder);
        if (list) list.push(rel);
        else byFolder.set(folder, [rel]);
      }
      setGroups(
        [...byFolder.entries()]
          .map(([folder, files]) => ({ folder, files: files.sort((a, b) => a.localeCompare(b)) }))
          .sort((a, b) => a.folder.localeCompare(b.folder)),
      );
    });
    return () => { stale = true; };
  }, [open]);

  const total = groups?.reduce((n, g) => n + g.files.length, 0) ?? 0;

  const toggleFile = (rel: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });

  const setFolderSelected = (files: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const rel of files) { if (on) next.add(rel); else next.delete(rel); }
      return next;
    });

  const toggleExpanded = (folder: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const importSelected = () => {
    if (!selected.size) return;
    onImportSelected([...selected]);
    onOpenChange(false);
  };

  // Shared handler for both native pickers (multi-file + directory) — hand the files to the host import.
  const pickFromDevice = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";
    if (!files.length) return;
    onImportFiles(files);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import Objects</DialogTitle>
          <DialogDescription>
            Tick whole folders or individual objects from the library, then Import — or pick{" "}
            <code>.pobj.json</code> files / a folder from this device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {selected.size} of {total} selected
          </span>
          <span className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!total || selected.size === total}
              onClick={() => setSelected(new Set(groups?.flatMap((g) => g.files) ?? []))}
            >
              Select all
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={!selected.size}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-slate-200">
          {groups === null ? (
            <p className="p-3 text-sm text-slate-500">Loading library…</p>
          ) : groups.length === 0 ? (
            <p className="p-3 text-sm text-slate-500">No objects found at public/Library/Parametric Objects.</p>
          ) : (
            groups.map((g) => {
              const pickedCount = g.files.filter((rel) => selected.has(rel)).length;
              const expanded = expandedFolders.has(g.folder);
              return (
                <div key={g.folder} className="border-b border-slate-100 last:border-b-0">
                  <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-50">
                    <button
                      type="button"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                      title={expanded ? "Collapse" : "Expand"}
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${g.folder}`}
                      onClick={() => toggleExpanded(g.folder)}
                    >
                      {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <Checkbox
                      checked={pickedCount === g.files.length}
                      aria-label={`Select all objects in ${g.folder}`}
                      onCheckedChange={(v) => setFolderSelected(g.files, v === true)}
                    />
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                      onClick={() => toggleExpanded(g.folder)}
                    >
                      {expanded
                        ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
                        : <Folder className="h-4 w-4 shrink-0 text-amber-500" />}
                      <span className="truncate font-medium text-slate-700">{g.folder}</span>
                      <span className="text-xs text-slate-400">
                        {pickedCount ? `${pickedCount}/${g.files.length}` : g.files.length}
                      </span>
                    </button>
                  </div>
                  {expanded &&
                    g.files.map((rel) => (
                      <div key={rel} className="flex items-center gap-2 py-1 pl-9 pr-2 hover:bg-slate-50">
                        <Checkbox
                          checked={selected.has(rel)}
                          aria-label={`Select ${fileLabel(rel)}`}
                          onCheckedChange={() => toggleFile(rel)}
                        />
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-slate-600"
                          onClick={() => toggleFile(rel)}
                        >
                          <Box className="h-4 w-4 shrink-0 text-teal-600" />
                          <span className="truncate">{fileLabel(rel)}</span>
                        </button>
                      </div>
                    ))}
                </div>
              );
            })
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {/* Native pickers — import external objects: several .pobj.json files, or one folder recursively. */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" title="Pick .pobj.json files from this device" onClick={() => filesInputRef.current?.click()}>
              <FileJson className="mr-1 h-4 w-4" />
              Files…
            </Button>
            <Button variant="outline" size="sm" title="Pick a folder of .pobj.json files from this device" onClick={() => folderInputRef.current?.click()}>
              <Folder className="mr-1 h-4 w-4" />
              Folder…
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button disabled={!selected.size} onClick={importSelected}>
              Import{selected.size ? ` (${selected.size})` : ""}
            </Button>
          </div>
        </DialogFooter>
        <input
          ref={filesInputRef}
          type="file"
          accept=".json,application/json"
          multiple
          className="hidden"
          onChange={pickFromDevice}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          // `webkitdirectory` / `directory` aren't in React's input types — spread them in so the picker
          // opens in directory mode and files carry `webkitRelativePath` (the folder structure).
          {...({ webkitdirectory: "", directory: "" } as unknown as InputHTMLAttributes<HTMLInputElement>)}
          onChange={pickFromDevice}
        />
      </DialogContent>
    </Dialog>
  );
};
