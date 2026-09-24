/** axisMesh.ts — meshes for the 3D Render node's AXIS-SEGMENT rows (Tube, Ring) and its LOFT row.
 *
 *  Both rows read the same wire format — a list of `[x1,y1,z1,x2,y2,z2]` segments — and differ only in what
 *  the segment MEANS: for a Tube it is the cylinder's own extent, for a Ring it is the torus's AXIS (the
 *  axle), so the ring is centred on the segment's midpoint and lies in the plane perpendicular to it.
 *
 *  WHY THESE ARE MESHES rather than a rotated primitive. A Cuboid / Cylinder row is positioned by a POINT
 *  and its axis is fixed to vertical — the row exposes no rotation, and nothing wired could supply one, so
 *  every off-axis member (a frame's down tube, a strut, a handrail, a wheel standing on edge) was out of
 *  reach except by hand-building its faces in the Math Engine. Emitting a face list instead of a new
 *  primitive shape means the existing POLYHEDRON path carries them end to end: the viewport, the 3D export
 *  and any downstream Display 3D already handle it, and there is one triangulation, not three.
 *
 *  FRAME: everything here is the PLAN frame the Render rows speak — x across, y down the plan, z up — and
 *  the caller maps to scene coordinates exactly as it does for a Polyhedron row's own face list. Rings are
 *  emitted as closed loops of 3D points, the format a Polyhedron row already reads, and are fan-triangulated
 *  and drawn double-sided downstream, so winding direction is not load-bearing. */

export type V3 = [number, number, number];

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (v: V3, s: number): V3 => [v[0] * s, v[1] * s, v[2] * s];
const norm3 = (v: V3): number => Math.hypot(v[0], v[1], v[2]);
const cross3 = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** An orthonormal pair spanning the plane PERPENDICULAR to the unit axis `d`. The seed is whichever world
 *  axis `d` leans on least, so the cross product can never collapse — which is the whole reason a tilted
 *  member needs no special case: a vertical seat tube and a raked fork take the same path. */
const basisFor = (d: V3): [V3, V3] => {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  const seed: V3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const raw = cross3(d, seed);
  const l = norm3(raw);
  const e1: V3 = l > 1e-9 ? mul3(raw, 1 / l) : [1, 0, 0];
  return [e1, cross3(d, e1)]; // e2 is already unit: d ⟂ e1 and both are unit
};

/** A LOFT: the skin over an ordered stack of cross-sections, plus a cap at each end.
 *
 *  This is the primitive a curved BODY needs, and the reason it exists as a row rather than as maths. A
 *  Polyhedron row can already draw any solid — but only if the Math Engine enumerates every FACE, and for a
 *  lofted hull that means the caller writing the quad-stitching loop itself: index k to k+1 around each ring,
 *  section i to i+1 along the body, the wrap-around at k = n−1, and the two caps. That loop is identical for
 *  every lofted thing — a car body, a boat hull, a roof, a moulding, a tapered column — so it belongs here
 *  once instead of in every flow. What the flow then authors is what actually varies: the SECTIONS.
 *
 *  Sections should share a vertex count; where two differ, consecutive sections are stitched over the
 *  smaller of the two, so a mismatch loses detail rather than the solid. Fewer than two usable sections is
 *  nothing to skin. Rings are closed automatically — do not repeat the first point. */
export const loftFaces = (sections: number[][][]): number[][][] => {
  const secs = sections.filter((s) => Array.isArray(s) && s.length >= 3);
  if (secs.length < 2) return [];
  const faces: number[][][] = [[...secs[0]].reverse()]; // near cap, wound outward
  for (let i = 0; i + 1 < secs.length; i++) {
    const A = secs[i], B = secs[i + 1];
    const n = Math.min(A.length, B.length);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      faces.push([A[k], A[j], B[j], B[k]]);
    }
  }
  faces.push(secs[secs.length - 1]); // far cap
  return faces;
};

/** A capped cylinder of `radius` spanning a → b: two end rings plus one quad per side. A zero-length
 *  segment yields nothing rather than a degenerate sliver — a plan-projected vertical member is exactly
 *  that, and a whole list is routinely built with a few of them in it. */
export const tubeFaces = (a: V3, b: V3, radius: number, sides = 12, radiusB?: number): number[][][] => {
  const d = sub3(b, a);
  const L = norm3(d);
  if (L < 1e-6) return [];
  const n = Math.max(3, Math.round(sides));
  const rA = Math.max(1e-5, radius);
  // A second end radius makes the same generator a truncated CONE, which is what a tapered bore or a
  // countersink needs; omitted, it is the plain cylinder every existing caller gets.
  const rB = radiusB === undefined ? rA : Math.max(1e-5, radiusB);
  const u = mul3(d, 1 / L);
  const [e1, e2] = basisFor(u);
  const ringAt = (o: V3, r: number): V3[] => Array.from({ length: n }, (_, k) => {
    const t = (2 * Math.PI * k) / n;
    return add3(o, add3(mul3(e1, r * Math.cos(t)), mul3(e2, r * Math.sin(t))));
  });
  const A = ringAt(a, rA), B = ringAt(b, rB);
  const faces: number[][][] = [[...A].reverse(), B]; // caps, wound outward
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    faces.push([A[k], A[j], B[j], B[k]]);
  }
  return faces;
};

