/**
 * optimiseSteppedShape.ts
 *
 * Specialised algorithm for the largest "Stepped" (staircase / terraced) shape inscribed
 * in a polygon.
 *
 * A Stepped shape is a bounding rectangle (X, Y, W, H) at axis tilt θ with a STAIRCASE of
 * `steps` uniform steps cut out of one corner. The remaining outline has a stepped diagonal
 * edge — a terraced footprint. A 1-step staircase is exactly an L-shape, so this generalises
 * optimiseLShape to N steps.
 *
 *   corner = "TL" | "TR" | "BR" | "BL"   — which corner the staircase is cut from.
 *
 * The staircase extent is (stepW × stepH); each step has tread = stepW/n and riser = stepH/n.
 *
 * Pipeline mirrors the other inscribed-shape solvers: rotate → random search → hill-climb → rotate back.
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

const polyArea = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) / 2;
};

// ─── Stepped geometry ─────────────────────────────────────────────────────────

export type StepCorner = "TL" | "TR" | "BR" | "BL";

const ALL_CORNERS: StepCorner[] = ["TL", "TR", "BR", "BL"];

interface SParams {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Total horizontal / vertical extent of the staircase cut. */
  stepW: number;
  stepH: number;
  /** Number of (uniform) steps, ≥ 1. */
  steps: number;
  corner: StepCorner;
}

/** The vertices of the Stepped shape in the rotated frame (2·steps + 4 of them).
 *  Built canonically with the staircase at the top-right corner, then reflected to
 *  the requested corner (reflection keeps the polygon simple). */
const steppedVertices = (s: SParams): Point[] => {
  const { x, y, w, h, stepW, stepH, steps, corner } = s;
  const x1 = x + w, y1 = y + h;
  const xs = x1 - stepW, ys = y + stepH;
  const t = stepW / steps, r = stepH / steps;

  // Canonical: staircase cut from the TOP-RIGHT corner, descending from the top edge
  // (at xs) down to the right edge (at ys) as alternating riser/tread segments.
  const v: Point[] = [{ x, y }, { x: xs, y }];
  for (let i = 0; i < steps; i++) {
    v.push({ x: xs + i * t, y: y + (i + 1) * r });        // riser down
    v.push({ x: xs + (i + 1) * t, y: y + (i + 1) * r });  // tread right
  }
  v.push({ x: x1, y: y1 }, { x, y: y1 });

  // Reflect to the requested corner.
  const flipX = corner === "TL" || corner === "BL";
  const flipY = corner === "BR" || corner === "BL";
  if (!flipX && !flipY) return v;
  return v.map((p) => ({
    x: flipX ? x + x1 - p.x : p.x,
    y: flipY ? y + y1 - p.y : p.y,
  }));
};

const stepInside = (s: SParams, poly: Point[]): boolean => {
  const verts = steppedVertices(s);
  for (const vtx of verts) if (!pip(vtx.x, vtx.y, poly)) return false;
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

const stepArea = (s: SParams): number => polyArea(steppedVertices(s));

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseSteppedShapeParams {
  pts: Point[];
  axisAngleDeg: number;
  /** Number of staircase steps (≥ 1). 1 = an L-shape. */
  steps: number;
  randomSamples?: number;
  refineIters?: number;
  /** Minimum solid-margin thickness in pixels (w − stepW, h − stepH). Default 4. */
  minArmPx?: number;
  /** Minimum step size in pixels — each tread AND riser stay ≥ this. Default 0. */
  minNotchPx?: number;
}

export interface OptimiseSteppedShapeResult {
  outline: Point[] | null;
  areaPx: number;
  params: SParams | null;
  success: boolean;
  errorMessage?: string;
}

export function computeOptimiseSteppedShape(params: OptimiseSteppedShapeParams): OptimiseSteppedShapeResult {
  const { pts, axisAngleDeg } = params;
  const steps = Math.max(1, Math.min(20, Math.round(params.steps)));
  const N = params.randomSamples ?? 6000;
  const refineIters = params.refineIters ?? 240;
  const minArm = params.minArmPx ?? 4;
  const minNotch = Math.max(0, params.minNotchPx ?? 0);
  // Each tread/riser must be ≥ this. With no minimum it collapses to `minArm`.
  const stepMin = Math.max(minArm, minNotch);

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
  // The staircase needs `steps` treads (≥ stepMin) plus a solid margin (≥ minArm) on each axis.
  const minSide = steps * stepMin + minArm;
  const span = Math.min(maxX - minX, maxY - minY);
  if (span <= minSide) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small for the steps" };
  }

  let seed = (Math.round(axisAngleDeg * 1000) | 0) + steps * 1009;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  const rand = mulberry32(seed ^ 0x57E9);

  // ─── Random search ───────────────────────────────────────────────────────
  let best: SParams | null = null;
  let bestArea = 0;
  const minStepExtent = steps * stepMin; // stepW / stepH lower bound

  for (let k = 0; k < N; k++) {
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    if (wMax < minSide || hMax < minSide) continue;
    const w = minSide + Math.pow(rand(), 0.5) * (wMax - minSide);
    const h = minSide + Math.pow(rand(), 0.5) * (hMax - minSide);
    // Staircase extent ∈ [steps·stepMin, side − minArm] (leaves a solid margin ≥ minArm).
    const stepW = minStepExtent + rand() * (w - minArm - minStepExtent);
    const stepH = minStepExtent + rand() * (h - minArm - minStepExtent);
    const corner = ALL_CORNERS[(rand() * 4) | 0];
    const cand: SParams = { x: x0, y: y0, w, h, stepW, stepH, steps, corner };
    if (!stepInside(cand, rotPoly)) continue;
    const a = stepArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid stepped shape found in random search" };
  }

  // ─── Hill-climb refinement ───────────────────────────────────────────────
  let step = Math.max(span * 0.05, minArm);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(s: SParams, d: number) => SParams> = [
      (s, d) => ({ ...s, x: s.x - d, w: s.w + d }),
      (s, d) => ({ ...s, w: s.w + d }),
      (s, d) => ({ ...s, y: s.y - d, h: s.h + d }),
      (s, d) => ({ ...s, h: s.h + d }),
      // Shrink the staircase (increases solid area) — not below the per-step minimum.
      (s, d) => ({ ...s, stepW: Math.max(minStepExtent, s.stepW - d) }),
      (s, d) => ({ ...s, stepH: Math.max(minStepExtent, s.stepH - d) }),
      // Grow the staircase (sometimes needed to stay inside a non-convex room).
      (s, d) => ({ ...s, stepW: s.stepW + d }),
      (s, d) => ({ ...s, stepH: s.stepH + d }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      if (cand.w < minSide || cand.h < minSide) continue;
      // Each tread/riser ≥ stepMin; solid margins ≥ minArm.
      if (cand.stepW < minStepExtent || cand.stepH < minStepExtent) continue;
      if (cand.w - cand.stepW < minArm || cand.h - cand.stepH < minArm) continue;
      if (!stepInside(cand, rotPoly)) continue;
      const a = stepArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  const verts = steppedVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));
  return { outline, areaPx: bestArea, params: best, success: true };
}
