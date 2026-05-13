import { type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";

export type LoggedOp = {
  id: string;
  timestamp: number;
  description: string;
  op: { tool: string; params: Record<string, unknown>; commit?: boolean };
  roomId?: string;
};

interface InfoPanelProps {
  panelExpanded: boolean;
  onPanelExpandedChange: Dispatch<SetStateAction<boolean>>;
  actionLog: LoggedOp[];
  onClearLog: () => void;
  logExpanded: boolean;
  onLogExpandedChange: Dispatch<SetStateAction<boolean>>;
  expandedEntries: Set<string>;
  onExpandedEntriesChange: Dispatch<SetStateAction<Set<string>>>;
}

export const InfoPanel = ({
  panelExpanded,
  onPanelExpandedChange,
  actionLog,
  onClearLog,
  logExpanded,
  onLogExpandedChange,
  expandedEntries,
  onExpandedEntriesChange,
}: InfoPanelProps) => {
  const onCopyRecipe = () => {
    if (actionLog.length === 0) { toast.error("Log is empty"); return; }
    const recipe = { operations: actionLog.map((e) => e.op) };
    navigator.clipboard.writeText(JSON.stringify(recipe, null, 2)).then(
      () => toast.success("Recipe copied to clipboard"),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <div className="shrink-0 border-t border-slate-200 bg-slate-50" style={panelExpanded ? { maxHeight: "35%" } : undefined}>
      <button
        type="button"
        className="flex w-full items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-left"
        onClick={() => onPanelExpandedChange((v) => !v)}
      >
        <span className="text-sm font-semibold">Info</span>
        <span className="text-[11px] text-slate-400">{panelExpanded ? "▼" : "▶"}</span>
      </button>
      {panelExpanded && (
        <ScrollArea className="h-full max-h-[35vh]">
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-end pb-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-700 underline"
                  onClick={onCopyRecipe}
                >
                  Copy Recipe
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  className="text-[10px] text-slate-500 hover:text-slate-700 underline"
                  onClick={onClearLog}
                >
                  Clear
                </button>
              </div>
            </div>

            <button
              type="button"
              className="flex w-full items-center justify-between text-left rounded border border-slate-200 bg-white p-2"
              onClick={() => onLogExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                Operations Log {actionLog.length > 0 ? `(${actionLog.length})` : ""}
              </span>
              <span className="text-[11px] text-slate-400">{logExpanded ? "▼" : "▶"}</span>
            </button>

            {logExpanded && (
              <div className="space-y-1">
                {actionLog.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-200 bg-white p-3 text-center text-[11px] text-slate-400">
                    No operations yet. Apply Inset, BSP, Optimise-Rect, Place-Object or Treemap to log entries here.
                  </p>
                ) : (
                  [...actionLog].reverse().map((e) => {
                    const isOpen = expandedEntries.has(e.id);
                    const time = new Date(e.timestamp).toLocaleTimeString();
                    return (
                      <div key={e.id} className="rounded border border-slate-200 bg-white p-2">
                        <button
                          type="button"
                          className="flex w-full items-start justify-between gap-2 text-left"
                          onClick={() => onExpandedEntriesChange((prev) => {
                            const next = new Set(prev);
                            if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                            return next;
                          })}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium text-slate-700 truncate">{e.description}</p>
                            <p className="text-[9px] text-slate-400">
                              {time}{e.roomId ? ` · ${e.roomId.slice(0, 8)}` : ""}
                            </p>
                          </div>
                          <span className="text-[11px] text-slate-400 shrink-0">{isOpen ? "▼" : "▶"}</span>
                        </button>
                        {isOpen && (
                          <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-1.5 text-[10px] text-slate-700 font-mono">
{JSON.stringify(e.op, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
};
