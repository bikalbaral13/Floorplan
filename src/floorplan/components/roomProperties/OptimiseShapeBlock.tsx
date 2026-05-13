import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type OptimiseShapeKind = "lshape" | "tshape";

export interface OptimiseShapeBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  axisAngle: number;
  setAxisAngle: (v: number) => void;
  shape: OptimiseShapeKind;
  setShape: (v: OptimiseShapeKind) => void;
  /** Compute & apply the shape preview/commit (silent=true → preview, false → commit). */
  runRoomOptimiseShape: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Drop the live-preview walls when Live is toggled off. */
  onLiveOff: () => void;
}

export const OptimiseShapeBlock = (p: OptimiseShapeBlockProps) => {
  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Optimise Shape</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          <div>
            <span className="text-[10px] text-slate-500">Shape</span>
            <select
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
              value={p.shape}
              onChange={(e) => p.setShape(e.target.value as OptimiseShapeKind)}
            >
              <option value="lshape">L-shape</option>
              <option value="tshape">T-shape</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Axis tilt</span>
              <span className="font-mono text-[10px] text-slate-700">{p.axisAngle.toFixed(1)}°</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={0}
              max={90}
              step={0.1}
              value={p.axisAngle}
              onChange={(e) => p.setAxisAngle(+e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1 text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={p.live}
                onChange={(e) => {
                  const on = e.target.checked;
                  p.setLive(on);
                  if (on) p.runRoomOptimiseShape(p.selectedRoom, true);
                  else p.onLiveOff();
                }}
              />
              Live
            </label>
            <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on change" : "click Apply"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={() => p.runRoomOptimiseShape(p.selectedRoom, false)}
          >
            Apply
          </Button>
        </>
      )}
    </div>
  );
};
