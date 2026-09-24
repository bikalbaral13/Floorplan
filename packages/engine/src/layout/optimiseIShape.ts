/**
 * optimiseIShape.ts
 *
 * Specialised algorithm for the largest I-shape (an "I-beam" / capital I) inscribed
 * in a polygon.
 *
 * An I-shape is a bounding rectangle (X, Y, W, H) at axis tilt θ with TWO rectangular
 * notches cut into the middle of a pair of opposite edges, leaving two end bars joined
 * by a central stem. The result is a 12-vertex rectilinear polygon (two reflex pairs).
 *
 *   orientation = "vertical":   bars on top & bottom, stem runs vertically
 *   orientation = "horizontal": bars on left & right, stem runs horizontally
 *
 * Both bars share a thickness so the result is symmetric — a clean I.
 *
 * Pipeline mirrors optimiseL/T/ZShape: rotate → random search → hill-climb → rotate back.
 */

import type { Point } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mulberry32 = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rotAround = (p: Point, cx: number, cy: number, cos: number, sin: number): Point => ({
  x: (p.x - cx) * cos - (p.y - cy) * sin + cx,
  y: (p.x - cx) * sin + (p.y - cy) * cos + cy,
});

const pip = (px: number, py: number, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (
      (a.y > py) !== (b.y > py) &&
      px < ((b.x - a.x) * (py - a.y)) / ((b.y - a.y) || 1e-9) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
};

const orient = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number =>
  (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

const segmentsProperlyCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) &&
    d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
};

// ─── I-shape geometry ───────────────────────────────────────────────────────────

export type IOrientation = "vertical" | "horizontal";

const ALL_ORIENTATIONS: IOrientation[] = ["vertical", "horizontal"];

interface IParams {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bar thickness (both bars equal), perpendicular to the bars' long axis. */
  barT: number;
  /** Stem thickness (perpendicular to the stem's long axis). */
  wStem: number;
  /** Stem offset along the bars (gap before the stem on the first flank). */
  xStem: number;
  orientation: IOrientation;
}

/** The 12 vertices of the I-shape in the rotated frame. */
const iVertices = (t: IParams): Point[] => {
  const { x, y, w, h, barT, wStem, xStem, orientation } = t;
  const x1 = x + w, y1 = y + h;
  if (orientation === "vertical") {
    const sx0 = x + xStem, sx1 = x + xStem + wStem;
    return [
      { x,        y },
      { x: x1,    y },
      { x: x1,    y: y + barT },
      { x: sx1,   y: y + barT },
      { x: sx1,   y: y1 - barT },
      { x: x1,    y: y1 - barT },
      { x: x1,    y: y1 },
      { x,        y: y1 },
      { x,        y: y1 - barT },
      { x: sx0,   y: y1 - barT },
      { x: sx0,   y: y + barT },
      { x,        y: y + barT },
    ];
  }
  // horizontal: bars on left & right, stem runs horizontally.
  const sy0 = y + xStem, sy1 = y + xStem + wStem;
  return [
    { x,            y },
    { x: x + barT,  y },
    { x: x + barT,  y: sy0 },
    { x: x1 - barT, y: sy0 },
    { x: x1 - barT, y },
    { x: x1,        y },
    { x: x1,        y: y1 },
    { x: x1 - barT, y: y1 },
    { x: x1 - barT, y: sy1 },
    { x: x + barT,  y: sy1 },
    { x: x + barT,  y: y1 },
    { x,            y: y1 },
  ];
};

/** Notch dimensions: the two side cut-outs share a depth (the gap between the bars)
 *  and have a flank width each (the gaps on either side of the stem). */
const iNotchDims = (t: IParams): { gap: number; flank1: number; flank2: number } => {
  const isVertical = t.orientation === "vertical";
  const barAxis = isVertical ? t.h : t.w;
  const stemSpan = isVertical ? t.w : t.h;
  return { gap: barAxis - 2 * t.barT, flank1: t.xStem, flank2: stemSpan - t.xStem - t.wStem };
};

const iNotchOk = (t: IParams, minNotch: number): boolean => {
  if (minNotch <= 0) return true;
  const { gap, flank1, flank2 } = iNotchDims(t);
  return gap >= minNotch && flank1 >= minNotch && flank2 >= minNotch;
};

const iInside = (t: IParams, poly: Point[]): boolean => {
  const verts = iVertices(t);
  for (const v of verts) if (!pip(v.x, v.y, poly)) return false;
  const n = verts.length, m = poly.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const c = poly[j], d = poly[(j + 1) % m];
      if (segmentsProperlyCross(a, b, c, d)) return false;
    }
  }
  for (const p of poly) if (pip(p.x, p.y, verts)) return false;
  return true;
};

