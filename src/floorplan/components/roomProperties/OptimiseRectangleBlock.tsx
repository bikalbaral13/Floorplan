import { useState, useMemo, useRef, useEffect } from "react";
import Konva from "konva";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Point } from "../../types";
import { computeOptimiseRect } from "../../algorithms/layout/optimiseRect";
import { classifyRectilinearPolygon, scorePolygonAgainstShape } from "../../algorithms/geometry/rectilinearShapeClassifier";
import { clipPolygonByHalfPlane } from "../../algorithms/partitioning/voronoi";

/** Render a single variation to an offscreen Konva Stage and return a PNG data URL.
 *  Mirrors the main canvas's styling (dark room outline + light fill, amber placed
 *  rectangles with mitered joins) so the thumbnails feel like real canvas snapshots
 *  rather than wireframes. The container div is mounted at a far-offscreen position
 *  so the stage has real layout dimensions but is invisible to the user. */
const renderVariationPng = (
  polygon: Point[],
  placed: Point[][],
  unionPolygon: Point[] | null,
  count: number,
  sizePx: number,
): string => {
  // Off-screen container — Konva needs a real DOM node with width/height to draw.
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-100000px";
  container.style.top = "0";
  container.style.width = `${sizePx}px`;
  container.style.height = `${sizePx}px`;
  container.style.pointerEvents = "none";
  document.body.appendChild(container);

  try {
    const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    // Fit-to-thumbnail with 6% padding on each side.
    const pad = sizePx * 0.06;
    const scale = Math.min((sizePx - 2 * pad) / w, (sizePx - 2 * pad) / h);
    const offsetX = (sizePx - w * scale) / 2 - minX * scale;
    const offsetY = (sizePx - h * scale) / 2 - minY * scale;

    const stage = new Konva.Stage({ container, width: sizePx, height: sizePx });
    const layer = new Konva.Layer();
    stage.add(layer);

    // White background.
    layer.add(new Konva.Rect({ x: 0, y: 0, width: sizePx, height: sizePx, fill: "#ffffff" }));

    // Room polygon — slate fill + dark stroke (match main canvas room rendering).
    const polyPoints: number[] = [];
    for (const pt of polygon) {
      polyPoints.push(pt.x * scale + offsetX, pt.y * scale + offsetY);
    }
    layer.add(new Konva.Line({
      points: polyPoints,
      closed: true,
      fill: "rgba(148, 163, 184, 0.25)",
      stroke: "#1e293b",
      strokeWidth: 2,
      lineJoin: "round",
    }));

    // Union outline (only when count >= 2 — single merged polyomino) drawn beneath
    // the per-rect outlines so individual decomposition is still visible.
    if (count >= 2 && unionPolygon && unionPolygon.length >= 3) {
      const uPoints: number[] = [];
      for (const pt of unionPolygon) uPoints.push(pt.x * scale + offsetX, pt.y * scale + offsetY);
      layer.add(new Konva.Line({
        points: uPoints,
        closed: true,
        fill: "rgba(245, 158, 11, 0.45)",
        stroke: "#92400e",
        strokeWidth: 3,
        lineJoin: "round",
      }));
    }

    // Per-rectangle outlines — for count=1 the rect is filled solid amber; for
    // count>=2 they're translucent so the union fill shines through.
    for (const corners of placed) {
      const cPoints: number[] = [];
      for (const pt of corners) cPoints.push(pt.x * scale + offsetX, pt.y * scale + offsetY);
      layer.add(new Konva.Line({
        points: cPoints,
        closed: true,
        fill: count >= 2 ? "rgba(245, 158, 11, 0.20)" : "rgba(245, 158, 11, 0.55)",
        stroke: "#b45309",
        strokeWidth: 2.5,
        lineJoin: "round",
      }));
    }

    layer.draw();
    // pixelRatio 2 → crisp on HiDPI displays; doubles the bitmap dimensions.
    const url = stage.toDataURL({ pixelRatio: 2 });
    stage.destroy();
    return url;
  } finally {
    document.body.removeChild(container);
  }
};

