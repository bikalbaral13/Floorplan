import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface CvtRelaxationBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  iterations: number;
  setIterations: (v: number) => void;
  tolerance: number;
  setTolerance: (v: number) => void;
  /** Read-only count, sourced from the Voronoi block's seeds. */
  seedCount: number;
  runRoomCvt: (room: { id: string; points: Point[] }, mode: "preview" | "relax" | "cells") => boolean;
  onClearAllPreview: () => void;
}

export const CvtRelaxationBlock = (p: CvtRelaxationBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">CVT Relaxation</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <span className="text-[9px] text-slate-400">Relaxes Voronoi seeds to their cell centroids (Lloyd&apos;s algorithm).</span>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500">Seeds (from Voronoi block)</span>
        <span className="font-mono text-[10px] text-slate-700">{p.seedCount}</span>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Lloyd iterations</span>
          <span className="font-mono text-[10px] text-slate-700">{p.iterations}</span>
        </div>
        <input type="range" className="w-full" min={1} max={50} step={1}
          value={p.iterations} onChange={(e) => p.setIterations(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Tolerance</span>
          <span className="font-mono text-[10px] text-slate-700">{p.tolerance.toFixed(2)} px</span>
        </div>
        <input type="range" className="w-full" min={0.1} max={5} step={0.1}
          value={p.tolerance} onChange={(e) => p.setTolerance(+e.target.value)} />
        <span className="text-[9px] text-slate-400">Loop ends early once the largest seed move falls below this.</span>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomCvt(p.selectedRoom, "preview");
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "preview cells" : "relax & commit"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomCvt(p.selectedRoom, "relax"); }}
      >
        Apply Relaxation (seeds)
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomCvt(p.selectedRoom, "cells"); }}
      >
        Apply Cells
      </Button>
    </>}
  </div>
);
