/**
 * optimiseZShape.ts
 *
 * Specialised algorithm for the largest Z-shape (a.k.a. S-shape) inscribed in a polygon.
 *
 * A Z-shape is a bounding rectangle (X, Y, W, H) at axis tilt θ with TWO rectangular
 * notches of size (wN × hN) removed from a pair of diagonally-opposite corners. The
 * result is an octagon (8 axis-aligned edges in the rotated frame) with exactly two
 * reflex (270°) vertices — the zigzag of a "Z" or its mirror "S".
 *
 *   diag = "TL_BR":  notches at top-left + bottom-right  (an "S")
 *   diag = "TR_BL":  notches at top-right + bottom-left  (a "Z")
 *
 * The two notches are kept the same size so the result is point-symmetric — a clean Z.
 *
 * Pipeline mirrors optimiseLShape / optimiseTShape:
 *   1. Rotate polygon by -θ → axis-aligned frame.
 *   2. Random search over (X, Y, W, H, wN, hN, diag), validating containment.
 *   3. Hill-climb the best candidate.
 *   4. Rotate back to world space.
 */

import type { Point } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mulberry32 — small, fast, deterministic 32-bit PRNG (seeded → no slider flicker). */
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

/** 2D cross product of (a−o) × (b−o). */
const orient = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number =>
  (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

/** Proper segment intersection (interiors cross; shared endpoints / collinear touching don't count). */
const segmentsProperlyCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
  const d2 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
  const d3 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
  const d4 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) &&
    d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
};

// ─── Z-shape geometry ───────────────────────────────────────────────────────────

/** Which diagonal pair of corners is notched. */
export type ZDiag = "TL_BR" | "TR_BL";

const ALL_DIAGS: ZDiag[] = ["TL_BR", "TR_BL"];

interface ZParams {
  /** Bounding-box top-left in the rotated frame. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Notch width (along x) and height (along y), shared by both notches. */
  wN: number;
  hN: number;
  diag: ZDiag;
}

/** The 8 vertices of the Z-shape in order in the rotated frame. */
const zVertices = (z: ZParams): Point[] => {
  const { x, y, w, h, wN, hN, diag } = z;
  const x1 = x + w, y1 = y + h;
  if (diag === "TL_BR") {
    // Notches removed from top-left and bottom-right.
    return [
      { x,            y: y + hN },
      { x: x + wN,    y: y + hN },
      { x: x + wN,    y },
      { x: x1,        y },
      { x: x1,        y: y1 - hN },
      { x: x1 - wN,   y: y1 - hN },
      { x: x1 - wN,   y: y1 },
      { x,            y: y1 },
    ];
  }
  // "TR_BL": notches removed from top-right and bottom-left.
  return [
    { x,            y },
    { x: x1 - wN,   y },
    { x: x1 - wN,   y: y + hN },
    { x: x1,        y: y + hN },
    { x: x1,        y: y1 },
    { x: x + wN,    y: y1 },
    { x: x + wN,    y: y1 - hN },
    { x,            y: y1 - hN },
  ];
};

/** True iff the Z-shape lies entirely inside `poly` — correct for concave containers.
 *  Vertices inside + no edge crossings + no room vertex trapped inside the Z. */
