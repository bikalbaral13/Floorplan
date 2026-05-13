/**
 * optimiseTShape.ts
 *
 * Specialised algorithm for the largest T-shape inscribed in a polygon.
 *
 * A T-shape is parameterised as a bounding rectangle (X, Y, W, H) at axis tilt θ
 * with TWO rectangular notches removed from corners that share the same side.
 * Equivalently: a "bar" of full width W × h_bar, plus a "stem" of width w_stem
 * × (H − h_bar) hanging from (or rising into) the bar at horizontal offset x_stem.
 *
 * Orientations:
 *   - "T-down":  bar on top,    stem points down
 *   - "T-up":    bar on bottom, stem points up
 *   - "T-left":  bar on right,  stem points left
 *   - "T-right": bar on left,   stem points right
 *
 * Pipeline mirrors optimiseLShape.ts: random search + hill-climb, deterministic
 * Mulberry32 PRNG so identical inputs produce identical T-shapes (no flicker on
 * slider drag).
 */

import type { Point } from "../../types";

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

// ─── T-shape geometry ─────────────────────────────────────────────────────────

export type TOrientation = "T-down" | "T-up" | "T-left" | "T-right";
const ALL_ORIENTATIONS: TOrientation[] = ["T-down", "T-up", "T-left", "T-right"];

interface TParams {
  /** Bounding-box top-left in the rotated frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Bar thickness (perpendicular to the bar's long axis). */
  hBar: number;
  /** Stem thickness (perpendicular to the stem's long axis). */
  wStem: number;
  /** Stem offset along the bar (left edge of stem from the bar's start). */
  xStem: number;
  orientation: TOrientation;
}

/** The 8 vertices of the T-shape in CCW order in the rotated frame. */
const tVertices = (t: TParams): Point[] => {
  const { x, y, w, h, hBar, wStem, xStem, orientation } = t;
  const x1 = x + w, y1 = y + h;
  switch (orientation) {
    case "T-down": {
      // Bar on top (height hBar), stem hangs down (width wStem at x+xStem).
      return [
        { x,                 y },
        { x: x1,             y },
        { x: x1,             y: y + hBar },
        { x: x + xStem + wStem, y: y + hBar },
        { x: x + xStem + wStem, y: y1 },
        { x: x + xStem,      y: y1 },
        { x: x + xStem,      y: y + hBar },
        { x,                 y: y + hBar },
      ];
    }
    case "T-up": {
      // Bar on bottom, stem rises.
      return [
        { x: x + xStem,         y },
        { x: x + xStem + wStem, y },
        { x: x + xStem + wStem, y: y1 - hBar },
        { x: x1,                y: y1 - hBar },
        { x: x1,                y: y1 },
        { x,                    y: y1 },
        { x,                    y: y1 - hBar },
        { x: x + xStem,         y: y1 - hBar },
      ];
    }
    case "T-right": {
      // Bar on left (width hBar), stem points right (height wStem at y+xStem).
      return [
        { x,            y },
        { x: x + hBar,  y },
        { x: x + hBar,  y: y + xStem },
        { x: x1,        y: y + xStem },
        { x: x1,        y: y + xStem + wStem },
        { x: x + hBar,  y: y + xStem + wStem },
        { x: x + hBar,  y: y1 },
        { x,            y: y1 },
      ];
    }
    case "T-left": {
      // Bar on right, stem points left.
      return [
        { x,            y: y + xStem },
        { x: x1 - hBar, y: y + xStem },
        { x: x1 - hBar, y },
        { x: x1,        y },
        { x: x1,        y: y1 },
        { x: x1 - hBar, y: y1 },
        { x: x1 - hBar, y: y + xStem + wStem },
        { x,            y: y + xStem + wStem },
      ];
    }
  }
};

const tInside = (t: TParams, poly: Point[]): boolean => {
  const verts = tVertices(t);
  for (const v of verts) if (!pip(v.x, v.y, poly)) return false;
  return true;
};

