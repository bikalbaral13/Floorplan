/** Pure polygon smoothing — Chaikin corner-cutting or cubic Bézier corner fillets, with optional
 *  "restrict inside" reflex handling and a post curve-shortening (Grayson flow) pass.
 *
 *  Extracted from the Smoothing block's runner so the Flow "Smoothing" node previews exactly what
 *  Run Flow commits — both call this one function. */
import type { Point } from "../../types";
import { curveShorteningFlow } from "./curveShorteningFlow";

export type SmoothingType = "chaikin" | "bezier";

export interface SmoothPolygonOptions {
  type: SmoothingType;
  /** 0..1 — Chaikin iterations (0..5) or Bézier fillet radius fraction. */
  level: number;
  /** Keep the smoothed curve inside the original polygon (sharp inward corners at reflex vertices). */
  restrictInside: boolean;
  /** 0..100 — Grayson curve-shortening applied after smoothing (0 = none, 100 = collapse). */
  curveShortening: number;
}

/** Smooth a polygon. Returns the smoothed (de-duplicated) vertex list, or [] when degenerate. */
export const computeSmoothedPolygon = (points: Point[], opts: SmoothPolygonOptions): Point[] => {
  const { type, level, restrictInside, curveShortening } = opts;
  if (points.length < 3) return [];

  // Normalise to MATH-CCW (positive shoelace) so reflex detection (cross < 0) is orientation-stable.
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  const polygon: Point[] = signedArea < 0 ? [...points].reverse() : points.slice();
  if (polygon.length < 3) return [];

  let smoothPts: Point[] = [];

  const isReflexAt = (poly: Point[], i: number): boolean => {
    const N = poly.length;
    const prev = poly[(i - 1 + N) % N];
    const v = poly[i];
    const next = poly[(i + 1) % N];
    return (v.x - prev.x) * (next.y - v.y) - (v.y - prev.y) * (next.x - v.x) < 0;
  };

  if (type === "chaikin") {
    const iterations = Math.max(0, Math.round(level * 5));

    // Restrict-inside pre-processing: replace each reflex vertex with an inset Bézier sample so the
    // subsequent corner-cutting can't produce outward-bulging diagonals.
    let pts: Point[];
    if (restrictInside) {
      const PULL_REFLEX = 4 / 3;
      const PRE_SAMPLES = 10;
      const N = polygon.length;
      pts = [];
      for (let i = 0; i < N; i++) {
        const prev = polygon[(i - 1 + N) % N];
        const v = polygon[i];
        const next = polygon[(i + 1) % N];
        if (!isReflexAt(polygon, i)) {
          pts.push({ x: v.x, y: v.y });
          continue;
        }
        const lenPrev = Math.hypot(v.x - prev.x, v.y - prev.y);
        const lenNext = Math.hypot(next.x - v.x, next.y - v.y);
        const maxR = Math.min(lenPrev, lenNext) * 0.49;
        const r = Math.max(0, Math.min(maxR, Math.max(0.2, level) * maxR));
        if (r < 0.5) { pts.push({ x: v.x, y: v.y }); continue; }
        const inDx = v.x - prev.x, inDy = v.y - prev.y;
        const inLen = Math.hypot(inDx, inDy) || 1;
        const outDx = next.x - v.x, outDy = next.y - v.y;
        const outLen = Math.hypot(outDx, outDy) || 1;
        const p1 = { x: v.x - (inDx / inLen) * r, y: v.y - (inDy / inLen) * r };
        const p2 = { x: v.x + (outDx / outLen) * r, y: v.y + (outDy / outLen) * r };
        const c1 = { x: p1.x + (v.x - p1.x) * PULL_REFLEX, y: p1.y + (v.y - p1.y) * PULL_REFLEX };
        const c2 = { x: p2.x + (v.x - p2.x) * PULL_REFLEX, y: p2.y + (v.y - p2.y) * PULL_REFLEX };
        for (let s = 0; s <= PRE_SAMPLES; s++) {
          const t = s / PRE_SAMPLES;
          const u = 1 - t;
          const x = u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x;
          const y = u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y;
          pts.push({ x, y });
        }
      }
    } else {
      pts = polygon.map((p) => ({ x: p.x, y: p.y }));
    }

    for (let iter = 0; iter < iterations; iter++) {
      const next: Point[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        next.push(
          { x: a.x + 0.25 * (b.x - a.x), y: a.y + 0.25 * (b.y - a.y) },
          { x: a.x + 0.75 * (b.x - a.x), y: a.y + 0.75 * (b.y - a.y) },
        );
      }
      pts = next;
    }
    smoothPts = pts;
  } else {
    // Bézier corner fillets: round each corner with a cubic Bézier.
    const N = polygon.length;
    const KAPPA = 0.5523;
    const SAMPLES = 12;
    const radii: number[] = [];
    for (let i = 0; i < N; i++) {
      const prev = polygon[(i - 1 + N) % N], v = polygon[i], next = polygon[(i + 1) % N];
      const lenPrev = Math.hypot(v.x - prev.x, v.y - prev.y);
      const lenNext = Math.hypot(next.x - v.x, next.y - v.y);
      const maxR = Math.min(lenPrev, lenNext) * 0.49;
      radii.push(Math.max(0, Math.min(maxR, level * maxR)));
    }
    const out: Point[] = [];
    for (let i = 0; i < N; i++) {
      const prev = polygon[(i - 1 + N) % N], v = polygon[i], next = polygon[(i + 1) % N];
      const reflex = restrictInside && isReflexAt(polygon, i);
      const r = radii[i];
      const inDx = v.x - prev.x, inDy = v.y - prev.y;
      const inLen = Math.hypot(inDx, inDy) || 1;
      const outDx = next.x - v.x, outDy = next.y - v.y;
      const outLen = Math.hypot(outDx, outDy) || 1;
      const p1 = { x: v.x - (inDx / inLen) * r, y: v.y - (inDy / inLen) * r };
      const p2 = { x: v.x + (outDx / outLen) * r, y: v.y + (outDy / outLen) * r };
      if (r < 0.5) {
        out.push({ x: v.x, y: v.y });
        continue;
      }
      const PULL = reflex ? 4 / 3 : KAPPA;
      const c1 = { x: p1.x + (v.x - p1.x) * PULL, y: p1.y + (v.y - p1.y) * PULL };
      const c2 = { x: p2.x + (v.x - p2.x) * PULL, y: p2.y + (v.y - p2.y) * PULL };
      for (let s = 0; s <= SAMPLES; s++) {
        const t = s / SAMPLES;
        const u = 1 - t;
        const x = u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x;
        const y = u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y;
        out.push({ x, y });
      }
    }
    smoothPts = out;
  }

  // Curve-shortening flow after smoothing (independent of restrict-inside).
  if (curveShortening > 0) {
    smoothPts = curveShorteningFlow(smoothPts, curveShortening / 100);
  }

  // De-duplicate near-identical consecutive points.
  const cleanedPts: Point[] = [];
  for (const p of smoothPts) {
    const last = cleanedPts[cleanedPts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.3) cleanedPts.push(p);
  }
  return cleanedPts.length >= 3 ? cleanedPts : [];
};
