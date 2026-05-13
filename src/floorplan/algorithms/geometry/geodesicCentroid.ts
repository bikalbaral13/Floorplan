import type { Point } from "../../types";

/** Result of a geodesic-centroid computation.
 *  - `point`     — the chosen sample minimising Σ geodesic-distance to every other sample.
 *  - `samples`   — every interior sample point considered (useful for diagnostics / overlays).
 *  - `cost`      — sum of geodesic distances from `point` to all other reachable samples.
 *  - `isConvex`  — when true, the polygon is convex so geodesic distance equals Euclidean; the
 *                  fast Euclidean fallback was used (visibility graph skipped). */
export interface GeodesicCentroidResult {
  point: Point;
  samples: Point[];
  cost: number;
  isConvex: boolean;
}

const cross = (o: Point, p: Point, q: Point) =>
  (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);

/** Strict segment intersection — true only when AB and CD cross at an interior point of each
 *  (collinear / shared-endpoint cases return false so visibility-graph edges that meet at a
 *  polygon vertex don't disqualify themselves). */
const segmentsIntersectStrict = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
};

const pointInPolygon = (p: Point, poly: Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y)) &&
      (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

/** Does segment AB lie strictly inside `poly`? Used to build the visibility graph: an edge
 *  exists between two nodes iff the straight line between them never leaves the polygon. */
const segmentInsidePolygon = (a: Point, b: Point, poly: Point[]): boolean => {
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    if (segmentsIntersectStrict(a, b, p1, p2)) return false;
  }
  // Mid-point must be inside — catches segments running along a concavity that the strict
  // intersection test would miss (they only touch polygon edges, never cross them).
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return pointInPolygon(mid, poly);
};

const polygonIsConvex = (poly: Point[]): boolean => {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    const z = cross(a, b, c);
    if (Math.abs(z) < 1e-9) continue;
    if (sign === 0) sign = z > 0 ? 1 : -1;
    else if ((z > 0 ? 1 : -1) !== sign) return false;
  }
  return true;
};

const polygonAbsArea = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(a) / 2;
};

/** Geodesic centroid (a.k.a. 1-median under the geodesic metric):
 *  the point inside `polygon` minimising the sum of *shortest-paths-inside-the-polygon* to
 *  every other interior point.
 *
 *  Algorithm:
 *    1. Reject-sample a uniform grid; keep every cell-centre that lies inside the polygon.
 *       `samplesTarget` is the rough target count (the actual grid resolution is adjusted up
 *       so non-convex polygons with low fill-ratio still produce enough interior samples).
 *    2. If the polygon is convex, geodesic = Euclidean — skip the visibility graph and just
 *       pick the sample minimising Σ Euclidean-distance (O(N²)).
 *    3. Otherwise build a visibility graph over (samples + polygon vertices). Two nodes get an
 *       edge if and only if the straight segment between them stays inside the polygon.
 *       Edge weight = Euclidean length.
 *    4. Run Dijkstra from each sample. Sum the resulting geodesic distances to all other
 *       samples; the sample with the smallest sum is the geodesic centroid.
 *
 *  Complexity: O(N²) visibility-graph build + O(S · N²) Dijkstra (no heap, dense). For N ≈ 150
 *  and S ≈ 100 this is < 5 ms — comfortable for a Live preview slider. */
export const geodesicCentroid = (
  polygon: Point[],
  samplesTarget = 80,
): GeodesicCentroidResult | null => {
  if (polygon.length < 3) return null;

  // ── 1. Bounding box + grid resolution ──
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;
  const polyArea = polygonAbsArea(polygon);
  const fillRatio = polyArea / (width * height) || 0.5;
  const sideN = Math.max(6, Math.ceil(Math.sqrt(samplesTarget / Math.max(0.1, fillRatio))));
  const cellW = width / sideN;
  const cellH = height / sideN;

  const samples: Point[] = [];
  for (let j = 0; j < sideN; j++) {
    for (let i = 0; i < sideN; i++) {
      const x = minX + (i + 0.5) * cellW;
      const y = minY + (j + 0.5) * cellH;
      if (pointInPolygon({ x, y }, polygon)) samples.push({ x, y });
    }
  }
  if (samples.length === 0) return null;

  // ── 2. Convex fast path ──
  if (polygonIsConvex(polygon)) {
    let bestIdx = 0;
    let bestCost = Infinity;
    for (let i = 0; i < samples.length; i++) {
      let c = 0;
      for (let j = 0; j < samples.length; j++) {
        if (i === j) continue;
        c += Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y);
      }
      if (c < bestCost) { bestCost = c; bestIdx = i; }
    }
    return { point: samples[bestIdx], samples, cost: bestCost, isConvex: true };
  }

  // ── 3. Visibility graph (nodes = samples ++ polygon vertices) ──
  const nodes: Point[] = [...samples, ...polygon];
  const N = nodes.length;
  const adj: Array<Array<{ to: number; w: number }>> = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (segmentInsidePolygon(nodes[i], nodes[j], polygon)) {
        const w = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        adj[i].push({ to: j, w });
        adj[j].push({ to: i, w });
      }
    }
  }

  // ── 4. Dijkstra from each sample (dense, no heap — fast at our N) ──
  const INF = Infinity;
  let bestIdx = 0;
  let bestCost = INF;
  const dist = new Array<number>(N);
  const visited = new Array<boolean>(N);
  for (let s = 0; s < samples.length; s++) {
    for (let i = 0; i < N; i++) { dist[i] = INF; visited[i] = false; }
    dist[s] = 0;
    for (let k = 0; k < N; k++) {
      let u = -1, du = INF;
      for (let i = 0; i < N; i++) {
        if (!visited[i] && dist[i] < du) { u = i; du = dist[i]; }
      }
      if (u === -1) break;
      visited[u] = true;
      for (const { to, w } of adj[u]) {
        const alt = dist[u] + w;
        if (alt < dist[to]) dist[to] = alt;
      }
    }
    let cost = 0;
    let reach = 0;
    for (let t = 0; t < samples.length; t++) {
      if (t === s) continue;
      if (dist[t] === INF) continue;
      cost += dist[t];
      reach++;
    }
    // Heavily penalise unreachable samples so disconnected pockets don't accidentally win
    // (e.g. a degenerate self-intersecting polygon where some samples are walled off).
    if (reach < samples.length - 1) {
      cost += (samples.length - 1 - reach) * 1e9;
    }
    if (cost < bestCost) { bestCost = cost; bestIdx = s; }
  }

  return { point: samples[bestIdx], samples, cost: bestCost, isConvex: false };
};
