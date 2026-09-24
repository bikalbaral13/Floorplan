import type { Point } from "../types.js";

export type SkeletonType = "straight-skeleton" | "segment-sweepline" | "sampled-voronoi" | "thinning";

/** Visvalingam-Whyatt polyline simplification. Repeatedly drops the interior
 *  vertex whose triangle (with its two neighbours) has the smallest area until
 *  the surviving count reaches `targetCount`. Endpoints are preserved. O(n²)
 *  worst-case which is fine for skeleton polylines (typically < 200 vertices). */
export const simplifyPolylineVW = (poly: Point[], targetCount: number): Point[] => {
  const n = poly.length;
  if (n <= 2) return poly.slice();
  const tgt = Math.max(2, Math.min(n, targetCount));
  if (tgt >= n) return poly.slice();
  const prev = new Int32Array(n);
  const next = new Int32Array(n);
  const removed = new Uint8Array(n);
  for (let i = 0; i < n; i++) { prev[i] = i - 1; next[i] = i + 1; }
  next[n - 1] = -1;
  const triArea = (i: number): number => {
    const ip = prev[i], inx = next[i];
    if (ip < 0 || inx < 0) return Infinity;
    const a = poly[ip], b = poly[i], c = poly[inx];
    return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  };
  let remaining = n;
  while (remaining > tgt) {
    let bestI = -1, bestA = Infinity;
    for (let i = 0; i < n; i++) {
      if (removed[i]) continue;
      const A = triArea(i);
      if (A < bestA) { bestA = A; bestI = i; }
    }
    if (bestI < 0) break;
    removed[bestI] = 1;
    const p = prev[bestI], nx = next[bestI];
    if (p >= 0) next[p] = nx;
    if (nx >= 0) prev[nx] = p;
    remaining--;
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (!removed[i]) out.push(poly[i]);
  return out;
};

export interface SkeletonOptions {
  /** Per-edge sample count for `sampled-voronoi`, or grid resolution scaling for `segment-sweepline`. */
  samples?: number;
  /** Drop dead-end spurs whose endpoints coincide with an original polygon vertex (straight-skeleton only). */
  pruneEnds?: boolean;
}

export interface SkeletonEdge {
  p1: Point;
  p2: Point;
}

/** Compute a 2D polygon skeleton via one of four pipelines:
 *  - `straight-skeleton`: full event-driven straight skeleton with edge-collapse, split and
 *    vertex/pinch events (degeneracy-sanitised for rectilinear shapes, validated with a rotation retry).
 *  - `thinning`: rectilinear centerline — for axis-aligned plans (L/T/C/U/Z/stepped, any world rotation)
 *    the orthogonal per-limb spine with right-angle junctions; falls back to the straight skeleton when
 *    the polygon is not rectilinear in its own edge frame.
 *  - `segment-sweepline`: grid labelling by nearest polygon edge → emit segments where labels differ.
 *  - `sampled-voronoi`: point-Voronoi of boundary samples → emit cell-boundary edges between cells whose seeds belong to different polygon edges (medial-axis approximation). */
export const computePolygonSkeleton = (
  polygon: Point[],
  type: SkeletonType,
  opts: SkeletonOptions = {},
): SkeletonEdge[] => {
  if (polygon.length < 3) return [];
  const samples = opts.samples ?? 4;
  const pruneEnds = opts.pruneEnds ?? false;

  if (type === "thinning") return computeThinningSkeleton(polygon) ?? computeStraightSkeleton(polygon, pruneEnds);
  if (type === "straight-skeleton") return computeStraightSkeleton(polygon, pruneEnds);
  if (type === "segment-sweepline") return computeSegmentSweepline(polygon, samples);
  return computeSampledVoronoiSkeleton(polygon, samples);
};

/** First intersection of the ray `origin + t·dir` (t > 0) with the polygon boundary, or null. */
const rayPolygonHit = (origin: Point, dir: Point, polygon: Point[]): Point | null => {
  let best: Point | null = null;
  let bestT = Infinity;
  const N = polygon.length;
  for (let i = 0; i < N; i++) {
    const a = polygon[i], b = polygon[(i + 1) % N];
    const ex = b.x - a.x, ey = b.y - a.y;
    const denom = dir.x * ey - dir.y * ex;
    if (Math.abs(denom) < 1e-9) continue; // parallel
    // origin + t·dir = a + s·(b-a)
    const t = ((a.x - origin.x) * ey - (a.y - origin.y) * ex) / denom;
    const s = ((a.x - origin.x) * dir.y - (a.y - origin.y) * dir.x) / denom;
    if (t > 1e-3 && s >= -1e-6 && s <= 1 + 1e-6 && t < bestT) {
      bestT = t;
      best = { x: origin.x + t * dir.x, y: origin.y + t * dir.y };
    }
  }
  return best;
};

/** "Reduce segments": thin a skeleton by repeatedly midpoint-merging interior vertices, anchored at
 *  the chain endpoints (junctions AND tips stay fixed, so connectivity and the skeleton's reach are
 *  preserved). The graph is split into chains at every node of degree ≠ 2; within each chain the
 *  interior vertices are pairwise-averaged to their midpoints, halving interior detail per `level`.
 *  Closed loops (all degree-2) are decimated cyclically. Endpoints are never moved, so tips used by
 *  computeSkeletonBoundaryJoins are unchanged. */
export const reduceSkeletonByMidpoints = (edges: SkeletonEdge[], level: number): SkeletonEdge[] => {
  const L = Math.max(0, Math.min(8, Math.floor(level)));
  if (L <= 0 || edges.length === 0) return edges;
  const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const eid = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const nodePt = new Map<string, Point>();
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const ka = key(e.p1), kb = key(e.p2);
    if (ka === kb) continue;
    nodePt.set(ka, e.p1); nodePt.set(kb, e.p2);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push(kb);
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push(ka);
  }
  const degree = (k: string) => adj.get(k)?.length ?? 0;

  // Walk a maximal chain from `start` along its neighbour `first`, through degree-2 nodes only.
  const used = new Set<string>();
  const walk = (start: string, first: string): Point[] => {
    const pts = [nodePt.get(start)!];
    let prev = start, cur = first;
    used.add(eid(prev, cur));
    pts.push(nodePt.get(cur)!);
    while (degree(cur) === 2 && cur !== start) {
      const nbs = adj.get(cur)!;
      const next = nbs.find((n) => n !== prev) ?? nbs[0];
      if (next === undefined || used.has(eid(cur, next))) break;
      used.add(eid(cur, next));
      pts.push(nodePt.get(next)!);
      prev = cur; cur = next;
    }
    return pts;
  };

  type Chain = { pts: Point[]; closed: boolean };
  const chains: Chain[] = [];
  for (const k of nodePt.keys()) {
    if (degree(k) === 2) continue;
    for (const nb of adj.get(k)!) {
      if (used.has(eid(k, nb))) continue;
      chains.push({ pts: walk(k, nb), closed: false });
    }
  }
  // Any edges left over belong to pure cycles (every node degree 2).
  for (const e of edges) {
    const ka = key(e.p1), kb = key(e.p2);
    if (ka === kb || used.has(eid(ka, kb))) continue;
    chains.push({ pts: walk(ka, kb), closed: true });
  }

  const out: SkeletonEdge[] = [];
  for (const ch of chains) {
    let pts = ch.pts;
    if (ch.closed) {
      for (let it = 0; it < L && pts.length > 4; it++) {
        const next: Point[] = [];
        for (let i = 0; i < pts.length; i += 2) next.push(mid(pts[i], pts[(i + 1) % pts.length]));
        pts = next;
      }
      for (let i = 0; i < pts.length; i++) out.push({ p1: pts[i], p2: pts[(i + 1) % pts.length] });
    } else {
      for (let it = 0; it < L && pts.length > 3; it++) {
        const a = pts[0], b = pts[pts.length - 1];
        const interior = pts.slice(1, -1);
        const reduced: Point[] = [];
        for (let i = 0; i < interior.length; i += 2) {
          reduced.push(i + 1 < interior.length ? mid(interior[i], interior[i + 1]) : interior[i]);
        }
        pts = [a, ...reduced, b];
      }
      for (let i = 0; i < pts.length - 1; i++) out.push({ p1: pts[i], p2: pts[i + 1] });
    }
  }
  return out;
};

