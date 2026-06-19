import type { Point } from "../../types";

/** Exact polygon UNION for simple polygons that ABUT or only touch (no crossing interiors) — e.g. two
 *  spaces sharing a wall. Unlike the raster union it keeps edges perfectly straight: it dissolves the
 *  shared internal walls and re-traces the outer boundary from the original vertices.
 *
 *  Returns null when the inputs' interiors actually overlap (edges cross) or it can't form a clean loop
 *  — the caller should fall back to `rasterUnion` for those. */
const signedArea = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
};

const crossZ = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do segments p1p2 and p3p4 cross through each other's INTERIOR (collinear / endpoint-touch = false)? */
const segmentsProperlyCross = (p1: Point, p2: Point, p3: Point, p4: Point, eps = 1e-6): boolean => {
  const d1 = crossZ(p3, p4, p1), d2 = crossZ(p3, p4, p2), d3 = crossZ(p1, p2, p3), d4 = crossZ(p1, p2, p4);
  return ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
         ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps));
};

export function polygonUnionVector(polysIn: Point[][], tol = 0.5, keepCollinear = false): Point[] | null {
  const polys = polysIn.filter((p) => p.length >= 3).map((p) => (signedArea(p) < 0 ? [...p].reverse() : p.slice()));
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];

  // Bail to the raster path if any two polygons' interiors overlap (proper edge crossing) — the
  // dissolve-shared-edges method is only exact for abutting / touching polygons.
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const A = polys[i], B = polys[j];
      for (let a = 0; a < A.length; a++) {
        const a1 = A[a], a2 = A[(a + 1) % A.length];
        for (let b = 0; b < B.length; b++) {
          if (segmentsProperlyCross(a1, a2, B[b], B[(b + 1) % B.length])) return null;
        }
      }
    }
  }

  // Snap vertices to a shared grid so coincident endpoints collapse to one node.
  const key = (p: Point) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const nodePt = new Map<string, Point>();
  const reg = (p: Point): string => { const k = key(p); if (!nodePt.has(k)) nodePt.set(k, p); return k; };

  type DE = { a: string; b: string };
  let edges: DE[] = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = reg(poly[i]), b = reg(poly[(i + 1) % poly.length]);
      if (a !== b) edges.push({ a, b });
    }
  }

  // T-junction split: if a node lies strictly on an edge, split the edge there. Iterate to a fixpoint so a
  // shared wall divided differently on each side still resolves into matching reverse-edge pairs.
  let changed = true, guard = 0;
  while (changed && guard++ < 60) {
    changed = false;
    const nodeList = [...nodePt.entries()];
    const out: DE[] = [];
    for (const e of edges) {
      const A = nodePt.get(e.a)!, B = nodePt.get(e.b)!;
      const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy;
      let best: { k: string; t: number } | null = null;
      if (len2 > 1e-9) {
        for (const [k, p] of nodeList) {
          if (k === e.a || k === e.b) continue;
          const t = ((p.x - A.x) * dx + (p.y - A.y) * dy) / len2;
          if (t <= 1e-4 || t >= 1 - 1e-4) continue;
          if (Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy)) > tol) continue;
          if (!best || t < best.t) best = { k, t };
        }
      }
      if (best) { out.push({ a: e.a, b: best.k }, { a: best.k, b: e.b }); changed = true; }
      else out.push(e);
    }
    edges = out;
  }

  // Dissolve shared internal walls: a directed edge whose REVERSE also exists is the boundary between two
  // filled faces (two abutting CCW polygons), so drop it. Then keep one of any same-direction duplicates.
  const ek = (e: DE) => `${e.a}|${e.b}`;
  const present = new Set(edges.map(ek));
  const seen = new Set<string>();
  const finalEdges = edges.filter((e) => {
    if (present.has(`${e.b}|${e.a}`)) return false;        // shared wall → drop
    const k = ek(e); if (seen.has(k)) return false; seen.add(k); return true; // de-dup
  });
  if (finalEdges.length < 3) return null;

  // Trace loops. At a node with several outgoing edges (3+ polygons meeting) keep the union's outer
  // boundary by taking the most clockwise turn from the incoming direction.
  const outAdj = new Map<string, DE[]>();
  for (const e of finalEdges) (outAdj.get(e.a) ?? outAdj.set(e.a, []).get(e.a)!).push(e);
  const used = new Set<string>();
  const loops: Point[][] = [];
  for (const start of finalEdges) {
    if (used.has(ek(start))) continue;
    const loop: Point[] = [];
    let cur: DE | undefined = start, g = 0;
    while (cur && !used.has(ek(cur)) && g++ < finalEdges.length + 2) {
      used.add(ek(cur));
      loop.push(nodePt.get(cur.a)!);
      const outs = (outAdj.get(cur.b) ?? []).filter((e) => !used.has(ek(e)));
      if (outs.length === 0) break;
      if (outs.length === 1) { cur = outs[0]; continue; }
      const A = nodePt.get(cur.a)!, B = nodePt.get(cur.b)!;
      const inAng = Math.atan2(B.y - A.y, B.x - A.x);
      let next = outs[0], bestTurn = Infinity;
      for (const o of outs) {
        const C = nodePt.get(o.b)!;
        let turn = Math.atan2(C.y - B.y, C.x - B.x) - inAng;
        while (turn <= -Math.PI) turn += 2 * Math.PI;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        if (turn < bestTurn) { bestTurn = turn; next = o; }
      }
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (loops.length === 0) return null;

  // Largest-area loop = the outer union boundary.
  let best = loops[0], bestA = -Infinity;
  for (const lp of loops) { const ar = Math.abs(signedArea(lp)); if (ar > bestA) { bestA = ar; best = lp; } }
  // keepCollinear: retain the collinear breakpoints where abutting pieces meet (e.g. a partition wall's
  // faces along a straight outer edge → the wall thickness reads as its own segment when dimensioned).
  if (keepCollinear) return best;
  // Otherwise collapse collinear runs to one vertex per corner.
  const compact: Point[] = [];
  for (let i = 0; i < best.length; i++) {
    const a = best[(i - 1 + best.length) % best.length], b = best[i], c = best[(i + 1) % best.length];
    if (Math.abs(crossZ(a, b, c)) > tol * tol) compact.push(b);
  }
  return compact.length >= 3 ? compact : best;
}