export type OptimiseRectShape = "rectangle" | "square" | "hexagon" | "lshape";
export type OptimiseRectReference = "none" | "custom" | number;

/** A single thumbnail variation: a fully-specified set of optimise-rect params.
 *  All variations are constrained to shape="rectangle". When count >= 2 the
 *  union outline is rendered (per the user's spec — union always true). */
type SeedVariation = {
  label: string;
  count: 1 | 2 | 3;
  reference: OptimiseRectReference;
  axisAngleDeg: number;
};

/** Build the variation set from the polygon's available edges + count/tilt grid.
 *  Page 0: count {1,2,3} × tilt {0°, 90°} = 6 thumbnails (custom-angle anchored).
 *  Page 1+: same counts, but reference shifts to a polygon edge per page (one
 *  edge index covered per page). Lets the user browse edge alignments without
 *  blowing the strip up to N×3 thumbnails on screen at once. */
const buildVariations = (numEdges: number, page: number): SeedVariation[] => {
  if (page <= 0) {
    return [
      { label: "1×, 0°",  count: 1, reference: "custom", axisAngleDeg: 0 },
      { label: "1×, 90°", count: 1, reference: "custom", axisAngleDeg: 90 },
      { label: "2×, 0°",  count: 2, reference: "custom", axisAngleDeg: 0 },
      { label: "2×, 90°", count: 2, reference: "custom", axisAngleDeg: 90 },
      { label: "3×, 0°",  count: 3, reference: "custom", axisAngleDeg: 0 },
      { label: "3×, 90°", count: 3, reference: "custom", axisAngleDeg: 90 },
    ];
  }
  // Page i (1-indexed) anchors all 3 counts to edge index (i-1) % numEdges.
  // Two thumbnails per count covering tilt 0° (edge-aligned) plus a perpendicular
  // variant via edge angle + 90° offset (axisAngleDeg ignored when ref=number).
  const edgeIdx = (page - 1) % Math.max(1, numEdges);
  return [
    { label: `1×, edge ${edgeIdx}`,  count: 1, reference: edgeIdx, axisAngleDeg: 0 },
    { label: `2×, edge ${edgeIdx}`,  count: 2, reference: edgeIdx, axisAngleDeg: 0 },
    { label: `3×, edge ${edgeIdx}`,  count: 3, reference: edgeIdx, axisAngleDeg: 0 },
  ];
};