/** "Join to Boundary": for a pruned skeleton, take each open branch tip (a node touched by exactly
 *  one skeleton edge) and extend it — continuing the branch's direction — out to the polygon
 *  boundary. Returns those completion segments (the red lines). Pruning is forced on, since the tips
 *  only become interior once spurs to the original vertices are removed. */
export const computeSkeletonBoundaryJoins = (
  polygon: Point[],
  type: SkeletonType,
  samples = 8,
): SkeletonEdge[] => {
  if (polygon.length < 3) return [];
  const edges = computePolygonSkeleton(polygon, type, { samples, pruneEnds: true });
  if (edges.length === 0) return [];
  const key = (p: Point) => `${Math.round(p.x)}_${Math.round(p.y)}`;
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(key(e.p1), (degree.get(key(e.p1)) ?? 0) + 1);
    degree.set(key(e.p2), (degree.get(key(e.p2)) ?? 0) + 1);
  }
  const joins: SkeletonEdge[] = [];
  for (const e of edges) {
    for (const [tip, other] of [[e.p1, e.p2], [e.p2, e.p1]] as const) {
      if ((degree.get(key(tip)) ?? 0) !== 1) continue; // only leaf tips
      const dx = tip.x - other.x, dy = tip.y - other.y;
      const len = Math.hypot(dx, dy) || 1;
      const hit = rayPolygonHit(tip, { x: dx / len, y: dy / len }, polygon);
      if (hit && Math.hypot(hit.x - tip.x, hit.y - tip.y) > 0.5) joins.push({ p1: tip, p2: hit });
    }
  }
  return joins;
};

// ── Straight skeleton ─────────────────────────────────────────────────────────
/** Robustness wrapper. Axis-aligned (rectilinear) polygons collapse with EXACTLY simultaneous events
 *  — coincident wavefront vertices, zero-length edges and fold-back spikes that the classic edge/split
 *  event pair alone mishandles (long crisscross arcs escaping the polygon). `runStraightSkeleton`
 *  sanitises the wavefront between events; this wrapper then VALIDATES the arcs (quarter-point samples
 *  must stay inside the polygon) and, if any escape, retries once with the polygon rotated by a small fixed
 *  angle (breaking residual exact-parallel degeneracies), mapping the arcs back and keeping whichever
 *  result is cleaner. */
