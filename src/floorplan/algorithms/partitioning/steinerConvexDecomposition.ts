import type { Point } from "../../types";
import { decomposeBayazit } from "./convexDecomposition";

/** Steiner-enriched convex decomposition.
 *
 *  Two-phase algorithm:
 *
 *    Phase 1 — ENRICH. Walk every reflex vertex of the polygon. For each, cast two rays from
 *    the reflex vertex along the supporting lines of its two incident edges (the "extension"
 *    directions, heading into the polygon interior). Each ray that lands MID-EDGE on the
 *    polygon boundary contributes a new Steiner vertex inserted on that edge. The resulting
 *    "enriched" polygon has the original N vertices plus up to 2·R new Steiner vertices.
 *
 *    Phase 2 — DECOMPOSE. Run the standard Bayazit diagonal convex-decomposition on the
 *    enriched polygon. Because the supporting-line Steiner points are now real polygon
 *    vertices, Bayazit's diagonals can connect a reflex vertex DIRECTLY to one of these
 *    Steiner points — which is exactly the "edge extension" cut we wanted, expressed as
 *    a vertex-to-vertex diagonal.
 *
 *  Robustness wins:
 *    – If both supporting lines of a reflex vertex hit existing polygon vertices (pathological
 *      skewed L/T/U), no new Steiner points are added and Bayazit proceeds on the original
 *      polygon. The result degrades gracefully to a regular diagonal decomposition.
 *    – If a supporting line happens to be collinear with a polygon edge or hits exactly on
 *      a vertex (s ≈ 0 or s ≈ 1), the insertion is skipped — the existing vertex is already
 *      available for Bayazit to use.
 *    – No bespoke chord-selection heuristics needed; the proven Bayazit logic handles which
 *      diagonal to pick at each reflex. */

const CROSS_TOL = 1e-9;
const HIT_TOL = 1e-6;
const VERTEX_MERGE_TOL = 1e-3;

const cross3 = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

const normalizeCCW = (points: Point[]): Point[] => {
  let s = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s < 0 ? [...points].reverse() : points.slice();
};

const isReflex = (poly: Point[], i: number): boolean => {
  const n = poly.length;
  const prev = poly[(i - 1 + n) % n];
  const v = poly[i];
  const next = poly[(i + 1) % n];
  return cross3(prev, v, next) < -CROSS_TOL;
};

/** Ray-segment intersection. Returns the hit point + segment parameter `s` (where the hit
 *  lies on the segment, in [0, 1]). Returns null if no forward hit (t > 0) or if `s` is
 *  outside [0, 1]. */
const rayHitsSegment = (
  origin: Point,
  dirX: number,
  dirY: number,
  a: Point,
  b: Point,
): { t: number; s: number; point: Point } | null => {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const det = dirX * (-sy) - dirY * (-sx);
  if (Math.abs(det) < CROSS_TOL) return null;
  const rx = a.x - origin.x;
  const ry = a.y - origin.y;
  const t = (rx * (-sy) - ry * (-sx)) / det;
  const s = (dirX * ry - dirY * rx) / det;
  if (t <= HIT_TOL) return null;
  if (s < -HIT_TOL || s > 1 + HIT_TOL) return null;
  return { t, s, point: { x: origin.x + t * dirX, y: origin.y + t * dirY } };
};

/** Closest forward ray-edge hit. Skips the two edges incident to `reflexIdx`. */
const closestRayHit = (
  poly: Point[],
  origin: Point,
  dirX: number,
  dirY: number,
  reflexIdx: number,
): { edgeIdx: number; point: Point; t: number; s: number } | null => {
  const n = poly.length;
  const skipPrev = (reflexIdx - 1 + n) % n;
  let best: { edgeIdx: number; point: Point; t: number; s: number } | null = null;
  for (let i = 0; i < n; i += 1) {
    if (i === reflexIdx || i === skipPrev) continue;
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const hit = rayHitsSegment(origin, dirX, dirY, a, b);
    if (hit && (best === null || hit.t < best.t)) {
      best = { edgeIdx: i, point: hit.point, t: hit.t, s: hit.s };
    }
  }
  return best;
};

/** Phase 1 — enrich the polygon with Steiner points. For every reflex vertex, cast both
 *  supporting-line rays (extension directions) and insert each MID-EDGE hit as a new vertex
 *  on the appropriate edge. Hits at s < 0.02 or s > 0.98 are skipped (the existing vertex
 *  is already there and Bayazit will use it).
 *
 *  Exported as a separate API so callers (e.g. the editor) can render the Steiner points as
 *  visible markers on the canvas alongside the decomposition. */
