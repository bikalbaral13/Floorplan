/** meshBool.ts — 3D MESH BOOLEANS for the Math Engine, on the face-list format the Polyhedron row reads.
 *
 *  The 2D twin of this lives in polyBool.ts and delegates to `polygon-clipping`. There is no equivalent
 *  delegation available here: the project's mesh CSG is `three-csg-ts`, which operates on THREE geometries,
 *  and expr.ts is deliberately a LEAF — pulling three into it would put the whole 3D stack behind every
 *  consumer of the expression language, including the pobj `vars` and node-declaration `showWhen` paths that
 *  have nothing to do with rendering. So the algorithm is implemented here, in ~120 lines of dependency-free
 *  TypeScript: the classic BSP-tree CSG (Naylor/Amanatides, as popularised by csg.js).
 *
 *  WHY A BOOLEAN AT ALL, when the Loft and Tube rows can already make curved solids. Because SUBTRACTION is
 *  not expressible by construction. Every row builds material; none of them removes it. A hole through a
 *  wall, a bore down a tube, a mortise, a duct penetration — each is a solid defined by what is NOT there,
 *  and short of hand-authoring the trimmed surface (which means solving the intersection curve yourself, in a
 *  language with no computed indexing) there was no way to say it.
 *
 *  ROBUSTNESS, and the two things that keep this honest:
 *  • EVERY input face is fan-TRIANGULATED before it enters the tree. A triangle is always planar and always
 *    convex, which are exactly the two assumptions the splitter makes; feeding it a saddle-shaped quad from
 *    a lofted hull would split it wrongly and silently. The cost is more polygons and the benefit is that
 *    any mesh any row can produce is legal input.
 *  • A closed input whose winding is globally INVERTED is detected by signed volume and flipped, because an
 *    inside-out solid turns a subtraction into an intersection with no visible error. Locally inconsistent
 *    winding cannot be repaired and is not attempted — use the constructors below, which are wound correctly
 *    by construction.
 *
 *  WHAT IT DOES NOT GIVE YOU: a topologically watertight result. Splitting a polygon leaves T-junctions where
 *  a neighbour was not split at the same point, so on a curved surface a good fraction of edges come back
 *  unpaired (1568 of 6982 on the drilled flute). That is inherent to BSP CSG and is geometrically closed —
 *  the vertex lies exactly on the neighbour's edge, and the volume comes out exact, which is the check worth
 *  making. It renders and exports correctly; it is not a mesh to hand to a solver that demands manifold input.
 *
 *  THE WIRE FORMAT, in and out, is the Polyhedron row's own:
 *    N×4  `[[x,y,z,f],…]`  — one face per run of equal fourth value
 *    N×3  `[[x,y,z],…]`    — a single face (accepted, though a lone face is not a solid)
 *  so `msubtract(…)` wires straight into a Polyhedron row, and a boolean result can be subtracted again.
 */

import { type Matrix, round6, isRectMatrix } from "./matrixCore.js";
import { tubeFaces, latheFaces, loftFaces, type V3 } from "./axisMesh.js";

/** Plane-classification tolerance. Model units are metres and the features these booleans cut are
 *  millimetres (a flute's 8 mm finger hole in a 3 mm wall), so this has to be far below a feature but far
 *  above float noise: 0.1 µm. csg.js ships 1e-5, which at metre scale is 10 µm — enough to swallow the wall
 *  of a wind instrument. */
const EPS = 1e-7;

const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a: V3, b: V3, t: number): V3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Poly { v: V3[]; n: V3; w: number }

/** A polygon with its plane, or null if the vertices are collinear (a zero-area sliver, which must never
 *  become a splitting plane — its normal is noise). */
const mkPoly = (v: V3[]): Poly | null => {
  if (v.length < 3) return null;
  const raw = cross3(sub3(v[1], v[0]), sub3(v[2], v[0]));
  const L = Math.hypot(raw[0], raw[1], raw[2]);
  if (!(L > 1e-13)) return null;
  const n: V3 = [raw[0] / L, raw[1] / L, raw[2] / L];
  return { v, n, w: dot3(n, v[0]) };
};
const flip = (p: Poly): Poly => ({ v: [...p.v].reverse(), n: [-p.n[0], -p.n[1], -p.n[2]], w: -p.w });