const computeStraightSkeleton = (polygon: Point[], pruneEnds: boolean): SkeletonEdge[] => {
  const N = polygon.length;
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = N - 1; i < N; j = i++) {
      const a = polygon[i], b = polygon[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  const distToBoundary = (px: number, py: number): number => {
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      const a = polygon[i], b = polygon[(i + 1) % N];
      const ex = b.x - a.x, ey = b.y - a.y;
      const len2 = ex * ex + ey * ey || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / len2));
      best = Math.min(best, Math.hypot(px - (a.x + t * ex), py - (a.y + t * ey)));
    }
    return best;
  };
  // Arcs that leave the polygon (beyond a 1px graze) mean the wavefront degenerated. Sampled at the
  // quarter points, not just the midpoint — a chord that dips OUT and back (crossing a concave notch)
  // can still have an inside midpoint, so one sample misses it.
  const violations = (edges: SkeletonEdge[]): number => {
    let bad = 0;
    for (const e of edges) {
      for (const t of [0.25, 0.5, 0.75]) {
        const mx = e.p1.x + (e.p2.x - e.p1.x) * t, my = e.p1.y + (e.p2.y - e.p1.y) * t;
        if (!pip(mx, my) && distToBoundary(mx, my) > 1.0) { bad++; break; }
      }
    }
    return bad;
  };
  const prune = (edges: SkeletonEdge[]): SkeletonEdge[] => {
    if (!pruneEnds) return edges;
    const VTX_TOL = 1.5;
    const nearVertex = (p: Point) => polygon.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < VTX_TOL);
    return edges.filter((e) => !nearVertex(e.p1) && !nearVertex(e.p2));
  };
  const first = runStraightSkeleton(polygon);
  const vFirst = violations(first);
  if (vFirst === 0) return prune(first);
  const cx = polygon.reduce((s, p) => s + p.x, 0) / N;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / N;
  const th = 0.0137, cosT = Math.cos(th), sinT = Math.sin(th);
  const rot = (p: Point): Point => ({ x: cx + (p.x - cx) * cosT - (p.y - cy) * sinT, y: cy + (p.x - cx) * sinT + (p.y - cy) * cosT });
  const unrot = (p: Point): Point => ({ x: cx + (p.x - cx) * cosT + (p.y - cy) * sinT, y: cy - (p.x - cx) * sinT + (p.y - cy) * cosT });
  const second = runStraightSkeleton(polygon.map(rot)).map((e) => ({ p1: unrot(e.p1), p2: unrot(e.p2) }));
  return prune(violations(second) < vFirst ? second : first);
};

