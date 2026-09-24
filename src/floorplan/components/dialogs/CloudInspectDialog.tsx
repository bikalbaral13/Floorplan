import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CloudOff,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  FileText,
  File as FileIcon,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchCloudTree,
  fetchBucketFileText,
  uploadToBucket,
  deleteFromBucket,
  type CloudTree,
  type CloudTreeNode,
} from "../../cloudLibrary";

export interface CloudInspectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Read AND manage what is actually in the Cloudflare R2 bucket.
 *
 *  Everything else in the app addresses the bucket through the `library/` prefix and by exact key —
 *  save this design, fetch that object. Nothing showed the bucket as it stands, so a file written by
 *  another app (or a save that landed under the wrong key) was invisible until someone opened the
 *  Cloudflare dashboard. This is that view, plus the two operations that otherwise sent you there:
 *  upload into any folder, and delete any file.
 *
 *  It talks to `/__r2/*`, which is DEV-SERVER ONLY: every one of those verbs needs an S3 signature,
 *  and the keys deliberately never enter the bundle (see cloudLibrary.ts). In a production build the
 *  fetch fails and the dialog says so, rather than rendering an empty bucket that looks real.
 *
 *  TWO GUARDS, because this writes to storage other apps read and the bucket has no versioning:
 *  an upload that would replace an existing key asks first, and every delete asks on the row it was
 *  clicked from. Both confirmations are INLINE rather than nested modals — a dialog stacked on a
 *  dialog fights Radix's focus trap, and naming the file where you clicked is clearer anyway.
 */
