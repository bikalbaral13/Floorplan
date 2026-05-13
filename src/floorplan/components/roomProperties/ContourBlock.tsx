import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export interface ContourBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  unit: string;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  interval: number;
  setInterval: (v: number) => void;
  maxLevels: number;
  setMaxLevels: (v: number) => void;
  runRoomContour: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const ContourBlock = (p: ContourBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Contour</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <span className="text-[9px] text-slate-400">Nested contour polygons at fixed intervals, computed by iteratively offsetting the boundary inward. Outer boundary = "elevation 0"; each inner contour is one step deeper.</span>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Interval ({p.unit})</span>
          <span className="font-mono text-[10px] text-slate-700">{p.interval.toFixed(2)}</span>
        </div>
        <input type="range" className="w-full" min={0.1} max={5} step={0.05}
          value={p.interval} onChange={(e) => p.setInterval(+e.target.value)} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Max levels</span>
          <span className="font-mono text-[10px] text-slate-700">{p.maxLevels}</span>
        </div>
        <input type="range" className="w-full" min={1} max={30} step={1}
          value={p.maxLevels} onChange={(e) => p.setMaxLevels(+e.target.value)} />
        <span className="text-[9px] text-slate-400">Stops early if a contour collapses below the minimum area.</span>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomContour(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Contour"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomContour(p.selectedRoom, false); }}
      >
        Apply Contour
      </Button>
    </>}
  </div>
);