const runStraightSkeleton = (polygon: Point[]): SkeletonEdge[] => {
  // (px,py) = the anchor where this vertex's current skeleton arc started; (dx,dy) = the unit bisector
  // direction the vertex was travelling when anchored (undefined until its first advance).
  type SkV = { x: number; y: number; px: number; py: number; dx?: number; dy?: number };
  const skeletonEdges: SkeletonEdge[] = [];
  let elapsedT = 0;
  let signedArea = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  const insideSign = signedArea > 0 ? 1 : -1;

  let components: SkV[][] = [polygon.map((p) => ({ x: p.x, y: p.y, px: p.x, py: p.y }))];
  const maxSteps = polygon.length * 6 + 8;

  const closeComponent = (comp: SkV[]) => {
    if (comp.length === 0) return;
    if (comp.length === 1) {
      const v = comp[0];
      if (Math.hypot(v.x - v.px, v.y - v.py) > 0.5)
        skeletonEdges.push({ p1: { x: v.px, y: v.py }, p2: { x: v.x, y: v.y } });
      return;
    }
    if (comp.length === 2) {
      const a = comp[0], b = comp[1];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (Math.hypot(mx - a.px, my - a.py) > 0.5)
        skeletonEdges.push({ p1: { x: a.px, y: a.py }, p2: { x: mx, y: my } });
      if (Math.hypot(mx - b.px, my - b.py) > 0.5)
        skeletonEdges.push({ p1: { x: b.px, y: b.py }, p2: { x: mx, y: my } });
      return;
    }
    const cx = comp.reduce((s, v) => s + v.x, 0) / comp.length;
    const cy = comp.reduce((s, v) => s + v.y, 0) / comp.length;
    for (const v of comp) {
      if (Math.hypot(cx - v.px, cy - v.py) > 0.5)
        skeletonEdges.push({ p1: { x: v.px, y: v.py }, p2: { x: cx, y: cy } });
    }
  };

  const edgeInwardNormal = (a: SkV, b: SkV): { nx: number; ny: number } => {
    const ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey) || 1e-9;
    return { nx: (-ey / L) * insideSign, ny: (ex / L) * insideSign };
  };
  const velAt = (prevN: { nx: number; ny: number }, nextN: { nx: number; ny: number }) => {
    const dot = prevN.nx * nextN.nx + prevN.ny * nextN.ny;
    const denom = 1 + dot;
    if (Math.abs(denom) < 1e-6) return { vx: 0, vy: 0 };
    let vx = (prevN.nx + nextN.nx) / denom, vy = (prevN.ny + nextN.ny) / denom;
    // Near-anti-parallel flanks (needle vertex) → speed explodes; cap it so events stay finite and
    // the spike sanitiser (below) can excise the needle instead of the vertex rocketing off.
    const sp = Math.hypot(vx, vy);
    if (sp > 50) { vx *= 50 / sp; vy *= 50 / sp; }
    return { vx, vy };
  };
  const isReflex = (prev: SkV, v: SkV, next: SkV): boolean => {
    const ax = v.x - prev.x, ay = v.y - prev.y;
    const bx = next.x - v.x, by = next.y - v.y;
    const cross = ax * by - ay * bx;
    return (cross * insideSign) < 0;
  };

  // A vertex's arc ends here — draw it from its anchor and let the caller re-anchor.
  const emitArc = (v: SkV) => {
    if (Math.hypot(v.x - v.px, v.y - v.py) > 0.5)
      skeletonEdges.push({ p1: { x: v.px, y: v.py }, p2: { x: v.x, y: v.y } });
  };
  // Degeneracy sanitiser — rectilinear shapes collapse with EXACTLY simultaneous events, which the
  // edge/split pair alone mishandles: coincident wavefront vertices, zero-length edges (whose normals
  // are garbage) and fold-back spikes freeze or corrupt every later velocity. Between events:
  //  (a) merge ADJACENT coincident vertices (their arcs end; fresh anchor at the merge point);
  //  (b) excise fold-back SPIKES (consecutive anti-parallel edges — a collapsed strip), emitting the
  //      seam arc and re-anchoring the surviving endpoint whose flank changed;
  //  (c) split a component at NON-ADJACENT coincident vertices — the missing VERTEX/PINCH event (e.g.
  //      an L-shape's reflex arc meeting a corner arc, pinching the wavefront into its two limbs).
  const EPS = 0.75;
  const sanitizeComponents = () => {
    for (let guard = 0; guard < polygon.length * 8; guard++) {
      let changed = false;
      outer: for (let c = 0; c < components.length; c++) {
        const comp = components[c];
        const K = comp.length;
        if (K < 3) continue;
        // (a) adjacent coincident → merge into one re-anchored vertex
        for (let i = 0; i < K; i++) {
          const a = comp[i], b = comp[(i + 1) % K];
          if (Math.hypot(b.x - a.x, b.y - a.y) >= EPS) continue;
          emitArc(a); emitArc(b);
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const merged: SkV = { x: mx, y: my, px: mx, py: my };
          const next: SkV[] = [];
          for (let k = 0; k < K; k++) {
            if (k === i) next.push(merged);
            else if (k !== (i + 1) % K) next.push(comp[k]);
          }
          components[c] = next;
          changed = true; break outer;
        }
        // (b) fold-back spike → excise the tip, emit the seam arc
        for (let i = 0; i < K; i++) {
          const p = comp[(i - 1 + K) % K], v = comp[i], n = comp[(i + 1) % K];
          const d1x = v.x - p.x, d1y = v.y - p.y, d2x = n.x - v.x, d2y = n.y - v.y;
          const L1 = Math.hypot(d1x, d1y), L2 = Math.hypot(d2x, d2y);
          if (L1 < 1e-9 || L2 < 1e-9) continue;
          if ((d1x * d2x + d1y * d2y) / (L1 * L2) > -0.999) continue;
          const q = L1 <= L2 ? p : n; // nearer collinear endpoint — the spike folds back onto it
          emitArc(v);
          if (Math.hypot(v.x - q.x, v.y - q.y) > 0.5)
            skeletonEdges.push({ p1: { x: v.x, y: v.y }, p2: { x: q.x, y: q.y } });
          emitArc(q); q.px = q.x; q.py = q.y; // its flanking edge changed — its arc bends here
          components[c] = comp.filter((_, k) => k !== i);
          changed = true; break outer;
        }
        // (c) non-adjacent coincident → pinch: split into two components at the touch point
        for (let i = 0; i < K; i++) {
          for (let j = i + 2; j < K; j++) {
            if (i === 0 && j === K - 1) continue; // adjacent around the wrap
            const a = comp[i], b = comp[j];
            if (Math.hypot(b.x - a.x, b.y - a.y) >= EPS) continue;
            emitArc(a); emitArc(b);
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const compA: SkV[] = [];
            for (let k = i + 1; k < j; k++) compA.push(comp[k]);
            compA.push({ x: mx, y: my, px: mx, py: my });
            const compB: SkV[] = [];
            for (let k = (j + 1) % K; k !== i; k = (k + 1) % K) compB.push(comp[k]);
            compB.push({ x: mx, y: my, px: mx, py: my });
            components.splice(c, 1, compA, compB);
            changed = true; break outer;
          }
        }
      }
      if (!changed) break;
    }
  };

  for (let step = 0; step < maxSteps; step++) {
    sanitizeComponents();
    components = components.filter((c) => {
      if (c.length < 3) { closeComponent(c); return false; }
      return true;
    });
    if (components.length === 0) break;

    type Event =
      | { kind: "edge"; t: number; comp: number; i: number }
      | { kind: "split"; t: number; comp: number; rIdx: number; jIdx: number; hit: Point };

    const compState = components.map((comp) => {
      const K = comp.length;
      const normals: { nx: number; ny: number }[] = [];
      for (let i = 0; i < K; i++) normals.push(edgeInwardNormal(comp[i], comp[(i + 1) % K]));
      const vels: { vx: number; vy: number }[] = [];
      for (let i = 0; i < K; i++) vels.push(velAt(normals[(i - 1 + K) % K], normals[i]));
      return { normals, vels };
    });

    let best: Event | null = null;
    for (let c = 0; c < components.length; c++) {
      const comp = components[c];
      const K = comp.length;
      const { normals, vels } = compState[c];
      for (let i = 0; i < K; i++) {
        const a = comp[i], b = comp[(i + 1) % K];
        const va = vels[i], vb = vels[(i + 1) % K];
        const ex = b.x - a.x, ey = b.y - a.y;
        const L = Math.hypot(ex, ey);
        if (L < 1e-6) continue;
        const ux = ex / L, uy = ey / L;
        const rate = (vb.vx - va.vx) * ux + (vb.vy - va.vy) * uy;
        if (rate < -1e-6) {
          const t = -L / rate;
          if (t > 1e-6 && (!best || t < best.t)) {
            best = { kind: "edge", t, comp: c, i };
          }
        }
      }
      for (let i = 0; i < K; i++) {
        const prev = comp[(i - 1 + K) % K], v = comp[i], next = comp[(i + 1) % K];
        if (!isReflex(prev, v, next)) continue;
        const vv = vels[i];
        for (let j = 0; j < K; j++) {
          if (j === i || j === (i - 1 + K) % K) continue;
          const a = comp[j], b = comp[(j + 1) % K];
          const va = vels[j], vb = vels[(j + 1) % K];
          const n = normals[j];
          const d0 = (v.x - a.x) * n.nx + (v.y - a.y) * n.ny;
          const vDotN = vv.vx * n.nx + vv.vy * n.ny;
          const rate = vDotN - 1;
          if (Math.abs(rate) < 1e-6) continue;
          const t = -d0 / rate;
          if (t <= 1e-6 || (best && t >= best.t)) continue;
          const hitX = v.x + vv.vx * t;
          const hitY = v.y + vv.vy * t;
          const ax = a.x + va.vx * t, ay = a.y + va.vy * t;
          const bx = b.x + vb.vx * t, by = b.y + vb.vy * t;
          const ex2 = bx - ax, ey2 = by - ay;
          const elen2 = ex2 * ex2 + ey2 * ey2;
          if (elen2 < 1e-6) continue;
          const s = ((hitX - ax) * ex2 + (hitY - ay) * ey2) / elen2;
          // Allow hits AT the edge endpoints (s ≈ 0 / 1): in rectilinear shapes the reflex arc meets a
          // corner arc exactly (a vertex event) — the sanitiser merges the resulting duplicate vertex.
          if (s < -0.02 || s > 1.02) continue;
          best = { kind: "split", t, comp: c, rIdx: i, jIdx: j, hit: { x: hitX, y: hitY } };
        }
      }
    }
    if (!best) break;
    elapsedT += best.t;

    for (let c = 0; c < components.length; c++) {
      const comp = components[c];
      const { vels } = compState[c];
      for (let i = 0; i < comp.length; i++) {
        const v = comp[i];
        const sp = Math.hypot(vels[i].vx, vels[i].vy);
        if (sp > 1e-9) {
          const ux = vels[i].vx / sp, uy = vels[i].vy / sp;
          // Arc-fidelity guard: a skeleton arc is straight ONLY while the vertex's bisector direction
          // holds. Degeneracy handling (speed caps, sanitiser merges) can bend it between events; when
          // it has bent > ~2° since this arc was anchored, close the segment and re-anchor — the arc
          // becomes a faithful polyline instead of one long cut-across chord (the boundary-hugging
          // artefact on concave limbs).
          if (v.dx !== undefined && v.dy !== undefined && v.dx * ux + v.dy * uy < 0.99939) {
            emitArc(v);
            v.px = v.x; v.py = v.y;
          }
          v.dx = ux; v.dy = uy;
        }
        v.x += vels[i].vx * best.t;
        v.y += vels[i].vy * best.t;
      }
    }

    if (best.kind === "edge") {
      const comp = components[best.comp];
      const K = comp.length;
      const i = best.i;
      const i1 = (i + 1) % K;
      const mergedX = (comp[i].x + comp[i1].x) / 2;
      const mergedY = (comp[i].y + comp[i1].y) / 2;
      if (Math.hypot(mergedX - comp[i].px, mergedY - comp[i].py) > 0.5)
        skeletonEdges.push({ p1: { x: comp[i].px, y: comp[i].py }, p2: { x: mergedX, y: mergedY } });
      if (Math.hypot(mergedX - comp[i1].px, mergedY - comp[i1].py) > 0.5)
        skeletonEdges.push({ p1: { x: comp[i1].px, y: comp[i1].py }, p2: { x: mergedX, y: mergedY } });
      const merged: SkV = { x: mergedX, y: mergedY, px: mergedX, py: mergedY };
      const next: SkV[] = [];
      for (let k = 0; k < K; k++) {
        if (k === i) next.push(merged);
        else if (k !== i1) next.push(comp[k]);
      }
      components[best.comp] = next;
    } else {
      const comp = components[best.comp];
      const K = comp.length;
      const r = best.rIdx, j = best.jIdx;
      const hitSk: SkV = { x: best.hit.x, y: best.hit.y, px: best.hit.x, py: best.hit.y };
      if (Math.hypot(hitSk.x - comp[r].px, hitSk.y - comp[r].py) > 0.5)
        skeletonEdges.push({ p1: { x: comp[r].px, y: comp[r].py }, p2: { x: hitSk.x, y: hitSk.y } });

      const compA: SkV[] = [];
      const compB: SkV[] = [];
      for (let k = (r + 1) % K; ; k = (k + 1) % K) {
        compA.push(comp[k]);
        if (k === j) break;
        if (compA.length > K) break;
      }
      compA.push({ ...hitSk });
      for (let k = (j + 1) % K; ; k = (k + 1) % K) {
        if (k === r) break;
        compB.push(comp[k]);
        if (compB.length > K) break;
      }
      compB.push({ ...hitSk });
      const replacement: SkV[][] = [];
      if (compA.length >= 3) replacement.push(compA);
      if (compB.length >= 3) replacement.push(compB);
      components.splice(best.comp, 1, ...replacement);
    }
  }

  sanitizeComponents();
  for (const c of components) closeComponent(c);
  return skeletonEdges;
};

