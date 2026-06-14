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

/** 2D cross product of (a−o) × (b−o). Sign gives orientation of o→a→b. */
const orient = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number =>
  (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

/** Proper segment intersection: true only when the two open segments cross at an
 *  interior point (shared endpoints / collinear touching don't count). */
const segmentsProperlyCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) &&
    d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
};

/** True iff the T-shape lies *entirely* inside `poly` — correct for concave
 *  containers, not just convex. Vertices inside + no edge crossings + no room
 *  vertex trapped inside the T (concave notch poking in). */
const tInside = (t: TParams, poly: Point[]): boolean => {
  const verts = tVertices(t);
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

/** The two corner notches of a T flank the stem. This returns their depth (how
 *  far they cut in from the bar-opposite side) and the two flank widths (the gaps
 *  on either side of the stem along the bar). For a usable T every one of these
 *  must be ≥ the minimum notch size. */
const tNotchDims = (t: TParams): { depth: number; flank1: number; flank2: number } => {
  const isVertical = t.orientation === "T-down" || t.orientation === "T-up";
  const barAxis = isVertical ? t.h : t.w;   // along the stem
  const stemSpan = isVertical ? t.w : t.h;  // along the bar
  return { depth: barAxis - t.hBar, flank1: t.xStem, flank2: stemSpan - t.xStem - t.wStem };
};

const tNotchOk = (t: TParams, minNotch: number): boolean => {
  if (minNotch <= 0) return true;
  const { depth, flank1, flank2 } = tNotchDims(t);
  return depth >= minNotch && flank1 >= minNotch && flank2 >= minNotch;
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
  /** Minimum notch size in pixels. A T removes two corner notches flanking the
   *  stem; each notch's depth AND each flank width must be ≥ this, so a
   *  too-shallow/narrow nick doesn't count as a T. Default 0 = no minimum. */
  minNotchPx?: number;
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
  const minNotch = Math.max(0, params.minNotchPx ?? 0);
  // Lower bounds for the notch dimensions. With no minimum these collapse to
  // `minT`, exactly reproducing the previous sampling/validity behaviour.
  const flankMin = Math.max(minT, minNotch); // gap on each side of the stem
  const depthMin = Math.max(minT, minNotch); // how far the notches cut in

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
  // bbox needs to fit the stem (≥ minT) plus a notch flank (≥ flankMin) on each side.
  const minSide = minT + 2 * flankMin;
  if (span <= minSide) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small for the minimum notch" };
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
    // Bar thickness is perpendicular to the bar's long axis; leave ≥ depthMin for the notch depth.
    const hBarMax = (isVertical ? h : w) - depthMin;
    if (hBarMax <= minT) continue;
    const hBar = minT + rand() * (hBarMax - minT);
    // Stem axis = the OTHER axis of the bbox; leave ≥ flankMin on each side of the stem.
    const stemSpan = isVertical ? w : h;
    const wStemMax = stemSpan - 2 * flankMin;
    if (wStemMax <= minT) continue;
    const wStem = minT + rand() * (wStemMax - minT);
    const xStem = flankMin + rand() * (stemSpan - wStem - 2 * flankMin);
    const cand: TParams = { x: x0, y: y0, w, h, hBar, wStem, xStem, orientation };
    if (!tNotchOk(cand, minNotch)) continue;
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
      // Validity constraints. Bar/stem thickness ≥ minT; notch depth & flanks ≥ their minima.
      if (cand.w < minSide || cand.h < minSide) continue;
      if (cand.hBar < minT || cand.hBar > barAxis - depthMin) continue;
      if (cand.wStem < minT || cand.wStem > stemSpan - 2 * flankMin) continue;
      if (cand.xStem < flankMin || cand.xStem + cand.wStem > stemSpan - flankMin) continue;
      if (!tNotchOk(cand, minNotch)) continue;
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
