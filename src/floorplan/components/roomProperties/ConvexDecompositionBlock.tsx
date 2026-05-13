import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type ConvexDecompositionType = "hertel-mehlhorn" | "bayazit" | "acd" | "steiner";

export interface ConvexDecompositionBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  type: ConvexDecompositionType;
  setType: (v: ConvexDecompositionType) => void;
  tolerance: number;
  setTolerance: (v: number) => void;
  runRoomConvexDecomp: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const ConvexDecompositionBlock = (p: ConvexDecompositionBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Convex Decomposition</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Type</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.type}
          onChange={(e) => p.setType(e.target.value as ConvexDecompositionType)}
        >
          <option value="hertel-mehlhorn">Hertel–Mehlhorn (heuristic)</option>
          <option value="bayazit">Bayazit (reflex split)</option>
          <option value="acd">ACD (approximate convex)</option>
          <option value="steiner">Steiner (edge extension)</option>
        </select>
        <span className="text-[9px] text-slate-400">
          {p.type === "hertel-mehlhorn"
            ? "Triangulate + merge across non-essential diagonals. ≤ 4× optimal pieces."
            : p.type === "bayazit"
              ? "Recursively split at each reflex vertex. Exact convex pieces."
              : p.type === "acd"
                ? "Bayazit but ignores reflex vertices within tolerance — fewer pieces for noisy polygons."
                : "Extends each reflex edge along its supporting line until it hits the opposite edge. Allows Steiner points (new vertices mid-edge) — produces rectangular pieces in L/U/T shapes instead of triangles."}
        </span>
      </div>
      {p.type === "acd" && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Tolerance</span>
            <span className="font-mono text-[10px] text-slate-700">{p.tolerance.toFixed(1)}°</span>
          </div>
          <input type="range" className="w-full" min={0} max={40} step={0.5}
            value={p.tolerance} onChange={(e) => p.setTolerance(+e.target.value)} />
          <span className="text-[9px] text-slate-400">Reflex vertices within this angle beyond 180° are treated as convex.</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomConvexDecomp(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "preview on" : "click Apply Decomposition"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomConvexDecomp(p.selectedRoom, false); }}
      >
        Apply Convex Decomposition
      </Button>
    </>}
  </div>
);
