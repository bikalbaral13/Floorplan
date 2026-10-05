import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, File, Folder, FolderOpen, Layers } from "lucide-react";

/** One entry of public/interior-mesh-pipeline/manifest.json (tools/gen-pipeline-manifest.mjs). */
interface PNode {
  name: string;
  path: string;
  type: "folder" | "file";
  size?: number;
  files?: number;
  children?: PNode[];
}

const BASE = "/interior-mesh-pipeline";
const fmt = (b = 0) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Navigator section: the Interior Mesh Pipeline folder shipped with the app — VIEW ONLY. Folders fold;
 *  a file opens in a new tab. Folded by default; the open state is remembered per browser. */
export const PipelineTreeSection = () => {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("bp.editor.pipelineOpen") === "1"; } catch { return false; } });
  const [root, setRoot] = useState<{ files: number; children: PNode[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** The text file folded open under its row (one at a time), and fetched bodies. */
  const [preview, setPreview] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || root) return;
    fetch(`${BASE}/manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRoot)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, root]);

  const toggleOpen = () => setOpen((o) => { try { localStorage.setItem("bp.editor.pipelineOpen", o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const toggle = (p: string) => setExpanded((prev) => { const n = new Set(prev); if (!n.delete(p)) n.add(p); return n; });

  const Row = ({ node, depth }: { node: PNode; depth: number }) => {
    const pad = { paddingLeft: `${depth * 14 + 4}px` };
    if (node.type === "file") {
      const href = `${BASE}/${node.path.split("/").map(encodeURIComponent).join("/")}`;
      // Text opens INLINE under the row (a .py has no content type and would download); the rest opens in a tab.
      const isText = /\.(md|py|json|txt|csv|keep|ya?ml)$/i.test(node.name) || !node.name.includes(".");
      const showing = preview === node.path;
      const inner = (
        <>
          {isText ? (showing ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />) : <span className="w-3.5 shrink-0" />}
          <File className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${showing ? "font-semibold text-sky-700" : "text-slate-800"}`}>{node.name}</span>
          <span className="shrink-0 pl-2 font-mono text-[10px] text-slate-400">{fmt(node.size)}</span>
        </>
      );
      const cls = "flex w-full items-center gap-1.5 rounded py-[3px] pr-1.5 text-left hover:bg-white";
      if (!isText) return <a href={href} target="_blank" rel="noreferrer" style={pad} title={`Open ${node.path}`} className={cls}>{inner}</a>;
      return (
        <div>
          <button type="button" style={pad} className={cls} aria-expanded={showing} title={node.path}
            onClick={() => {
              if (showing) { setPreview(null); return; }
              setPreview(node.path);
              if (bodies[node.path] == null) fetch(href).then((r) => r.text()).then((t) => setBodies((b) => ({ ...b, [node.path]: t.slice(0, 200_000) }))).catch(() => setBodies((b) => ({ ...b, [node.path]: "(could not load)" })));
            }}>
            {inner}
          </button>
          {showing && (
            <pre className="mb-1 max-h-72 overflow-auto whitespace-pre rounded-md border border-slate-200 bg-white p-2 font-mono text-[10px] leading-relaxed text-slate-700" style={{ marginLeft: `${depth * 14 + 20}px` }}>
              {bodies[node.path] ?? "Loading…"}
            </pre>
          )}
        </div>
      );
    }
    const isOpen = expanded.has(node.path);
    return (
      <div>
        <button type="button" onClick={() => toggle(node.path)} style={pad} aria-expanded={isOpen}
          className="flex w-full items-center gap-1.5 rounded py-[3px] pr-1.5 text-left hover:bg-white">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          {isOpen ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{node.name}</span>
          <span className="shrink-0 pl-2 font-mono text-[10px] text-slate-400">{node.files}</span>
        </button>
        {isOpen && node.children?.map((c) => <Row key={c.path} node={c} depth={depth + 1} />)}
      </div>
    );
  };

  return (
    <div className={`flex shrink-0 flex-col border-t border-slate-200 pt-2 ${open ? "max-h-[40%] min-h-0" : ""}`}>
      <button type="button" onClick={toggleOpen} aria-expanded={open}
        className="flex items-center gap-1.5 rounded px-1 pb-1.5 text-left hover:text-slate-800">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <Layers className="h-3.5 w-3.5 text-violet-600" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Interior Mesh Pipeline</span>
        {root && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">{root.files}</span>}
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? <p className="px-1 py-2 text-[11px] text-rose-600">Could not load the pipeline: {error}</p>
            : !root ? <p className="px-1 py-2 text-[11px] text-slate-400">Loading…</p>
            : root.children.map((c) => <Row key={c.path} node={c} depth={0} />)}
        </div>
      )}
    </div>
  );
};
