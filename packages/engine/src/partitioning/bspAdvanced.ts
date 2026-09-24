/**
 * Advanced BSP partitioning for the Flow BSP node.
 *
 * Improvements over the plain `computeBspCells` engine:
 *  • TRUE-AREA cuts — every cut position is solved by bisection so the CLIPPED area (the part of
 *    the cell inside the boundary polygon, not its bounding box) matches the target fraction.
 *    Equal weights → genuinely equal clipped cell areas, even on L/T/concave boundaries.
 *  • Weighted balance — per-cell ratio weights drive the same clipped-area solve.
 *  • Adjacency — a required-connection list (seed index pairs) steers the recursion: at every
 *    split the seed set is bipartitioned to MINIMISE cut connections (exact enumeration ≤ 12 seeds,
 *    RFP-style), then a relabelling pass (equal-weight seeds may swap cells) and deterministic
 *    multi-start probes maximise the number of satisfied connections.
 *  • Squarified treemap layout — cells laid out with the squarify row heuristic so aspect ratios
 *    approach 1, combined with the clipped-area bisection so areas stay exact.
 *  • Aspect-aware axis choice — in slicing mode, an optional max-aspect target makes each split
 *    pick the cut axis whose children are predicted to yield the squarest cells.
 */

import type { Point } from "../types.js";
import { sutherlandHodgmanClip } from "../geometry/sutherlandHodgman.js";

export interface AdvancedBspOptions {
  /** One weight per cell (length = cell count). Equal weights → equal clipped areas. */
  weights: number[];
  /** Tilt angle in degrees. Cuts are axis-aligned in the rotated frame, then unrotated. */
  tiltAngleDeg?: number;
  /** "strip" = recursive slicing (BSP); "squarify" = squarified-treemap rows. */
  layout?: "strip" | "squarify";
  /** Required adjacencies as 0-based seed index pairs. Forces strip mode. */
  connections?: [number, number][];
  /** Soft max aspect target (long/short). 0/undefined = off. Strip mode only. */
  maxRatio?: number;
  /** Recursion depth cap. Defaults to 24. */
  maxDepth?: number;
}

export interface AdvancedBspResult {
  /** One cell polygon per seed (in seed order; degenerate cells are empty arrays). */
  cells: Point[][];
  /** Connections whose two cells share a wall in the final layout. */
  satisfied: [number, number][];
  /** Connections the solver couldn't satisfy. */
  broken: [number, number][];
}

type Box = { x0: number; y0: number; x1: number; y1: number };

const polyArea = (pts: { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
};

/** Parse a "1-2, 2-3" connection list (1-based pairs) into deduped 0-based index pairs < n. */
export const parseBspConnections = (raw: string, n: number): [number, number][] => {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const tok of String(raw ?? "").split(",")) {
    const m = tok.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (!m) continue;
    const a = parseInt(m[1], 10) - 1;
    const b = parseInt(m[2], 10) - 1;
    if (a < 0 || b < 0 || a >= n || b >= n || a === b) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a < b ? [a, b] : [b, a]);
  }
  return out;
};

/** Serialize 0-based pairs back to the "1-2,2-3" param format. */
export const serializeBspConnections = (pairs: [number, number][]): string =>
  pairs.map(([a, b]) => `${a + 1}-${b + 1}`).join(",");

