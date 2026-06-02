/** Pure minimum-enclosing bounding-shape geometry — circle (Welzl), ellipse (Khachiyan), and
 *  regular n-gon (supporting-line fit on the convex hull). Each returns a closed polygon (vertex
 *  list) in the same world-pixel space as the input, or an empty array when degenerate.
 *
 *  These mirror the Bounding Shapes block's runners (FloorPlanEditor) so the Flow "Bounding Shapes"
 *  node previews exactly what Run Flow commits. */
import type { Point } from "../../types";

/** Minimum enclosing circle (Welzl, randomised incremental) → a `seg`-gon approximation of the
 *  circle. Returns [] if the circle is degenerate. */
export const computeBoundingCircle = (pts: Point[], seg = 64): Point[] => {
  if (pts.length < 2) return [];
  type Circle = { x: number; y: number; r: number };
  const EPS = 1e-9;
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const inCircle = (c: Circle, p: Point) => dist({ x: c.x, y: c.y }, p) <= c.r + EPS;
  const fromTwo = (a: Point, b: Point): Circle => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, r: dist(a, b) / 2 });
  const fromThree = (a: Point, b: Point, c: Point): Circle => {
    const ax = a.x, ay = a.y, bx = b.x, by = b.y, cx = c.x, cy = c.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < EPS) return { x: (ax + cx) / 2, y: (ay + cy) / 2, r: dist(a, c) / 2 };
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    return { x: ux, y: uy, r: dist({ x: ux, y: uy }, a) };
  };
  const shuffled = pts.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let C: Circle = { x: shuffled[0].x, y: shuffled[0].y, r: 0 };
  for (let i = 1; i < shuffled.length; i++) {
    if (inCircle(C, shuffled[i])) continue;
    C = { x: shuffled[i].x, y: shuffled[i].y, r: 0 };
    for (let j = 0; j < i; j++) {
      if (inCircle(C, shuffled[j])) continue;
      C = fromTwo(shuffled[i], shuffled[j]);
      for (let k = 0; k < j; k++) {
        if (inCircle(C, shuffled[k])) continue;
        C = fromThree(shuffled[i], shuffled[j], shuffled[k]);
      }
    }
  }
  if (C.r < 0.5) return [];
  return Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2;
    return { x: C.x + Math.cos(a) * C.r, y: C.y + Math.sin(a) * C.r };
  });
};

