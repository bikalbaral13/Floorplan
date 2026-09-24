/** Curves for the matrix language: Bezier, B-spline, NURBS, the catenary, and the two utilities
 *  (`arclen`, `resample`) that make a sampled curve usable as geometry.
 *
 *  WHY THESE ARE BUILTINS. Everything here is expressible in the expression language already — a
 *  quadratic Bezier is four lines of column arithmetic, and the piano's bent side was written that
 *  way. What is NOT expressible in four lines is the general case: de Casteljau at arbitrary degree,
 *  de Boor with a clamped knot vector, the rational weights that make a NURBS an exact conic, or the
 *  transcendental solve behind a catenary's sag. Those are loops over a scalar index, which the
 *  interpreter charges per statement and caps at MAX_STEPS — so a 200-point spline written in the
 *  language would cost thousands of steps and still be the same maths. Here it is one call.
 *
 *  DIMENSION IS READ, NOT DECLARED. A control-point matrix is N×2 or N×3 and the output matches, so
 *  the same call draws a plan curve for a Polygon row and a space curve for a rail sweep.
 *
 *  Every entry point returns `[]` rather than throwing on degenerate input — a half-built parametric
 *  object should render nothing, not break the flow it sits in.
 */

import { type Matrix, round6, isRectMatrix } from "./matrixCore.js";

/** Sample count, clamped to something a curve can actually be drawn from. */
const samples = (n: number): number => Math.max(2, Math.min(4096, Math.round(n) || 2));

/** Round a whole point list once, at the exit — the interpreter's matrices are compared and
 *  serialised, so trailing float noise is worth removing here rather than at every call site. */
const clean = (pts: number[][]): Matrix => pts.map((p) => p.map(round6));

/** Control points as a clean N×d list, or null when there is nothing to interpolate. */
const controlPoints = (M: Matrix, least = 2): number[][] | null => {
  if (!isRectMatrix(M) || M.length < least) return null;
  const d = Math.min(3, Math.max(2, M[0].length));
  return M.map((r) => (d === 2 ? [r[0], r[1]] : [r[0], r[1], r[2] ?? 0]));
};

const lerpPt = (a: number[], b: number[], t: number): number[] =>
  a.map((v, i) => v + (b[i] - v) * t);

/**
 * A Bezier curve of ANY degree, by de Casteljau — `n` points from `ctrl`'s first control point to
 * its last, the interior ones pulling the curve without being touched.
 *
 * Degree follows the control count, so three points give the quadratic that a hand-written
 * `(1-t)²A + 2(1-t)tB + t²C` gives, and eight give a septic that hand-writing would not survive.
 */
export const bezierMatrix = (ctrl: Matrix, n: number): Matrix => {
  const P = controlPoints(ctrl);
  if (!P) return [];
  const count = samples(n);
  const out: number[][] = [];
  for (let s = 0; s < count; s++) {
    const t = s / (count - 1);
    // Repeated linear interpolation, collapsing the control polygon to one point.
    const work = P.map((p) => p.slice());
    for (let r = 1; r < work.length; r++) {
      for (let j = 0; j + r < work.length; j++) work[j] = lerpPt(work[j], work[j + 1], t);
    }
    out.push(work[0]);
  }
  return clean(out);
};

/** A CLAMPED uniform knot vector for `m` control points at `degree` — the curve then starts exactly
 *  at the first control point and ends exactly at the last, which is what makes a spline usable as
 *  an edge of something rather than only as a shape near some points. */
const clampedKnots = (m: number, degree: number): number[] => {
  const U: number[] = [];
  for (let i = 0; i <= m + degree; i++) {
    if (i <= degree) U.push(0);
    else if (i >= m) U.push(1);
    else U.push((i - degree) / (m - degree));
  }
  return U;
};

/** The knot span containing `u`, i.e. the k with U[k] <= u < U[k+1], clamped to the legal range. */
const knotSpan = (U: number[], m: number, degree: number, u: number): number => {
  if (u >= U[m]) return m - 1;
  let lo = degree;
  let hi = m;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (u < U[mid]) hi = mid;
    else lo = mid;
  }
  return lo;
};

