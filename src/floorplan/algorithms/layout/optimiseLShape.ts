/**
 * optimiseLShape.ts
 *
 * Specialised algorithm for the largest L-shape inscribed in a polygon.
 *
 * An L-shape is parameterised as a bounding rectangle (X, Y, W, H) at axis tilt θ
 * with a rectangular notch (w_n × h_n) removed from one of its 4 corners. The
 * resulting hexagon has 6 axis-aligned edges (in the rotated frame) and exactly
 * one reflex (270°) vertex.
 *
 * Pipeline:
 *   1. Rotate polygon by -θ → axis-aligned frame.
 *   2. Random search over (X, Y, W, H, w_n, h_n, corner) — sample N candidates,
 *      validate each by point-in-polygon test on the 6 L-vertices.
 *   3. Hill-climb the best candidate by perturbing each parameter.
 *   4. Rotate the L back to world space and return.
 *
 * This is a first-cut implementation — single random-restart + local refinement.
 * Easy to swap in a smarter optimiser later (LP-per-θ, NFP, branch-and-bound, ...).
 */

import type { Point } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mulberry32 — small, fast, deterministic 32-bit PRNG. Seeded so identical inputs
 *  produce identical L-shapes (no flicker on slider drag re-runs). */
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

/** Winding-number point-in-polygon test (matches the convention used elsewhere). */
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

// ─── L-shape geometry ─────────────────────────────────────────────────────────

/** Notch corner: which corner of the bbox is removed.
 *  TL = top-left (min x, min y), TR = top-right, BR = bottom-right, BL = bottom-left. */
export type LCorner = "TL" | "TR" | "BR" | "BL";

const ALL_CORNERS: LCorner[] = ["TL", "TR", "BR", "BL"];

interface LParams {
  /** Bounding-box top-left in the rotated frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Notch width (along x) and height (along y). 0 < wN < w, 0 < hN < h. */
  wN: number;
  hN: number;
  corner: LCorner;
}

/** The 6 vertices of the L-shape in CCW order in the rotated frame. */
const lVertices = (l: LParams): Point[] => {
  const { x, y, w, h, wN, hN, corner } = l;
  const x1 = x + w, y1 = y + h;
  switch (corner) {
    case "TL":
      // Notch at (x, y) of size (wN, hN). 6 vertices CCW starting at the notch's outer-x edge top.
      return [
        { x: x + wN, y },
        { x: x1,     y },
        { x: x1,     y: y1 },
        { x,         y: y1 },
        { x,         y: y + hN },
        { x: x + wN, y: y + hN },
      ];
    case "TR":
      return [
        { x,             y },
        { x: x1 - wN,    y },
        { x: x1 - wN,    y: y + hN },
        { x: x1,         y: y + hN },
        { x: x1,         y: y1 },
        { x,             y: y1 },
      ];
    case "BR":
      return [
        { x,             y },
        { x: x1,         y },
        { x: x1,         y: y1 - hN },
        { x: x1 - wN,    y: y1 - hN },
        { x: x1 - wN,    y: y1 },
        { x,             y: y1 },
      ];
    case "BL":
      return [
        { x,         y },
        { x: x1,     y },
        { x: x1,     y: y1 },
        { x: x + wN, y: y1 },
        { x: x + wN, y: y1 - hN },
        { x,         y: y1 - hN },
      ];
  }
};

/** True if every L-vertex is strictly inside `poly`. For convex containers this
 *  also implies edge containment, since the L's edges are axis-aligned and any
 *  axis-aligned segment between two interior points of a convex set stays inside. */
const lInside = (l: LParams, poly: Point[]): boolean => {
  const verts = lVertices(l);
  for (const v of verts) if (!pip(v.x, v.y, poly)) return false;
  return true;
};

const lArea = (l: LParams): number => l.w * l.h - l.wN * l.hN;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseLShapeParams {
  /** Room polygon in pixel/world coordinates. */
  pts: Point[];
  /** Axis tilt in degrees. The L's edges align with this rotated frame. */
  axisAngleDeg: number;
  /** Number of random samples to evaluate. Default 4000. */
  randomSamples?: number;
  /** Hill-climb refinement iterations on the best random candidate. Default 200. */
  refineIters?: number;
  /** Minimum allowed arm width in pixels (rejects sliver-arm L's). Default 4. */
  minArmPx?: number;
}