/** Minimum-area enclosing ellipse (Khachiyan) → a `seg`-gon approximation. Returns [] if degenerate. */
export const computeBoundingEllipse = (pts: Point[], seg = 72): Point[] => {
  const N = pts.length;
  if (N < 3) return [];
  const TOL = 1e-3;
  const MAX_ITERS = 80;
  const Q = new Array<number>(3 * N);
  for (let i = 0; i < N; i++) { Q[i] = pts[i].x; Q[N + i] = pts[i].y; Q[2 * N + i] = 1; }
  const u = new Array<number>(N).fill(1 / N);
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    const X = new Array<number>(9).fill(0);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < N; k++) s += Q[r * N + k] * u[k] * Q[c * N + k];
        X[r * 3 + c] = s;
      }
    }
    const det =
      X[0] * (X[4] * X[8] - X[5] * X[7]) -
      X[1] * (X[3] * X[8] - X[5] * X[6]) +
      X[2] * (X[3] * X[7] - X[4] * X[6]);
    if (Math.abs(det) < 1e-12) break;
    const inv = new Array<number>(9);
    inv[0] = (X[4] * X[8] - X[5] * X[7]) / det;
    inv[1] = (X[2] * X[7] - X[1] * X[8]) / det;
    inv[2] = (X[1] * X[5] - X[2] * X[4]) / det;
    inv[3] = (X[5] * X[6] - X[3] * X[8]) / det;
    inv[4] = (X[0] * X[8] - X[2] * X[6]) / det;
    inv[5] = (X[2] * X[3] - X[0] * X[5]) / det;
    inv[6] = (X[3] * X[7] - X[4] * X[6]) / det;
    inv[7] = (X[1] * X[6] - X[0] * X[7]) / det;
    inv[8] = (X[0] * X[4] - X[1] * X[3]) / det;
    let jMax = 0, mMax = -Infinity;
    for (let i = 0; i < N; i++) {
      const q0 = Q[i], q1 = Q[N + i], q2 = Q[2 * N + i];
      const r0 = inv[0] * q0 + inv[1] * q1 + inv[2] * q2;
      const r1 = inv[3] * q0 + inv[4] * q1 + inv[5] * q2;
      const r2 = inv[6] * q0 + inv[7] * q1 + inv[8] * q2;
      const m = q0 * r0 + q1 * r1 + q2 * r2;
      if (m > mMax) { mMax = m; jMax = i; }
    }
    const step = (mMax - 3) / (3 * (mMax - 1));
    if (step < TOL) break;
    for (let i = 0; i < N; i++) u[i] *= (1 - step);
    u[jMax] += step;
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < N; i++) { cx += pts[i].x * u[i]; cy += pts[i].y * u[i]; }
  let s00 = 0, s01 = 0, s11 = 0;
  for (let i = 0; i < N; i++) {
    const px = pts[i].x, py = pts[i].y;
    s00 += u[i] * px * px;
    s01 += u[i] * px * py;
    s11 += u[i] * py * py;
  }
  const m00 = s00 - cx * cx;
  const m01 = s01 - cx * cy;
  const m11 = s11 - cy * cy;
  const mdet = m00 * m11 - m01 * m01;
  if (Math.abs(mdet) < 1e-9) return [];
  const trace = m00 + m11;
  const discr = Math.sqrt(Math.max(0, (trace * trace) / 4 - mdet));
  const lam1 = trace / 2 + discr;
  const lam2 = trace / 2 - discr;
  const a = Math.sqrt(Math.max(0, 2 * lam1));
  const b = Math.sqrt(Math.max(0, 2 * lam2));
  let rot: number;
  if (Math.abs(m01) > 1e-9) rot = Math.atan2(lam1 - m00, m01);
  else rot = m00 >= m11 ? 0 : Math.PI / 2;
  if (a < 0.5 || b < 0.5) return [];
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  return Array.from({ length: seg }, (_, i) => {
    const t = (i / seg) * Math.PI * 2;
    const ex = a * Math.cos(t), ey = b * Math.sin(t);
    return { x: cx + ex * cosR - ey * sinR, y: cy + ex * sinR + ey * cosR };
  });
};

/** Smallest regular n-gon enclosing the points (via convex-hull supporting lines). `angleDeg` is the
 *  base orientation; `optimize` sweeps the n-gon's fundamental domain [0, 2π/n) for minimum area.
 *  Returns the n corners, or [] on failure. */
export const computeBoundingNGon = (pts: Point[], sides: number, angleDeg: number, optimize: boolean): Point[] => {
  if (pts.length < 3) return [];
  const n = Math.max(3, Math.min(12, Math.round(sides)));

  // Convex hull (Andrew's monotone chain).
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  if (hull.length < 3) return [];

  const fitAtAngle = (theta: number): { corners: Point[]; area: number } | null => {
    const dirs: { nx: number; ny: number; d: number }[] = [];
    for (let k = 0; k < n; k++) {
      const a = theta + (2 * Math.PI * k) / n;
      const nx = Math.cos(a), ny = Math.sin(a);
      let d = -Infinity;
      for (const p of hull) {
        const proj = p.x * nx + p.y * ny;
        if (proj > d) d = proj;
      }
      dirs.push({ nx, ny, d });
    }
    const corners: Point[] = [];
    for (let k = 0; k < n; k++) {
      const L1 = dirs[k], L2 = dirs[(k + 1) % n];
      const det = L1.nx * L2.ny - L1.ny * L2.nx;
      if (Math.abs(det) < 1e-9) return null;
      const x = (L1.d * L2.ny - L2.d * L1.ny) / det;
      const y = (L1.nx * L2.d - L2.nx * L1.d) / det;
      corners.push({ x, y });
    }
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const a = corners[i], b = corners[(i + 1) % n];
      area2 += a.x * b.y - b.x * a.y;
    }
    return { corners, area: Math.abs(area2) / 2 };
  };

  let best: { corners: Point[]; area: number } | null = null;
  const baseRad = (angleDeg * Math.PI) / 180;
  if (optimize) {
    const STEPS = 180;
    for (let i = 0; i < STEPS; i++) {
      const t = baseRad + (i * (2 * Math.PI / n)) / STEPS;
      const r = fitAtAngle(t);
      if (r && (!best || r.area < best.area)) best = r;
    }
  } else {
    best = fitAtAngle(baseRad);
  }
  return best ? best.corners : [];
};