const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

/** Split `p` by `plane`'s plane into the four buckets — the one primitive the whole algorithm rests on. */
const splitPoly = (plane: Poly, p: Poly, coF: Poly[], coB: Poly[], front: Poly[], back: Poly[]): void => {
  let mixed = 0;
  const types: number[] = [];
  for (const vv of p.v) {
    const t = dot3(plane.n, vv) - plane.w;
    const type = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
    mixed |= type;
    types.push(type);
  }
  if (mixed === COPLANAR) { (dot3(plane.n, p.n) > 0 ? coF : coB).push(p); return; }
  if (mixed === FRONT) { front.push(p); return; }
  if (mixed === BACK) { back.push(p); return; }
  const f: V3[] = [], b: V3[] = [];
  for (let i = 0; i < p.v.length; i++) {
    const j = (i + 1) % p.v.length;
    const ti = types[i], tj = types[j];
    const vi = p.v[i], vj = p.v[j];
    if (ti !== BACK) f.push(vi);
    if (ti !== FRONT) b.push(vi);
    if ((ti | tj) === SPANNING) {
      const denom = dot3(plane.n, sub3(vj, vi));
      const t = Math.abs(denom) > 1e-18 ? (plane.w - dot3(plane.n, vi)) / denom : 0;
      const vm = lerp3(vi, vj, t);
      f.push(vm); b.push(vm);
    }
  }
  const pf = mkPoly(f); if (pf) front.push(pf);
  const pb = mkPoly(b); if (pb) back.push(pb);
};

interface BspNode { plane: Poly | null; front: BspNode | null; back: BspNode | null; polys: Poly[] }
const mkNode = (): BspNode => ({ plane: null, front: null, back: null, polys: [] });

/** Depth ceiling. The tree's depth is data-dependent (a bad splitting order degenerates to a list), and this
 *  runs on every slider drag, so past the limit the remaining polygons are simply kept at the node: the
 *  result degrades locally instead of overflowing the stack. */
const MAX_DEPTH = 400;

const build = (node: BspNode, polys: Poly[], depth = 0): void => {
  if (!polys.length) return;
  if (!node.plane) node.plane = polys[0];
  if (depth > MAX_DEPTH) { for (const p of polys) node.polys.push(p); return; }
  const front: Poly[] = [], back: Poly[] = [];
  for (const p of polys) splitPoly(node.plane, p, node.polys, node.polys, front, back);
  if (front.length) { node.front = node.front ?? mkNode(); build(node.front, front, depth + 1); }
  if (back.length) { node.back = node.back ?? mkNode(); build(node.back, back, depth + 1); }
};

/** Remove the parts of `polys` that fall INSIDE this tree's solid. */
const clipPolys = (node: BspNode, polys: Poly[]): Poly[] => {
  if (!node.plane) return polys.slice();
  let front: Poly[] = [], back: Poly[] = [];
  for (const p of polys) splitPoly(node.plane, p, front, back, front, back);
  if (node.front) front = clipPolys(node.front, front);
  back = node.back ? clipPolys(node.back, back) : [];
  return front.concat(back);
};
const clipTo = (node: BspNode, other: BspNode): void => {
  node.polys = clipPolys(other, node.polys);
  if (node.front) clipTo(node.front, other);
  if (node.back) clipTo(node.back, other);
};
const invert = (node: BspNode): void => {
  node.polys = node.polys.map(flip);
  if (node.plane) node.plane = flip(node.plane);
  if (node.front) invert(node.front);
  if (node.back) invert(node.back);
  const t = node.front; node.front = node.back; node.back = t;
};
const allPolys = (node: BspNode): Poly[] => {
  let out = node.polys.slice();
  if (node.front) out = out.concat(allPolys(node.front));
  if (node.back) out = out.concat(allPolys(node.back));
  return out;
};

// ── matrix ⇄ polygon list ───────────────────────────────────────────────────────────────────────────────

/** The faces a matrix carries, FAN-TRIANGULATED (see the header: convexity and planarity are assumptions of
 *  the splitter, and a triangle satisfies both unconditionally). */
