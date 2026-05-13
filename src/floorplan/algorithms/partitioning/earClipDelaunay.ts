import type { Point } from "../../types";

export type MeshType = "ear-clipping" | "delaunay" | "blossom-quad";

export interface PolygonMesh {
  /** Triangles produced by the chosen pipeline. Each entry is a triple of polygon-vertex indices. */
  triangles: Array<[number, number, number]>;
  /** Quad pairings (only non-empty for `blossom-quad`). */
  quads: Array<[number, number, number, number]>;
  /** Triangles left over after blossom-quad pairing (== `triangles` for ear-clipping / delaunay). */
  remainingTriangles: Array<[number, number, number]>;
  /** Deduplicated mesh edges as point pairs. */
  edges: Array<{ p1: Point; p2: Point }>;
  /** Circumcenter of each triangle in `triangles`. */
  circumcenters: Point[];
}

const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** Triangulate (ear-clipping or constrained-Delaunay-lite) a simple polygon, optionally pair triangles into
 *  quads (blossom-quad), and return triangles, quads, deduplicated edges, and per-triangle circumcenters. */
export const computePolygonMesh = (polygon: Point[], type: MeshType): PolygonMesh => {
  const N = polygon.length;
  const empty: PolygonMesh = { triangles: [], quads: [], remainingTriangles: [], edges: [], circumcenters: [] };
  if (N < 3) return empty;

  let signedArea = 0;
  for (let i = 0; i < N; i++) {
    const a = polygon[i], b = polygon[(i + 1) % N];
    signedArea += a.x * b.y - b.x * a.y;
  }

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

  const triangles: Array<[number, number, number]> = [];

  if (type === "ear-clipping") {
    const idxs = Array.from({ length: N }, (_, i) => i);
    if (signedArea < 0) idxs.reverse();
    const isConvexVertex = (pa: Point, pb: Point, pc: Point) => (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x) > 0;
    const triArea2 = (a: Point, b: Point, c: Point) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    const pointInTri = (p: Point, a: Point, b: Point, c: Point) => {
      const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
      const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
      const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
      const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      return !(hasNeg && hasPos);
    };
    const remaining = idxs.slice();
    let guard = remaining.length * remaining.length;
    while (remaining.length > 3 && guard-- > 0) {
      let earFound = false;
      for (let i = 0; i < remaining.length; i++) {
        const prevI = remaining[(i - 1 + remaining.length) % remaining.length];
        const curI = remaining[i];
        const nextI = remaining[(i + 1) % remaining.length];
        const pa = polygon[prevI], pb = polygon[curI], pc = polygon[nextI];
        if (!isConvexVertex(pa, pb, pc)) continue;
        if (triArea2(pa, pb, pc) < 0.01) { remaining.splice(i, 1); earFound = true; break; }
        let containsOther = false;
        for (const k of remaining) {
          if (k === prevI || k === curI || k === nextI) continue;
          if (pointInTri(polygon[k], pa, pb, pc)) { containsOther = true; break; }
        }
        if (containsOther) continue;
        triangles.push([prevI, curI, nextI]);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
      if (!earFound) break;
    }
    if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  } else {
    const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const dx = (maxX - minX) || 1, dy = (maxY - minY) || 1;
    const dmax = Math.max(dx, dy) * 20;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const pts: Point[] = [...polygon, { x: cx - dmax, y: cy - dmax }, { x: cx + dmax, y: cy - dmax }, { x: cx, y: cy + dmax }];
    type Tri = { a: number; b: number; c: number };
    let tris: Tri[] = [{ a: N, b: N + 1, c: N + 2 }];
    const inCircumcircle = (p: Point, a: Point, b: Point, c: Point): boolean => {
      const ax = a.x - p.x, ay = a.y - p.y;
      const bx = b.x - p.x, by = b.y - p.y;
      const ccx = c.x - p.x, ccy = c.y - p.y;
      const det =
        (ax * ax + ay * ay) * (bx * ccy - ccx * by) -
        (bx * bx + by * by) * (ax * ccy - ccx * ay) +
        (ccx * ccx + ccy * ccy) * (ax * by - bx * ay);
      const orient = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      return orient > 0 ? det > 0 : det < 0;
    };
    for (let i = 0; i < N; i++) {
      const p = pts[i];
      const bad: Tri[] = [], good: Tri[] = [];
      for (const t of tris) {
        if (inCircumcircle(p, pts[t.a], pts[t.b], pts[t.c])) bad.push(t);
        else good.push(t);
      }
      const ec = new Map<string, { a: number; b: number; count: number }>();
      for (const t of bad) {
        for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
          const k = ek(a, b);
          const prev = ec.get(k);
          if (prev) prev.count += 1; else ec.set(k, { a, b, count: 1 });
        }
      }
      const fresh: Tri[] = [];
      for (const e of ec.values()) if (e.count === 1) fresh.push({ a: e.a, b: e.b, c: i });
      tris = [...good, ...fresh];
    }
    tris = tris.filter((t) => t.a < N && t.b < N && t.c < N);
    for (const t of tris) {
      const pa = polygon[t.a], pb = polygon[t.b], pc = polygon[t.c];
      const ccx = (pa.x + pb.x + pc.x) / 3, ccy = (pa.y + pb.y + pc.y) / 3;
      if (pip(ccx, ccy)) triangles.push([t.a, t.b, t.c]);
    }
  }

  if (triangles.length === 0) return empty;

  const circumcenters: Point[] = [];
  for (const [ia, ib, ic] of triangles) {
    const A = polygon[ia], B = polygon[ib], C = polygon[ic];
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    if (Math.abs(d) < 1e-9) {
      circumcenters.push({ x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 });
      continue;
    }
    const a2 = A.x * A.x + A.y * A.y, b2 = B.x * B.x + B.y * B.y, c2 = C.x * C.x + C.y * C.y;
    const ux = (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / d;
    const uy = (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / d;
    circumcenters.push({ x: ux, y: uy });
  }

  let quads: Array<[number, number, number, number]> = [];
  let remainingTriangles: Array<[number, number, number]> = triangles;
  if (type === "blossom-quad") {
    const edgeToTris = new Map<string, number[]>();
    for (let ti = 0; ti < triangles.length; ti++) {
      const [a, b, c] = triangles[ti];
      for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
        const k = ek(u, v);
        if (!edgeToTris.has(k)) edgeToTris.set(k, []);
        edgeToTris.get(k)!.push(ti);
      }
    }
    const candidates: Array<{ ta: number; tb: number; quad: [number, number, number, number]; score: number }> = [];
    for (const [k, tis] of edgeToTris) {
      if (tis.length !== 2) continue;
      const [ti1, ti2] = tis;
      const t1 = triangles[ti1], t2 = triangles[ti2];
      const [u, v] = k.split("_").map(Number) as [number, number];
      const third = (t: [number, number, number]) => t.find((x) => x !== u && x !== v)!;
      const w1 = third(t1), w2 = third(t2);
      const quad: [number, number, number, number] = [u, w1, v, w2];
      const cross = (a: Point, b: Point, c: Point) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const p = quad.map((i) => polygon[i]);
      const signs = [
        Math.sign(cross(p[0], p[1], p[2])),
        Math.sign(cross(p[1], p[2], p[3])),
        Math.sign(cross(p[2], p[3], p[0])),
        Math.sign(cross(p[3], p[0], p[1])),
      ];
      const isConvex = signs.every((s) => s === signs[0]) && signs[0] !== 0;
      if (!isConvex) continue;
      const angleAt = (a: Point, b: Point, c: Point) => {
        const ax = a.x - b.x, ay = a.y - b.y;
        const cx2 = c.x - b.x, cy2 = c.y - b.y;
        const dot = ax * cx2 + ay * cy2;
        const det = ax * cy2 - ay * cx2;
        return Math.atan2(Math.abs(det), dot) * 180 / Math.PI;
      };
      const angles = [
        angleAt(p[3], p[0], p[1]),
        angleAt(p[0], p[1], p[2]),
        angleAt(p[1], p[2], p[3]),
        angleAt(p[2], p[3], p[0]),
      ];
      const dev = angles.reduce((s, a) => s + Math.abs(a - 90), 0);
      candidates.push({ ta: ti1, tb: ti2, quad, score: -dev });
    }
    candidates.sort((a, b) => b.score - a.score);
    const used = new Set<number>();
    for (const c of candidates) {
      if (used.has(c.ta) || used.has(c.tb)) continue;
      used.add(c.ta);
      used.add(c.tb);
      quads.push(c.quad);
    }
    remainingTriangles = triangles.filter((_, i) => !used.has(i));
  }

  const edgeSet = new Set<string>();
  const edges: { p1: Point; p2: Point }[] = [];
  for (const [a, b, c] of remainingTriangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = ek(u, v);
      if (edgeSet.has(k)) continue;
      edgeSet.add(k);
      edges.push({ p1: polygon[u], p2: polygon[v] });
    }
  }
  for (const [a, b, c, d] of quads) {
    for (const [u, v] of [[a, b], [b, c], [c, d], [d, a]] as [number, number][]) {
      const k = ek(u, v);
      if (edgeSet.has(k)) continue;
      edgeSet.add(k);
      edges.push({ p1: polygon[u], p2: polygon[v] });
    }
  }

  return { triangles, quads, remainingTriangles, edges, circumcenters };
};