// Deterministic LCG so multi-start probes are stable across re-evaluations.
const makeRng = (seed: number) => {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

export const computeBspCellsAdvanced = (
  polygon: Point[],
  opts: AdvancedBspOptions,
): AdvancedBspResult => {
  const n = opts.weights.length;
  if (polygon.length < 3 || n < 1) return { cells: [], satisfied: [], broken: [] };

  const tiltAngleDeg = opts.tiltAngleDeg ?? 0;
  const maxDepth = opts.maxDepth ?? 24;
  const maxRatio = Math.max(0, opts.maxRatio ?? 0);
  const connections = (opts.connections ?? []).filter(([a, b]) => a >= 0 && b >= 0 && a < n && b < n && a !== b);
  // Adjacency steering needs the slicing recursion, so connections force strip mode.
  const layout: "strip" | "squarify" = connections.length > 0 ? "strip" : (opts.layout ?? "strip");
  const w = (i: number) => Math.max(0.01, opts.weights[i] ?? 1);

  // ── Rotated frame (tilt) ──────────────────────────────────────────────────
  const cxR = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cyR = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  const tiltRad = (tiltAngleDeg * Math.PI) / 180;
  const cosT = Math.cos(tiltRad), sinT = Math.sin(tiltRad);
  const rot = (p: { x: number; y: number }) => ({ x: (p.x - cxR) * cosT + (p.y - cyR) * sinT, y: -(p.x - cxR) * sinT + (p.y - cyR) * cosT });
  const unrot = (p: { x: number; y: number }): Point => ({ x: p.x * cosT - p.y * sinT + cxR, y: p.x * sinT + p.y * cosT + cyR });
  const rotPolygon = polygon.map(rot);
  const xs = rotPolygon.map((p) => p.x), ys = rotPolygon.map((p) => p.y);
  const rootBox: Box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };

  // ── Clipped-area machinery ────────────────────────────────────────────────
  const boxRect = (b: Box): Point[] => [
    { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 },
  ];
  const clipArea = (b: Box): number => {
    if (b.x1 - b.x0 < 1e-9 || b.y1 - b.y0 < 1e-9) return 0;
    const c = sutherlandHodgmanClip(rotPolygon, boxRect(b));
    return c.length >= 3 ? polyArea(c) : 0;
  };

  /** Cut position along `axis` so the left/top part holds `target` clipped area (bisection). */
  const solveCutAbs = (box: Box, axis: "x" | "y", target: number): number => {
    let lo = axis === "x" ? box.x0 : box.y0;
    let hi = axis === "x" ? box.x1 : box.y1;
    const span = hi - lo;
    // Degenerate region (outside the polygon): fall back to a linear position.
    const total = clipArea(box);
    if (total < 1e-9) return lo + span * 0.5;
    const t = Math.max(0, Math.min(total, target));
    for (let it = 0; it < 28; it++) {
      const mid = (lo + hi) / 2;
      const left: Box = axis === "x" ? { ...box, x1: mid } : { ...box, y1: mid };
      if (clipArea(left) < t) lo = mid;
      else hi = mid;
    }
    // Keep a sliver of room on both sides so no cell collapses entirely.
    const pos = (lo + hi) / 2;
    const min = (axis === "x" ? box.x0 : box.y0) + span * 0.005;
    const max = (axis === "x" ? box.x1 : box.y1) - span * 0.005;
    return Math.max(min, Math.min(max, pos));
  };

  const solveCutFrac = (box: Box, axis: "x" | "y", frac: number): number =>
    solveCutAbs(box, axis, Math.max(0.02, Math.min(0.98, frac)) * clipArea(box));

  // ── Strip (slicing) recursion ─────────────────────────────────────────────
  const adjMat: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const [a, b] of connections) { adjMat[a][b] = true; adjMat[b][a] = true; }

  const cutsBetween = (L: number[], R: number[]): number => {
    let c = 0;
    for (const a of L) for (const b of R) if (adjMat[a][b]) c++;
    return c;
  };

  /** Ordered prefix split balancing weights (the classic weighted-BSP bipartition). */
  const prefixBipartition = (ids: number[]): { L: number[]; R: number[] } => {
    const total = ids.reduce((s, i) => s + w(i), 0);
    let splitIdx = 1, bestDiff = Infinity, running = 0;
    for (let k = 1; k < ids.length; k++) {
      running += w(ids[k - 1]);
      const diff = Math.abs(running - (total - running));
      if (diff < bestDiff) { bestDiff = diff; splitIdx = k; }
    }
    return { L: ids.slice(0, splitIdx), R: ids.slice(splitIdx) };
  };

  /** Min-cut bipartition (exact ≤ 12 ids, RFP-style); ties break on weight balance. */
  const bestBipartition = (ids: number[]): { L: number[]; R: number[] } => {
    if (connections.length === 0) return prefixBipartition(ids);
    const k = ids.length;
    if (k === 2) return { L: [ids[0]], R: [ids[1]] };
    if (k <= 12) {
      const totalW = ids.reduce((s, i) => s + w(i), 0) || 1;
      let best: { L: number[]; R: number[]; score: number } | null = null;
      const maskMax = 1 << k;
      for (let mask = 1; mask < (maskMax >> 1); mask++) {
        const L: number[] = [], R: number[] = [];
        for (let bit = 0; bit < k; bit++) {
          if (mask & (1 << bit)) L.push(ids[bit]); else R.push(ids[bit]);
        }
        const cuts = cutsBetween(L, R);
        const wL = L.reduce((s, i) => s + w(i), 0);
        const score = cuts * 1000 + Math.abs(wL / totalW - 0.5);
        if (!best || score < best.score) best = { L, R, score };
      }
      return best ? { L: best.L, R: best.R } : prefixBipartition(ids);
    }
    return prefixBipartition(ids);
  };

  /** Predicted worst final-cell aspect if this child box's seeds keep splitting along its longer side. */
  const childAspectEstimate = (bw: number, bh: number, m: number): number => {
    let cw = bw, ch = bh;
    if (cw >= ch) cw /= Math.max(1, m); else ch /= Math.max(1, m);
    return Math.max(cw, ch) / Math.max(1e-9, Math.min(cw, ch));
  };

  const chooseAxis = (box: Box, frac: number, mL: number, mR: number): "x" | "y" => {
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    if (maxRatio <= 0) return bw >= bh ? "x" : "y";
    const estX = Math.max(childAspectEstimate(bw * frac, bh, mL), childAspectEstimate(bw * (1 - frac), bh, mR));
    const estY = Math.max(childAspectEstimate(bw, bh * frac, mL), childAspectEstimate(bw, bh * (1 - frac), mR));
    // Both within target → prefer the longer side (classic); otherwise pick the squarer prediction.
    if (estX <= maxRatio && estY <= maxRatio) return bw >= bh ? "x" : "y";
    return estX <= estY ? "x" : "y";
  };

  const runStrip = (order: number[]): (Box | null)[] => {
    const cellBox: (Box | null)[] = new Array(n).fill(null);
    const recurse = (ids: number[], box: Box, depth: number): void => {
      if (ids.length === 1) { cellBox[ids[0]] = box; return; }
      if (ids.length < 1) return;
      if (depth > maxDepth) { for (const id of ids) if (!cellBox[id]) cellBox[id] = box; return; }
      const { L, R } = bestBipartition(ids);
      if (!L.length || !R.length) { for (const id of ids) if (!cellBox[id]) cellBox[id] = box; return; }
      const wL = L.reduce((s, i) => s + w(i), 0);
      const wR = R.reduce((s, i) => s + w(i), 0);
      const frac = wL / (wL + wR || 1);
      const axis = chooseAxis(box, frac, L.length, R.length);
      const pos = solveCutFrac(box, axis, frac);
      if (axis === "x") {
        recurse(L, { ...box, x1: pos }, depth + 1);
        recurse(R, { ...box, x0: pos }, depth + 1);
      } else {
        recurse(L, { ...box, y1: pos }, depth + 1);
        recurse(R, { ...box, y0: pos }, depth + 1);
      }
    };
    recurse(order, rootBox, 0);
    return cellBox;
  };

  // ── Squarified treemap layout ─────────────────────────────────────────────
  const runSquarify = (): (Box | null)[] => {
    const cellBox: (Box | null)[] = new Array(n).fill(null);
    const rootArea = clipArea(rootBox);
    const totalW = opts.weights.reduce((s, _, i) => s + w(i), 0) || 1;
    // Largest-first ordering is what keeps squarify's rows square.
    let list = opts.weights
      .map((_, i) => ({ id: i, area: (w(i) / totalW) * rootArea }))
      .sort((a, b) => b.area - a.area);
    let rem: Box = { ...rootBox };

    /** Worst aspect ratio of a row of `areas` laid along a side of length L (rect math). */
    const worst = (areas: number[], L: number): number => {
      const S = areas.reduce((s, a) => s + a, 0);
      const t = S / Math.max(1e-9, L); // row thickness
      let m = 1;
      for (const a of areas) {
        const cellLen = a / Math.max(1e-9, t);
        m = Math.max(m, Math.max(t / Math.max(1e-9, cellLen), cellLen / Math.max(1e-9, t)));
      }
      return m;
    };

    while (list.length > 0) {
      const bw = rem.x1 - rem.x0, bh = rem.y1 - rem.y0;
      const vertical = bw >= bh; // strip consumes width; row laid along the (shorter) height
      const L = vertical ? bh : bw;
      // Greedy row: keep adding while the worst aspect ratio doesn't degrade.
      const row = [list[0]];
      let cur = worst([list[0].area], L);
      let i = 1;
      while (i < list.length) {
        const cand = worst([...row.map((r) => r.area), list[i].area], L);
        if (cand <= cur) { row.push(list[i]); cur = cand; i++; }
        else break;
      }
      list = list.slice(row.length);
      const S = row.reduce((s, r) => s + r.area, 0);
      // Strip thickness via clipped-area bisection; the final row takes the remainder box exactly.
      let strip: Box;
      if (list.length === 0) {
        strip = { ...rem };
      } else if (vertical) {
        const pos = solveCutAbs(rem, "x", S);
        strip = { ...rem, x1: pos };
        rem = { ...rem, x0: pos };
      } else {
        const pos = solveCutAbs(rem, "y", S);
        strip = { ...rem, y1: pos };
        rem = { ...rem, y0: pos };
      }
      // Within the strip, sequential clipped-area cuts give each row member its share.
      let stripRem: Box = { ...strip };
      for (let j = 0; j < row.length; j++) {
        if (j === row.length - 1) { cellBox[row[j].id] = stripRem; break; }
        const axis: "x" | "y" = vertical ? "y" : "x";
        const pos = solveCutAbs(stripRem, axis, row[j].area);
        cellBox[row[j].id] = axis === "y" ? { ...stripRem, y1: pos } : { ...stripRem, x1: pos };
        stripRem = axis === "y" ? { ...stripRem, y0: pos } : { ...stripRem, x0: pos };
      }
    }
    return cellBox;
  };

  // ── Adjacency: rect touch test + relabelling + deterministic multi-start ──
  const eps = Math.max(rootBox.x1 - rootBox.x0, rootBox.y1 - rootBox.y0) * 1e-6 + 1e-9;
  const touch = (a: Box, b: Box): boolean => {
    const horiz = (Math.abs(a.x1 - b.x0) < eps || Math.abs(b.x1 - a.x0) < eps) &&
      Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > eps;
    const vert = (Math.abs(a.y1 - b.y0) < eps || Math.abs(b.y1 - a.y0) < eps) &&
      Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > eps;
    return horiz || vert;
  };

  const countSat = (boxes: (Box | null)[]): number => {
    let c = 0;
    for (const [a, b] of connections) {
      const A = boxes[a], B = boxes[b];
      if (A && B && touch(A, B)) c++;
    }
    return c;
  };

  /** Greedy pairwise swap of cells between EQUAL-WEIGHT seeds to satisfy more connections.
   *  (Swapping unequal weights would break the weighted-area contract, so those stay put.) */
  const relabel = (boxes: (Box | null)[]): (Box | null)[] => {
    if (connections.length === 0) return boxes;
    const out = boxes.slice();
    let best = countSat(out);
    let guard = n * n * 4;
    while (guard-- > 0) {
      let bi = -1, bj = -1, bestDelta = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(w(i) - w(j)) > 1e-9 || !out[i] || !out[j]) continue;
          [out[i], out[j]] = [out[j], out[i]];
          const delta = countSat(out) - best;
          [out[i], out[j]] = [out[j], out[i]];
          if (delta > bestDelta) { bestDelta = delta; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;
      [out[bi], out[bj]] = [out[bj], out[bi]];
      best += bestDelta;
    }
    return out;
  };

  let cellBox: (Box | null)[];
  if (layout === "squarify") {
    cellBox = runSquarify();
  } else {
    const baseOrder = opts.weights.map((_, i) => i);
    cellBox = relabel(runStrip(baseOrder));
    // Multi-start: probe shuffled seed orders (deterministic RNG) when connections stay broken —
    // different orderings explore different slicing topologies, like the editor's multi-start.
    if (connections.length > 0 && countSat(cellBox) < connections.length && n >= 3) {
      const rng = makeRng(n * 2654435761 + connections.length * 97);
      let bestSat = countSat(cellBox);
      for (let probe = 0; probe < 8 && bestSat < connections.length; probe++) {
        const order = opts.weights.map((_, i) => i);
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        const cand = relabel(runStrip(order));
        const sat = countSat(cand);
        if (sat > bestSat) { bestSat = sat; cellBox = cand; }
      }
    }
  }

  // ── Clip leaf boxes back to the boundary & report adjacency results ───────
  const cells: Point[][] = [];
  for (let i = 0; i < n; i++) {
    const box = cellBox[i];
    if (!box) { cells.push([]); continue; }
    const clipped = sutherlandHodgmanClip(rotPolygon, boxRect(box));
    cells.push(clipped.length >= 3 ? clipped.map(unrot) : []);
  }
  const satisfied: [number, number][] = [];
  const broken: [number, number][] = [];
  for (const [a, b] of connections) {
    const A = cellBox[a], B = cellBox[b];
    if (A && B && cells[a].length >= 3 && cells[b].length >= 3 && touch(A, B)) satisfied.push([a, b]);
    else broken.push([a, b]);
  }
  return { cells, satisfied, broken };
};