// ── Thinning (rectilinear centerline) ────────────────────────────────────────
/** The "thinned line" of a rectilinear plan: each limb's AXIS-ALIGNED centerline meeting at right-angle
 *  junctions — the orthogonal spine a designer would draw — instead of the straight skeleton's 45°
 *  bisector network (which is medially correct but architecturally wrong for L/T/C/U/Z plans).
 *  Pipeline: dominant edge frame (length-weighted circular mean folded mod 90° — NOT PCA, whose axis is
 *  diagonal on an L) → rectilinearity gate (every edge within ~5° of an axis) → snap edges exactly H/V →
 *  grid cells from the snapped edge coordinates → greedy largest-rectangle partition (bars before stubs,
 *  so a T decomposes into bar + stem) → per-rectangle long-axis centerline, tips inset HALF THE LIMB
 *  WIDTH at cap edges (medial-style termination; `joinToBoundary` re-extends them) and flush at junction
 *  cuts → junction connectors: a flush tip extends along its own direction to the first perpendicular
 *  centerline; parallel limbs sharing a side cut (Z / offset bars) get a jog at the overlap midpoint.
 *  Returns null when the polygon is not rectilinear (or the partition degenerates) — caller falls back. */
const computeThinningSkeleton = (polygon: Point[]): SkeletonEdge[] | null => {
  if (polygon.length < 4) return null;
  // Dominant edge frame — fold every edge direction mod 90° and take the length-weighted circular mean.
  let fx = 0, fy = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const a4 = Math.atan2(dy, dx) * 4;
    fx += Math.cos(a4) * len; fy += Math.sin(a4) * len;
  }
  const theta = Math.atan2(fy, fx) / 4;
  let ccx = 0, ccy = 0;
  for (const p of polygon) { ccx += p.x / polygon.length; ccy += p.y / polygon.length; }
  const cosT = Math.cos(-theta), sinT = Math.sin(-theta);
  const rotP = (p: Point): Point => ({ x: ccx + (p.x - ccx) * cosT - (p.y - ccy) * sinT, y: ccy + (p.x - ccx) * sinT + (p.y - ccy) * cosT });
  const unrotP = (x: number, y: number): Point => ({ x: ccx + (x - ccx) * cosT + (y - ccy) * sinT, y: ccy - (x - ccx) * sinT + (y - ccy) * cosT });
  const pts: Point[] = polygon.map(rotP);

  // Rectilinearity gate: every edge longer than snap noise must lie within ~5° of horizontal/vertical.
  const DEG5 = Math.tan((5 * Math.PI) / 180);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (Math.hypot(dx, dy) < 1.5) continue;
    if (Math.min(dx, dy) > Math.max(dx, dy) * DEG5) return null;
  }

  // Merge consecutive same-orientation edges (collinear runs / sub-pixel steps) so H and V alternate —
  // the property that makes the per-edge snap below assignment-consistent.
  const isH = (a: Point, b: Point) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  for (let guard = 0; guard < polygon.length; guard++) {
    let merged = false;
    for (let i = 0; i < pts.length && pts.length > 4; i++) {
      const p0 = pts[(i - 1 + pts.length) % pts.length], p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      if (isH(p0, p1) === isH(p1, p2)) { pts.splice(i, 1); merged = true; break; }
    }
    if (!merged) break;
  }
  if (pts.length < 4 || pts.length % 2 !== 0) return null;

  // Snap: an H edge fixes both endpoints' y (their mean), a V edge their x — with alternation each
  // vertex takes x from its V edge and y from its H edge, exactly once.
  const K = pts.length;
  const snapped: Point[] = pts.map((p) => ({ ...p }));
  for (let i = 0; i < K; i++) {
    const a = pts[i], b = pts[(i + 1) % K];
    if (isH(a, b)) { const y = (a.y + b.y) / 2; snapped[i].y = y; snapped[(i + 1) % K].y = y; }
    else { const x = (a.x + b.x) / 2; snapped[i].x = x; snapped[(i + 1) % K].x = x; }
  }
  // Cluster the axis coordinates (sub-pixel duplicates collapse) and quantise the outline onto them.
  const cluster = (vals: number[]): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) if (!out.length || v - out[out.length - 1] > 0.75) out.push(v);
    return out;
  };
  const xs = cluster(snapped.map((p) => p.x));
  const ys = cluster(snapped.map((p) => p.y));
  if (xs.length < 2 || ys.length < 2) return null;
  const snapTo = (v: number, list: number[]) => list.reduce((best, c) => (Math.abs(c - v) < Math.abs(best - v) ? c : best), list[0]);
  const poly2: Point[] = snapped.map((p) => ({ x: snapTo(p.x, xs), y: snapTo(p.y, ys) }));

  const pip2 = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = poly2.length - 1; i < poly2.length; j = i++) {
      const a = poly2[i], b = poly2[j];
      if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
    }
    return inside;
  };
  const distToOutline = (px: number, py: number): number => {
    let best = Infinity;
    for (let i = 0; i < poly2.length; i++) {
      const a = poly2[i], b = poly2[(i + 1) % poly2.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const len2 = ex * ex + ey * ey || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / len2));
      best = Math.min(best, Math.hypot(px - (a.x + t * ex), py - (a.y + t * ey)));
    }
    return best;
  };
  const onOutline = (px: number, py: number) => distToOutline(px, py) < 0.75;

  // Cell grid + greedy largest-rectangle partition (largest bars claimed first: a T becomes bar + stem).
  const nxC = xs.length - 1, nyC = ys.length - 1;
  const at = (i: number, j: number) => j * nxC + i;
  const inside: boolean[] = new Array(nxC * nyC);
  for (let j = 0; j < nyC; j++) for (let i = 0; i < nxC; i++)
    inside[at(i, j)] = pip2((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2);
  const used: boolean[] = new Array(nxC * nyC).fill(false);
  type CellRect = { i1: number; i2: number; j1: number; j2: number };
  const rects: CellRect[] = [];
  for (let iter = 0; iter < 64; iter++) {
    let best: CellRect | null = null;
    let bestA = 0;
    for (let i1 = 0; i1 < nxC; i1++) for (let j1 = 0; j1 < nyC; j1++) {
      if (!inside[at(i1, j1)] || used[at(i1, j1)]) continue;
      for (let i2 = i1; i2 < nxC; i2++) for (let j2 = j1; j2 < nyC; j2++) {
        let ok = true;
        for (let i = i1; i <= i2 && ok; i++) for (let j = j1; j <= j2 && ok; j++) if (!inside[at(i, j)] || used[at(i, j)]) ok = false;
        if (!ok) continue;
        const area = (xs[i2 + 1] - xs[i1]) * (ys[j2 + 1] - ys[j1]);
        if (area > bestA) { bestA = area; best = { i1, i2, j1, j2 }; }
      }
    }
    if (!best) break;
    for (let i = best.i1; i <= best.i2; i++) for (let j = best.j1; j <= best.j2; j++) used[at(i, j)] = true;
    rects.push(best);
  }
  for (let k = 0; k < inside.length; k++) if (inside[k] && !used[k]) return null; // partition failed
  if (!rects.length) return null;

  // Per-rectangle centerline along the LONG axis. Ends flush at junction cuts; inset half the limb
  // width at cap edges (the medial-style tip — joinToBoundary re-extends it to the cap when wanted).
  type Seg = { ax: number; ay: number; bx: number; by: number; horiz: boolean; aFlush: boolean; bFlush: boolean };
  const segs: Seg[] = [];
  const segOfRect: (Seg | null)[] = [];
  for (const r of rects) {
    const x1 = xs[r.i1], x2 = xs[r.i2 + 1], y1 = ys[r.j1], y2 = ys[r.j2 + 1];
    const w = x2 - x1, h = y2 - y1;
    let seg: Seg | null = null;
    if (w >= h) {
      const yMid = (y1 + y2) / 2;
      const capL = onOutline(x1, yMid), capR = onOutline(x2, yMid);
      const ax = x1 + (capL ? h / 2 : 0), bx = x2 - (capR ? h / 2 : 0);
      if (bx - ax > 0.5) seg = { ax, ay: yMid, bx, by: yMid, horiz: true, aFlush: !capL, bFlush: !capR };
    } else {
      const xMid = (x1 + x2) / 2;
      const capB = onOutline(xMid, y1), capT = onOutline(xMid, y2);
      const ay = y1 + (capB ? w / 2 : 0), by = y2 - (capT ? w / 2 : 0);
      if (by - ay > 0.5) seg = { ax: xMid, ay, bx: xMid, by, horiz: false, aFlush: !capB, bFlush: !capT };
    }
    segOfRect.push(seg);
    if (seg) segs.push(seg);
  }
  if (!segs.length) return null;

  // Junction connectors 1 — perpendicular: a flush tip continues along its own direction to the first
  // perpendicular centerline it meets (the T-stem rising to the bar line; the L-arm reaching the leg line).
  const maxSpan = (xs[xs.length - 1] - xs[0]) + (ys[ys.length - 1] - ys[0]);
  const connectors: Seg[] = [];
  for (const s of segs) {
    const tips: Array<[boolean, number, number, number, number]> = [
      [s.aFlush, s.ax, s.ay, s.horiz ? -1 : 0, s.horiz ? 0 : -1],
      [s.bFlush, s.bx, s.by, s.horiz ? 1 : 0, s.horiz ? 0 : 1],
    ];
    for (const [flush, tx, ty, dirx, diry] of tips) {
      if (!flush) continue;
      let bestD = Infinity;
      for (const o of segs) {
        if (o === s) continue;
        if (diry === 0 && !o.horiz) {
          const d = (o.ax - tx) * dirx;
          const minY = Math.min(o.ay, o.by) - 0.5, maxY = Math.max(o.ay, o.by) + 0.5;
          if (d > 0.25 && ty >= minY && ty <= maxY && d < bestD) bestD = d;
        } else if (dirx === 0 && o.horiz) {
          const d = (o.ay - ty) * diry;
          const minX = Math.min(o.ax, o.bx) - 0.5, maxX = Math.max(o.ax, o.bx) + 0.5;
          if (d > 0.25 && tx >= minX && tx <= maxX && d < bestD) bestD = d;
        }
      }
      if (isFinite(bestD) && bestD < maxSpan)
        connectors.push({ ax: tx, ay: ty, bx: tx + dirx * bestD, by: ty + diry * bestD, horiz: diry === 0, aFlush: false, bFlush: false });
    }
  }
  // Junction connectors 2 — parallel limbs sharing a side cut (Z / offset bars): jog between the two
  // centerlines at the midpoint of the shared interval.
  for (let a = 0; a < rects.length; a++) for (let b = a + 1; b < rects.length; b++) {
    const sa = segOfRect[a], sb = segOfRect[b];
    if (!sa || !sb || sa.horiz !== sb.horiz) continue;
    const ra = rects[a], rb = rects[b];
    const stackedV = ra.j2 + 1 === rb.j1 || rb.j2 + 1 === ra.j1; // share a horizontal cut line
    const stackedH = ra.i2 + 1 === rb.i1 || rb.i2 + 1 === ra.i1; // share a vertical cut line
    if (sa.horiz && stackedV) {
      const ox1 = Math.max(xs[ra.i1], xs[rb.i1]), ox2 = Math.min(xs[ra.i2 + 1], xs[rb.i2 + 1]);
      if (ox2 - ox1 < 0.5) continue;
      const xm = (ox1 + ox2) / 2;
      const inA = xm >= Math.min(sa.ax, sa.bx) - 0.5 && xm <= Math.max(sa.ax, sa.bx) + 0.5;
      const inB = xm >= Math.min(sb.ax, sb.bx) - 0.5 && xm <= Math.max(sb.ax, sb.bx) + 0.5;
      if (inA && inB && Math.abs(sb.ay - sa.ay) > 0.5)
        connectors.push({ ax: xm, ay: sa.ay, bx: xm, by: sb.ay, horiz: false, aFlush: false, bFlush: false });
    } else if (!sa.horiz && stackedH) {
      const oy1 = Math.max(ys[ra.j1], ys[rb.j1]), oy2 = Math.min(ys[ra.j2 + 1], ys[rb.j2 + 1]);
      if (oy2 - oy1 < 0.5) continue;
      const ym = (oy1 + oy2) / 2;
      const inA = ym >= Math.min(sa.ay, sa.by) - 0.5 && ym <= Math.max(sa.ay, sa.by) + 0.5;
      const inB = ym >= Math.min(sb.ay, sb.by) - 0.5 && ym <= Math.max(sb.ay, sb.by) + 0.5;
      if (inA && inB && Math.abs(sb.ax - sa.ax) > 0.5)
        connectors.push({ ax: sa.ax, ay: ym, bx: sb.ax, by: ym, horiz: true, aFlush: false, bFlush: false });
    }
  }

  const out: SkeletonEdge[] = [];
  for (const s of [...segs, ...connectors]) {
    if (Math.hypot(s.bx - s.ax, s.by - s.ay) < 0.5) continue;
    out.push({ p1: unrotP(s.ax, s.ay), p2: unrotP(s.bx, s.by) });
  }
  return out.length ? out : null;
};

