import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type BoundingShapeKind = "circle" | "ellipse" | "ngon";

export interface BoundingShapesBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  kind: BoundingShapeKind;
  setKind: (v: BoundingShapeKind) => void;
  nGonSides: number;
  setNGonSides: (v: number) => void;
  nGonAngle: number;
  setNGonAngle: (v: number) => void;
  nGonOptimize: boolean;
  setNGonOptimize: (v: boolean) => void;
  runRoomCircumcircle: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  runRoomEllipse: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  runRoomNGon: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Drop preview walls when switching kinds while Live is on, OR when Live turns off. */
  onClearAllPreview: () => void;
}

export const BoundingShapesBlock = (p: BoundingShapesBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Bounding Shapes</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Shape</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.kind}
          onChange={(e) => {
            const kind = e.target.value as BoundingShapeKind;
            p.setKind(kind);
            if (p.live) p.onClearAllPreview();
          }}
        >
          <option value="circle">Circumcircle (Welzl — minimum enclosing circle)</option>
          <option value="ellipse">Minimum Enclosing Ellipse (Khachiyan)</option>
          <option value="ngon">Regular n-gon (minimum enclosing)</option>
        </select>
      </div>
      {p.kind === "circle" && (
        <span className="text-[9px] text-slate-400">Smallest circle through the polygon's extreme vertices. No orientation parameter.</span>
      )}
      {p.kind === "ellipse" && (
        <span className="text-[9px] text-slate-400">Smallest-area ellipse containing every vertex. Orientation is chosen automatically.</span>
      )}
      {p.kind === "ngon" && (
        <>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Sides (n)</span>
              <span className="font-mono text-[10px] text-slate-700">{p.nGonSides}</span>
            </div>
            <input type="range" className="w-full" min={3} max={12} step={1}
              value={p.nGonSides} onChange={(e) => p.setNGonSides(+e.target.value)} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Angle</span>
              <span className="font-mono text-[10px] text-slate-700">{p.nGonAngle.toFixed(1)}°</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={0}
              max={360 / Math.max(3, p.nGonSides)}
              step={0.5}
              value={p.nGonAngle}
              onChange={(e) => p.setNGonAngle(+e.target.value)}
              disabled={p.nGonOptimize}
            />
            <span className="text-[9px] text-slate-400">Range is 0–{(360 / Math.max(3, p.nGonSides)).toFixed(1)}° (rotational symmetry).</span>
          </div>
          <label className="flex items-center gap-1 text-[10px] text-slate-600">
            <input type="checkbox" checked={p.nGonOptimize} onChange={(e) => p.setNGonOptimize(e.target.checked)} />
            Optimize orientation
            <span className="text-[9px] text-slate-400">(sweeps θ for minimum area)</span>
          </label>
          <span className="text-[9px] text-slate-400">Regular {p.nGonSides}-gon fitted to the polygon's convex hull via supporting-line intersection.</span>
        </>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (!on) p.onClearAllPreview();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">
          {p.live
            ? (p.kind === "ngon" ? "auto-updates on slide" : "auto-updates on drag")
            : `click Apply ${p.kind === "circle" ? "Circumcircle" : p.kind === "ellipse" ? "Ellipse" : `${p.nGonSides}-gon`}`}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => {
          if (p.kind === "circle") p.runRoomCircumcircle(p.selectedRoom, false);
          else if (p.kind === "ellipse") p.runRoomEllipse(p.selectedRoom, false);
          else p.runRoomNGon(p.selectedRoom, false);
        }}
      >
        {p.kind === "circle" ? "Apply Circumcircle" : p.kind === "ellipse" ? "Apply Ellipse" : `Apply ${p.nGonSides}-gon`}
      </Button>
    </>}
  </div>
);
