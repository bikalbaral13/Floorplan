/** polyBool.ts — 2D POLYGON BOOLEANS for the Math Engine, on the matrix format the rest of the engine speaks.
 *
 *  Until now the Expression node's own documentation told you this was impossible: "NOT possible: indexing by
 *  a COMPUTED value, and therefore polygon booleans/clipping. For a union use the Merge or Boolean 2D node,
 *  never a hand-rolled clipper." That advice was right about the hand-rolled clipper and wrong about the
 *  conclusion — a boolean does not need computed indexing, it needs a sweep-line implementation, and the
 *  project already ships one (`polygon-clipping`, behind the Boolean 2D node). This exposes it as four
 *  functions so a shape with holes can be COMPUTED rather than assembled by wiring two nodes together.
 *
 *  WHY THAT MATTERS: a hole is the one thing the render rows cannot be told about. A Polygon row reads a ring
 *  list even-odd, so a hole is expressible — but only if something PRODUCED the hole ring in the right place,
 *  and "the right place" is the outline of one shape cut by another. Drilling seven holes in a flute, cutting
 *  a stair well out of a slab, punching a duct through a wall: all the same operation, none of them available
 *  inside a formula before this.
 *
 *  THE WIRE FORMAT is the one the 2D Render Polygon row already reads, in and out:
 *    N×2  `[[x,y],…]`         — one ring
 *    N×3  `[[x,y,g],…]`       — several rings, one per run of equal third value
 *  Rings are read with the EVEN-ODD rule (a ring inside another is a hole, disjoint rings union), matching
 *  both the renderer and the Boolean 2D node, and the result always carries the group column so holes
 *  survive the trip back onto a wire.
 *
 *  Kept as a LEAF: its only import is the external clipper, so expr.ts stays free of project geometry
 *  modules and the import cycle back through flowTypes cannot form.
 */

import { type Matrix, round6, isRectMatrix } from "./matrixCore.js";

// The package ships an ESM bundle whose only export is `default`, but its .d.ts declares named exports —
// resolve the callable object defensively across bundler/interop modes (the same dance as evalNodes.ts).
import * as PolygonClippingNS from "polygon-clipping";

type PcRing = [number, number][];
type PcMultiPolygon = PcRing[][];
const pc: {
  union: (g: PcMultiPolygon | PcRing[], ...r: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
  intersection: (s: PcMultiPolygon | PcRing[], ...c: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
  difference: (s: PcMultiPolygon | PcRing[], ...c: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
  xor: (g: PcMultiPolygon | PcRing[], ...r: (PcMultiPolygon | PcRing[])[]) => PcMultiPolygon;
} =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PolygonClippingNS as any).default ?? (PolygonClippingNS as any);

/** A matrix → the rings it carries. A third column GROUPS: one ring per run of equal value, which is the
 *  same convention a Polygon render row splits on, so a boolean result feeds straight back to one. */
export const matrixToRings = (M: Matrix): number[][][] => {
  if (!isRectMatrix(M) || M.length < 3) return [];
  const wide = M[0].length >= 3;
  if (!wide) return [M.map((r) => [r[0], r[1]])];
  const out: number[][][] = [];
  let cur: number[][] = [];
  let key: number | null = null;
  for (const r of M) {
    if (key !== null && r[2] !== key) { if (cur.length >= 3) out.push(cur); cur = []; }
    key = r[2];
    cur.push([r[0], r[1]]);
  }
  if (cur.length >= 3) out.push(cur);
  return out;
};

/** Rings → the flat grouped matrix. ALWAYS three columns: a boolean can turn one ring into several (a cut
 *  that splits a shape in two) or into an outer plus holes, and the group column is what carries that. */
export const ringsToMatrix = (rings: number[][][]): Matrix => {
  const out: Matrix = [];
  let g = 0;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (const p of ring) out.push([round6(p[0]), round6(p[1]), g]);
    g++;
  }
  return out;
};

const toPcRing = (ring: number[][]): PcRing => {
  const r: PcRing = ring.map((p) => [p[0], p[1]] as [number, number]);
  if (r.length) r.push([r[0][0], r[0][1]]); // polygon-clipping wants first === last
  return r;
};
const fromPcRing = (ring: PcRing): number[][] => {
  const pts = ring.map(([x, y]) => [x, y]);
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12) pts.pop();
  }
  return pts;
};

/** Rings read EVEN-ODD → a clipper MultiPolygon with explicit outers and holes, by XOR-ing them together.
 *  Same normalisation the Boolean 2D node uses, so the two surfaces agree on what a nested ring means. */
const ringsToMulti = (rings: number[][][]): PcMultiPolygon => {
  const mps = rings.filter((r) => r.length >= 3).map((r) => [toPcRing(r)] as PcRing[]);
  if (!mps.length) return [];
  if (mps.length === 1) return [mps[0]];
  try { return pc.xor(mps[0], ...mps.slice(1)); }
  catch { return mps; } // fallback: every ring its own solid
};
const multiToRings = (mp: PcMultiPolygon): number[][][] => {
  const out: number[][][] = [];
  for (const poly of mp) for (const ring of poly) { const p = fromPcRing(ring); if (p.length >= 3) out.push(p); }
  return out;
};

/** The four booleans. `op`: "subtract" | "union" | "intersect" | "xor".
 *
 *  An EMPTY B is the identity for subtract / union / xor and annihilates intersect — but note that even the
 *  identity path returns A DISSOLVED (its rings XOR-merged into clean loops), so `union(A, zeros(0,3))` is
 *  the canonical way to merge a pile of overlapping pieces into one outline. A clipper failure falls back to
 *  A rather than to nothing, so a bad slider gives a wrong picture instead of a vanished object. */
export const boolMatrix2d = (A: Matrix, B: Matrix, op: string): Matrix => {
  const ra = matrixToRings(A);
  if (!ra.length) return [];
  const ma = ringsToMulti(ra);
  if (!ma.length) return [];
  const mb = ringsToMulti(matrixToRings(B));
  if (!mb.length) return op === "intersect" ? [] : ringsToMatrix(multiToRings(ma));
  try {
    return ringsToMatrix(multiToRings(
      op === "subtract" ? pc.difference(ma, mb)
      : op === "intersect" ? pc.intersection(ma, mb)
      : op === "xor" ? pc.xor(ma, mb)
      : pc.union(ma, mb),
    ));
  } catch { return ringsToMatrix(multiToRings(ma)); }
};

/** Point-in-shape as a 0/1 MASK over the rows of P, read even-odd (so a point in a hole is OUTSIDE).
 *
 *  The companion to the booleans and the more useful of the two for 3D work: it is how a surface gets
 *  TRIMMED without a mesh boolean — keep the quads of a grid whose centres fall outside the cutter — and it
 *  is a mask, so it feeds `compress` and `where` like any other. Ray-crossing per ring, which is O(P·V) and
 *  fine at the sizes a flow works with. */
export const inPolyMask = (P: Matrix, R: Matrix): Matrix => {
  if (!isRectMatrix(P)) return [];
  const rings = matrixToRings(R);
  return P.map((p) => {
    const x = p[0], y = p[1];
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    return [inside ? 1 : 0];
  });
};