// ── Segment sweepline (grid nearest-edge labelling) ──────────────────────────
const computeSegmentSweepline = (polygon: Point[], samples: number): SkeletonEdge[] => {
  const skeletonEdges: SkeletonEdge[] = [];
  const N = polygon.length;
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const GRID = Math.max(20, Math.min(120, Math.round(samples * 8)));
  const dx = (maxX - minX) / GRID, dy = (maxY - minY) / GRID;
  const pip = (px: number, py: number): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      const intersects = ((a.y > py) !== (b.y > py)) &&
        (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x);
      if (intersects) inside = !inside;
    }
    return inside;
  };
  const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const ex = bx - ax, ey = by - ay;
    const len2 = ex * ex + ey * ey || 1e-9;
    let t = ((px - ax) * ex + (py - ay) * ey) / len2;
    t = Math.max(0, Math.min(1, t));
    const fx = ax + t * ex, fy = ay + t * ey;
    return Math.hypot(px - fx, py - fy);
  };
  const nearestEdge = new Int32Array((GRID + 1) * (GRID + 1));
  const idx = (i: number, j: number) => j * (GRID + 1) + i;
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const px = minX + i * dx, py = minY + j * dy;
      if (!pip(px, py)) { nearestEdge[idx(i, j)] = -1; continue; }
      let bestK = 0, bestD = Infinity;
      for (let k = 0; k < N; k++) {
        const a = polygon[k], b = polygon[(k + 1) % N];
        const d = distSeg(px, py, a.x, a.y, b.x, b.y);
        if (d < bestD) { bestD = d; bestK = k; }
      }
      nearestEdge[idx(i, j)] = bestK;
    }
  }
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = nearestEdge[idx(i, j)], b = nearestEdge[idx(i + 1, j)];
      if (a >= 0 && b >= 0 && a !== b) {
        const mx = minX + (i + 0.5) * dx;
        const my = minY + j * dy;
        skeletonEdges.push({ p1: { x: mx, y: my - dy / 2 }, p2: { x: mx, y: my + dy / 2 } });
      }
    }
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const a = nearestEdge[idx(i, j)], b = nearestEdge[idx(i, j + 1)];
      if (a >= 0 && b >= 0 && a !== b) {
        const mx = minX + i * dx;
        const my = minY + (j + 0.5) * dy;
        skeletonEdges.push({ p1: { x: mx - dx / 2, y: my }, p2: { x: mx + dx / 2, y: my } });
      }
    }
  }
  return skeletonEdges;
};

