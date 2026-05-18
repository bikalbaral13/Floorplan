import { Button } from "@/components/ui/button";
import type { Wall, WallMethod } from "../../types";

export interface WallDisplayBlockProps {
  selectedWall: Wall;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Map from wall id → its computed level (from the connection graph). */
  wallLevels: Map<string, number>;
  /** Toggle the arrow-at-midpoint direction overlay for the selected wall. */
  onToggleShowDirection: (show: boolean) => void;
  /** Swap the wall's source and target endpoints (visual direction reverse). */
  onFlipDirection: () => void;
  /** Justification change — keeps draw-mode default in sync. */
  onJustificationChange: (m: WallMethod) => void;
}

/** Per-wall rendering toggles — direction arrow visibility, flip endpoints, and a
 *  read-only level readout from the connection graph. */
export const WallDisplayBlock = (p: WallDisplayBlockProps) => (
  <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Display</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && (
      <>
        <div>
          <span className="text-[10px] text-slate-400">Justification</span>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <Button size="sm" variant={(p.selectedWall.method ?? "center") === "left" ? "default" : "outline"} onClick={() => p.onJustificationChange("left")}>
              Left
            </Button>
            <Button size="sm" variant={(p.selectedWall.method ?? "center") === "center" ? "default" : "outline"} onClick={() => p.onJustificationChange("center")}>
              Center
            </Button>
            <Button size="sm" variant={(p.selectedWall.method ?? "center") === "right" ? "default" : "outline"} onClick={() => p.onJustificationChange("right")}>
              Right
            </Button>
          </div>
          <p className="mt-0.5 text-[9px] text-slate-400">Press Tab while drawing to cycle.</p>
        </div>
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={!!p.selectedWall.showDirection}
            onChange={(e) => p.onToggleShowDirection(e.target.checked)}
          />
          Show Direction
          <span className="text-[9px] text-slate-400">(arrow at midpoint, source → target)</span>
        </label>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={p.onFlipDirection}
        >
          Flip Direction
        </Button>
        <p className="text-[9px] text-slate-400">
          Level: {p.wallLevels.has(p.selectedWall.id) ? `L${p.wallLevels.get(p.selectedWall.id)}` : "—"}
          <span className="ml-1">(toggle “Show Level” in Default Settings to display globally)</span>
        </p>
      </>
    )}
  </div>
);