export function CloudInspectDialog({ open, onOpenChange }: CloudInspectDialogProps) {
  const [data, setData] = useState<CloudTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"tree" | "json">("tree");
  const [filter, setFilter] = useState("");
  /** Expanded folder paths. Top-level folders start open so the dialog is not a single closed row. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Key currently being deleted, or awaiting confirmation on its row. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** Folder path an upload is running in, so its row can show a spinner. */
  const [uploading, setUploading] = useState<string | null>(null);
  /** Chosen files held back because they would overwrite existing keys. */
  const [pendingUpload, setPendingUpload] = useState<{ folder: string; files: File[]; clashes: string[] } | null>(null);
  /** Bucket key whose contents are folded open under its row. ONE at a time: the pane is 300px of
   *  scroller, and a stack of them buries the tree it is supposed to annotate. */
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, FilePreview>>({});
  /** Keys already fetched, so closing and re-opening a fold is instant rather than another request. */
  const fetchedRef = useRef<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement>(null);
  /** Folder the picker was opened for. A ref, not state: the change event fires long after the
   *  click and must read the value that was current when the button was pressed. */
  const uploadFolderRef = useRef<string>("");

  const load = useCallback(async (keepExpansion = false) => {
    setLoading(true);
    setError(null);
    // Whatever was folded open described the bucket as it was before this read. An upload or a
    // delete may have just replaced that very key, so the cache goes rather than being shown again.
    fetchedRef.current.clear();
    setPreviews({});
    setOpenPreview(null);
    const { tree, error: err } = await fetchCloudTree();
    setLoading(false);
    if (!tree) {
      setData(null);
      setError(err ?? "Could not read the bucket");
      return;
    }
    setData(tree);
    // A refresh after an upload or delete must not collapse the tree back to top level — the user is
    // several folders deep and looking at the row they just changed.
    if (!keepExpansion) {
      setExpanded(new Set((tree.tree.children ?? []).filter((c) => c.type === "folder").map((c) => c.path)));
    }
  }, []);

  // Fetch on open, and again on every re-open: the bucket is shared with other apps, so a cached
  // listing from ten minutes ago is exactly the stale picture this dialog exists to avoid.
  useEffect(() => {
    if (!open) return;
    setFilter("");
    setConfirmDelete(null);
    setPendingUpload(null);
    void load();
  }, [open, load]);

  const json = useMemo(() => (data ? JSON.stringify(data, null, 2) : ""), [data]);

  /** Every key in the bucket, for the overwrite check. */
  const allKeys = useMemo(() => {
    const keys = new Set<string>();
    const walk = (node: CloudTreeNode) => {
      if (node.type === "file") keys.add(node.path);
      else (node.children ?? []).forEach(walk);
    };
    if (data) walk(data.tree);
    return keys;
  }, [data]);

  /** The tree with non-matching files pruned, and folders that end up empty dropped with them.
   *  A folder whose own name matches is kept whole — filtering for "Designs" should show it. */
  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!data) return null;
    if (!query) return data.tree;
    const prune = (node: CloudTreeNode): CloudTreeNode | null => {
      if (node.type === "file") return node.path.toLowerCase().includes(query) ? node : null;
      if (node.path && node.name.toLowerCase().includes(query)) return node;
      const children = (node.children ?? []).map(prune).filter((c): c is CloudTreeNode => !!c);
      return children.length ? { ...node, children } : null;
    };
    return prune(data.tree) ?? { ...data.tree, children: [] };
  }, [data, filter]);

  /** Fold a file row open (or shut). The contents are fetched on first open only — the listing
   *  carries sizes and dates, never bodies, so nothing is read until someone asks for it. */
  const togglePreview = useCallback((key: string) => {
    if (openPreview === key) {
      setOpenPreview(null);
      return;
    }
    setOpenPreview(key);
    if (fetchedRef.current.has(key)) return;
    fetchedRef.current.add(key);
    setPreviews((prev) => ({ ...prev, [key]: { loading: true } }));
    void (async () => {
      const r = await fetchBucketFileText(key);
      setPreviews((prev) => ({
        ...prev,
        [key]: r.ok
          ? {
              loading: false,
              text: prettifyIfJson(key, r.text ?? ""),
              size: r.size ?? 0,
              truncated: !!r.truncated,
            }
          : { loading: false, error: r.error ?? "Could not read the file" },
      }));
    })();
  }, [openPreview]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast.success("Bucket JSON copied to the clipboard");
    } catch {
      toast.error("Could not copy — the clipboard was refused");
    }
  };

  const downloadJson = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${data?.bucket || "bucket"}-tree.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /** Save one object to disk.
   *
   *  `<a download>` is ignored cross-origin, and the r2.dev read domain is a different origin from
   *  the app — the attribute would be dropped and the browser would simply navigate to the file,
   *  which for a .json or an image means displaying it rather than saving it. So the bytes are
   *  fetched and handed to the anchor as a blob URL, where `download` is same-origin and honoured.
   */
  const [saving, setSaving] = useState<string | null>(null);
  const downloadFile = async (node: CloudTreeNode) => {
    if (!node.url) return;
    setSaving(node.path);
    try {
      const res = await fetch(node.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = node.name;
      anchor.click();
      // Revoking in the same tick can beat the browser to reading the blob, and the download
      // silently does nothing. One turn of the event loop is enough and costs nothing.
      setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (e) {
      toast.error(`Could not download ${node.name} — ${e instanceof Error ? e.message : "failed"}`);
    } finally {
      setSaving(null);
    }
  };

  /** Open the picker for one folder. "" is the bucket root. */
  const pickFilesFor = (folder: string) => {
    uploadFolderRef.current = folder;
    if (fileInputRef.current) fileInputRef.current.value = ""; // re-picking the same file must re-fire
    fileInputRef.current?.click();
  };

  const onFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const folder = uploadFolderRef.current;
    const clashes = files.map((f) => keyFor(folder, f.name)).filter((k) => allKeys.has(k));
    // Replacing a key other apps read is worth one question. Fresh names go straight up.
    if (clashes.length) setPendingUpload({ folder, files, clashes });
    else void runUpload(folder, files);
  };

  const runUpload = async (folder: string, files: File[]) => {
    setPendingUpload(null);
    setUploading(folder);
    let done = 0;
    const failures: string[] = [];
    for (const file of files) {
      const r = await uploadToBucket(keyFor(folder, file.name), file);
      if (r.ok) done += 1;
      else failures.push(`${file.name}: ${r.error ?? "unknown error"}`);
    }
    setUploading(null);
    if (done) {
      toast.success(`Uploaded ${done} file${done === 1 ? "" : "s"} to ${folder || "the bucket root"}`);
      // Show the result: the folder just written to is opened, and the listing is re-read so the new
      // rows (and the corrected folder totals) are the ones on screen.
      setExpanded((prev) => new Set(prev).add(folder));
      await load(true);
    }
    if (failures.length) toast.error(`${failures.length} upload${failures.length === 1 ? "" : "s"} failed`, { description: failures.join("\n"), duration: 10000 });
  };

  const runDelete = async (key: string) => {
    setBusyKey(key);
    const r = await deleteFromBucket(key);
    setBusyKey(null);
    setConfirmDelete(null);
    if (!r.ok) return toast.error(`Could not delete ${key}`, { description: r.error });
    toast.success(`Deleted ${key}`);
    await load(true);
  };

  /** Writes only work through the dev bridge; with no listing there is nothing to act on either. */
  const canWrite = !!data && !error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Inspect Cloud storage</DialogTitle>
          <DialogDescription>
            {data
              ? `Cloudflare R2 — ${data.bucket}: ${data.totals.files} file${data.totals.files === 1 ? "" : "s"} in ${data.totals.folders} folder${data.totals.folders === 1 ? "" : "s"}, ${formatBytes(data.totals.bytes)}`
              : "Everything in the Cloudflare R2 bucket, as a folder hierarchy."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-slate-200 p-0.5">
            {(["tree", "json"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  view === mode ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {mode === "tree" ? "Tree" : "Raw JSON"}
              </button>
            ))}
          </div>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name or key…"
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-44 flex-1 text-xs"
            disabled={view === "json" || !data}
          />
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void load(true)} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="text-xs">Refresh</span>
          </Button>
          {/* Upload to the bucket ROOT. The tree renders root's children, not root itself, so without
              this the ~59 files that live at the top level would have no folder button to reach. */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => pickFilesFor("")}
            disabled={!canWrite || !!uploading}
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="text-xs">Upload to root</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void copyJson()} disabled={!data}>
            <Copy className="h-3.5 w-3.5" />
            <span className="text-xs">Copy JSON</span>
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={downloadJson} disabled={!data}>
            <Download className="h-3.5 w-3.5" />
            <span className="text-xs">Download</span>
          </Button>
        </div>

        {/* Overwrite guard. Shown in place rather than as a nested modal, and it names every key that
            would be replaced — "3 files" is not enough to decide on. */}
        {pendingUpload && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {pendingUpload.clashes.length === 1
                ? "1 file already exists and would be replaced"
                : `${pendingUpload.clashes.length} files already exist and would be replaced`}
            </p>
            <ul className="mt-1.5 max-h-24 overflow-y-auto pl-5 font-mono text-[10px] text-amber-900">
              {pendingUpload.clashes.map((k) => <li key={k} className="truncate">{k}</li>)}
            </ul>
            <p className="mt-1.5 text-[11px] text-amber-800">
              The bucket has no versioning, so the current contents cannot be recovered afterwards.
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="h-7 bg-amber-600 text-xs hover:bg-amber-700" onClick={() => void runUpload(pendingUpload.folder, pendingUpload.files)}>
                Replace and upload
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setPendingUpload(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* `[&>…>div]:!block` overrides the `display: table` Radix puts on the viewport's inner
            wrapper. That table sizes itself to its widest content, so one long line — a minified
            JSON row, a deep folder path — stretched the listing past the viewport, which clips
            without a horizontal scrollbar. As a block it takes the viewport's width instead: row
            names truncate as intended, and a preview pane scrolls its own long lines rather than
            pushing the tree sideways. */}
        <ScrollArea className="min-h-[280px] flex-1 rounded-md border border-slate-200 bg-slate-50/60 [&>[data-radix-scroll-area-viewport]>div]:!block">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading the bucket…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <CloudOff className="h-6 w-6 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Could not read the bucket</p>
              <p className="max-w-[420px] text-xs text-muted-foreground">{error}</p>
              <p className="max-w-[420px] text-xs text-muted-foreground">
                Listing, uploading and deleting all need the signing keys, which stay in the dev
                server — so this works with <code className="rounded bg-slate-200 px-1">npm run dev</code> and
                the R2 variables set in <code className="rounded bg-slate-200 px-1">.env</code>, not in a
                static build.
              </p>
            </div>
          ) : filtered && (filtered.children?.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {filter ? `Nothing matches “${filter}”.` : "The bucket is empty."}
            </p>
          ) : view === "json" ? (
            <pre className="p-3 font-mono text-[11px] leading-relaxed text-slate-800">{json}</pre>
          ) : (
            <div className="p-2">
              {(filtered?.children ?? []).map((child) => (
                <TreeRow
                  key={child.path}
                  node={child}
                  depth={0}
                  expanded={expanded}
                  // Filtering already narrowed the tree to matches; force those folders open so the
                  // hits are visible instead of hidden behind a collapsed parent.
                  forceOpen={!!filter.trim()}
                  onToggle={(path) =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(path)) next.add(path);
                      return next;
                    })
                  }
                  onUpload={pickFilesFor}
                  onDownload={downloadFile}
                  saving={saving}
                  uploading={uploading}
                  confirmDelete={confirmDelete}
                  onRequestDelete={setConfirmDelete}
                  onConfirmDelete={(key) => void runDelete(key)}
                  busyKey={busyKey}
                  openPreview={openPreview}
                  previews={previews}
                  onTogglePreview={togglePreview}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {data?.publicUrl && (
          <p className="truncate text-[11px] text-muted-foreground">
            Public read origin: <span className="font-mono">{data.publicUrl}</span>
          </p>
        )}

        <input ref={fileInputRef} type="file" multiple onChange={onFilesChosen} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}