export interface OptimiseRectangleBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  shape: OptimiseRectShape;
  setShape: (v: OptimiseRectShape) => void;
  reference: OptimiseRectReference;
  setReference: (v: OptimiseRectReference) => void;
  axisAngle: number;
  setAxisAngle: (v: number) => void;
  count: number;
  setCount: (v: number) => void;
  minArea: number;
  setMinArea: (v: number) => void;
  union: boolean;
  setUnion: (v: boolean) => void;
  /** Target area in m² — bisects the union polygon into a green "filled" sub-polygon (= target)
   *  and a red remainder. Pure visualization. Mirrors the Fill Area block: independent Live
   *  toggle, Apply persists per room, Clear removes the persisted entry. */
  targetArea: number;
  setTargetArea: (v: number) => void;
  /** Bisection axis (deg) used for the target-area split. Cut line is perpendicular to this. */
  targetTilt: number;
  setTargetTilt: (v: number) => void;
  /** Independent Live toggle for the target-area overlay. */
  targetLive: boolean;
  setTargetLive: (v: boolean) => void;
  /** Persist the current target+tilt on the selected room. */
  onTargetApply: () => void;
  /** Drop the persisted entry for the selected room. */
  onTargetClear: () => void;
  /** Whether a committed target entry currently exists for the selected room. */
  hasCommittedTarget: boolean;
  /** Shrink: when enabled, the runner clips the room polygon along `shrinkAngle` and binary-searches
   *  the cut distance until the largest inscribed rectangle's area matches `targetArea`. */
  shrinkEnabled: boolean;
  setShrinkEnabled: (v: boolean) => void;
  shrinkAngle: number;
  setShrinkAngle: (v: number) => void;
  /** 0–100 percentage along `shrinkAngle` at which the cut line sits. 0 = no clip, 100 = fully cut. */
  shrinkSlide: number;
  setShrinkSlide: (v: number) => void;
  /** When ticked, the runner overrides the manual slide and auto-searches the cut to hit targetArea. */
  optimiseShrinkEnabled: boolean;
  setOptimiseShrinkEnabled: (v: boolean) => void;
  /** Auto-found slide percentage (read-only display when optimiseShrinkEnabled). */
  solvedShrinkSlide: number;
  /** Post-scale the placed rectangle(s) about their union centroid so the total area
   *  matches `targetArea` exactly. Trades the "strictly inscribed" guarantee for an
   *  exact area readout — the rectangle may protrude past the shrunk polygon by ≤ a
   *  few percent of its dimensions. Only meaningful when shrink-to-target is on. */
  exactArea: boolean;
  setExactArea: (v: boolean) => void;
  // ── Target area auto-derive from GCR ──────────────────────────────────────
  /** When on, target area is auto-set to (GCR % × site area) from the INPUTS block;
   *  the manual target-area slider is hidden. */
  targetFromGcr: boolean;
  setTargetFromGcr: (v: boolean) => void;
  /** Derived target area (m²) from plot-boundary GCR × site area; null when missing. */
  gcrTargetAreaSqm: number | null;
  runRoomOptimiseRect: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Drop preview walls and any cached optimise-union polygon, then bump live tick. */
  onLiveOff: () => void;
  /** Monotonic counter — each increment opens the layout-variations modal externally
   *  (used by the Apply-JSON `pickVariation: true` directive). 0 = never opened. */
  openVariationsTick?: number;
}

