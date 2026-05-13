import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { computePolygonPrincipalAxes } from "../../algorithms/geometry/principalAxes";

export type SplitMode = "equal" | "ratio" | "target" | "length";

export interface SplittingActionsBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  count: number;
  setCount: (v: number) => void;
  ratios: number[];
  setRatios: (updater: (prev: number[]) => number[]) => void;
  edge: number | null;
  setEdge: (v: number | null) => void;
  edgeFlip: boolean;
  setEdgeFlip: (updater: (prev: boolean) => boolean) => void;
  alongMinorPrincipalAxis: boolean;
  setAlongMinorPrincipalAxis: (v: boolean) => void;
  angle: number;
  setAngle: (v: number) => void;
  mode: SplitMode;
  setMode: (v: SplitMode) => void;
  target: number;
  setTarget: (v: number) => void;
  lengths: number[];
  setLengths: (updater: (prev: number[]) => number[]) => void;
  /** "normal" = existing N-piece logic; "strip" = exactly two parallel cuts of given width. */
  type: "normal" | "strip";
  setType: (v: "normal" | "strip") => void;
  stripLength: number;
  setStripLength: (v: number) => void;
  stripPosition: number;
  setStripPosition: (v: number) => void;
  runRoomSplit: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Drop split preview walls (isSplitWall) when Live is toggled off. */
  onLiveOff: () => void;
}

