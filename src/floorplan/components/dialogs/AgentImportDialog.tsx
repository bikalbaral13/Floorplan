import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, FolderOpen } from "lucide-react";
import { listAgentFiles, loadAgentsFromPaths, type AgentDefinition } from "../../ai/agentDefs";

export interface AgentImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the parsed agent definitions the user chose to import. */
  onImport: (agents: AgentDefinition[]) => void;
}

/** "Open" dialog rooted at public/Library/Agents — lists the agent files in that folder and imports the
 *  checked ones (the browser can't point a native file picker at a project subfolder, so this lists the
 *  folder directly via the same Library bridge the object / flow imports use). */
export const AgentImportDialog = ({ open, onOpenChange, onImport }: AgentImportDialogProps) => {
  const [files, setFiles] = useState<string[] | null>(null); // null = still loading
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Re)load the folder listing each time the dialog opens; default every file to selected.
  useEffect(() => {
    if (!open) return;
    setFiles(null); setSelected(new Set()); setError(null); setImporting(false);
    let cancelled = false;
    listAgentFiles()
      .then((fs) => { if (!cancelled) { setFiles(fs); setSelected(new Set(fs)); } })
      .catch((e) => { if (!cancelled) setError((e as Error)?.message ?? "Could not list Library/Agents"); });
    return () => { cancelled = true; };
  }, [open]);

  const toggle = (f: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(f)) next.delete(f); else next.add(f);
    return next;
  });
  const allSelected = !!files && files.length > 0 && selected.size === files.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(files ?? []));

  const doImport = async () => {
    if (!selected.size) return;
    setImporting(true);
    try {
      const defs = await loadAgentsFromPaths([...selected]);
      onImport(defs);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error)?.message ?? "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderOpen className="h-4 w-4 text-violet-600" /> Import agents
          </DialogTitle>
          <DialogDescription>
            Select agent files from <code className="rounded bg-muted px-1 text-xs">Library/Agents</code> to add to Chat AI.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : files === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading Library/Agents…
          </div>
        ) : files.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">No agent files found in Library/Agents.</p>
        ) : (
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} /> Select all ({files.length})
            </label>
            <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-1">
              {files.map((f) => (
                <label key={f} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={selected.has(f)} onCheckedChange={() => toggle(f)} />
                  <span className="truncate font-mono text-xs">{f}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>Cancel</Button>
          <Button onClick={doImport} disabled={importing || !selected.size}>
            {importing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Import{selected.size ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