export interface SteinerEnrichResult {
  /** The polygon with Steiner points inserted as new vertices in CCW order. */
  enriched: Point[];
  /** The new vertices added — the polygon-boundary intersections of the reflex-edge extensions.
   *  Subset of `enriched`; same coordinates, separately listed for overlay rendering. */
  steinerPoints: Point[];
}

export const enrichWithSteinerPoints = (polygon: Point[]): SteinerEnrichResult => {
  const n = polygon.length;
  type Insertion = { edgeIdx: number; s: number; point: Point };
  const insertions: Insertion[] = [];
  const MID_MIN = 0.02;
  const MID_MAX = 0.98;

  for (let i = 0; i < n; i += 1) {
    if (!isReflex(polygon, i)) continue;
    const prev = polygon[(i - 1 + n) % n];
    const v = polygon[i];
    const next = polygon[(i + 1) % n];

    // Two supporting-line extension directions, both heading into the polygon interior.
    const aLen = Math.hypot(v.x - prev.x, v.y - prev.y) || 1;
    const bLen = Math.hypot(v.x - next.x, v.y - next.y) || 1;
    const ndAx = (v.x - prev.x) / aLen, ndAy = (v.y - prev.y) / aLen;
    const ndBx = (v.x - next.x) / bLen, ndBy = (v.y - next.y) / bLen;

    const hitA = closestRayHit(polygon, v, ndAx, ndAy, i);
    const hitB = closestRayHit(polygon, v, ndBx, ndBy, i);

    if (hitA && hitA.s >= MID_MIN && hitA.s <= MID_MAX) {
      insertions.push({ edgeIdx: hitA.edgeIdx, s: hitA.s, point: hitA.point });
    }
    if (hitB && hitB.s >= MID_MIN && hitB.s <= MID_MAX) {
      insertions.push({ edgeIdx: hitB.edgeIdx, s: hitB.s, point: hitB.point });
    }
  }

  if (insertions.length === 0) return { enriched: polygon.slice(), steinerPoints: [] };

  // Group insertions by edge index, sort each group by `s` so insertions go in along-edge order.
  const byEdge = new Map<number, Insertion[]>();
  for (const ins of insertions) {
    const list = byEdge.get(ins.edgeIdx) ?? [];
    list.push(ins);
    byEdge.set(ins.edgeIdx, list);
  }
  for (const list of byEdge.values()) list.sort((a, b) => a.s - b.s);

  // Rebuild the polygon, inserting Steiner points along each edge in order. Dedupe inserts
  // that fall within VERTEX_MERGE_TOL of either the edge endpoints or each other (a single
  // supporting line of one reflex can graze the same Steiner location another reflex created).
  const enriched: Point[] = [];
  const steinerPoints: Point[] = [];
  const near = (p: Point, q: Point) =>
    Math.abs(p.x - q.x) < VERTEX_MERGE_TOL && Math.abs(p.y - q.y) < VERTEX_MERGE_TOL;
  for (let i = 0; i < n; i += 1) {
    enriched.push(polygon[i]);
    const inserts = byEdge.get(i);
    if (!inserts) continue;
    const next = polygon[(i + 1) % n];
    for (const ins of inserts) {
      const last = enriched[enriched.length - 1];
      if (near(ins.point, last) || near(ins.point, next)) continue;
      const p = { x: ins.point.x, y: ins.point.y };
      enriched.push(p);
      steinerPoints.push(p);
    }
  }
  return { enriched, steinerPoints };
};

/** Main entrypoint — enrich the polygon with Steiner points, then run Bayazit. */
export const decomposeSteinerEdgeExtension = (points: Point[]): Point[][] => {
  if (points.length < 3) return [];
  const polygon = normalizeCCW(points);
  const { enriched } = enrichWithSteinerPoints(polygon);
  return decomposeBayazit(enriched, 0);
};

/** Convenience: normalise + enrich. Used by the editor to render Steiner points alongside
 *  the decomposition (so they're visible as markers on the canvas). */
export const computeSteinerEnrichment = (points: Point[]): SteinerEnrichResult => {
  if (points.length < 3) return { enriched: [], steinerPoints: [] };
  return enrichWithSteinerPoints(normalizeCCW(points));
};