export const matrixToTris = (M: Matrix): Poly[] => {
  if (!isRectMatrix(M) || M.length < 3) return [];
  const grouped = M[0].length >= 4;
  const rings: V3[][] = [];
  if (!grouped) {
    rings.push(M.map((r) => [r[0], r[1], r[2]] as V3));
  } else {
    let cur: V3[] = [];
    let key: number | null = null;
    for (const r of M) {
      if (key !== null && r[3] !== key) { if (cur.length >= 3) rings.push(cur); cur = []; }
      key = r[3];
      cur.push([r[0], r[1], r[2]]);
    }
    if (cur.length >= 3) rings.push(cur);
  }
  const out: Poly[] = [];
  for (const ring of rings) {
    for (let i = 1; i + 1 < ring.length; i++) {
      const p = mkPoly([ring[0], ring[i], ring[i + 1]]);
      if (p) out.push(p);
    }
  }
  return out;
};

/** Six times the signed volume of a closed triangle soup (the divergence-theorem sum). Positive means the
 *  faces are wound outward. Used to catch a globally inside-out solid, which would otherwise turn a
 *  subtraction into an intersection with nothing to show that it had. */
const signedVolume6 = (tris: Poly[]): number => {
  let s = 0;
  for (const t of tris) s += dot3(t.v[0], cross3(t.v[1], t.v[2]));
  return s;
};
const orient = (tris: Poly[]): Poly[] => (signedVolume6(tris) < 0 ? tris.map(flip) : tris);

/** Twice the area of a polygon in 3D — the magnitude of its summed edge cross products. */
const area2 = (v: V3[]): number => {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    x += a[1] * b[2] - a[2] * b[1];
    y += a[2] * b[0] - a[0] * b[2];
    z += a[0] * b[1] - a[1] * b[0];
  }
  return Math.hypot(x, y, z);
};

/** Faces → the flat `[x,y,z,f]` matrix a Polyhedron row reads, one group per face.
 *
 *  ZERO-AREA FACES ARE DROPPED, and the rounding is why they exist: a split lands a new vertex a nanometre
 *  from an existing one, `round6` puts the two at the same micron, and the fragment between them collapses.
 *  Measured on the flute, every tessellation produced a handful. They draw nothing, but they carry a
 *  meaningless normal into any consumer that averages one, and they make a mesh look broken to a validator.
 *  Discarding them cannot change the volume — a zero-area face contributes exactly zero to the divergence
 *  sum that defines it — which the volume assertions confirm to twelve figures on the exact cases. */
const trisToMatrix = (tris: Poly[]): Matrix => {
  const out: Matrix = [];
  let f = 0;
  for (const t of tris) {
    const v = t.v.map((p) => [round6(p[0]), round6(p[1]), round6(p[2])] as V3);
    if (area2(v) < 1e-12) continue; // collapsed by the rounding — see above
    for (const p of v) out.push([p[0], p[1], p[2], f]);
    f++;
  }
  return out;
};

/** Runaway guard. A boolean between two finely tessellated solids can multiply face counts; past this the
 *  result is returned as-is rather than pushed further, so a mistyped `sides` gives a coarse picture instead
 *  of a hung tab — the same bargain the expression body's step ceiling makes. */
const MAX_TRIS = 60000;

/** `op`: "subtract" | "union" | "intersect". The standard BSP recipes. An empty B is the identity for
 *  subtract and union, and annihilates intersect. */
export const boolMatrix3d = (A: Matrix, B: Matrix, op: string): Matrix => {
  const ta = orient(matrixToTris(A));
  if (!ta.length) return [];
  const tb = orient(matrixToTris(B));
  if (!tb.length) return op === "intersect" ? [] : trisToMatrix(ta);
  if (ta.length + tb.length > MAX_TRIS) return trisToMatrix(ta);
  const a = mkNode(), b = mkNode();
  build(a, ta);
  build(b, tb);
  if (op === "subtract") {
    invert(a);
    clipTo(a, b);
    clipTo(b, a);
    invert(b); clipTo(b, a); invert(b);
    build(a, allPolys(b));
    invert(a);
  } else if (op === "intersect") {
    invert(a);
    clipTo(b, a);
    invert(b);
    clipTo(a, b);
    clipTo(b, a);
    build(a, allPolys(b));
    invert(a);
  } else {
    clipTo(a, b);
    clipTo(b, a);
    invert(b); clipTo(b, a); invert(b);
    build(a, allPolys(b));
  }
  return trisToMatrix(allPolys(a));
};

