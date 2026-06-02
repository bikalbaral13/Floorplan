import type { Point } from "../../types";
import { polygonArea } from "./polygon";
import { computePolygonPrincipalAxes } from "./principalAxes";
import { sutherlandHodgmanClip } from "./sutherlandHodgman";

/** Parameters describing a split, mirroring the state the Splitting Actions block holds.
 *  Only the parameters consumed by the committing runner (`runRoomSplit`) are needed —
 *  i.e. the "normal" and "strip" types and the equal/ratio/target/length sizing modes. */
export interface SplitPolygonParams {
  type: "normal" | "strip" | "grid" | "principal";
  mode: "equal" | "ratio" | "target" | "length";
  count: number;
  ratios: number[];
  target: number;        // m²
  lengths: number[];     // m
  angle: number;         // degrees
  edge: number | null;
  edgeFlip: boolean;
  alongMinorPrincipalAxis: boolean;
  stripLength: number;   // m
  stripPosition: number; // 0..100 (%)
}

/** A single resulting piece of a split: its polygon (world-pixel coords) + area (m²). */
export interface SplitPiece {
  pts: Point[];
  areaM2: number;
}

/**
 * Given a polygon in the rotated splitting frame (cut lines are vertical, i.e. constant x),
 * return the axis x-positions where a vertical cut leaves `cumFracs[i]` of the *total area* to
 * its left. Used so "equal"/"ratio"/"target" sizing splits by AREA rather than by axis length —
 * essential for non-rectangular shapes where equal length bands have unequal areas.
 *
 * The cumulative-area-to-the-left function is monotonic in x, so each cut is found by binary
 * search on the slab-clipped area.
 */