export interface OptimiseLShapeResult {
  /** L-shape outline in world coordinates (6 vertices, CCW, closed implicitly). */
  outline: Point[] | null;
  /** Area in px². 0 when no valid L was found. */
  areaPx: number;
  /** Best parameters in the rotated frame (handy for debugging / iterative refinement). */
  params: LParams | null;
  success: boolean;
  errorMessage?: string;
}

/**
 * Find the largest L-shape inscribed in `pts` at axis tilt `axisAngleDeg`.
 *
 * Strategy: rotate the polygon to an axis-aligned frame, then random-search
 * 7 parameters (x, y, w, h, wN, hN, corner) and hill-climb the best candidate.
 * Containment is verified by point-in-polygon on the 6 L-vertices — exact for
 * convex polygons, approximate for non-convex (a future improvement is to also
 * check edge intersection against the polygon's edges).
 */
export function computeOptimiseLShape(params: OptimiseLShapeParams): OptimiseLShapeResult {
  const { pts, axisAngleDeg } = params;
  const N = params.randomSamples ?? 4000;
  const refineIters = params.refineIters ?? 200;
  const minArm = params.minArmPx ?? 4;

  if (pts.length < 3) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon needs ≥ 3 vertices" };
  }

  // Centroid for rotation pivot.
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
  if (span <= 2 * minArm) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small" };
  }

  // Deterministic PRNG: seed combines polygon vertices + angle so the same input
  // always yields the same L-shape, eliminating slider-drag flicker.
  let seed = Math.round(axisAngleDeg * 1000) | 0;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  const rand = mulberry32(seed);

  // ─── Random search ───────────────────────────────────────────────────────
  let best: LParams | null = null;
  let bestArea = 0;
  const minSide = 2 * minArm; // bbox side must accommodate notch + arm

  for (let k = 0; k < N; k++) {
    // Random bbox top-left and size, biased toward larger boxes.
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    if (wMax < minSide || hMax < minSide) continue;
    // Bias: sample side length from a distribution favouring larger sides.
    const w = minSide + Math.pow(rand(), 0.5) * (wMax - minSide);
    const h = minSide + Math.pow(rand(), 0.5) * (hMax - minSide);
    const wN = minArm + rand() * (w - 2 * minArm);
    const hN = minArm + rand() * (h - 2 * minArm);
    const corner = ALL_CORNERS[(rand() * 4) | 0];
    const cand: LParams = { x: x0, y: y0, w, h, wN, hN, corner };
    if (!lInside(cand, rotPoly)) continue;
    const a = lArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid L found in random search" };
  }

  // ─── Hill-climb refinement ───────────────────────────────────────────────
  // Independently perturb each continuous parameter; on each iteration try a step
  // forward and backward and keep the best valid neighbour. Step shrinks geometrically.
  let step = Math.max(span * 0.05, minArm);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(l: LParams, s: number) => LParams> = [
      // Grow / shrink bbox in 4 directions.
      (l, s) => ({ ...l, x: l.x - s, w: l.w + s }),                  // expand left
      (l, s) => ({ ...l, w: l.w + s }),                              // expand right
      (l, s) => ({ ...l, y: l.y - s, h: l.h + s }),                  // expand up
      (l, s) => ({ ...l, h: l.h + s }),                              // expand down
      // Shrink the notch (always increases area when valid).
      (l, s) => ({ ...l, wN: Math.max(minArm, l.wN - s) }),
      (l, s) => ({ ...l, hN: Math.max(minArm, l.hN - s) }),
      // Grow the notch (sometimes needed to keep the L inside a non-convex polygon).
      (l, s) => ({ ...l, wN: Math.min(l.w - minArm, l.wN + s) }),
      (l, s) => ({ ...l, hN: Math.min(l.h - minArm, l.hN + s) }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      if (cand.w < minSide || cand.h < minSide) continue;
      if (cand.wN <= 0 || cand.hN <= 0 || cand.wN >= cand.w || cand.hN >= cand.h) continue;
      if (!lInside(cand, rotPoly)) continue;
      const a = lArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  // Rotate the 6 vertices back to world space.
  const verts = lVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));

  return { outline, areaPx: bestArea, params: best, success: true };
}
