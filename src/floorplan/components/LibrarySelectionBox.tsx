import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { CONTEXT_BUDGET, KIND_LABEL, KIND_ORDER, clearSelection, removeSelection, useLibrarySelection, type SelItem } from "../librarySelection";

const fmt = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** The bottom of the navigator: what is ticked, grouped by folder behaviour. This is what the chat agent reads
 *  on every send — nothing here is loaded onto the canvas. */
export const LibrarySelectionBox = () => {
  const items = useLibrarySelection();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const total = items.reduce((s, i) => s + i.size, 0);
  const groups = KIND_ORDER.map((k) => ({ kind: k, list: items.filter((i) => i.kind === k) })).filter((g) => g.list.length);
  const name = (i: SelItem) => i.key.split("/").pop() ?? i.key;
  const where = (i: SelItem) => i.key.replace(/^library\//, "").split("/").slice(0, -1).join("/");

  return (
    <div className="flex max-h-[45%] min-h-[5.5rem] shrink-0 flex-col border-t border-slate-200 pt-2">
      <div className="flex items-center gap-2 px-1 pb-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selection</span>
        {items.length > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
            {items.length} · {fmt(total)}
          </span>
        )}
        {items.length > 0 && (
          <button type="button" onClick={clearSelection} className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            Clear
          </button>
        )}
      </div>
      {total > CONTEXT_BUDGET && (
        <p className="mx-1 mb-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
          Over {fmt(CONTEXT_BUDGET)} — the agent gets the skills and the smaller files in full, the rest as links.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-1 py-2 text-[11px] leading-relaxed text-slate-400">
            Tick files or folders above. Skills become the agent's instructions; objects, tools and designs are
            given to it to read. Nothing is loaded onto the canvas.
          </p>
        ) : (
          groups.map((g) => {
            const open = !closed.has(g.kind);
            return (
              <div key={g.kind} className="mb-1">
                <button
                  type="button"
                  onClick={() => setClosed((c) => { const n = new Set(c); if (!n.delete(g.kind)) n.add(g.kind); return n; })}
                  className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-slate-50"
                  aria-expanded={open}
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                  <span className="flex-1 text-[11px] font-semibold text-slate-700">{KIND_LABEL[g.kind]}</span>
                  <span className="text-[10px] tabular-nums text-slate-400">{g.list.length}</span>
                </button>
                {open && g.list.map((i) => (
                  <div key={i.key} className="group flex items-center gap-1.5 rounded py-0.5 pl-6 pr-1 hover:bg-slate-50" title={i.key}>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-slate-700">
                      {name(i)}
                      {where(i) && <span className="ml-1.5 text-[10px] text-slate-400">{where(i)}</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSelection([i.key])}
                      className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-700 group-hover:text-slate-400"
                      aria-label={`Remove ${name(i)}`}
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