export const SplittingActionsBlock = (p: SplittingActionsBlockProps) => (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Splitting Actions</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Type</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.type}
          onChange={(e) => p.setType(e.target.value as "normal" | "strip")}
        >
          <option value="normal">Normal</option>
          <option value="strip">Strip</option>
        </select>
      </div>

      {p.type === "normal" && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Pieces</span>
            <span className="font-mono text-[10px] text-slate-700">{p.count}</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={2}
            max={6}
            step={1}
            value={p.count}
            onChange={(e) => {
              const n = +e.target.value;
              p.setCount(n);
              p.setRatios((prev) => {
                const arr = [...prev];
                while (arr.length < n) arr.push(Math.round(100 / n));
                while (arr.length > n) arr.pop();
                const sum = arr.reduce((s, v) => s + v, 0) || 1;
                return arr.map((v) => Math.round((v / sum) * 100));
              });
            }}
          />
        </div>
      )}

      <div>
        <span className="text-[10px] text-slate-500">Measure along edge</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.edge ?? ""}
          onChange={(e) => p.setEdge(e.target.value === "" ? null : +e.target.value)}
        >
          <option value="">— manual angle —</option>
          {p.selectedRoom.points.map((pt, i) => {
            const q = p.selectedRoom.points[(i + 1) % p.selectedRoom.points.length];
            const Lm = Math.hypot(q.x - pt.x, q.y - pt.y) / p.pixelsPerMeter;
            return <option key={i} value={i}>{`Edge ${i} — ${Lm.toFixed(2)} m`}</option>;
          })}
        </select>
        {p.edge !== null && (
          <Button
            variant="outline"
            size="sm"
            className="mt-1 h-6 w-full text-[10px]"
            onClick={() => p.setEdgeFlip((v) => !v)}
          >
            Flip direction {p.edgeFlip ? "(end → start)" : "(start → end)"}
          </Button>
        )}
      </div>

      <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
        <input
          type="checkbox"
          checked={p.alongMinorPrincipalAxis}
          onChange={(e) => p.setAlongMinorPrincipalAxis(e.target.checked)}
        />
        Split along minor principal axis
        <span
          className="text-[9px] text-slate-400"
          title="Cut lines run along the minor principal axis (the polygon's short direction). Pieces stack along the major axis — the long dimension is sliced into normal-aspect children. Falls back to the manual angle for near-isotropic polygons."
        >
          (auto angle)
        </span>
      </label>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Splitting angle</span>
          <span className="font-mono text-[10px] text-slate-700">
            {p.alongMinorPrincipalAxis
              ? (() => {
                  const { majorAngleDeg, anisotropy } = computePolygonPrincipalAxes(p.selectedRoom.points);
                  if (anisotropy < 0.05) return `${p.angle}° (isotropic — manual)`;
                  return `${majorAngleDeg.toFixed(1)}° (major principal)`;
                })()
              : `${p.angle}°${p.edge !== null ? " (derived)" : ""}`}
          </span>
        </div>
        <input
          type="range"
          className="w-full"
          min={0}
          max={360}
          step={1}
          value={p.angle}
          disabled={p.alongMinorPrincipalAxis}
          onChange={(e) => { p.setEdge(null); p.setAngle(+e.target.value); }}
        />
      </div>

      {p.type === "strip" && (() => {
        const pts = p.selectedRoom.points;
        const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
        const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
        const rad = (p.angle * Math.PI) / 180;
        const c = Math.cos(rad), sn = Math.sin(rad);
        const rxs = pts.map((pt) => (pt.x - cx) * c + (pt.y - cy) * sn);
        const axisSpanM = (Math.max(...rxs) - Math.min(...rxs)) / p.pixelsPerMeter;
        return (
          <>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Strip length</span>
                <span className="font-mono text-[10px] text-slate-700">{p.stripLength.toFixed(2)} m</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={0.1}
                max={Math.max(0.2, axisSpanM)}
                step={0.05}
                value={Math.min(p.stripLength, Math.max(0.2, axisSpanM))}
                onChange={(e) => p.setStripLength(+e.target.value)}
              />
              <span className="text-[9px] text-slate-400">Two parallel cuts {p.stripLength.toFixed(2)} m apart along the splitting axis (max {axisSpanM.toFixed(2)} m).</span>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Strip position</span>
                <span className="font-mono text-[10px] text-slate-700">{p.stripPosition}%</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={0}
                max={100}
                step={1}
                value={p.stripPosition}
                onChange={(e) => p.setStripPosition(+e.target.value)}
              />
              <span className="text-[9px] text-slate-400">Centre of the strip along the splitting axis (0 = near min, 100 = near max).</span>
            </div>
          </>
        );
      })()}

      {p.type === "normal" && (
        <div>
          <span className="text-[10px] text-slate-500">Sizing</span>
          <select
            className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
            value={p.mode}
            onChange={(e) => p.setMode(e.target.value as SplitMode)}
          >
            <option value="equal">Equal</option>
            <option value="ratio">Ratio</option>
            <option value="target">Target area (m²)</option>
            <option value="length">Length (m)</option>
          </select>
        </div>
      )}

      {p.type === "normal" && p.mode === "ratio" && (
        <div className="space-y-1">
          {Array.from({ length: p.count }).map((_, i) => (
            <div key={i}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Piece {i + 1}</span>
                <span className="font-mono text-[10px] text-slate-700">{p.ratios[i] ?? 0}%</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={1}
                max={99}
                step={1}
                value={p.ratios[i] ?? 0}
                onChange={(e) => {
                  const v = +e.target.value;
                  p.setRatios((prev) => {
                    const arr = [...prev];
                    while (arr.length < p.count) arr.push(0);
                    arr[i] = v;
                    return arr;
                  });
                }}
              />
            </div>
          ))}
        </div>
      )}

      {p.type === "normal" && p.mode === "target" && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">First piece area</span>
            <span className="font-mono text-[10px] text-slate-700">{p.target} m²</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={1}
            max={200}
            step={1}
            value={p.target}
            onChange={(e) => p.setTarget(+e.target.value)}
          />
        </div>
      )}

      {p.type === "normal" && p.mode === "length" && (() => {
        const pts = p.selectedRoom.points;
        const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
        const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
        const rad = (p.angle * Math.PI) / 180;
        const c = Math.cos(rad), sn = Math.sin(rad);
        const rxs = pts.map((pt) => (pt.x - cx) * c + (pt.y - cy) * sn);
        const axisSpanM = (Math.max(...rxs) - Math.min(...rxs)) / p.pixelsPerMeter;
        return (
          <div className="space-y-1">
            <span className="text-[9px] text-slate-500">Piece lengths (max {axisSpanM.toFixed(2)} m) — last piece = remainder</span>
            {Array.from({ length: Math.max(1, p.count - 1) }).map((_, i) => {
              const v = p.lengths[i] ?? 0;
              return (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[10px] text-slate-500 w-12">Piece {i + 1}</span>
                  <input
                    type="number"
                    className="h-6 flex-1 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                    min={0.05}
                    max={axisSpanM}
                    step={0.05}
                    value={v}
                    onChange={(e) => {
                      const nv = +e.target.value;
                      p.setLengths((prev) => {
                        const arr = [...prev];
                        while (arr.length < p.count - 1) arr.push(1);
                        arr[i] = nv;
                        return arr;
                      });
                    }}
                  />
                  <span className="text-[10px] text-slate-500">m</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomSplit(p.selectedRoom, true);
              else p.onLiveOff();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Split"}</span>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomSplit(p.selectedRoom, false); }}
      >
        Apply Split
      </Button>
    </>}
  </div>
);