const iArea = (t: IParams): number => {
  const isVertical = t.orientation === "vertical";
  const barLen = isVertical ? t.w : t.h;   // bar length
  const barAxis = isVertical ? t.h : t.w;  // along the stem
  return 2 * barLen * t.barT + t.wStem * (barAxis - 2 * t.barT);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseIShapeParams {
  pts: Point[];
  axisAngleDeg: number;
  randomSamples?: number;
  refineIters?: number;
  /** Minimum bar/stem thickness in pixels. Default 4. */
  minArmPx?: number;
  /** Minimum notch size in pixels (each side cut's depth & flank width). Default 0. */
  minNotchPx?: number;
}

export interface OptimiseIShapeResult {
  outline: Point[] | null;
  areaPx: number;
  params: IParams | null;
  success: boolean;
  errorMessage?: string;
}

export function computeOptimiseIShape(params: OptimiseIShapeParams): OptimiseIShapeResult {
  const { pts, axisAngleDeg } = params;
  const N = params.randomSamples ?? 6000;
  const refineIters = params.refineIters ?? 240;
  const minArm = params.minArmPx ?? 4;
  const minNotch = Math.max(0, params.minNotchPx ?? 0);
  const flankMin = Math.max(minArm, minNotch); // gap on each side of the stem
  const gapMin = Math.max(minArm, minNotch);   // gap between the two bars

  if (pts.length < 3) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon needs ≥ 3 vertices" };
  }

  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;

  const theta = (axisAngleDeg * Math.PI) / 180;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const cosN = Math.cos(-theta), sinN = Math.sin(-theta);
  const rotPoly = pts.map((p) => rotAround(p, cx, cy, cosN, sinN));

  const xs = rotPoly.map((p) => p.x), ys = rotPoly.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.min(maxX - minX, maxY - minY);
  // bbox needs, on the bar axis: 2 bars (≥ minArm) + a gap (≥ gapMin); on the stem axis: the stem
  // (≥ minArm) + 2 flanks (≥ flankMin).
  const minBarAxis = 2 * minArm + gapMin;
  const minStemSpan = minArm + 2 * flankMin;
  const minSide = Math.min(minBarAxis, minStemSpan);
  if (span <= minSide) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small for the minimum notch" };
  }

  let seed = Math.round(axisAngleDeg * 1000) | 0;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  const rand = mulberry32(seed ^ 0x1BEA);

  let best: IParams | null = null;
  let bestArea = 0;

  for (let k = 0; k < N; k++) {
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    const orientation = ALL_ORIENTATIONS[(rand() * 2) | 0];
    const isVertical = orientation === "vertical";
    // Need the right minimum on each axis for this orientation.
    const wMin = isVertical ? minStemSpan : minBarAxis;
    const hMin = isVertical ? minBarAxis : minStemSpan;
    if (wMax < wMin || hMax < hMin) continue;
    const w = wMin + Math.pow(rand(), 0.5) * (wMax - wMin);
    const h = hMin + Math.pow(rand(), 0.5) * (hMax - hMin);
    const barAxis = isVertical ? h : w;
    const stemSpan = isVertical ? w : h;
    // Bar thickness: 2 bars + a gap ≥ gapMin.
    const barTMax = (barAxis - gapMin) / 2;
    if (barTMax < minArm) continue;
    const barT = minArm + rand() * (barTMax - minArm);
    // Stem: leave ≥ flankMin on each side.
    const wStemMax = stemSpan - 2 * flankMin;
    if (wStemMax < minArm) continue;
    const wStem = minArm + rand() * (wStemMax - minArm);
    const xStem = flankMin + rand() * (stemSpan - wStem - 2 * flankMin);
    const cand: IParams = { x: x0, y: y0, w, h, barT, wStem, xStem, orientation };
    if (!iNotchOk(cand, minNotch)) continue;
    if (!iInside(cand, rotPoly)) continue;
    const a = iArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid I found in random search" };
  }

  let step = Math.max(span * 0.05, minArm);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(t: IParams, s: number) => IParams> = [
      (t, s) => ({ ...t, x: t.x - s, w: t.w + s }),
      (t, s) => ({ ...t, w: t.w + s }),
      (t, s) => ({ ...t, y: t.y - s, h: t.h + s }),
      (t, s) => ({ ...t, h: t.h + s }),
      (t, s) => ({ ...t, barT: t.barT + s }),
      (t, s) => ({ ...t, barT: Math.max(minArm, t.barT - s) }),
      (t, s) => ({ ...t, wStem: t.wStem + s }),
      (t, s) => ({ ...t, wStem: Math.max(minArm, t.wStem - s) }),
      (t, s) => ({ ...t, xStem: Math.max(flankMin, t.xStem - s) }),
      (t, s) => ({ ...t, xStem: t.xStem + s }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      const isVertical = cand.orientation === "vertical";
      const barAxis = isVertical ? cand.h : cand.w;
      const stemSpan = isVertical ? cand.w : cand.h;
      if (cand.w < (isVertical ? minStemSpan : minBarAxis)) continue;
      if (cand.h < (isVertical ? minBarAxis : minStemSpan)) continue;
      // Bars ≥ minArm with a gap ≥ gapMin; stem ≥ minArm with flanks ≥ flankMin.
      if (cand.barT < minArm || 2 * cand.barT > barAxis - gapMin) continue;
      if (cand.wStem < minArm || cand.wStem > stemSpan - 2 * flankMin) continue;
      if (cand.xStem < flankMin || cand.xStem + cand.wStem > stemSpan - flankMin) continue;
      if (!iNotchOk(cand, minNotch)) continue;
      if (!iInside(cand, rotPoly)) continue;
      const a = iArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  const verts = iVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));
  return { outline, areaPx: bestArea, params: best, success: true };
}