/** A SOLID OF REVOLUTION: the closed profile loop `profile` — rows of `[t, r]`, t measured along the axis
 *  from `a`, r the radius at that station — swept around the axis a → b. Only the DIRECTION of a → b is used,
 *  so the profile alone fixes the extent.
 *
 *  This is the constructor that keeps a boolean out of a job it is bad at. A hollow tube is expressible as
 *  `msubtract(cylinder, longer cylinder)`, and it is a poor case for BSP CSG: a thin wall's facets straddle
 *  most of the bore's radial planes rather than sitting cleanly behind them, so each one gets split many
 *  times over. Measured on the flute below — 32 / 48 / 64 sides — the boolean route costs 3.5× / 3.9× / 4.5×
 *  the faces of the revolve and 24 / 33 / 43 ms, against 160 / 240 / 320 faces and no CSG at all; chaining
 *  the bore and then seven holes as eight separate subtractions reached 116k triangles and 3.8 s, where a
 *  revolve plus ONE boolean for all seven holes is 3.2k triangles and 74 ms.
 *
 *  It is also the more truthful description, which is why it is not merely an optimisation: the profile
 *  ALREADY describes both walls. For a flute, `(head,0) → (head,R) → (foot,R) → (foot,rBore) →
 *  (cork,rBore) → (cork,0)` is the outer surface, the foot annulus, the bore, and the cork face the bore
 *  stops against — six points, and every one of them a dimension a maker would actually quote.
 *
 *  The loop is CLOSED implicitly (last row joins the first), so it needs no end caps — a cap is just a
 *  profile edge at constant t. A station at r = 0 sits ON the axis, where the revolution collapses to a
 *  single point, so those quads come back as triangles rather than as zero-width slivers. */
export const latheFaces = (a: V3, b: V3, profile: number[][], sides = 24): number[][][] => {
  const d = sub3(b, a);
  const L = norm3(d);
  if (L < 1e-9 || !Array.isArray(profile) || profile.length < 3) return [];
  const n = Math.max(3, Math.round(sides));
  const u = mul3(d, 1 / L);
  const [e1, e2] = basisFor(u);
  const P = profile.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [p[0], Math.max(0, p[1])]);
  if (P.length < 3) return [];
  const at = (t: number, r: number, k: number): V3 => {
    const th = (2 * Math.PI * k) / n;
    return add3(add3(a, mul3(u, t)), add3(mul3(e1, r * Math.cos(th)), mul3(e2, r * Math.sin(th))));
  };
  const faces: number[][][] = [];
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    const [t0, r0] = P[i], [t1, r1] = P[j];
    if (Math.abs(t0 - t1) < 1e-12 && Math.abs(r0 - r1) < 1e-12) continue; // repeated profile point
    const axial0 = r0 < 1e-12, axial1 = r1 < 1e-12;
    if (axial0 && axial1) continue;                                       // an edge along the axis sweeps nothing
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const ring = axial0
        ? [at(t0, 0, 0), at(t1, r1, k), at(t1, r1, k2)]
        : axial1
          ? [at(t0, r0, k), at(t1, 0, 0), at(t0, r0, k2)]
          : [at(t0, r0, k), at(t1, r1, k), at(t1, r1, k2), at(t0, r0, k2)];
      faces.push(ring);
    }
  }
  return faces;
};

/** A torus of ring radius `ringR` and section radius `tubeR` whose AXIS is the segment a → b: centred on
 *  its midpoint, lying in the perpendicular plane. Only the segment's direction and midpoint are used — its
 *  LENGTH is free, which is what lets a wheel be driven by its axle and a bend by its own centreline.
 *  Quads are emitted as a `seg` × `sides` grid, both loops closed. */
export const ringFaces = (
  a: V3, b: V3, ringR: number, tubeR: number, seg = 20, sides = 8,
): number[][][] => {
  const d = sub3(b, a);
  const L = norm3(d);
  if (L < 1e-9) return [];
  const ns = Math.max(3, Math.round(seg)), nk = Math.max(3, Math.round(sides));
  const R = Math.max(1e-4, ringR), t = Math.max(1e-4, tubeR);
  const u = mul3(d, 1 / L);
  const c = mul3(add3(a, b), 0.5);
  const [e1, e2] = basisFor(u);
  // grid[i][k] — around the ring by i, around the section by k. The section circle lies in the (radial,
  // axis) plane, so the tube stays normal to the ring wherever it is.
  const grid: V3[][] = Array.from({ length: ns }, (_, i) => {
    const phi = (2 * Math.PI * i) / ns;
    const rad = add3(mul3(e1, Math.cos(phi)), mul3(e2, Math.sin(phi)));
    const centre = add3(c, mul3(rad, R));
    return Array.from({ length: nk }, (_, k) => {
      const th = (2 * Math.PI * k) / nk;
      return add3(centre, add3(mul3(rad, t * Math.cos(th)), mul3(u, t * Math.sin(th))));
    });
  });
  const faces: number[][][] = [];
  for (let i = 0; i < ns; i++) {
    const i2 = (i + 1) % ns;
    for (let k = 0; k < nk; k++) {
      const k2 = (k + 1) % nk;
      faces.push([grid[i][k], grid[i][k2], grid[i2][k2], grid[i2][k]]);
    }
  }
  return faces;
};
