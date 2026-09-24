/**
 * pull.ts
 *
 * "Pull" two Space polygons together (or apart) — the geometry behind the Connection-segment Pull panel,
 * extracted as a pure function so the Flow "Pull" node can reuse it. Given two polygons and a set of
 * parameters it returns the two transformed polygons.
 *
 * Modes: "centroid" (slam centroids together), "touch" (just touching), "distance" (a target gap).
 * Contact: "point" (closest approach along the centroid axis) or "edge-flush" (rotate so the facing
 * edges become parallel, then close the perpendicular gap, optionally sliding the edges to overlap).
 * Anchor: which space moves — "A", "B", or "both" (split evenly). All distances in METRES (× ppm).
 */

import type { Point } from "../types.js";
import { polygonCentroid, rotatePolygon } from "./polygon.js";

export interface PullParams {
  mode: "centroid" | "touch" | "distance";
  anchor: "A" | "B" | "both";
  contact: "point" | "edge-flush";
  /** Target gap in metres (used by "distance" mode). */
  distance: number;
  /** Edge-flush only: slide the facing edges along their shared direction so they overlap. */
  edgeSlide: boolean;
}

/** SAT-based convex polygon overlap test (false negatives possible on non-convex rooms). */
const polygonsOverlapSAT = (A: Point[], B: Point[]): boolean => {
  const collectAxes = (poly: Point[], out: Point[]) => {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      const ex = p2.x - p1.x, ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey) || 1;
      out.push({ x: -ey / len, y: ex / len });
    }
  };
  const project = (poly: Point[], axis: Point) => {
    let min = Infinity, max = -Infinity;
    for (const p of poly) { const proj = p.x * axis.x + p.y * axis.y; if (proj < min) min = proj; if (proj > max) max = proj; }
    return { min, max };
  };
  const axes: Point[] = [];
  collectAxes(A, axes); collectAxes(B, axes);
  const eps = 1e-6;
  for (const axis of axes) {
    const pa = project(A, axis), pb = project(B, axis);
    if (pa.max < pb.min - eps || pb.max < pa.min - eps) return false;
  }
  return true;
};

/** Outward unit normal of edge (p1→p2), oriented away from the polygon centroid. */
const outwardNormal = (p1: Point, p2: Point, centroid: Point): Point => {
  const ex = p2.x - p1.x, ey = p2.y - p1.y;
  const len = Math.hypot(ex, ey) || 1;
  let nx = -ey / len, ny = ex / len;
  const mx = (p1.x + p2.x) / 2 - centroid.x;
  const my = (p1.y + p2.y) / 2 - centroid.y;
  if (mx * nx + my * ny < 0) { nx = -nx; ny = -ny; }
  return { x: nx, y: ny };
};

/** Best facing edge-pair + the signed rotation θ to apply to A so its facing edge becomes anti-parallel
 *  to B's facing edge. Smallest |θ| wins. */
const planEdgeFlush = (A: Point[], B: Point[], cA: Point, cB: Point, dir: Point) => {
  const facing = (poly: Point[], c: Point, sign: number) => {
    const out: Array<{ idx: number; nx: number; ny: number }> = [];
    for (let i = 0; i < poly.length; i++) {
      const n = outwardNormal(poly[i], poly[(i + 1) % poly.length], c);
      if ((n.x * dir.x + n.y * dir.y) * sign > 0) out.push({ idx: i, nx: n.x, ny: n.y });
    }
    return out;
  };
  const aEdges = facing(A, cA, +1);
  const bEdges = facing(B, cB, -1);
  if (aEdges.length === 0 || bEdges.length === 0) return null;
  let best: { angle: number; aIdx: number; bIdx: number } | null = null;
  for (const ea of aEdges) {
    for (const eb of bEdges) {
      const target = { x: -eb.nx, y: -eb.ny };
      const angle = Math.atan2(ea.nx * target.y - ea.ny * target.x, ea.nx * target.x + ea.ny * target.y);
      if (!best || Math.abs(angle) < Math.abs(best.angle)) best = { angle, aIdx: ea.idx, bIdx: eb.idx };
    }
  }
  return best;
};

/** Minimum r ≥ 0 such that translating B by -r·d makes A and B touch. 0 if already overlapping; null if
 *  no overlap is reachable along d. */
