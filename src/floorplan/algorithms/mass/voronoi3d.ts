/**
 * Voronoi 3D — the Voronoi diagram of a set of 3D seed points, computed by half-space intersection:
 * each cell starts as the seeds' bounding box and is clipped by the perpendicular-bisector plane between
 * its seed and every other seed (keeping the side closer to its own seed). Each cell is a convex
 * polyhedron returned as a list of faces (CCW point loops). Self-contained for the "Voronoi 3D" Mass node.
 *
 * O(N²) per cell — fine for the modest seed counts a primitive Mass yields (8 cube corners, ~16–20 for
 * sphere / cone / cylinder). All coordinates are scene metres (matching the 3D render).
 */

export type V3 = { x: number; y: number; z: number };

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** The six faces of an axis-aligned box (each a CCW quad). */
function boxFaces(min: V3, max: V3): V3[][] {
  const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
  const { x: x0, y: y0, z: z0 } = min, { x: x1, y: y1, z: z1 } = max;
  return [
    [v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)],
    [v(x1, y0, z0), v(x1, y1, z0), v(x1, y1, z1), v(x1, y0, z1)],
    [v(x0, y0, z0), v(x1, y0, z0), v(x1, y0, z1), v(x0, y0, z1)],
    [v(x0, y1, z0), v(x0, y1, z1), v(x1, y1, z1), v(x1, y1, z0)],
    [v(x0, y0, z0), v(x0, y1, z0), v(x1, y1, z0), v(x1, y0, z0)],
    [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)],
  ];
}

/** Order a set of coplanar cut points into a ring (CCW about plane normal `n`); dedups near-duplicates. */
function orderRing(pts: V3[], n: V3): V3[] {
  const uniq: V3[] = [];
  for (const p of pts) if (!uniq.some((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < 1e-5)) uniq.push(p);
  if (uniq.length < 3) return uniq;
  const c: V3 = { x: 0, y: 0, z: 0 };
  for (const p of uniq) { c.x += p.x; c.y += p.y; c.z += p.z; }
  c.x /= uniq.length; c.y /= uniq.length; c.z /= uniq.length;
  const nn = norm(n);
  let t: V3 = { x: 1, y: 0, z: 0 };
  if (Math.abs(dot(nn, t)) > 0.9) t = { x: 0, y: 1, z: 0 };
  const u = norm(cross(nn, t));
  const w = cross(nn, u);
  return uniq.slice().sort((a, b) =>
    Math.atan2(dot(sub(a, c), w), dot(sub(a, c), u)) - Math.atan2(dot(sub(b, c), w), dot(sub(b, c), u)));
}

/** Clip a convex polyhedron (list of CCW faces) by the half-space { x : dot(n, x − p) ≤ 0 }. */
function clipByPlane(faces: V3[][], n: V3, p: V3): V3[][] {
  const eps = 1e-7;
  const sd = (v: V3) => dot(n, sub(v, p));
  const out: V3[][] = [];
  const cut: V3[] = [];
  for (const face of faces) {
    const kept: V3[] = [];
    const M = face.length;
    for (let i = 0; i < M; i++) {
      const a = face[i], b = face[(i + 1) % M];
      const da = sd(a), db = sd(b);
      const inA = da <= eps, inB = db <= eps;
      if (inA) kept.push(a);
      if (inA !== inB) {
        const t = da / (da - db);
        const ip: V3 = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
        kept.push(ip);
        cut.push(ip);
      }
    }
    if (kept.length >= 3) out.push(kept);
  }
  const cap = orderRing(cut, n);
  if (cap.length >= 3) out.push(cap);
  return out;
}

/** Voronoi cells (each a convex polyhedron = list of faces) of `seeds`, clipped to `min`..`max`. */
export function voronoiCells3D(seeds: V3[], min: V3, max: V3): V3[][][] {
  const cells: V3[][][] = [];
  for (let i = 0; i < seeds.length; i++) {
    let faces = boxFaces(min, max);
    for (let j = 0; j < seeds.length && faces.length; j++) {
      if (i === j) continue;
      const n = sub(seeds[j], seeds[i]);            // toward j; keep the side closer to i
      if (Math.hypot(n.x, n.y, n.z) < 1e-9) continue;
      const mid: V3 = { x: (seeds[i].x + seeds[j].x) / 2, y: (seeds[i].y + seeds[j].y) / 2, z: (seeds[i].z + seeds[j].z) / 2 };
      faces = clipByPlane(faces, n, mid);
    }
    if (faces.length) cells.push(faces);
  }
  return cells;
}

/** Seed vertices of a primitive Mass in scene metres, positioned to match the 3D render (base on the
 *  floor, centred at `cx`,`cz`). Cube/Cuboid → 8 corners; Sphere/Cone/Cylinder → sampled surface points. */
export function massVertices(
  m: { shape: string; length: number; breadth: number; height: number; radius: number },
  cx: number, cz: number,
): V3[] {
  const boxCorners = (w: number, h: number, d: number): V3[] => {
    const hx = w / 2, hz = d / 2, out: V3[] = [];
    for (const y of [0, h]) for (const sx of [-hx, hx]) for (const sz of [-hz, hz]) out.push({ x: cx + sx, y, z: cz + sz });
    return out;
  };
  if (m.shape === "cuboid") return boxCorners(m.length, m.height, m.breadth);
  if (m.shape === "sphere") {
    const r = m.radius, n = 18, out: V3[] = [];
    for (let i = 0; i < n; i++) {                  // Fibonacci sphere
      const y = 1 - 2 * (i + 0.5) / n;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * 2.399963229728653;
      out.push({ x: cx + r * rr * Math.cos(phi), y: r + r * y, z: cz + r * rr * Math.sin(phi) });
    }
    return out;
  }
  if (m.shape === "cone") {
    const r = m.radius, h = m.height, mseg = 10, out: V3[] = [{ x: cx, y: h, z: cz }, { x: cx, y: 0, z: cz }];
    for (let i = 0; i < mseg; i++) { const a = (i / mseg) * 2 * Math.PI; out.push({ x: cx + r * Math.cos(a), y: 0, z: cz + r * Math.sin(a) }); }
    return out;
  }
  if (m.shape === "cylinder") {
    const r = m.radius, h = m.height, mseg = 10, out: V3[] = [];
    for (const y of [0, h]) for (let i = 0; i < mseg; i++) { const a = (i / mseg) * 2 * Math.PI; out.push({ x: cx + r * Math.cos(a), y, z: cz + r * Math.sin(a) }); }
    return out;
  }
  return boxCorners(m.length, m.length, m.length); // cube
}