const tArea = (t: TParams): number => {
  const isVertical = t.orientation === "T-down" || t.orientation === "T-up";
  if (isVertical) {
    // Bar W × hBar  +  stem wStem × (H − hBar).
    return t.w * t.hBar + t.wStem * (t.h - t.hBar);
  }
  // Bar hBar × H  +  stem (W − hBar) × wStem.
  return t.hBar * t.h + (t.w - t.hBar) * t.wStem;
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseTShapeParams {
  pts: Point[];
  axisAngleDeg: number;
  randomSamples?: number;
  refineIters?: number;
  /** Minimum allowed bar/stem thickness in pixels. Default 4. */
  minThicknessPx?: number;
}

export interface OptimiseTShapeResult {
  /** T-shape outline in world coordinates (8 vertices, CCW). */
  outline: Point[] | null;
  areaPx: number;
  params: TParams | null;
  success: boolean;
  errorMessage?: string;
}

export function computeOptimiseTShape(params: OptimiseTShapeParams): OptimiseTShapeResult {
  const { pts, axisAngleDeg } = params;
  const N = params.randomSamples ?? 4000;
  const refineIters = params.refineIters ?? 200;
  const minT = params.minThicknessPx ?? 4;

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
  if (span <= 3 * minT) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small" };
  }

  // Deterministic PRNG seeded by polygon + angle.
  let seed = Math.round(axisAngleDeg * 1000) | 0;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  // XOR with a constant to differentiate the seed stream from L-shape's.
  const rand = mulberry32(seed ^ 0x7E5);

  let best: TParams | null = null;
  let bestArea = 0;
  const minSide = 3 * minT; // bbox needs to fit bar + 2 stem-flanks

  for (let k = 0; k < N; k++) {
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    if (wMax < minSide || hMax < minSide) continue;
    const w = minSide + Math.pow(rand(), 0.5) * (wMax - minSide);
    const h = minSide + Math.pow(rand(), 0.5) * (hMax - minSide);
    const orientation = ALL_ORIENTATIONS[(rand() * 4) | 0];
    const isVertical = orientation === "T-down" || orientation === "T-up";
    // Bar thickness is perpendicular to the bar's long axis.
    const hBarMax = (isVertical ? h : w) - minT; // leave room for stem
    if (hBarMax <= minT) continue;
    const hBar = minT + rand() * (hBarMax - minT);
    // Stem axis = the OTHER axis of the bbox.
    const stemSpan = isVertical ? w : h;
    const wStemMax = stemSpan - 2 * minT;
    if (wStemMax <= minT) continue;
    const wStem = minT + rand() * (wStemMax - minT);
    const xStem = minT + rand() * (stemSpan - wStem - 2 * minT);
    const cand: TParams = { x: x0, y: y0, w, h, hBar, wStem, xStem, orientation };
    if (!tInside(cand, rotPoly)) continue;
    const a = tArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid T found in random search" };
  }

  // Hill-climb refinement.
  let step = Math.max(span * 0.05, minT);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(t: TParams, s: number) => TParams> = [
      (t, s) => ({ ...t, x: t.x - s, w: t.w + s }),
      (t, s) => ({ ...t, w: t.w + s }),
      (t, s) => ({ ...t, y: t.y - s, h: t.h + s }),
      (t, s) => ({ ...t, h: t.h + s }),
      (t, s) => ({ ...t, hBar: t.hBar + s }),
      (t, s) => ({ ...t, hBar: Math.max(minT, t.hBar - s) }),
      (t, s) => ({ ...t, wStem: t.wStem + s }),
      (t, s) => ({ ...t, wStem: Math.max(minT, t.wStem - s) }),
      (t, s) => ({ ...t, xStem: Math.max(minT, t.xStem - s) }),
      (t, s) => ({ ...t, xStem: t.xStem + s }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      const isVertical = cand.orientation === "T-down" || cand.orientation === "T-up";
      const stemSpan = isVertical ? cand.w : cand.h;
      const barAxis = isVertical ? cand.h : cand.w;
      // Validity constraints.
      if (cand.w < minSide || cand.h < minSide) continue;
      if (cand.hBar < minT || cand.hBar >= barAxis - minT) continue;
      if (cand.wStem < minT || cand.wStem >= stemSpan - 2 * minT) continue;
      if (cand.xStem < minT || cand.xStem + cand.wStem > stemSpan - minT) continue;
      if (!tInside(cand, rotPoly)) continue;
      const a = tArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  const verts = tVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));
  return { outline, areaPx: bestArea, params: best, success: true };
}
