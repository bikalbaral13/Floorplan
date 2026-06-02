import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { computePolygonPrincipalAxes } from "../../algorithms/geometry/principalAxes";
import type { PrincipalAxesMethod, PrincipalAxesShow } from "../../algorithms/geometry/principalAxes";
import { computeSplitPolygons } from "../../algorithms/geometry/splitPolygons";

export type SplitMode = "equal" | "ratio" | "target" | "length";

/** Compact, scrollable read-only list of a piece's vertices (in metres). */
const VertexList = ({ pts, ppm }: { pts: Point[]; ppm: number }) => (
  <div className="mt-0.5 max-h-20 overflow-y-auto rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] leading-tight text-slate-700">
    {pts.map((q, i) => (
      <div key={i}>{i + 1}: ({(q.x / ppm).toFixed(2)}, {(q.y / ppm).toFixed(2)})</div>
    ))}
  </div>
);

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
  type: "normal" | "strip" | "grid" | "principal";
  setType: (v: "normal" | "strip" | "grid" | "principal") => void;
  stripLength: number;
  setStripLength: (v: number) => void;
  stripPosition: number;
  setStripPosition: (v: number) => void;
  /** Grid 2×n: count → user picks n directly; width → n derived from cell width along major axis. */
  gridMode: "count" | "width";
  setGridMode: (v: "count" | "width") => void;
  gridCount: number;
  setGridCount: (v: number) => void;
  gridWidth: number;
  setGridWidth: (v: number) => void;
  /** Principal-axes split: mirrors the Shape Analysis Principal Axes controls. */
  principalMethod: PrincipalAxesMethod;
  setPrincipalMethod: (v: PrincipalAxesMethod) => void;
  principalShow: PrincipalAxesShow;
  setPrincipalShow: (v: PrincipalAxesShow) => void;
  principalAlignToCenter: boolean;
  setPrincipalAlignToCenter: (v: boolean) => void;
  /** Sub-split: n−1 perpendicular cuts distributed along the long axis. */
  principalSubsplit: boolean;
  setPrincipalSubsplit: (v: boolean) => void;
  principalSubsplitMode: "count" | "width";
  setPrincipalSubsplitMode: (v: "count" | "width") => void;
  principalSubsplitCount: number;
  setPrincipalSubsplitCount: (v: number) => void;
  principalSubsplitWidth: number;
  setPrincipalSubsplitWidth: (v: number) => void;
  /** Minimum area (m²) for keeping a slice of the long axis between two sub-cuts. */
  principalMinArea: number;
  setPrincipalMinArea: (v: number) => void;
  /** Visvalingam-Whyatt polyline simplification — only shown when method = "skeleton".
   *  Bound to the same state slot as the Skeleton block's "Simplify" slider. */
  principalSimplify: number;
  setPrincipalSimplify: (v: number) => void;
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
          onChange={(e) => p.setType(e.target.value as "normal" | "strip" | "grid")}
        >
          <option value="normal">Normal</option>
          <option value="strip">Strip</option>
          <option value="grid">Grid 2×n</option>
          <option value="principal">Principal Axes</option>
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

      {p.type !== "principal" && (
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
      )}

      {p.type !== "principal" && (
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
      )}

      {p.type !== "principal" && (
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
      )}

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

      {p.type === "grid" && (() => {
        const pts = p.selectedRoom.points;
        const { majorAngleDeg, anisotropy } = computePolygonPrincipalAxes(pts, "obb");
        const cx = pts.reduce((s, pt) => s + pt.x, 0) / pts.length;
        const cy = pts.reduce((s, pt) => s + pt.y, 0) / pts.length;
        const useMajor = anisotropy >= 0.05;
        const rad = ((useMajor ? majorAngleDeg : p.angle) * Math.PI) / 180;
        const c = Math.cos(rad), sn = Math.sin(rad);
        const rxs = pts.map((pt) => (pt.x - cx) * c + (pt.y - cy) * sn);
        const majorSpanM = (Math.max(...rxs) - Math.min(...rxs)) / p.pixelsPerMeter;
        const derivedN = p.gridMode === "width"
          ? Math.max(1, Math.round(majorSpanM / Math.max(0.01, p.gridWidth)))
          : Math.max(1, Math.floor(p.gridCount));
        const effectiveWidth = majorSpanM / derivedN;
        return (
          <>
            <div className="text-[9px] text-slate-500">
              Major axis: {useMajor ? `${majorAngleDeg.toFixed(1)}° (principal)` : `${p.angle}° (isotropic — manual)`}, span {majorSpanM.toFixed(2)} m
            </div>
            <div>
              <span className="text-[10px] text-slate-500">Mode</span>
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={p.gridMode}
                onChange={(e) => p.setGridMode(e.target.value as "count" | "width")}
              >
                <option value="count">Count (n)</option>
                <option value="width">Cell width (m)</option>
              </select>
            </div>
            {p.gridMode === "count" ? (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">n (columns)</span>
                  <span className="font-mono text-[10px] text-slate-700">{p.gridCount} → {2 * p.gridCount} cells</span>
                </div>
                <input
                  type="range"
                  className="w-full"
                  min={1}
                  max={20}
                  step={1}
                  value={p.gridCount}
                  onChange={(e) => p.setGridCount(+e.target.value)}
                />
                <span className="text-[9px] text-slate-400">Cell width ≈ {effectiveWidth.toFixed(2)} m</span>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Cell width</span>
                  <span className="font-mono text-[10px] text-slate-700">{p.gridWidth.toFixed(2)} m → n = {derivedN}</span>
                </div>
                <input
                  type="number"
                  className="h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                  min={0.1}
                  max={Math.max(0.2, majorSpanM)}
                  step={0.05}
                  value={p.gridWidth}
                  onChange={(e) => p.setGridWidth(+e.target.value)}
                />
                <span className="text-[9px] text-slate-400">{2 * derivedN} cells, actual width ≈ {effectiveWidth.toFixed(2)} m</span>
              </div>
            )}
          </>
        );
      })()}

      {p.type === "principal" && (
        <div className="space-y-2">
          <span className="text-[9px] text-slate-400">
            Emit the polygon's long/short principal axes as walls. Major = amber, minor = violet. Live previews softly; Apply commits as real walls and removes the source space.
          </span>
          <div>
            <span className="text-[10px] text-slate-500">Method</span>
            <select
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
              value={p.principalMethod}
              onChange={(e) => p.setPrincipalMethod(e.target.value as PrincipalAxesMethod)}
            >
              <option value="obb">Min-area OBB (best-fit rectangle)</option>
              <option value="pca">PCA (area-weighted moments)</option>
              <option value="skeleton">Straight Skeleton (longest path)</option>
            </select>
          </div>
          {p.principalMethod === "skeleton" && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Simplify</span>
                <span className="font-mono text-[10px] text-slate-700">{p.principalSimplify}%</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={0}
                max={100}
                step={1}
                value={p.principalSimplify}
                onChange={(e) => p.setPrincipalSimplify(+e.target.value)}
              />
              <span className="text-[9px] text-slate-400">
                Visvalingam-Whyatt simplification of the skeleton spine (shared with Skeleton block).
              </span>
            </div>
          )}
          {p.principalMethod !== "skeleton" && (
            <div>
              <span className="text-[10px] text-slate-500">Show</span>
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={p.principalShow}
                onChange={(e) => p.setPrincipalShow(e.target.value as PrincipalAxesShow)}
              >
                <option value="both">Both axes</option>
                <option value="long">Long axis only</option>
                <option value="short">Short axis only</option>
              </select>
            </div>
          )}
          {p.principalMethod !== "skeleton" && (
            <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={p.principalAlignToCenter}
                onChange={(e) => p.setPrincipalAlignToCenter(e.target.checked)}
              />
              Align to Center
              <span
                className="text-[9px] text-slate-400"
                title="Snap each axis to the midpoints of the two edges the principal direction crosses (visually-centered for parallelograms/trapezoids)."
              >
                (edge-midpoints)
              </span>
            </label>
          )}

          {(p.principalMethod === "skeleton" || p.principalShow !== "short") && (
            <>
              <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
                <input
                  type="checkbox"
                  checked={p.principalSubsplit}
                  onChange={(e) => p.setPrincipalSubsplit(e.target.checked)}
                />
                Sub-split
                <span
                  className="text-[9px] text-slate-400"
                  title="Distribute perpendicular cut lines along the long axis. Each cut is a line perpendicular to the major direction, clipped to the polygon."
                >
                  (perpendicular to long axis)
                </span>
              </label>
              {p.principalSubsplit && (
                <div className="ml-4 space-y-1.5 border-l border-slate-200 pl-2">
                  <div>
                    <span className="text-[10px] text-slate-500">Mode</span>
                    <select
                      className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                      value={p.principalSubsplitMode}
                      onChange={(e) => p.setPrincipalSubsplitMode(e.target.value as "count" | "width")}
                    >
                      <option value="count">Count (n)</option>
                      <option value="width">Cell width (m)</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Min cell area</span>
                      <span className="font-mono text-[10px] text-slate-700">{p.principalMinArea.toFixed(1)} m²</span>
                    </div>
                    <input
                      type="number"
                      className="h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                      min={0}
                      step={0.5}
                      value={p.principalMinArea}
                      onChange={(e) => p.setPrincipalMinArea(+e.target.value)}
                    />
                    <span className="text-[9px] text-slate-400">
                      Skip the long-axis slice when either top or bottom cell at that position is below this area.
                    </span>
                  </div>
                  {p.principalSubsplitMode === "count" ? (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">n</span>
                        <span className="font-mono text-[10px] text-slate-700">{p.principalSubsplitCount} → {Math.max(0, p.principalSubsplitCount - 1)} cuts</span>
                      </div>
                      <input
                        type="range"
                        className="w-full"
                        min={1}
                        max={20}
                        step={1}
                        value={p.principalSubsplitCount}
                        onChange={(e) => p.setPrincipalSubsplitCount(+e.target.value)}
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500">Cell width</span>
                        <span className="font-mono text-[10px] text-slate-700">{p.principalSubsplitWidth.toFixed(2)} m</span>
                      </div>
                      <input
                        type="number"
                        className="h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                        min={0.1}
                        step={0.05}
                        value={p.principalSubsplitWidth}
                        onChange={(e) => p.setPrincipalSubsplitWidth(+e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

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

      {/* Result polygons — live vertices + area for each piece the current parameters
       *  would produce. Mirrors the committing runner's cut math, so this preview matches
       *  what Apply Split commits. Recomputed every render → updates as parameters change. */}
      {(() => {
        const pieces = computeSplitPolygons(p.selectedRoom.points, p.pixelsPerMeter, {
          type: p.type,
          mode: p.mode,
          count: p.count,
          ratios: p.ratios,
          target: p.target,
          lengths: p.lengths,
          angle: p.angle,
          edge: p.edge,
          edgeFlip: p.edgeFlip,
          alongMinorPrincipalAxis: p.alongMinorPrincipalAxis,
          stripLength: p.stripLength,
          stripPosition: p.stripPosition,
        });
        const totalM2 = pieces?.reduce((s, pc) => s + pc.areaM2, 0) ?? 0;
        return (
          <div className="space-y-1.5 rounded bg-slate-50 px-1.5 py-1">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                Result polygons (m)
              </span>
              {pieces && (
                <span className="font-mono text-[9px] text-slate-500">
                  {pieces.length} pcs · Σ {totalM2.toFixed(2)} m²
                </span>
              )}
            </div>
            {pieces ? (
              pieces.map((pc, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-slate-600">Piece {i + 1}</span>
                    <span className="font-mono text-[10px] text-slate-800">{pc.areaM2.toFixed(2)} m²</span>
                  </div>
                  <VertexList pts={pc.pts} ppm={p.pixelsPerMeter} />
                </div>
              ))
            ) : (
              <div className="text-[9px] italic text-slate-400">
                {p.type === "grid" || p.type === "principal"
                  ? "Piece list not available for this split type."
                  : "—"}
              </div>
            )}
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
