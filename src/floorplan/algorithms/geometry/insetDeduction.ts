// ──────────────────────────────────────────────────────────────────────────
// Inset "Deduct Area" half-plane split.
//
// The Inset Polygon block's Deduct Area feature carves a piece out of the inset
// polygon by a half-plane at `angleDeg`, sized (via a slide along that normal)
// so the cut-off area equals a target deduction (absolute m² or a % of the main
// polygon). This helper performs that same binary-search and returns BOTH the
// cut-off piece (the deduction, drawn red) and the remaining buildable side (the
// "available" polygon the Optimise Rectangle must fit inside).
//
// Shared by the live inset overlay (to draw the deduction) and by Optimise
// Rectangle (to fit the tower clear of it) so the two never diverge.
// ──────────────────────────────────────────────────────────────────────────

import type { Point } from "../../types";
import { clipPolygonByHalfPlane } from "../partitioning/voronoi";

const polyAreaAbs = (pts: Point[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
};

export interface InsetDeductionOpts {
  /** Half-plane direction in degrees. */
  angleDeg: number;
  /** "area" → use `areaM2`; "percent" → use `percent` of `mainAreaM2`. */
  mode: "area" | "percent";
  /** Target deduction in m² (area mode). */
  areaM2: number;
  /** Target deduction as a % of the main polygon area (percent mode). */
  percent: number;
  /** Area of the MAIN (pre-inset) polygon in m² — drives percent mode. */
  mainAreaM2: number;
  /** Pixels per metre — the inset polygon is given in pixel coordinates. */
  ppm: number;
}

export interface InsetDeductionResult {
  /** Inset minus the deduction (buildable side). Equals `insetPts` when the
   *  deduction is zero; may be empty if the deduction consumes the whole inset. */
  available: Point[];
  /** The deduction cut-off piece. Empty when the deduction is zero. */
  deduction: Point[];
}

/**
 * Split an inset polygon into its deduction piece and the remaining available
 * area. Coordinates are in pixels; `ppm` converts the metric deduction target.
 */
export const clipInsetByDeduction = (
  insetPts: Point[],
  opts: InsetDeductionOpts,
): InsetDeductionResult => {
  if (insetPts.length < 3) return { available: insetPts, deduction: [] };

  const insetAreaPx2 = polyAreaAbs(insetPts);
  const dedM2 = opts.mode === "area" ? opts.areaM2 : (opts.percent / 100) * opts.mainAreaM2;
  const targetCutPx2 = Math.min(dedM2 * opts.ppm * opts.ppm, insetAreaPx2);
  if (!(targetCutPx2 > 0.5)) return { available: insetPts, deduction: [] };

  const rad = (opts.angleDeg * Math.PI) / 180;
  const nx = Math.cos(rad), ny = Math.sin(rad);
  const projs = insetPts.map((q) => q.x * nx + q.y * ny);
  const pMin = Math.min(...projs);
  const pMax = Math.max(...projs);

  // Cut-off area for slide s∈[0,100]: keep the high side (+n). Monotonic in s.
  const cutAreaAt = (s: number): number => {
    if (s <= 0) return 0;
    const c = pMax - (Math.min(100, Math.max(0, s)) / 100) * (pMax - pMin);
    const cl = clipPolygonByHalfPlane(insetPts, c * nx, c * ny, nx, ny);
    return cl.length < 3 ? 0 : polyAreaAbs(cl);
  };

  // Binary-search the slide whose cut-off area matches the target.
  let lo = 0, hi = 100;
  if (cutAreaAt(hi) > targetCutPx2) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (cutAreaAt(mid) < targetCutPx2) lo = mid; else hi = mid;
    }
  }
  const c = pMax - (hi / 100) * (pMax - pMin);
  const deduction = clipPolygonByHalfPlane(insetPts, c * nx, c * ny, nx, ny);
  const available = clipPolygonByHalfPlane(insetPts, c * nx, c * ny, -nx, -ny);
  return {
    available: available.length >= 3 ? available : [],
    deduction: deduction.length >= 3 ? deduction : [],
  };
};