interface TreeRowProps {
  node: CloudTreeNode;
  depth: number;
  expanded: Set<string>;
  forceOpen: boolean;
  onToggle: (path: string) => void;
  onUpload: (folder: string) => void;
  onDownload: (node: CloudTreeNode) => void | Promise<void>;
  /** Path of the file currently being fetched, so its own button can show the spinner. */
  saving: string | null;
  uploading: string | null;
  confirmDelete: string | null;
  onRequestDelete: (key: string | null) => void;
  onConfirmDelete: (key: string) => void;
  busyKey: string | null;
  openPreview: string | null;
  previews: Record<string, FilePreview>;
  onTogglePreview: (key: string) => void;
}

/** One folder or file line. Recursive, so the rendered depth follows the bucket rather than a
 *  fixed set of levels — the Library is three deep today and nothing here assumes that. */
function TreeRow(p: TreeRowProps) {
  const { node, depth, expanded, forceOpen, onToggle } = p;
  const open = forceOpen || expanded.has(node.path);
  const indent = { paddingLeft: `${depth * 14 + 4}px` };

  if (node.type === "file") {
    const confirming = p.confirmDelete === node.path;
    const busy = p.busyKey === node.path;
    const previewable = isPreviewable(node.name);
    const showing = p.openPreview === node.path;
    return (
      <div>
      <div
        style={indent}
        className={`group flex items-center gap-1.5 rounded py-[3px] pr-1.5 ${confirming ? "bg-rose-50" : showing ? "bg-white" : "hover:bg-white"}`}
      >
        {/* The chevron sits where a file row previously held a blank spacer, so text files gain a
            fold without the column of names shifting. Binary keys keep the spacer: the pane renders
            characters, and a .glb through it is a screenful of mojibake. */}
        {previewable ? (
          <button
            type="button"
            onClick={() => p.onTogglePreview(node.path)}
            title={showing ? `Hide ${node.name}` : `Show what is inside ${node.name}`}
            aria-expanded={showing}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            {showing ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-400" />
            )}
            <FileGlyph name={node.name} />
            <span className={`truncate font-mono text-[11px] ${showing ? "font-semibold text-sky-700" : "text-slate-800"}`}>
              {node.name}
            </span>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="w-3.5 shrink-0" />
            <FileGlyph name={node.name} />
            <span className="truncate font-mono text-[11px] text-slate-800">{node.name}</span>
          </div>
        )}

        {confirming ? (
          // Inline confirmation, on the row that was clicked, naming nothing but this one file. A
          // delete here cannot be undone — the bucket has no versioning.
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-3">
            <span className="text-[10px] font-medium text-rose-700">Delete permanently?</span>
            <Button
              size="sm"
              className="h-5 bg-rose-600 px-2 text-[10px] hover:bg-rose-700"
              onClick={() => p.onConfirmDelete(node.path)}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Delete"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => p.onRequestDelete(null)}
              disabled={busy}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <>
            <span className="ml-auto shrink-0 pl-3 font-mono text-[10px] text-slate-400">
              {formatBytes(node.size ?? 0)}
            </span>
            {node.lastModified && (
              <span className="hidden shrink-0 pl-2 font-mono text-[10px] text-slate-400 sm:inline">
                {node.lastModified.slice(0, 10)}
              </span>
            )}
            {node.url && (
              <a
                href={node.url}
                target="_blank"
                rel="noreferrer"
                title="Open the public URL"
                className="shrink-0 pl-1 text-slate-400 opacity-0 transition-opacity hover:text-sky-600 group-hover:opacity-100"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {node.url && (
              <button
                type="button"
                onClick={() => void p.onDownload(node)}
                title={`Download ${node.name}`}
                aria-label={`Download ${node.name}`}
                disabled={p.saving === node.path}
                className="shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-sky-100 hover:text-sky-600 group-hover:text-slate-400"
              >
                {p.saving === node.path
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Download className="h-3 w-3" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => p.onRequestDelete(node.path)}
              title={`Delete ${node.path}`}
              aria-label={`Delete ${node.path}`}
              className="shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-rose-100 hover:text-rose-600 group-hover:text-slate-400"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
      {showing && <FilePreviewPane node={node} depth={depth} state={p.previews[node.path]} />}
      </div>
    );
  }

  const busyHere = p.uploading === node.path;
  return (
    <div>
      {/* A row, not a button wrapping everything: the upload control is itself a button and cannot
          be nested inside one. The label half stays the toggle. */}
      <div className="group flex items-center rounded pr-1.5 hover:bg-white">
        <button
          type="button"
          style={indent}
          onClick={() => onToggle(node.path)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-[3px] text-left"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          )}
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
          <span className="truncate text-[11px] font-semibold text-slate-700">{node.name}</span>
          <span className="ml-auto shrink-0 pl-3 font-mono text-[10px] text-slate-400">
            {node.files ?? 0} · {formatBytes(node.bytes ?? 0)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => p.onUpload(node.path)}
          title={`Upload into ${node.path}`}
          aria-label={`Upload into ${node.path}`}
          disabled={!!p.uploading}
          className="ml-1.5 shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-sky-100 hover:text-sky-600 group-hover:text-slate-400 disabled:opacity-40"
        >
          {busyHere ? <Loader2 className="h-3 w-3 animate-spin text-sky-600" /> : <Upload className="h-3 w-3" />}
        </button>
      </div>
      {open &&
        (node.children ?? []).map((child) => (
          <TreeRow key={child.path} {...p} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

/** One file's contents, as fetched for its fold. */
interface FilePreview {
  loading: boolean;
  text?: string;
  error?: string;
  /** The object's FULL size, which is larger than `text` when the read was capped. */
  size?: number;
  truncated?: boolean;
}

/** The fold-out under a file row: what is actually stored under that key.
 *
 *  Scrolls in BOTH directions inside a fixed height. A design JSON is thousands of lines with some
 *  very long ones, and neither wrapping it nor letting it grow works here — wrapping turns one
 *  coordinate array into a paragraph, and an unbounded pane pushes the rest of the tree out of the
 *  dialog. So the pane keeps its place in the listing and the file moves inside it.
 */
function FilePreviewPane({ node, depth, state }: { node: CloudTreeNode; depth: number; state?: FilePreview }) {
  // Line up with the file name above rather than the row's left edge: chevron + glyph + the gaps.
  const inset = { paddingLeft: `${depth * 14 + 22}px` };
  const full = state?.text ?? "";
  const empty = !full.trim();
  // A pretty-printed 3 MB design is ~8 MB of text, and putting that in the DOM stalls the dialog for
  // seconds to render lines nobody scrolls to. Read in full so the JSON parses; show a slice.
  const clipped = full.length > PREVIEW_RENDER_CHARS;
  const shown = clipped ? `${full.slice(0, PREVIEW_RENDER_CHARS)}
…` : full;
  const partial = clipped || !!state?.truncated;
  return (
    <div style={inset} className="pb-1.5 pr-1">
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        {state?.loading ? (
          <p className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading {node.name}…
          </p>
        ) : state?.error ? (
          <p className="p-3 text-[11px] text-rose-600">{state.error}</p>
        ) : empty ? (
          <p className="p-3 text-[11px] text-muted-foreground">This file is empty.</p>
        ) : (
          <>
            <pre className="max-h-[320px] overflow-auto p-2.5 font-mono text-[10.5px] leading-[1.55] text-slate-800">
              {shown}
            </pre>
            {partial && (
              <p className="border-t border-slate-200 bg-amber-50 px-2.5 py-1 text-[10px] text-amber-800">
                Partial view — {node.name} is {formatBytes(state?.size ?? full.length)}. Open its public URL to
                read all of it.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** How much of a file the pane will actually put on screen. Independent of the server's read cap:
 *  the whole file comes back so JSON parses and re-indents, and this bounds the DOM that results. */
const PREVIEW_RENDER_CHARS = 200_000;

/** Extensions the fold will open. Deliberately a list rather than "anything not an image": an
 *  unknown extension is more likely to be a binary this pane cannot show than a text file it can. */
const PREVIEWABLE = new Set([
  ".json", ".geojson", ".md", ".txt", ".csv", ".tsv", ".svg", ".yaml", ".yml", ".xml", ".log", ".ifc", ".obj", ".gltf",
]);

const isPreviewable = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && PREVIEWABLE.has(name.slice(dot).toLowerCase());
};

/** JSON is stored minified, which is one unreadable line in a preview — re-indent it when it parses.
 *  Anything else (and anything malformed, including a file the read was capped mid-way through) is
 *  shown exactly as it is in the bucket. */
const prettifyIfJson = (key: string, text: string): string => {
  if (!key.toLowerCase().endsWith(".json")) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

/** The bucket holds JSON definitions and markdown skills; anything else gets the generic glyph. */
function FileGlyph({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return <FileJson className="h-3.5 w-3.5 shrink-0 text-sky-500" />;
  if (lower.endsWith(".md")) return <FileText className="h-3.5 w-3.5 shrink-0 text-violet-500" />;
  return <FileIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />;
}

/** Bucket key for a file dropped into `folder`. "" is the root, where there is no prefix to join. */
const keyFor = (folder: string, name: string): string => (folder ? `${folder}/${name}` : name);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
