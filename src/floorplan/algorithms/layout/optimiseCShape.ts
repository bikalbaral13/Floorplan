/**
 * optimiseCShape.ts
 *
 * Specialised algorithm for the largest C-shape (a "C" / "U") inscribed in a polygon.
 *
 * A C-shape is a bounding rectangle (X, Y, W, H) at axis tilt θ with a single rectangular
 * mouth cut into the middle of one edge, leaving two arms joined by a spine on the opposite
 * side. The result is an 8-vertex rectilinear polygon with two reflex vertices.
 *
 *   orientation = "right": opens right (spine on the left)
 *   orientation = "left":  opens left  (spine on the right)
 *   orientation = "up":    opens up    (spine on the bottom)
 *   orientation = "down":  opens down  (spine on the top)
 *
 * Both arms share a thickness so the result is symmetric — a clean C.
 *
 * Pipeline mirrors optimiseL/T/Z/IShape: rotate → random search → hill-climb → rotate back.
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

// ─── C-shape geometry ─────────────────────────────────────────────────────────

export type COrientation = "right" | "left" | "up" | "down";

const ALL_ORIENTATIONS: COrientation[] = ["right", "left", "up", "down"];

interface CParams {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Arm thickness (both arms equal), perpendicular to the arms' long axis. */
  barT: number;
  /** Spine (closed back) thickness. */
  spineT: number;
  orientation: COrientation;
}

/** The 8 vertices of the C-shape in the rotated frame. */
const cVertices = (c: CParams): Point[] => {
  const { x, y, w, h, barT, spineT, orientation } = c;
  const x1 = x + w, y1 = y + h;
  switch (orientation) {
    case "right": // spine on the left, opens right
      return [
        { x,            y },
        { x: x1,        y },
        { x: x1,        y: y + barT },
        { x: x + spineT, y: y + barT },
        { x: x + spineT, y: y1 - barT },
        { x: x1,        y: y1 - barT },
        { x: x1,        y: y1 },
        { x,            y: y1 },
      ];
    case "left": // spine on the right, opens left
      return [
        { x,             y },
        { x: x1,         y },
        { x: x1,         y: y1 },
        { x,             y: y1 },
        { x,             y: y1 - barT },
        { x: x1 - spineT, y: y1 - barT },
        { x: x1 - spineT, y: y + barT },
        { x,             y: y + barT },
      ];
    case "up": // spine on the bottom, opens up
      return [
        { x,            y },
        { x: x + barT,  y },
        { x: x + barT,  y: y1 - spineT },
        { x: x1 - barT, y: y1 - spineT },
        { x: x1 - barT, y },
        { x: x1,        y },
        { x: x1,        y: y1 },
        { x,            y: y1 },
      ];
    case "down": // spine on the top, opens down
      return [
        { x,            y },
        { x: x1,        y },
        { x: x1,        y: y1 },
        { x: x1 - barT, y: y1 },
        { x: x1 - barT, y: y + spineT },
        { x: x + barT,  y: y + spineT },
        { x: x + barT,  y: y1 },
        { x,            y: y1 },
      ];
  }
};

/** Mouth dimensions: how deep it cuts in (depth, opposite the spine) and the clear
 *  gap between the two arms. */
const cMouthDims = (c: CParams): { depth: number; gap: number } => {
  const isHorizontal = c.orientation === "right" || c.orientation === "left";
  return isHorizontal
    ? { depth: c.w - c.spineT, gap: c.h - 2 * c.barT }
    : { depth: c.h - c.spineT, gap: c.w - 2 * c.barT };
};

const cMouthOk = (c: CParams, minNotch: number): boolean => {
  if (minNotch <= 0) return true;
  const { depth, gap } = cMouthDims(c);
  return depth >= minNotch && gap >= minNotch;
};