export const areaProportionalCuts = (
  rotated: Point[],
  axisMin: number,
  axisMax: number,
  cumFracs: number[],
): number[] => {
  const rys = rotated.map((p) => p.y);
  const yPad = (Math.max(...rys) - Math.min(...rys)) + 10;
  const yLo = Math.min(...rys) - yPad;
  const yHi = Math.max(...rys) + yPad;
  const totalArea = polygonArea(rotated); // rotation preserves area
  if (totalArea <= 0) return cumFracs.map((f) => axisMin + f * (axisMax - axisMin));

  const leftAreaAt = (x: number): number => {
    const slab: Point[] = [
      { x: axisMin - 1, y: yLo },
      { x, y: yLo },
      { x, y: yHi },
      { x: axisMin - 1, y: yHi },
    ];
    const clipped = sutherlandHodgmanClip(rotated, slab);
    return clipped.length < 3 ? 0 : polygonArea(clipped);
  };

  return cumFracs.map((f) => {
    const targetArea = f * totalArea;
    let lo = axisMin, hi = axisMax;
    for (let it = 0; it < 48; it++) {
      const mid = (lo + hi) / 2;
      if (leftAreaAt(mid) < targetArea) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  });
};

/**
 * Compute the sub-polygons a split would produce, *exactly* mirroring the cut math in
 * `FloorPlanEditor.runRoomSplit` so the readout can never diverge from what gets committed.
 *
 * The runner only draws parallel cut lines (perpendicular to the splitting axis) and relies on
 * room re-detection to form the actual pieces. Here we reproduce those cuts and recover the
 * pieces directly by clipping the polygon to each band (convex-slab clip — exact for convex
 * polygons, the common floorplate/site case).
 *
 * Returns `null` for modes the committing runner does not implement (grid / principal) or when
 * the polygon is degenerate.
 */
export const computeSplitPolygons = (
  polygon: Point[],
  ppm: number,
  params: SplitPolygonParams,
): SplitPiece[] | null => {
  const pts = polygon;
  if (pts.length < 3 || ppm <= 0) return null;
  // Grid / principal aren't emitted as plain parallel cuts by the runner — skip the readout.
  if (params.type === "grid" || params.type === "principal") return null;

  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;

  // Stacking direction. When "split along minor principal axis" is on, cut lines run along the
  // minor axis and pieces stack along the MAJOR axis (matches the runner). Near-isotropic
  // polygons fall back to the manual angle.
  let effectiveAngle = params.angle;
  if (params.alongMinorPrincipalAxis) {
    const { majorAngleDeg, anisotropy } = computePolygonPrincipalAxes(pts);
    if (anisotropy >= 0.05) effectiveAngle = majorAngleDeg;
  }

  const rad = (effectiveAngle * Math.PI) / 180;
  const cosA = Math.cos(rad), sinA = Math.sin(rad);
  const rotated = pts.map((p) => ({
    x: (p.x - cx) * cosA + (p.y - cy) * sinA,
    y: -(p.x - cx) * sinA + (p.y - cy) * cosA,
  }));
  const rxs = rotated.map((p) => p.x);
  const rys = rotated.map((p) => p.y);
  const axisMin = Math.min(...rxs);
  const axisMax = Math.max(...rxs);
  const axisLen = axisMax - axisMin;
  if (axisLen <= 0) return null;

  // --- Fractions per sizing mode (identical to the runner). ---
  const { mode, count } = params;
  let fracs: number[] = [];
  if (mode === "equal") {
    fracs = Array.from({ length: count }, () => 1 / count);
  } else if (mode === "ratio") {
    const arr = Array.from({ length: count }, (_, i) => Math.max(1, params.ratios[i] ?? 0));
    const sum = arr.reduce((s, v) => s + v, 0);
    fracs = arr.map((v) => v / sum);
  } else if (mode === "target") {
    const polyAreaM2 = polygonArea(pts) / (ppm * ppm);
    const firstFrac = polyAreaM2 > 0 ? Math.max(0.05, Math.min(0.95, params.target / polyAreaM2)) : 1 / count;
    const remain = (1 - firstFrac) / Math.max(1, count - 1);
    fracs = [firstFrac, ...Array.from({ length: count - 1 }, () => remain)];
  } else {
    // length mode
    if (params.edge !== null && params.edge >= 0 && params.edge < pts.length) {
      fracs = Array.from({ length: count }, () => 1 / count); // placeholder; cuts computed below
    } else {
      const axisLenM = axisLen / ppm;
      const userFracs: number[] = [];
      let used = 0;
      for (let i = 0; i < count - 1; i++) {
        const Lm = Math.max(0.01, params.lengths[i] ?? 0);
        userFracs.push(Lm / axisLenM);
        used += Lm / axisLenM;
      }
      if (used >= 0.98) {
        const sum = userFracs.reduce((s, v) => s + v, 0) || 1;
        fracs = userFracs.map((v) => v / sum);
      } else {
        fracs = [...userFracs, 1 - used];
      }
      if (params.edgeFlip) fracs = fracs.reverse();
    }
  }

  // --- Cut positions along the rotated axis (identical to the runner). ---
  let cuts: number[];
  if (params.type === "strip") {
    const stripPx = Math.max(0.01, params.stripLength) * ppm;
    const t = Math.max(0, Math.min(100, params.stripPosition)) / 100;
    let centerX: number;
    if (params.edge !== null && params.edge >= 0 && params.edge < pts.length) {
      const ev = pts[params.edge], ew = pts[(params.edge + 1) % pts.length];
      const originPt = params.edgeFlip ? ew : ev;
      const originX = (originPt.x - cx) * cosA + (originPt.y - cy) * sinA;
      const direction = params.edgeFlip ? -1 : 1;
      centerX = originX + direction * (t * axisLen);
    } else {
      centerX = axisMin + t * axisLen;
    }
    cuts = [centerX - stripPx / 2, centerX + stripPx / 2].filter((x) => x > axisMin + 0.01 && x < axisMax - 0.01);
  } else if (mode === "length" && params.edge !== null && params.edge >= 0 && params.edge < pts.length) {
    const ev = pts[params.edge], ew = pts[(params.edge + 1) % pts.length];
    const originPt = params.edgeFlip ? ew : ev;
    const originX = (originPt.x - cx) * cosA + (originPt.y - cy) * sinA;
    const direction = params.edgeFlip ? -1 : 1;
    cuts = [];
    let cumPx = 0;
    for (let i = 0; i < count - 1; i++) {
      cumPx += Math.max(0.01, params.lengths[i] ?? 0) * ppm;
      cuts.push(originX + direction * cumPx);
    }
    cuts = cuts.filter((x) => x > axisMin + 0.01 && x < axisMax - 0.01);
  } else if (mode === "length") {
    // length-proportional cuts: fractions map directly to axis length.
    cuts = [];
    let acc = axisMin;
    for (let i = 0; i < fracs.length - 1; i++) { acc += fracs[i] * axisLen; cuts.push(acc); }
  } else {
    // equal / ratio / target → AREA-proportional cuts.
    const cum: number[] = [];
    let a = 0;
    for (let i = 0; i < fracs.length - 1; i++) { a += fracs[i]; cum.push(a); }
    cuts = areaProportionalCuts(rotated, axisMin, axisMax, cum)
      .filter((x) => x > axisMin + 0.01 && x < axisMax - 0.01);
  }

  // --- Recover pieces by clipping the polygon to each band between consecutive cuts. ---
  const unrotate = (p: Point): Point => ({
    x: p.x * cosA - p.y * sinA + cx,
    y: p.x * sinA + p.y * cosA + cy,
  });
  const yPad = (Math.max(...rys) - Math.min(...rys)) + 10;
  const yLo = Math.min(...rys) - yPad;
  const yHi = Math.max(...rys) + yPad;

  // Boundary x-values: outer span plus interior cuts, sorted & de-duplicated.
  const bounds = [axisMin, ...cuts, axisMax]
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const pieces: SplitPiece[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    if (hi - lo < 0.5) continue; // skip slivers
    const slab: Point[] = [
      { x: lo, y: yLo },
      { x: hi, y: yLo },
      { x: hi, y: yHi },
      { x: lo, y: yHi },
    ];
    const clippedRot = sutherlandHodgmanClip(rotated, slab);
    if (clippedRot.length < 3) continue;
    const worldPts = clippedRot.map(unrotate);
    const areaM2 = polygonArea(worldPts) / (ppm * ppm);
    if (areaM2 < 1e-4) continue;
    pieces.push({ pts: worldPts, areaM2 });
  }

  return pieces.length > 0 ? pieces : null;
};