const zInside = (z: ZParams, poly: Point[]): boolean => {
  const verts = zVertices(z);
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

const zArea = (z: ZParams): number => z.w * z.h - 2 * z.wN * z.hN;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseZShapeParams {
  /** Room polygon in pixel/world coordinates. */
  pts: Point[];
  /** Axis tilt in degrees. The Z's edges align with this rotated frame. */
  axisAngleDeg: number;
  /** Number of random samples to evaluate. Default 6000. */
  randomSamples?: number;
  /** Hill-climb refinement iterations on the best candidate. Default 240. */
  refineIters?: number;
  /** Minimum limb thickness in pixels — the end blocks' widths and the middle
   *  connector's height stay ≥ this. Default 4. */
  minArmPx?: number;
  /** Minimum notch leg length in pixels. Both notches must be ≥ this on each
   *  side, so a too-shallow nick doesn't count as a Z. Default 0 = no minimum. */
  minNotchPx?: number;
}

export interface OptimiseZShapeResult {
  /** Z-shape outline in world coordinates (8 vertices). */
  outline: Point[] | null;
  areaPx: number;
  params: ZParams | null;
  success: boolean;
  errorMessage?: string;
}

/**
 * Find the largest Z-shape inscribed in `pts` at axis tilt `axisAngleDeg`.
 * Strategy: rotate to an axis-aligned frame, random-search (x, y, w, h, wN, hN, diag)
 * and hill-climb the best candidate, with full polygon-in-polygon containment so the
 * result stays inside concave rooms.
 */
export function computeOptimiseZShape(params: OptimiseZShapeParams): OptimiseZShapeResult {
  const { pts, axisAngleDeg } = params;
  const N = params.randomSamples ?? 6000;
  const refineIters = params.refineIters ?? 240;
  const minArm = params.minArmPx ?? 4;
  const minNotch = Math.max(0, params.minNotchPx ?? 0);
  // Notch legs must be ≥ this. With no minimum it collapses to `minArm`,
  // matching the L/T convention.
  const notchMin = Math.max(minArm, minNotch);

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
  // Width must fit a notch + an end block; height must fit TWO notches + the middle connector.
  const minW = notchMin + minArm;
  const minH = 2 * notchMin + minArm;
  if (maxX - minX <= minW || maxY - minY <= minH) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small for the minimum notch" };
  }

  // Deterministic PRNG seeded by polygon + angle (XOR constant differentiates from L/T streams).
  let seed = Math.round(axisAngleDeg * 1000) | 0;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  const rand = mulberry32(seed ^ 0x2BAD);

  // ─── Random search ───────────────────────────────────────────────────────
  let best: ZParams | null = null;
  let bestArea = 0;

  for (let k = 0; k < N; k++) {
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    if (wMax < minW || hMax < minH) continue;
    const w = minW + Math.pow(rand(), 0.5) * (wMax - minW);
    const h = minH + Math.pow(rand(), 0.5) * (hMax - minH);
    // Notch width ∈ [notchMin, w − minArm] (leaves an end block ≥ minArm).
    const wN = notchMin + rand() * (w - minArm - notchMin);
    // Notch height ∈ [notchMin, (h − minArm)/2] (two notches + a middle connector ≥ minArm).
    const hNMax = (h - minArm) / 2;
    if (hNMax < notchMin) continue;
    const hN = notchMin + rand() * (hNMax - notchMin);
    const diag = ALL_DIAGS[(rand() * 2) | 0];
    const cand: ZParams = { x: x0, y: y0, w, h, wN, hN, diag };
    if (!zInside(cand, rotPoly)) continue;
    const a = zArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid Z found in random search" };
  }

  // ─── Hill-climb refinement ───────────────────────────────────────────────
  const span = Math.min(maxX - minX, maxY - minY);
  let step = Math.max(span * 0.05, minArm);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(z: ZParams, s: number) => ZParams> = [
      // Grow / shrink the bbox in 4 directions.
      (z, s) => ({ ...z, x: z.x - s, w: z.w + s }), // expand left
      (z, s) => ({ ...z, w: z.w + s }),             // expand right
      (z, s) => ({ ...z, y: z.y - s, h: z.h + s }), // expand up
      (z, s) => ({ ...z, h: z.h + s }),             // expand down
      // Shrink the notches (increases area when valid) — not below the min notch.
      (z, s) => ({ ...z, wN: Math.max(notchMin, z.wN - s) }),
      (z, s) => ({ ...z, hN: Math.max(notchMin, z.hN - s) }),
      // Grow the notches (sometimes needed to stay inside a non-convex room).
      (z, s) => ({ ...z, wN: z.wN + s }),
      (z, s) => ({ ...z, hN: z.hN + s }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      if (cand.w < minW || cand.h < minH) continue;
      // Notch legs ≥ the minimum; end blocks ≥ minArm; middle connector ≥ minArm.
      if (cand.wN < notchMin || cand.hN < notchMin) continue;
      if (cand.w - cand.wN < minArm) continue;
      if (cand.h - 2 * cand.hN < minArm) continue;
      if (!zInside(cand, rotPoly)) continue;
      const a = zArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  // Rotate the 8 vertices back to world space.
  const verts = zVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));

  return { outline, areaPx: bestArea, params: best, success: true };
}