// ── CONSTRUCTORS ────────────────────────────────────────────────────────────────────────────────────────
// A boolean is useless without solids to operate on, and the Math Engine had no way to make one: every mesh
// in the system is produced by a RENDER ROW, i.e. downstream of the formula. These two are the smallest set
// that covers subtractive modelling — a drill and an extrusion — and both are wound outward by construction,
// which is what `orient` above should never have to correct.

/** A closed cylinder (or truncated cone) along an axis SEGMENT `[x1,y1,z1,x2,y2,z2]` — the same wire format
 *  the Tube and Ring render rows read, so a drill can be aimed with the geometry that is already to hand.
 *  `rB` defaults to `r`, giving a plain cylinder; differing radii give a cone, which is how a countersink or
 *  a tapered bore gets said. Only the first row of `seg` is used. */
export const cylMatrix = (seg: Matrix, r: number, sides: number, rB?: number): Matrix => {
  if (!isRectMatrix(seg) || seg[0].length < 6) return [];
  const s = seg[0];
  const faces = tubeFaces(
    [s[0], s[1], s[2]], [s[3], s[4], s[5]],
    Math.max(1e-5, r), Math.max(3, Math.round(sides) || 12),
    rB === undefined ? undefined : Math.max(1e-5, rB),
  );
  const out: Matrix = [];
  faces.forEach((ring, f) => { for (const v of ring) out.push([round6(v[0]), round6(v[1]), round6(v[2]), f]); });
  return out;
};

/** Rings → the outward-wound `[x,y,z,f]` matrix. Shared by the constructors so none of them has to be
 *  trusted to get its winding right by hand; a solid that came out inside-out is flipped wholesale. */
const facesToMatrix = (faces: number[][][]): Matrix => {
  const tris: Poly[] = [];
  for (const ring of faces) for (let i = 1; i + 1 < ring.length; i++) {
    const p = mkPoly([ring[0] as V3, ring[i] as V3, ring[i + 1] as V3]);
    if (p) tris.push(p);
  }
  if (!tris.length) return [];
  const flipAll = signedVolume6(tris) < 0;
  const out: Matrix = [];
  faces.forEach((ring, f) => {
    const r = flipAll ? [...ring].reverse() : ring;
    for (const v of r) out.push([round6(v[0]), round6(v[1]), round6(v[2]), f]);
  });
  return out;
};

/** A SOLID OF REVOLUTION — the closed profile `[[t,r],…]` (t along the axis from the segment's start, r the
 *  radius) swept about the axis SEGMENT `[x1,y1,z1,x2,y2,z2]`. Only the segment's direction and origin are
 *  read; the profile fixes the extent.
 *
 *  This exists because a boolean is the WRONG tool for a hollow body, not merely a slow one — see
 *  {@link latheFaces}. Any tube, pipe, sleeve, bowl, bottle or bored instrument is one profile and no CSG,
 *  which leaves the boolean for what only it can do: the holes through the wall. */
export const latheMatrix = (seg: Matrix, profile: Matrix, sides: number): Matrix => {
  if (!isRectMatrix(seg) || seg[0].length < 6 || !isRectMatrix(profile) || profile.length < 3) return [];
  const s = seg[0];
  return facesToMatrix(latheFaces(
    [s[0], s[1], s[2]], [s[3], s[4], s[5]],
    profile.map((p) => [p[0], p[1]]),
    Math.max(3, Math.round(sides) || 24),
  ));
};

/** A closed prism: the 2D ring `[[x,y],…]` (or a grouped ring list, first ring used) extruded from z0 to z1,
 *  capped both ends. The general subtractive cutter — any outline the engine can compute becomes a solid
 *  that can be removed from another. Wound outward whichever way the ring was given, by checking its signed
 *  area rather than trusting the author. */