const findTouchDistance = (A: Point[], B: Point[], d: Point): number | null => {
  if (polygonsOverlapSAT(A, B)) return 0;
  const translate = (poly: Point[], r: number) => poly.map((p) => ({ x: p.x - r * d.x, y: p.y - r * d.y }));
  let probe = 1, hi = 0;
  for (let i = 0; i < 30; i++) { if (polygonsOverlapSAT(A, translate(B, probe))) { hi = probe; break; } probe *= 2; }
  if (hi === 0) return null;
  let lo = 0;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (polygonsOverlapSAT(A, translate(B, mid))) hi = mid; else lo = mid; if (hi - lo < 1e-3) break; }
  return hi;
};

const translatePoly = (poly: Point[], dx: number, dy: number): Point[] => poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));

/**
 * Pull two polygons per the parameters and return the transformed pair. On any degenerate / unreachable
 * case the inputs are returned unchanged.
 */
export function computePull(polyA: Point[], polyB: Point[], params: PullParams, pixelsPerMeter: number): { a: Point[]; b: Point[] } {
  const fallback = { a: polyA, b: polyB };
  if (polyA.length < 3 || polyB.length < 3) return fallback;
  const ca = polygonCentroid(polyA), cb = polygonCentroid(polyB);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return fallback;
  const ux = dx / dist, uy = dy / dist;
  const { mode, anchor, contact, distance, edgeSlide } = params;

  const splitMove = (mvx: number, mvy: number) => ({
    dxA: anchor === "A" ? mvx : anchor === "both" ? mvx / 2 : 0,
    dyA: anchor === "A" ? mvy : anchor === "both" ? mvy / 2 : 0,
    dxB: anchor === "B" ? -mvx : anchor === "both" ? -mvx / 2 : 0,
    dyB: anchor === "B" ? -mvy : anchor === "both" ? -mvy / 2 : 0,
  });

  let angleA = 0, angleB = 0, dxA = 0, dyA = 0, dxB = 0, dyB = 0;

  if (mode === "centroid") {
    ({ dxA, dyA, dxB, dyB } = splitMove(ux * dist, uy * dist));
  } else if (contact === "point") {
    const r = findTouchDistance(polyA, polyB, { x: ux, y: uy });
    if (r === null) return fallback;
    const move = mode === "touch" ? r : r - distance * pixelsPerMeter;
    ({ dxA, dyA, dxB, dyB } = splitMove(ux * move, uy * move));
  } else {
    // edge-flush
    const plan = planEdgeFlush(polyA, polyB, ca, cb, { x: ux, y: uy });
    if (!plan) return fallback;
    const θ = plan.angle;
    if (anchor === "A") angleA = θ;
    else if (anchor === "B") angleB = -θ;
    else { angleA = θ / 2; angleB = -θ / 2; }
    const pA = rotatePolygon(polyA, ca, angleA);
    const pB = rotatePolygon(polyB, cb, angleB);
    const aP1 = pA[plan.aIdx], aP2 = pA[(plan.aIdx + 1) % pA.length];
    const aNorm = outwardNormal(aP1, aP2, ca);
    const nx = aNorm.x, ny = aNorm.y;
    const tlen = Math.hypot(aP2.x - aP1.x, aP2.y - aP1.y) || 1;
    const tux = (aP2.x - aP1.x) / tlen, tuy = (aP2.y - aP1.y) / tlen;
    const bP1 = pB[plan.bIdx];
    const perpDist = nx * (bP1.x - aP1.x) + ny * (bP1.y - aP1.y);
    const target = mode === "touch" ? 0 : distance * pixelsPerMeter;
    const closeBy = perpDist - target;
    const base = splitMove(nx * closeBy, ny * closeBy);
    dxA = base.dxA; dyA = base.dyA; dxB = base.dxB; dyB = base.dyB;
    if (edgeSlide) {
      const newCa = { x: ca.x + dxA, y: ca.y + dyA };
      const newCb = { x: cb.x + dxB, y: cb.y + dyB };
      const projT = (newCb.x - newCa.x) * tux + (newCb.y - newCa.y) * tuy;
      if (anchor === "A") { dxA += projT * tux; dyA += projT * tuy; }
      else if (anchor === "B") { dxB += -projT * tux; dyB += -projT * tuy; }
      else { dxA += (projT * tux) / 2; dyA += (projT * tuy) / 2; dxB += -(projT * tux) / 2; dyB += -(projT * tuy) / 2; }
    }
    return {
      a: translatePoly(pA, dxA, dyA),
      b: translatePoly(pB, dxB, dyB),
    };
  }

  return {
    a: translatePoly(rotatePolygon(polyA, ca, angleA), dxA, dyA),
    b: translatePoly(rotatePolygon(polyB, cb, angleB), dxB, dyB),
  };
}