/** de Boor at `u`, on points of any width — the homogeneous 4th coordinate of a NURBS rides through
 *  as just another component, which is the whole reason the rational case needs no second algorithm. */
const deBoor = (P: number[][], U: number[], degree: number, u: number): number[] => {
  const k = knotSpan(U, P.length, degree, u);
  const d = [];
  for (let j = 0; j <= degree; j++) d.push(P[j + k - degree].slice());
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const lo = U[j + k - degree];
      const hi = U[j + 1 + k - r];
      const alpha = hi - lo > 1e-12 ? (u - lo) / (hi - lo) : 0;
      d[j] = lerpPt(d[j - 1], d[j], alpha);
    }
  }
  return d[degree];
};

/**
 * A clamped uniform B-SPLINE through `n` samples.
 *
 * The difference from {@link bezierMatrix} is LOCALITY: a Bezier's every control point pulls the
 * whole curve, so a fifty-point Bezier is unusable — moving one handle moves everything, and the
 * degree climbs with the point count until the numbers stop behaving. A B-spline holds the degree
 * fixed and each control point influences only `degree + 1` spans, which is why a long run of
 * fairing points (a road, a bent side, a hull line) is a spline and not a Bezier.
 *
 * `degree` is clamped to the control count, so a 3-point call at degree 5 quietly becomes a quadratic
 * rather than returning nothing.
 */
export const bsplineMatrix = (ctrl: Matrix, degree: number, n: number): Matrix => {
  const P = controlPoints(ctrl);
  if (!P) return [];
  const p = Math.max(1, Math.min(Math.round(degree) || 3, P.length - 1));
  const U = clampedKnots(P.length, p);
  const count = samples(n);
  const out: number[][] = [];
  for (let s = 0; s < count; s++) out.push(deBoor(P, U, p, s / (count - 1)));
  return clean(out);
};

/**
 * A NURBS curve — a B-spline whose control points carry WEIGHTS.
 *
 * This is the one curve in the set that can be EXACT rather than close: a weighted quadratic
 * reproduces a circular arc precisely, where a polynomial spline can only approach one. That matters
 * whenever a curve has to meet a fabricated part — a fillet, an arc'd mullion, a wheel — rather than
 * merely look right.
 *
 * `w` is read as one weight per control point (a column, or the first column of anything wider);
 * missing or non-positive weights fall back to 1, which degrades exactly to {@link bsplineMatrix}.
 */
export const nurbsMatrix = (ctrl: Matrix, w: Matrix, degree: number, n: number): Matrix => {
  const P = controlPoints(ctrl);
  if (!P) return [];
  const dim = P[0].length;
  const weightAt = (i: number): number => {
    const raw = isRectMatrix(w) ? (w[i]?.[0] ?? w[0]?.[i] ?? 1) : 1;
    return Number.isFinite(raw) && raw > 1e-9 ? raw : 1;
  };
  // Homogeneous form: (w·x, w·y, w·z, w). de Boor is linear, so interpolating these and dividing
  // through at the end IS the rational curve — no separate rational evaluator.
  const H = P.map((pt, i) => {
    const wi = weightAt(i);
    return [...pt.map((v) => v * wi), wi];
  });
  const p = Math.max(1, Math.min(Math.round(degree) || 3, H.length - 1));
  const U = clampedKnots(H.length, p);
  const count = samples(n);
  const out: number[][] = [];
  for (let s = 0; s < count; s++) {
    const h = deBoor(H, U, p, s / (count - 1));
    const wEnd = h[dim];
    const inv = Math.abs(wEnd) > 1e-12 ? 1 / wEnd : 0;
    out.push(h.slice(0, dim).map((v) => v * inv));
  }
  return clean(out);
};

/** The `a` of `a·cosh(x/a)` that droops `sag` over a horizontal span `L`.
 *
 *  sag(a) = a(cosh(L/2a) − 1) is monotonically DECREASING in a and has no closed-form inverse, so
 *  this is a bisection — cheap, and it cannot diverge the way a Newton step off a cosh can. */
