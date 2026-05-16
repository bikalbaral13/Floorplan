import type { Unit, Wall } from "../../types";

const metresToUnit = (meters: number, unit: Unit): number => {
  if (unit === "m") return meters;
  if (unit === "cm") return meters * 100;
  return meters * 3.28084;
};

export interface WallOutputsBlockProps {
  selectedWall: Wall;
  unit: Unit;
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
}

/** Read-only derived metrics for the selected wall — length, angle, slope, direction,
 *  endpoint coordinates. No state mutation; just formatting. */
export const WallOutputsBlock = (p: WallOutputsBlockProps) => {
  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Outputs</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (() => {
        const wdx = p.selectedWall.end.x - p.selectedWall.start.x;
        const wdy = p.selectedWall.end.y - p.selectedWall.start.y;
        const lenPx = Math.hypot(wdx, wdy);
        const lenUnit = metresToUnit(lenPx / p.pixelsPerMeter, p.unit);
        const angleDeg = (Math.atan2(wdy, wdx) * 180) / Math.PI;
        // Screen y grows downward, so flip sign to show conventional rise-over-run slope.
        const slope = Math.abs(wdx) < 1e-9 ? Infinity : -wdy / wdx;
        const sx = p.selectedWall.start.x / p.pixelsPerMeter;
        const sy = p.selectedWall.start.y / p.pixelsPerMeter;
        const tx = p.selectedWall.end.x / p.pixelsPerMeter;
        const ty = p.selectedWall.end.y / p.pixelsPerMeter;
        return (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div>
              <span className="text-[9px] text-slate-400">Length</span>
              <p className="font-mono text-slate-700">{lenUnit.toFixed(3)} {p.unit}</p>
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Angle</span>
              <p className="font-mono text-slate-700">{angleDeg.toFixed(2)}°</p>
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Slope (rise/run)</span>
              <p className="font-mono text-slate-700">{isFinite(slope) ? slope.toFixed(3) : "∞ (vertical)"}</p>
            </div>
            <div>
              <span className="text-[9px] text-slate-400">Direction</span>
              <p className="font-mono text-slate-700">
                {Math.abs(wdy) < 0.5 ? "horizontal" : Math.abs(wdx) < 0.5 ? "vertical" : "oblique"}
              </p>
            </div>
            <div className="col-span-2">
              <span className="text-[9px] text-slate-400">Nodes (m)</span>
              <div className="mt-0.5 rounded border border-slate-100 bg-slate-50 p-1 font-mono text-[9px] leading-[1.35] text-slate-700">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">source</span>
                  <span>{sx.toFixed(3)}, {sy.toFixed(3)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-400">target</span>
                  <span>{tx.toFixed(3)}, {ty.toFixed(3)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
