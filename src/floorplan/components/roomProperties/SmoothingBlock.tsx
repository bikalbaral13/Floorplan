import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type SmoothingType = "chaikin" | "bezier";

export interface SmoothingBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  type: SmoothingType;
  setType: (v: SmoothingType) => void;
  level: number;
  setLevel: (v: number) => void;
  /** When true, any smoothed point that drifts outside the original polygon (typically at
   *  reflex corners, where Chaikin's diagonal cuts and Bézier fillets bulge outward) is
   *  snapped back to its closest boundary point. Keeps the smoothed curve fully inside the
   *  original room. */
  restrictInside: boolean;
  setRestrictInside: (v: boolean) => void;
  /** Curve-shortening evolution applied AFTER the regular smoothing pass. Only used when
   *  `restrictInside` is on. 0 = no extra shrinkage, 100 = full collapse to the centroid.
   *  Each tick iterates a discrete Laplacian / curvature flow step, so the smoothed polygon
   *  is continuously "squeezed" inward — every closed curve eventually becomes a circle
   *  (Gage–Hamilton–Grayson) and then collapses to a point. */
  curveShortening: number;
  setCurveShortening: (v: number) => void;
  runRoomSmoothing: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  onClearAllPreview: () => void;
}

export const SmoothingBlock = (p: SmoothingBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Smoothing</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Type</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.type}
          onChange={(e) => p.setType(e.target.value as SmoothingType)}
        >
          <option value="chaikin">Chaikin corner-cutting</option>
          <option value="bezier">Bézier corner fillet</option>
        </select>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Smoothing level</span>
          <span className="font-mono text-[10px] text-slate-700">{(p.level * 100).toFixed(0)}%</span>
        </div>
        <input type="range" className="w-full" min={0} max={1} step={0.02}
          value={p.level} onChange={(e) => p.setLevel(+e.target.value)} />
        <span className="text-[9px] text-slate-400">
          {p.type === "chaikin"
            ? `Chaikin iterations: ${Math.round(p.level * 5)}.`
            : "Bézier fillet radius as fraction of shortest adjacent edge."}
        </span>
      </div>
      <label className="flex items-center gap-1 text-[10px] text-slate-600">
        <input
          type="checkbox"
          checked={p.restrictInside}
          onChange={(e) => {
            p.setRestrictInside(e.target.checked);
            if (p.live) p.runRoomSmoothing(p.selectedRoom, true);
          }}
        />
        Restrict inside the polygon
      </label>
      <span className="block text-[9px] text-slate-400 leading-tight">
        Snaps any smoothed point that lands outside the original polygon back to the closest boundary
        point. Useful when smoothing rounds reflex corners outward.
      </span>
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Curved shortening</span>
          <span className="font-mono text-[10px] text-slate-700">{p.curveShortening.toFixed(0)}%</span>
        </div>
        <input
          type="range"
          className="w-full"
          min={0}
          max={100}
          step={1}
          value={p.curveShortening}
          onChange={(e) => {
            const v = +e.target.value;
            p.setCurveShortening(v);
            if (p.live) p.runRoomSmoothing(p.selectedRoom, true);
          }}
        />
        <span className="block text-[9px] text-slate-400 leading-tight">
          Continuously squeezes the smoothed curve inward via Grayson's curve-shortening flow.
          0 = stay at the smoothed shape, 100 = collapse to a point. Every closed shape
          eventually becomes a circle along the way.
        </span>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomSmoothing(p.selectedRoom, true);
              else p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Smoothing"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomSmoothing(p.selectedRoom, false); }}
      >
        Apply Smoothing
      </Button>
    </>}
  </div>
);