export const OptimiseRectangleBlock = (p: OptimiseRectangleBlockProps) => {
  // Keep targetArea synced with the GCR-derived value whenever "Get target area from GCR"
  // is on and the derived value drifts (e.g. user edits GCR % or the plot polygon changes).
  useEffect(() => {
    if (!p.targetFromGcr) return;
    if (p.gcrTargetAreaSqm == null) return;
    if (Math.abs(p.gcrTargetAreaSqm - p.targetArea) < 0.05) return;
    p.setTargetArea(p.gcrTargetAreaSqm);
  }, [p, p.targetFromGcr, p.gcrTargetAreaSqm, p.targetArea, p.setTargetArea]);

  // Layout-seed variation modal — pops a wide dialog with bigger thumbnails so the
  // user can visually compare (count, reference, tilt) combinations side-by-side.
  // Click-applies-immediately with live canvas feedback; Cancel restores the
  // pre-open snapshot so browsing is reversible.
  const [seedStripOpen, setSeedStripOpen] = useState(false);
  const [seedStripPage, setSeedStripPage] = useState(0);
  // Snapshot of the optimise-rect params at the moment the dialog opened.
  // Used by Cancel to revert any browsing edits.
  const preOpenSnapshot = useRef<{
    shape: OptimiseRectShape;
    reference: OptimiseRectReference;
    axisAngle: number;
    count: number;
    union: boolean;
  } | null>(null);

  // L-shape mode: clamp count to 2 and force union on. Runs whenever the shape
  // selector flips to lshape, so toggling into L-shape resets these constraints.
  useEffect(() => {
    if (p.shape !== "lshape") return;
    if (p.count !== 2) p.setCount(2);
    if (!p.union) p.setUnion(true);
    // L-shape requires reference != "none" so the union path runs (the algorithm
    // gates union on reference !== "none"). Default to custom angle if none.
    if (p.reference === "none") p.setReference("custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.shape]);

  // Apply the same shrink half-plane clip as the runner uses, so the status
  // preview sees the polygon the packer will actually see. slide<=0 is a no-op.
  const applyShrinkClip = (pts: Point[], angleDeg: number, slidePct: number): Point[] => {
    if (slidePct <= 0) return pts;
    const rad = (angleDeg * Math.PI) / 180;
    const nx = Math.cos(rad), ny = Math.sin(rad);
    const projs = pts.map((q) => q.x * nx + q.y * ny);
    const pMin = Math.min(...projs), pMax = Math.max(...projs);
    const c = pMax - (Math.min(100, Math.max(0, slidePct)) / 100) * (pMax - pMin);
    const clipped = clipPolygonByHalfPlane(pts, c * nx, c * ny, -nx, -ny);
    return clipped.length >= 3 ? clipped : pts;
  };

  // Live classification of the union polygon at the current tilt + shrink-angle.
  // Purely informational — re-runs whenever a slider changes and reports the
  // best-matching preset name plus topology (n vertices, r reflex). No snap.
  const unionShapeLabel = useMemo<string | null>(() => {
    if (p.shape !== "lshape" || p.reference === "none") return null;
    if (p.selectedRoom.points.length < 3) return null;
    const sourcePts = p.shrinkEnabled
      ? applyShrinkClip(p.selectedRoom.points, p.shrinkAngle, p.shrinkSlide)
      : p.selectedRoom.points;
    if (sourcePts.length < 3) return "shrink clipped polygon away";
    const result = computeOptimiseRect({
      pts: sourcePts,
      shape: "lshape",
      reference: p.reference,
      axisAngleDeg: p.axisAngle,
      count: 2,
      minAreaPx: 0,
      union: true,
      silent: true,
    }, { thickness: 1, mode: "line" });
    if (!result.unionOutlineLocal || result.unionOutlineLocal.length < 4) {
      return "no union outline";
    }
    try {
      const cls = classifyRectilinearPolygon(result.unionOutlineLocal);
      return `${cls.best.name} (n=${cls.signature.n}, r=${cls.signature.reflexCount})`;
    } catch {
      return "classify error";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.shape, p.reference, p.axisAngle, p.shrinkAngle, p.shrinkEnabled, p.shrinkSlide, p.selectedRoom.points]);

  // External trigger — Apply-JSON's `pickVariation: true` directive bumps the tick
  // to open the modal without simulating a click on the trigger button.
  useEffect(() => {
    if (!p.openVariationsTick || p.openVariationsTick <= 0) return;
    preOpenSnapshot.current = {
      shape: p.shape,
      reference: p.reference,
      axisAngle: p.axisAngle,
      count: p.count,
      union: p.union,
    };
    setSeedStripPage(0);
    setSeedStripOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.openVariationsTick]);

  // Compute thumbnail geometry for each variation. Calls the pure
  // `computeOptimiseRect` algorithm (no React state, no history mutation) so
  // each thumbnail shows the actual placement that would be applied. Cached
  // until polygon or page changes — keeps slider drags cheap.
  const variations = useMemo(
    () => buildVariations(p.selectedRoom.points.length, seedStripPage),
    [p.selectedRoom.points.length, seedStripPage],
  );
  const thumbs = useMemo(() => {
    if (!seedStripOpen) return [] as Array<{ v: SeedVariation; placed: Point[][]; union: Point[] | null }>;
    return variations.map((v) => {
      // For thumbnails we don't need real wall geometry — just the placed shapes.
      // The wallStyle is inert (mode/thickness don't affect `placed[]` output).
      const result = computeOptimiseRect({
        pts: p.selectedRoom.points,
        shape: "rectangle",
        reference: v.reference,
        axisAngleDeg: v.axisAngleDeg,
        count: v.count,
        minAreaPx: 0,
        union: v.count >= 2,
        silent: true,
      }, { thickness: 1, mode: "line" });
      return { v, placed: result.placed, union: result.unionPolygon };
    });
  }, [seedStripOpen, variations, p.selectedRoom.points]);

  // Snapshot each variation as a PNG via off-screen Konva. Runs once per dialog
  // open / page change. Stored as data URLs and consumed by `<img>` in the grid.
  const [thumbPngs, setThumbPngs] = useState<string[]>([]);
  useEffect(() => {
    if (!seedStripOpen || thumbs.length === 0) { setThumbPngs([]); return; }
    let cancelled = false;
    // Defer to the next frame so the dialog opens snappily; PNG generation runs
    // after paint. Each variation is ~5-15ms so 6 thumbnails is ~60-90ms total.
    const id = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const urls = thumbs.map(({ v, placed, union }) =>
        renderVariationPng(p.selectedRoom.points, placed, union, v.count, 280),
      );
      if (!cancelled) setThumbPngs(urls);
    });
    return () => { cancelled = true; window.cancelAnimationFrame(id); };
  }, [seedStripOpen, thumbs, p.selectedRoom.points]);

  // Click handler: write the variation's params back to parent state and trigger
  // a fresh optimise-rect run (silent so it lays a preview, mirrors the existing
  // slider-driven flow). When count >= 2 the union flag is forced on per spec.
  const applyVariation = (v: SeedVariation) => {
    p.setShape("rectangle");
    p.setReference(v.reference);
    p.setAxisAngle(v.axisAngleDeg);
    p.setCount(v.count);
    p.setUnion(v.count >= 2);
    p.runRoomOptimiseRect(p.selectedRoom, true);
  };

  // Active variation = does any thumbnail's params exactly match the current state?
  // Lets us highlight the live selection in the strip.
  const isActive = (v: SeedVariation) =>
    p.shape === "rectangle" &&
    p.count === v.count &&
    p.reference === v.reference &&
    (typeof v.reference === "number" || Math.abs(p.axisAngle - v.axisAngleDeg) < 0.5) &&
    (v.count < 2 || p.union === true);

  return (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Optimise Rectangle</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div>
        <span className="text-[10px] text-slate-500">Shape</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.shape}
          onChange={(e) => p.setShape(e.target.value as OptimiseRectShape)}
        >
          <option value="rectangle">Rectangle (independent w × h)</option>
          <option value="square">Square (w = h)</option>
          <option value="hexagon">Hexagon (honeycomb lattice)</option>
          <option value="lshape">L-shape (2 rectangles, classified union)</option>
        </select>
      </div>
      <div>
        <span className="text-[10px] text-slate-500">Reference</span>
        <select
          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
          value={p.reference === "none" ? "none" : p.reference === "custom" ? "custom" : String(p.reference)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "none") p.setReference("none");
            else if (v === "custom") p.setReference("custom");
            else p.setReference(Number(v));
          }}
        >
          <option value="none">None (any-angle search)</option>
          <option value="custom">— Custom angle —</option>
          {p.selectedRoom.points.map((pt, i) => {
            const q = p.selectedRoom.points[(i + 1) % p.selectedRoom.points.length];
            const Lm = Math.hypot(q.x - pt.x, q.y - pt.y) / p.pixelsPerMeter;
            return <option key={i} value={String(i)}>{`Edge ${i} — ${Lm.toFixed(2)} m`}</option>;
          })}
        </select>
      </div>
      {p.reference === "custom" && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Axis tilt</span>
            <span className="font-mono text-[10px] text-slate-700">{p.axisAngle.toFixed(1)}°</span>
          </div>
          <input type="range" className="w-full" min={0} max={90} step={0.1}
            value={p.axisAngle} onChange={(e) => p.setAxisAngle(+e.target.value)} />
          {p.shape === "lshape" && unionShapeLabel && (
            <div className="mt-1 flex items-center gap-1">
              <span className="text-[10px] text-slate-500">Union shape:</span>
              <span className="font-mono text-[10px] text-slate-800">{unionShapeLabel}</span>
            </div>
          )}
        </div>
      )}
      {typeof p.reference === "number" && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Axis tilt (from edge)</span>
          <span className="font-mono text-[10px] text-slate-700">{p.axisAngle.toFixed(3)}°</span>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">Rectangles (n){p.shape === "lshape" ? " — locked at 2" : ""}</span>
          <span className="font-mono text-[10px] text-slate-700">{p.count}</span>
        </div>
        <input type="range" className="w-full" min={1} max={20} step={1}
          value={p.count}
          disabled={p.shape === "lshape"}
          onChange={(e) => p.setCount(+e.target.value)} />
        {p.shape === "lshape" && (
          <span className="text-[9px] text-slate-400">L-shape mode places exactly 2 rectangles.</span>
        )}
      </div>
      {p.count > 1 && p.reference !== "none" && (
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.union}
            disabled={p.shape === "lshape"}
            onChange={(e) => p.setUnion(e.target.checked)}
          />
          Union{p.shape === "lshape" ? " (forced on for L-shape)" : ""}
          <span className="text-[9px] text-slate-400">(show combined outline of N rectangles)</span>
        </label>
      )}
      <div className="mt-1 rounded border border-slate-100 bg-slate-50 p-1.5 space-y-1">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Target area</span>
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input type="checkbox" checked={p.shrinkEnabled} onChange={(e) => p.setShrinkEnabled(e.target.checked)} />
          Shrink to target area
        </label>
        {p.shrinkEnabled && (
          <>
            <label className="flex items-center gap-1 text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={p.targetFromGcr}
                onChange={(e) => {
                  const on = e.target.checked;
                  p.setTargetFromGcr(on);
                  // When turning on with a derived value available, push it into targetArea so
                  // the runner picks it up immediately. Sync also happens via the live cascade.
                  if (on && p.gcrTargetAreaSqm != null) p.setTargetArea(p.gcrTargetAreaSqm);
                }}
              />
              Get target area from GCR
            </label>
            {p.targetFromGcr ? (
              <div className="rounded bg-slate-50 px-1.5 py-1 text-[9px] text-slate-500 leading-tight">
                {p.gcrTargetAreaSqm == null ? (
                  <span className="text-amber-600">
                    Set GCR (%) on the plot-boundary in the INPUTS block.
                  </span>
                ) : (
                  <>
                    Target = GCR × site area = <span className="font-mono text-slate-700">{p.gcrTargetAreaSqm.toFixed(1)} m²</span>
                  </>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Target area</span>
                  <span className="font-mono text-[10px] text-slate-700">{p.targetArea.toFixed(1)} m²</span>
                </div>
                <input type="range" className="w-full" min={0} max={500} step={0.5}
                  value={p.targetArea} onChange={(e) => p.setTargetArea(+e.target.value)} />
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Shrink angle</span>
                <span className="font-mono text-[10px] text-slate-700">{p.shrinkAngle}°</span>
              </div>
              <input type="range" className="w-full" min={0} max={360} step={1}
                value={p.shrinkAngle} onChange={(e) => p.setShrinkAngle(+e.target.value)} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Shrink slide{p.optimiseShrinkEnabled ? " (auto)" : ""}</span>
                <span className="font-mono text-[10px] text-slate-700">
                  {(p.optimiseShrinkEnabled ? p.solvedShrinkSlide : p.shrinkSlide).toFixed(1)}%
                </span>
              </div>
              <input type="range" className="w-full" min={0} max={100} step={0.1}
                value={p.optimiseShrinkEnabled ? p.solvedShrinkSlide : p.shrinkSlide}
                onChange={(e) => p.setShrinkSlide(+e.target.value)}
                disabled={p.optimiseShrinkEnabled}
                readOnly={p.optimiseShrinkEnabled}
              />
            </div>
            <label className="flex items-center gap-1 text-[10px] text-slate-600">
              <input type="checkbox" checked={p.optimiseShrinkEnabled} onChange={(e) => p.setOptimiseShrinkEnabled(e.target.checked)} />
              Optimise shrink (auto-fit slide to target area)
            </label>
            <label className="flex items-center gap-1 text-[10px] text-slate-600">
              <input type="checkbox" checked={p.exactArea} onChange={(e) => p.setExactArea(e.target.checked)} />
              Exact area (post-scale to match target — may protrude slightly)
            </label>
            <Button
              variant="outline"
              size="sm"
              className="w-full text-[11px]"
              onClick={p.onTargetApply}
            >
              Apply
            </Button>
            {p.hasCommittedTarget && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={p.onTargetClear}
              >
                Clear committed target
              </Button>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomOptimiseRect(p.selectedRoom, true);
              else p.onLiveOff();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on type change" : "click Optimise"}</span>
      </div>
      {/* Layout-seed variation trigger — opens a modal with bigger side-by-side thumbnails. */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-full text-[11px]"
        onClick={() => {
          // Snapshot current params so Cancel can roll back any browsing edits.
          preOpenSnapshot.current = {
            shape: p.shape,
            reference: p.reference,
            axisAngle: p.axisAngle,
            count: p.count,
            union: p.union,
          };
          setSeedStripPage(0);
          setSeedStripOpen(true);
        }}
      >
        Show layout variations
      </Button>
    </>}

    {/* Variation modal — wide dialog, 3-up grid of large thumbnails. Click a
        thumbnail to apply its (count, reference, tilt) combo to the live canvas.
        Cancel restores the pre-open snapshot; Done closes the dialog keeping
        the active selection. */}
    <Dialog open={seedStripOpen} onOpenChange={setSeedStripOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Layout Variations — Optimise Rectangle</DialogTitle>
        </DialogHeader>
        {(() => {
          const pts = p.selectedRoom.points;
          if (pts.length < 3) return <p className="text-sm text-slate-500">Select a room polygon with at least 3 vertices.</p>;
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {thumbs.map(({ v }, i) => {
                  const active = isActive(v);
                  const pngUrl = thumbPngs[i];
                  return (
                    <button
                      key={`${v.count}-${v.reference}-${v.axisAngleDeg}-${i}`}
                      type="button"
                      onClick={() => applyVariation(v)}
                      className={`group relative aspect-square overflow-hidden rounded-lg border-2 bg-white transition ${
                        active
                          ? "border-amber-500 ring-4 ring-amber-200"
                          : "border-slate-200 hover:border-amber-400 hover:shadow-md"
                      }`}
                      title={v.label}
                    >
                      {pngUrl ? (
                        <img
                          src={pngUrl}
                          alt={v.label}
                          className="h-full w-full object-contain"
                          draggable={false}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                          Rendering…
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-md bg-white/90 px-2 py-0.5 text-xs font-mono font-semibold text-slate-700 shadow-sm">
                        {v.label}
                      </span>
                      {active && (
                        <span className="absolute top-2 left-2 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
                          Active
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={seedStripPage <= 0}
                  onClick={() => setSeedStripPage((s) => Math.max(0, s - 1))}
                >
                  ◀ Prev
                </Button>
                <span className="text-xs text-slate-500">
                  {seedStripPage === 0 ? "Custom angles (0° / 90°)" : `Edge ${(seedStripPage - 1) % Math.max(1, pts.length)} alignment`}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={seedStripPage >= pts.length}
                  onClick={() => setSeedStripPage((s) => s + 1)}
                >
                  Next ▶
                </Button>
              </div>
            </div>
          );
        })()}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              // Restore the params snapshot taken when the dialog opened.
              const snap = preOpenSnapshot.current;
              if (snap) {
                p.setShape(snap.shape);
                p.setReference(snap.reference);
                p.setAxisAngle(snap.axisAngle);
                p.setCount(snap.count);
                p.setUnion(snap.union);
                p.runRoomOptimiseRect(p.selectedRoom, true);
              }
              setSeedStripOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={() => setSeedStripOpen(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
  );
};