const cInside = (c: CParams, poly: Point[]): boolean => {
  const verts = cVertices(c);
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

const cArea = (c: CParams): number => {
  const isHorizontal = c.orientation === "right" || c.orientation === "left";
  // Two arms (full length along the open axis) + the spine filling the gap between them.
  return isHorizontal
    ? 2 * c.w * c.barT + c.spineT * (c.h - 2 * c.barT)
    : 2 * c.h * c.barT + c.spineT * (c.w - 2 * c.barT);
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface OptimiseCShapeParams {
  pts: Point[];
  axisAngleDeg: number;
  randomSamples?: number;
  refineIters?: number;
  /** Minimum arm/spine thickness in pixels. Default 4. */
  minArmPx?: number;
  /** Minimum mouth size in pixels (its depth & the gap between arms). Default 0. */
  minNotchPx?: number;
}

export interface OptimiseCShapeResult {
  outline: Point[] | null;
  areaPx: number;
  params: CParams | null;
  success: boolean;
  errorMessage?: string;
}

export function computeOptimiseCShape(params: OptimiseCShapeParams): OptimiseCShapeResult {
  const { pts, axisAngleDeg } = params;
  const N = params.randomSamples ?? 6000;
  const refineIters = params.refineIters ?? 240;
  const minArm = params.minArmPx ?? 4;
  const minNotch = Math.max(0, params.minNotchPx ?? 0);
  const depthMin = Math.max(minArm, minNotch); // how far the mouth cuts in
  const gapMin = Math.max(minArm, minNotch);   // clear gap between the arms

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
  // Open axis: spine (≥ minArm) + mouth depth (≥ depthMin). Gap axis: 2 arms (≥ minArm) + mouth gap (≥ gapMin).
  const minOpen = minArm + depthMin;
  const minGapAxis = 2 * minArm + gapMin;
  const minSide = Math.min(minOpen, minGapAxis);
  if (span <= minSide) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "polygon too small for the minimum mouth" };
  }

  let seed = Math.round(axisAngleDeg * 1000) | 0;
  for (const p of pts) {
    seed = (seed * 31 + Math.round(p.x * 100)) | 0;
    seed = (seed * 31 + Math.round(p.y * 100)) | 0;
  }
  const rand = mulberry32(seed ^ 0x0CAB);

  let best: CParams | null = null;
  let bestArea = 0;

  for (let k = 0; k < N; k++) {
    const x0 = minX + rand() * (maxX - minX);
    const y0 = minY + rand() * (maxY - minY);
    const wMax = maxX - x0;
    const hMax = maxY - y0;
    const orientation = ALL_ORIENTATIONS[(rand() * 4) | 0];
    const isHorizontal = orientation === "right" || orientation === "left";
    const wMin = isHorizontal ? minOpen : minGapAxis;
    const hMin = isHorizontal ? minGapAxis : minOpen;
    if (wMax < wMin || hMax < hMin) continue;
    const w = wMin + Math.pow(rand(), 0.5) * (wMax - wMin);
    const h = hMin + Math.pow(rand(), 0.5) * (hMax - hMin);
    const openSpan = isHorizontal ? w : h;  // spine + mouth depth
    const gapSpan = isHorizontal ? h : w;   // 2 arms + mouth gap
    // Spine thickness: leave ≥ depthMin for the mouth depth.
    const spineMax = openSpan - depthMin;
    if (spineMax < minArm) continue;
    const spineT = minArm + rand() * (spineMax - minArm);
    // Arm thickness: 2 arms + a gap ≥ gapMin.
    const barTMax = (gapSpan - gapMin) / 2;
    if (barTMax < minArm) continue;
    const barT = minArm + rand() * (barTMax - minArm);
    const cand: CParams = { x: x0, y: y0, w, h, barT, spineT, orientation };
    if (!cMouthOk(cand, minNotch)) continue;
    if (!cInside(cand, rotPoly)) continue;
    const a = cArea(cand);
    if (a > bestArea) { bestArea = a; best = cand; }
  }

  if (!best) {
    return { outline: null, areaPx: 0, params: null, success: false, errorMessage: "no valid C found in random search" };
  }

  let step = Math.max(span * 0.05, minArm);
  const stepFloor = 0.25;
  for (let iter = 0; iter < refineIters && step >= stepFloor; iter++) {
    let improved = false;
    const tweaks: Array<(c: CParams, s: number) => CParams> = [
      (c, s) => ({ ...c, x: c.x - s, w: c.w + s }),
      (c, s) => ({ ...c, w: c.w + s }),
      (c, s) => ({ ...c, y: c.y - s, h: c.h + s }),
      (c, s) => ({ ...c, h: c.h + s }),
      (c, s) => ({ ...c, barT: c.barT + s }),
      (c, s) => ({ ...c, barT: Math.max(minArm, c.barT - s) }),
      (c, s) => ({ ...c, spineT: c.spineT + s }),
      (c, s) => ({ ...c, spineT: Math.max(minArm, c.spineT - s) }),
    ];
    for (const tweak of tweaks) {
      const cand = tweak(best, step);
      const isHorizontal = cand.orientation === "right" || cand.orientation === "left";
      const openSpan = isHorizontal ? cand.w : cand.h;
      const gapSpan = isHorizontal ? cand.h : cand.w;
      if (cand.w < (isHorizontal ? minOpen : minGapAxis)) continue;
      if (cand.h < (isHorizontal ? minGapAxis : minOpen)) continue;
      // Spine ≥ minArm with mouth depth ≥ depthMin; arms ≥ minArm with a gap ≥ gapMin.
      if (cand.spineT < minArm || cand.spineT > openSpan - depthMin) continue;
      if (cand.barT < minArm || 2 * cand.barT > gapSpan - gapMin) continue;
      if (!cMouthOk(cand, minNotch)) continue;
      if (!cInside(cand, rotPoly)) continue;
      const a = cArea(cand);
      if (a > bestArea) { bestArea = a; best = cand; improved = true; }
    }
    if (!improved) step *= 0.5;
  }

  const verts = cVertices(best);
  const outline = verts.map((p) => rotAround(p, cx, cy, cos, sin));
  return { outline, areaPx: bestArea, params: best, success: true };
}
