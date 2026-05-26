import type { Point } from "../../types";

export type SkeletonType = "straight-skeleton" | "segment-sweepline" | "sampled-voronoi";

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

/** Compute a 2D polygon skeleton via one of three pipelines:
 *  - `straight-skeleton`: full event-driven straight skeleton with edge-collapse and split events.
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

  if (type === "straight-skeleton") return computeStraightSkeleton(polygon, pruneEnds);
  if (type === "segment-sweepline") return computeSegmentSweepline(polygon, samples);
  return computeSampledVoronoiSkeleton(polygon, samples);
};

// ── Straight skeleton ─────────────────────────────────────────────────────────
const computeStraightSkeleton = (polygon: Point[], pruneEnds: boolean): SkeletonEdge[] => {
  type SkV = { x: number; y: number; px: number; py: number };
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
    return { vx: (prevN.nx + nextN.nx) / denom, vy: (prevN.ny + nextN.ny) / denom };
  };
  const isReflex = (prev: SkV, v: SkV, next: SkV): boolean => {
    const ax = v.x - prev.x, ay = v.y - prev.y;
    const bx = next.x - v.x, by = next.y - v.y;
    const cross = ax * by - ay * bx;
    return (cross * insideSign) < 0;
  };

  for (let step = 0; step < maxSteps; step++) {
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
          if (s < 0.02 || s > 0.98) continue;
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
        comp[i].x += vels[i].vx * best.t;
        comp[i].y += vels[i].vy * best.t;
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

  for (const c of components) closeComponent(c);

  if (!pruneEnds) return skeletonEdges;
  const VTX_TOL = 1.5;
  const nearVertex = (p: Point) => polygon.some((v) => Math.hypot(v.x - p.x, v.y - p.y) < VTX_TOL);
  return skeletonEdges.filter((e) => !nearVertex(e.p1) && !nearVertex(e.p2));
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
