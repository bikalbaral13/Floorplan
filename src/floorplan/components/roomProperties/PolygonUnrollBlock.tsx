import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface PolygonUnrollBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  unit: string;
  /** Pixel-units per real-world unit (already specialised by `unit`); used to display the slider value. */
  unitFromPixels: (px: number) => number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  startEdge: number;
  setStartEdge: (v: number) => void;
  slider: number;
  setSlider: (v: number) => void;
  runRoomUnroll: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const PolygonUnrollBlock = (p: PolygonUnrollBlockProps) => {
  const uN = p.selectedRoom.points.length;
  const uLens: number[] = [];
  for (let i = 0; i < uN; i++) {
    uLens.push(Math.hypot(
      p.selectedRoom.points[(i + 1) % uN].x - p.selectedRoom.points[i].x,
      p.selectedRoom.points[(i + 1) % uN].y - p.selectedRoom.points[i].y,
    ));
  }
  const uPerim = uLens.reduce((a, b) => a + b, 0);
  const uPerimUnit = p.unitFromPixels(uPerim);
  const uSliderUnit = p.unitFromPixels(p.slider);

  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Polygon Unroll</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && <>
        <span className="text-[9px] text-slate-400">Progressively lays each polygon edge flat on a horizontal line. Pivot is the vertex where the current edge ends.</span>
        <div>
          <span className="text-[10px] text-slate-500">Starting edge</span>
          <select
            className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
            value={p.startEdge}
            onChange={(e) => p.setStartEdge(Math.max(0, Math.min(uN - 1, +e.target.value)))}
          >
            {Array.from({ length: uN }, (_, i) => (
              <option key={i} value={i}>Edge {i} (L = {p.unitFromPixels(uLens[i] ?? 0).toFixed(2)} {p.unit})</option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Unrolled length</span>
            <span className="font-mono text-[10px] text-slate-700">{uSliderUnit.toFixed(2)} / {uPerimUnit.toFixed(2)} {p.unit}</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={0}
            max={uPerim}
            step={Math.max(0.1, uPerim / 500)}
            value={Math.min(p.slider, uPerim)}
            onChange={(e) => p.setSlider(+e.target.value)}
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
                if (on) p.runRoomUnroll(p.selectedRoom, true);
                else p.onClearAllPreview();
              }}
            />
            Live
          </label>
          <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Unroll"}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" size="sm" className="text-[11px]" onClick={() => p.setSlider(0)}>
            Reset (s=0)
          </Button>
          <Button variant="outline" size="sm" className="text-[11px]" onClick={() => p.setSlider(uPerim)}>
            Full (s=perimeter)
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-[11px]"
          onClick={() => { p.runRoomUnroll(p.selectedRoom, false); }}
        >
          Apply Unroll
        </Button>
      </>}
    </div>
  );
};