const catenaryParam = (L: number, sag: number): number => {
  const target = Math.max(1e-6, sag);
  const droop = (a: number): number => a * (Math.cosh(L / (2 * a)) - 1);
  let lo = 1e-6;
  let hi = Math.max(L, 1);
  // Grow the upper bound until it under-droops, so the root is bracketed whatever the sag asked for.
  for (let i = 0; i < 60 && droop(hi) > target; i++) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (droop(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * The hanging curve between the two ends of an AXIS SEGMENT — a cable, a chain, a draped edge, the
 * shape a suspension structure takes because it is the shape a rope takes.
 *
 * `seg` is `[x1,y1,z1,x2,y2,z2]`, the same wire format Tube and `mcyl` read, so a catenary can be
 * aimed with geometry already to hand. A 2-row × 3-column pair of points is accepted too.
 *
 * `sag` is the DROOP AT MID-SPAN below the straight chord, in metres, because that is the number a
 * designer has an opinion about — the `a` of the cosh is solved from it. The ends are exact: the
 * curve is the chord plus a cosh that is zero at both ends by construction, so raising one end tilts
 * the whole span instead of breaking the attachment.
 */
export const catenaryMatrix = (seg: Matrix, sag: number, n: number): Matrix => {
  if (!isRectMatrix(seg)) return [];
  let a: number[];
  let b: number[];
  if (seg[0].length >= 6) {
    a = [seg[0][0], seg[0][1], seg[0][2]];
    b = [seg[0][3], seg[0][4], seg[0][5]];
  } else if (seg.length >= 2 && seg[0].length >= 2) {
    a = [seg[0][0], seg[0][1], seg[0][2] ?? 0];
    b = [seg[1][0], seg[1][1], seg[1][2] ?? 0];
  } else return [];

  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  const count = samples(n);
  // A vertical drop has no horizontal span to hang across; the straight line is the honest answer.
  if (L < 1e-9) {
    const out: number[][] = [];
    for (let s = 0; s < count; s++) out.push(lerpPt(a, b, s / (count - 1)));
    return clean(out);
  }
  const aa = catenaryParam(L, sag);
  const half = Math.cosh(L / (2 * aa));
  const out: number[][] = [];
  for (let s = 0; s < count; s++) {
    const u = s / (count - 1);
    const x = L * u;
    // cosh((x − L/2)/a) − cosh(L/2a) is 0 at both ends and −sag/a at mid-span.
    const drop = aa * (Math.cosh((x - L / 2) / aa) - half);
    out.push([a[0] + dx * u, a[1] + dy * u, a[2] + (b[2] - a[2]) * u + drop]);
  }
  return clean(out);
};

/** Cumulative arc length down a point list, starting at 0 — an N×1 column.
 *
 *  The measuring tape for everything else here: spacing balusters, placing a label at 60% along,
 *  or checking that a sampled spline is long enough to fabricate. */
export const arclenMatrix = (pts: Matrix): Matrix => {
  const P = controlPoints(pts, 1);
  if (!P) return [];
  const out: number[][] = [[0]];
  let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    acc += Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0));
    out.push([round6(acc)]);
  }
  return out;
};

/**
 * Resample a polyline to `n` points EVENLY SPACED BY ARC LENGTH.
 *
 * Curve evaluators sample in the parameter, not in distance, and the two are not the same: a Bezier
 * bunches its points where the curve is tight. Anything placed along the result — treads, balusters,
 * fence posts, panel joints, a texture — needs even spacing in the world, not in t. This is that
 * conversion, and it is why the spline functions can stay honest samplers.
 */
export const resampleMatrix = (pts: Matrix, n: number): Matrix => {
  const P = controlPoints(pts, 2);
  if (!P) return [];
  const count = samples(n);
  const cum: number[] = [0];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const b = P[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0)));
  }
  const total = cum[cum.length - 1];
  if (total < 1e-12) return clean(new Array(count).fill(P[0]));
  const out: number[][] = [];
  let seg = 0;
  for (let s = 0; s < count; s++) {
    const target = (total * s) / (count - 1);
    while (seg < P.length - 2 && cum[seg + 1] < target) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span > 1e-12 ? (target - cum[seg]) / span : 0;
    out.push(lerpPt(P[seg], P[seg + 1], t));
  }
  return clean(out);
};
