/**
 * optimiseCrossShape.ts
 *
 * Specialised algorithm for the largest "Cross" (plus / +) shape inscribed in a polygon.
 *
 * A Cross is a bounding rectangle (X, Y, W, H) at axis tilt θ with all FOUR corners cut
 * away, leaving a vertical bar (width barW) crossing a horizontal bar (height barH). The
 * result is a 12-vertex rectilinear polygon with four reflex vertices. The two bars can
 * sit off-centre (xBar / yBar) so the cross fits irregular rooms.
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

// ─── Cross geometry ─────────────────────────────────────────────────────────────

interface XParams {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Vertical-bar width and horizontal-bar height (the two arm thicknesses). */
  barW: number;
  barH: number;
  /** Bar offsets: left gap before the vertical bar, top gap before the horizontal bar. */
  xBar: number;
  yBar: number;
}

/** The 12 vertices of the Cross in the rotated frame. */
const crossVertices = (c: XParams): Point[] => {
  const { x, y, w, h, barW, barH, xBar, yBar } = c;
  const x1 = x + w, y1 = y + h;
  const bx0 = x + xBar, bx1 = x + xBar + barW; // vertical-bar x-range
  const by0 = y + yBar, by1 = y + yBar + barH; // horizontal-bar y-range
  return [
    { x: bx0, y },
    { x: bx1, y },
    { x: bx1, y: by0 },
    { x: x1,  y: by0 },
    { x: x1,  y: by1 },
    { x: bx1, y: by1 },
    { x: bx1, y: y1 },
    { x: bx0, y: y1 },
    { x: bx0, y: by1 },
    { x,      y: by1 },
    { x,      y: by0 },
    { x: bx0, y: by0 },
  ];
};

/** The four corner notches share flank dimensions: left/right gaps (x) and top/bottom gaps (y). */
const crossNotchDims = (c: XParams): { left: number; right: number; top: number; bot: number } => ({
  left: c.xBar,
  right: c.w - c.xBar - c.barW,
  top: c.yBar,
  bot: c.h - c.yBar - c.barH,
});

const crossNotchOk = (c: XParams, minNotch: number): boolean => {
  if (minNotch <= 0) return true;
  const { left, right, top, bot } = crossNotchDims(c);
  return left >= minNotch && right >= minNotch && top >= minNotch && bot >= minNotch;
};

const crossInside = (c: XParams, poly: Point[]): boolean => {
  const verts = crossVertices(c);
  for (const v of verts) if (!pip(v.x, v.y, poly)) return false;
  const n = verts.length, m = poly.length;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const d0 = poly[j], d1 = poly[(j + 1) % m];
      if (segmentsProperlyCross(a, b, d0, d1)) return false;
    }
  }
  for (const p of poly) if (pip(p.x, p.y, verts)) return false;
  return true;
};

/** Vertical bar + horizontal bar − their overlap. */
const crossArea = (c: XParams): number => c.barW * c.h + c.barH * c.w - c.barW * c.barH;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseCrossShapeParams {
  pts: Point[];
  axisAngleDeg: number;
  randomSamples?: number;
  refineIters?: number;
  /** Minimum bar thickness in pixels (both arms). Default 4. */
  minArmPx?: number;
  /** Minimum corner-notch size in pixels (each notch's width & height). Default 0. */
  minNotchPx?: number;
}

export interface OptimiseCrossShapeResult {
  outline: Point[] | null;
  areaPx: number;
  params: XParams | null;
  success: boolean;
  errorMessage?: string;
}

export function computeOptimiseCrossShape(params: OptimiseCrossShapeParams): OptimiseCrossShapeResult {
  const { pts, axisAngleDeg } = params;
  const N = params.randomSamples ?? 6000;
  const refineIters = params.refineIters ?? 240;
  const minArm = params.minArmPx ?? 4;
  const minNotch = Math.max(0, params.minNotchPx ?? 0);
  const flankMin = Math.max(minArm, minNotch); // each corner-notch flank

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
  // Each axis needs a bar (≥ minArm) plus a flank (≥ flankMin) on both sides.
  const minSide = minArm + 2 * flankMin;
  if (span <= minSide) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small for the minimum notch" };
  }

  let seed = Math.round(axisAngleDeg * 1000) | 0;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  const rand = mulberry32(seed ^ 0x40FF);

  let best: XParams | null = null;
  let bestArea = 0;

  for (let k = 0; k < N; k++) {
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    if (wMax < minSide || hMax < minSide) continue;
    const w = minSide + Math.pow(rand(), 0.5) * (wMax - minSide);
    const h = minSide + Math.pow(rand(), 0.5) * (hMax - minSide);
    // Bar thickness leaves a flank ≥ flankMin on each side; bar offset keeps both flanks valid.
    const barW = minArm + rand() * (w - 2 * flankMin - minArm);
    const barH = minArm + rand() * (h - 2 * flankMin - minArm);
    const xBar = flankMin + rand() * (w - barW - 2 * flankMin);
    const yBar = flankMin + rand() * (h - barH - 2 * flankMin);
    const cand: XParams = { x: x0, y: y0, w, h, barW, barH, xBar, yBar };
    if (!crossNotchOk(cand, minNotch)) continue;
    if (!crossInside(cand, rotPoly)) continue;
    const a = crossArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid cross found in random search" };
  }

  let step = Math.max(span * 0.05, minArm);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(c: XParams, d: number) => XParams> = [
      (c, d) => ({ ...c, x: c.x - d, w: c.w + d }),
      (c, d) => ({ ...c, w: c.w + d }),
      (c, d) => ({ ...c, y: c.y - d, h: c.h + d }),
      (c, d) => ({ ...c, h: c.h + d }),
      // Grow / shrink the bars (grow increases area; shrink frees room to expand the bbox).
      (c, d) => ({ ...c, barW: c.barW + d }),
      (c, d) => ({ ...c, barW: Math.max(minArm, c.barW - d) }),
      (c, d) => ({ ...c, barH: c.barH + d }),
      (c, d) => ({ ...c, barH: Math.max(minArm, c.barH - d) }),
      // Slide the bars.
      (c, d) => ({ ...c, xBar: Math.max(flankMin, c.xBar - d) }),
      (c, d) => ({ ...c, xBar: c.xBar + d }),
      (c, d) => ({ ...c, yBar: Math.max(flankMin, c.yBar - d) }),
      (c, d) => ({ ...c, yBar: c.yBar + d }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      if (cand.w < minSide || cand.h < minSide) continue;
      // Bars ≥ minArm; both flanks on each axis ≥ flankMin.
      if (cand.barW < minArm || cand.barH < minArm) continue;
      if (cand.xBar < flankMin || cand.xBar + cand.barW > cand.w - flankMin) continue;
      if (cand.yBar < flankMin || cand.yBar + cand.barH > cand.h - flankMin) continue;
      if (!crossNotchOk(cand, minNotch)) continue;
      if (!crossInside(cand, rotPoly)) continue;
      const a = crossArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  const verts = crossVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));
  return { outline, areaPx: bestArea, params: best, success: true };
}
