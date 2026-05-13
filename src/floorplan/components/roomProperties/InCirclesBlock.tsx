import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface InCirclesBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  unit: string;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  sides: number;
  setSides: (v: number) => void;
  optimizeRotation: boolean;
  setOptimizeRotation: (v: boolean) => void;
  rotation: number;
  setRotation: (v: number) => void;
  count: number;
  setCount: (v: number) => void;
  minRadius: number;
  setMinRadius: (v: number) => void;
  runRoomInCircle: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const InCirclesBlock = (p: InCirclesBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">InCircles</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <span className="text-[9px] text-slate-400">Iterative inscribed-shape packing — places the largest inscribed shape, subtracts it from the available region, and repeats up to N times. Shapes are regular n-gons; 30 sides ≈ circle.</span>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Sides (n)</span>
          <span className="font-mono text-[10px] text-slate-700">{p.sides >= 30 ? "∞ (circle)" : p.sides}</span>
        </div>
        <input type="range" className="w-full" min={3} max={30} step={1}
          value={p.sides} onChange={(e) => p.setSides(+e.target.value)} />
        <span className="text-[9px] text-slate-400">3 = triangles, 4 = squares, 6 = hexagons, 30 = circle.</span>
      </div>
      {p.sides < 30 && (
        <>
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input type="checkbox" checked={p.optimizeRotation} onChange={(e) => p.setOptimizeRotation(e.target.checked)} />
            Optimize rotation
            <span className="text-[9px] text-slate-400">(sweeps θ per candidate for best fit)</span>
          </label>
          {!p.optimizeRotation && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Rotation</span>
                <span className="font-mono text-[10px] text-slate-700">{p.rotation.toFixed(1)}°</span>
              </div>
              <input type="range" className="w-full" min={0} max={360 / Math.max(3, p.sides)} step={0.5}
                value={p.rotation} onChange={(e) => p.setRotation(+e.target.value)} />
              <span className="text-[9px] text-slate-400">Range is 0–{(360 / Math.max(3, p.sides)).toFixed(1)}° (n-fold rotational symmetry).</span>
            </div>
          )}
        </>
      )}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Number of shapes</span>
          <span className="font-mono text-[10px] text-slate-700">{p.count}</span>
        </div>
        <input type="range" className="w-full" min={1} max={50} step={1}
          value={p.count} onChange={(e) => p.setCount(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Min radius ({p.unit})</span>
          <span className="font-mono text-[10px] text-slate-700">{p.minRadius.toFixed(2)}</span>
        </div>
        <input type="range" className="w-full" min={0.05} max={3} step={0.05}
          value={p.minRadius} onChange={(e) => p.setMinRadius(+e.target.value)} />
        <span className="text-[9px] text-slate-400">Stops early when no remaining shape can meet this circumradius.</span>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomInCircle(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply InCircles"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomInCircle(p.selectedRoom, false); }}
      >
        Apply InCircles
      </Button>
    </>}
  </div>
);