// ── Sampled-Voronoi medial-axis approximation ────────────────────────────────
const computeSampledVoronoiSkeleton = (polygon: Point[], samples: number): SkeletonEdge[] => {
  const samplesPerEdge = Math.max(2, Math.min(24, Math.round(samples)));
  type Sample = { x: number; y: number; edge: number };
  const sampleList: Sample[] = [];
  const N = polygon.length;
  for (let i = 0; i < N; i++) {
    const a = polygon[i], b = polygon[(i + 1) % N];
    for (let k = 0; k < samplesPerEdge; k++) {
      const t = k / samplesPerEdge;
      sampleList.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), edge: i });
    }
  }
  const M = sampleList.length;

  const clip = (poly: Point[], px: number, py: number, nx: number, ny: number): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = (a.x - px) * nx + (a.y - py) * ny;
      const db = (b.x - px) * nx + (b.y - py) * ny;
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    return out;
  };

  const cells: Point[][] = sampleList.map((s, i) => {
    let cell = polygon.slice();
    for (let j = 0; j < M; j++) {
      if (i === j) continue;
      const o = sampleList[j];
      const mx = (s.x + o.x) / 2, my = (s.y + o.y) / 2;
      const nx = s.x - o.x, ny = s.y - o.y;
      cell = clip(cell, mx, my, nx, ny);
      if (cell.length === 0) break;
    }
    return cell;
  });

  type OwnedEdge = { p1: Point; p2: Point; seedIdx: number };
  const keyPt = (p: Point) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  const edgeKey = (p: Point, q: Point) => {
    const a = keyPt(p), b = keyPt(q);
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const grouped = new Map<string, OwnedEdge[]>();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    for (let e = 0; e < cell.length; e++) {
      const p1 = cell[e], p2 = cell[(e + 1) % cell.length];
      if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.5) continue;
      const k = edgeKey(p1, p2);
      const arr = grouped.get(k);
      const entry = { p1, p2, seedIdx: i };
      if (arr) arr.push(entry); else grouped.set(k, [entry]);
    }
  }

  const skeletonEdges: SkeletonEdge[] = [];
  for (const arr of grouped.values()) {
    if (arr.length !== 2) continue;
    const e1 = sampleList[arr[0].seedIdx].edge;
    const e2 = sampleList[arr[1].seedIdx].edge;
    if (e1 === e2) continue;
    skeletonEdges.push({ p1: arr[0].p1, p2: arr[0].p2 });
  }
  return skeletonEdges;
};