export const prismMatrix = (ring: Matrix, z0: number, z1: number): Matrix => {
  if (!isRectMatrix(ring) || ring.length < 3) return [];
  const wide = ring[0].length >= 3;
  let pts: number[][] = [];
  if (!wide) pts = ring.map((r) => [r[0], r[1]]);
  else {
    const key = ring[0][2];
    for (const r of ring) { if (r[2] !== key) break; pts.push([r[0], r[1]]); }
  }
  if (pts.length < 3) return [];
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area2 += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  if (area2 < 0) pts = pts.reverse();                      // make it counter-clockwise
  const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
  if (!(hi - lo > 1e-9)) return [];
  const n = pts.length;
  const rings: number[][][] = [];
  // Bottom cap looks down (reversed), top cap looks up; sides wound so their normals point outward, which
  // for a CCW ring means bottom-i → bottom-j → top-j → top-i.
  rings.push(pts.map((p) => [p[0], p[1], lo]).reverse());
  rings.push(pts.map((p) => [p[0], p[1], hi]));
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    rings.push([
      [pts[i][0], pts[i][1], lo], [pts[j][0], pts[j][1], lo],
      [pts[j][0], pts[j][1], hi], [pts[i][0], pts[i][1], hi],
    ]);
  }
  const out: Matrix = [];
  rings.forEach((ring2, f) => { for (const v of ring2) out.push([round6(v[0]), round6(v[1]), round6(v[2]), f]); });
  return out;
};

/** The 12 vertices and 20 triangles of a unit icosahedron — the seed every geodesic subdivision grows
 *  from, and the reason a geodesic sphere's faces come out near-equal where a lat/long sphere's do not. */
const ICOSA = (): { verts: V3[]; faces: number[][] } => {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: V3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const s = 1 / Math.hypot(1, t);
  return {
    verts: raw.map((v) => [v[0] * s, v[1] * s, v[2] * s] as V3),
    faces: [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ],
  };
};

/**
 * A GEODESIC SPHERE OR DOME at the given frequency — 20·freq² triangles, each vertex pushed out to
 * `radius`, as the `[x,y,z,f]` face list a Polyhedron row reads.
 *
 * CLASS I subdivision, which is the one real domes are built to: each icosahedron face is divided
 * into freq² smaller triangles on a barycentric grid and every vertex is then normalised onto the
 * sphere. That admits ANY frequency — 2V, 3V, 4V, 5V are all ordinary — where the recursive
 * split-each-edge-in-half method used for render spheres only reaches powers of two. A dome is
 * specified by its frequency, so the distinction is the difference between modelling the thing and
 * approximating it.
 *
 * `hemi` non-zero keeps only the faces above the equator, turning the sphere into the dome. The cut
 * is exact at every frequency because the icosahedron's own vertices straddle z = 0 symmetrically.
 *
 * `centre` is an optional `[x,y,z]` (or `[x,y]`) row; omitted, the sphere is built about the origin.
 */
export const geodesicMatrix = (freq: number, radius: number, hemi = 0, centre?: Matrix): Matrix => {
  const f = Math.max(1, Math.min(24, Math.round(freq) || 1));
  const r = Math.abs(radius) > 1e-9 ? Math.abs(radius) : 1;
  const c = isRectMatrix(centre ?? []) && centre
    ? [centre[0][0] ?? 0, centre[0][1] ?? 0, centre[0][2] ?? 0]
    : [0, 0, 0];
  const { verts, faces } = ICOSA();
  const onSphere = (p: number[]): number[] => {
    const L = Math.hypot(p[0], p[1], p[2]) || 1;
    return [p[0] / L, p[1] / L, p[2] / L];
  };
  const out: number[][][] = [];
  for (const [ia, ib, ic] of faces) {
    const A = verts[ia];
    const B = verts[ib];
    const C = verts[ic];
    // Barycentric lattice point (i, j) of the f × f grid over this face.
    const at = (i: number, j: number): number[] => onSphere([
      (A[0] * (f - i - j) + B[0] * i + C[0] * j) / f,
      (A[1] * (f - i - j) + B[1] * i + C[1] * j) / f,
      (A[2] * (f - i - j) + B[2] * i + C[2] * j) / f,
    ]);
    for (let i = 0; i < f; i++) {
      for (let j = 0; j + i < f; j++) {
        out.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
        // The inverted triangle filling the gap between three upright ones; absent on the last row.
        if (i + j + 2 <= f) out.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
    }
  }
  const scaled = out
    .map((tri) => tri.map((p) => [p[0] * r + c[0], p[1] * r + c[1], p[2] * r + c[2]]))
    // A dome is the half above its centre, so the test is on the ORIGINAL z before the centre moved it.
    .filter((tri) => (hemi ? tri.reduce((s, p) => s + (p[2] - c[2]), 0) / 3 >= -1e-9 : true));
  const m: Matrix = [];
  scaled.forEach((tri, fi) => { for (const v of tri) m.push([round6(v[0]), round6(v[1]), round6(v[2]), fi]); });
  return m;
};

/**
 * SWEEP a 2D cross-section along a 3D rail — the skin of a handrail, a pipe run with bends, a cornice,
 * a spiral-stair stringer, a road corridor.
 *
 * The gap this closes: `mcyl` is a STRAIGHT tube, `mlathe` is a REVOLVE, and a Loft row stacks
 * sections the author has already placed. None of them carries a profile along a curve, so anything
 * following a path had to be stitched by hand — the one loop that is identical every time.
 *
 * PARALLEL TRANSPORT, not a fixed up-vector. The frame at each rail point is the previous frame
 * rotated by the minimum turn that takes the old tangent onto the new one, so the section does not
 * spin as the rail climbs and, critically, nothing degenerates when the rail goes vertical — which is
 * exactly where an up-vector frame flips the profile over and creases the mesh.
 *
 * `profile` is N×2 in the section's own (u, v) axes; `rail` is M×3 (M×2 is read at z = 0).
 */
export const sweepMatrix = (profile: Matrix, rail: Matrix, closed = 0): Matrix => {
  if (!isRectMatrix(profile) || profile.length < 3 || !isRectMatrix(rail) || rail.length < 2) return [];
  const prof = profile.map((p) => [p[0], p[1]]);
  const path: V3[] = rail.map((p) => [p[0], p[1], p[2] ?? 0] as V3);
  // Drop repeated points: a zero-length span has no tangent, and one is enough to break the frame chain.
  const pts: V3[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const q = path[i];
    const p = pts[pts.length - 1];
    if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 1e-9) pts.push(q);
  }
  if (closed && pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-9) pts.pop();
  }
  if (pts.length < 2) return [];

  const nrm = (v: V3): V3 => {
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  };
  const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // Tangent per point: the average of the incoming and outgoing spans, so a corner turns smoothly
  // rather than snapping the section between two orientations.
  const n = pts.length;
  const tan: V3[] = pts.map((_, i) => {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(n - 1, i + 1)];
    return nrm([next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]);
  });

  // Seed the frame with any axis not parallel to the first tangent, then carry it along.
  let u: V3 = Math.abs(tan[0][2]) < 0.9 ? nrm(crs(tan[0], [0, 0, 1])) : nrm(crs(tan[0], [1, 0, 0]));
  const sections: number[][][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // Rodrigues about (t_prev × t_i) by the angle between them — the minimum-twist carry.
      const axis = crs(tan[i - 1], tan[i]);
      const sinA = Math.hypot(axis[0], axis[1], axis[2]);
      if (sinA > 1e-9) {
        const k = nrm(axis);
        const ang = Math.atan2(sinA, dot3(tan[i - 1], tan[i]));
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const kxu = crs(k, u);
        const kdu = dot3(k, u);
        u = nrm([
          u[0] * ca + kxu[0] * sa + k[0] * kdu * (1 - ca),
          u[1] * ca + kxu[1] * sa + k[1] * kdu * (1 - ca),
          u[2] * ca + kxu[2] * sa + k[2] * kdu * (1 - ca),
        ]);
      }
    }
    const v = nrm(crs(tan[i], u));
    const o = pts[i];
    sections.push(prof.map((p) => [
      o[0] + u[0] * p[0] + v[0] * p[1],
      o[1] + u[1] * p[0] + v[1] * p[1],
      o[2] + u[2] * p[0] + v[2] * p[1],
    ]));
  }
  if (closed) sections.push(sections[0]);
  return facesToMatrix(loftFaces(sections));
};
