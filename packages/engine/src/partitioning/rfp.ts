/**
 * Rectangular Floor Plan (RFP) partitioning — slicing-tree variant guided by an adjacency matrix.
 *
 * Differs from plain BSP in that, at every recursive split, the seed set is bipartitioned to
 * MINIMISE the number of required adjacency edges that get cut. The rectangle is then split
 * proportionally to each side's total seed weight along the longer axis. Result: pairs of seeds
 * that share a "must be adjacent" edge end up in the same sub-rectangle as long as possible, so
 * they're far more likely to share a wall in the final layout.
 *
 * For seed counts <= 12 we enumerate every non-trivial bipartition (2^(n-1)-1 of them) and pick
 * the one with the fewest cut edges; ties break on weight balance. For larger sets we fall back
 * to a coordinate-median split, mirroring BSP — RFP degrades gracefully when the matrix is
 * impractical to brute-force.
 */

export type RfpSeed = {
  id: string;
  x: number;
  y: number;
  weight: number;
  label?: string;
  minArea?: number | null;
  maxArea?: number | null;
  maxRatio?: number | null;
};

export type RfpConnection = { aSeedId: string; bSeedId: string };

export type RfpLeaf = {
  seedId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type RfpCut = {
  axis: "x" | "y";
  pos: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type RfpResult = {
  leaves: RfpLeaf[];
  cuts: RfpCut[];
  satisfied: RfpConnection[];
  broken: RfpConnection[];
};

export function runRfp(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  seeds: RfpSeed[],
  connections: RfpConnection[],
): RfpResult {
  const n = seeds.length;
  const seedIdx = new Map<string, number>();
  seeds.forEach((s, i) => seedIdx.set(s.id, i));

  const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  for (const c of connections) {
    const a = seedIdx.get(c.aSeedId);
    const b = seedIdx.get(c.bSeedId);
    if (a == null || b == null || a === b) continue;
    adj[a][b] = true;
    adj[b][a] = true;
  }

  const w = (i: number): number => Math.max(0.01, seeds[i].weight ?? 1);

  const cutsBetween = (L: number[], R: number[]): number => {
    let count = 0;
    for (const a of L) for (const b of R) if (adj[a][b]) count++;
    return count;
  };

  const bestBipartition = (ids: number[]): { L: number[]; R: number[] } => {
    const k = ids.length;
    if (k === 2) return { L: [ids[0]], R: [ids[1]] };
    const totalW = ids.reduce((s, i) => s + w(i), 0) || 1;
    if (k <= 12) {
      let best: { L: number[]; R: number[]; score: number } | null = null;
      const maskMax = 1 << k;
      // Iterate masks 1..maskMax-2 ; skip empty & full sets. Also exploit complement symmetry.
      for (let mask = 1; mask < (maskMax >> 1); mask++) {
        const L: number[] = [];
        const R: number[] = [];
        for (let bit = 0; bit < k; bit++) {
          if (mask & (1 << bit)) L.push(ids[bit]); else R.push(ids[bit]);
        }
        const cuts = cutsBetween(L, R);
        const wL = L.reduce((s, i) => s + w(i), 0);
        const imbalance = Math.abs(wL / totalW - 0.5);
        const score = cuts * 1000 + imbalance;
        if (!best || score < best.score) best = { L, R, score };
      }
      return best ? { L: best.L, R: best.R } : { L: [ids[0]], R: ids.slice(1) };
    }
    // Fallback: median split by x position (then y if degenerate).
    const sortedX = [...ids].sort((a, b) => seeds[a].x - seeds[b].x);
    const mid = Math.floor(sortedX.length / 2);
    return { L: sortedX.slice(0, mid), R: sortedX.slice(mid) };
  };

  const leaves: RfpLeaf[] = [];
  const cuts: RfpCut[] = [];

  const recurse = (
    ids: number[],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    depth: number,
  ): void => {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      leaves.push({ seedId: seeds[ids[0]].id, x0, y0, x1, y1 });
      return;
    }
    if (depth > 24) return;
    const { L, R } = bestBipartition(ids);
    if (L.length === 0 || R.length === 0) {
      const mid = Math.floor(ids.length / 2);
      const Lf = ids.slice(0, mid);
      const Rf = ids.slice(mid);
      const wL = Lf.reduce((s, i) => s + w(i), 0);
      const wR = Rf.reduce((s, i) => s + w(i), 0);
      const frac = wL / (wL + wR);
      const ww = x1 - x0;
      const hh = y1 - y0;
      const axis: "x" | "y" = ww >= hh ? "x" : "y";
      if (axis === "x") {
        const pos = x0 + frac * ww;
        cuts.push({ axis, pos, x0, y0, x1, y1 });
        recurse(Lf, x0, y0, pos, y1, depth + 1);
        recurse(Rf, pos, y0, x1, y1, depth + 1);
      } else {
        const pos = y0 + frac * hh;
        cuts.push({ axis, pos, x0, y0, x1, y1 });
        recurse(Lf, x0, y0, x1, pos, depth + 1);
        recurse(Rf, x0, pos, x1, y1, depth + 1);
      }
      return;
    }
    const wL = L.reduce((s, i) => s + w(i), 0);
    const wR = R.reduce((s, i) => s + w(i), 0);
    const frac = wL / (wL + wR || 1);
    const ww = x1 - x0;
    const hh = y1 - y0;
    const axis: "x" | "y" = ww >= hh ? "x" : "y";
    if (axis === "x") {
      const pos = x0 + frac * ww;
      cuts.push({ axis, pos, x0, y0, x1, y1 });
      recurse(L, x0, y0, pos, y1, depth + 1);
      recurse(R, pos, y0, x1, y1, depth + 1);
    } else {
      const pos = y0 + frac * hh;
      cuts.push({ axis, pos, x0, y0, x1, y1 });
      recurse(L, x0, y0, x1, pos, depth + 1);
      recurse(R, x0, pos, x1, y1, depth + 1);
    }
  };

  recurse(
    seeds.map((_, i) => i),
    bbox.x0,
    bbox.y0,
    bbox.x1,
    bbox.y1,
    0,
  );

  // Adjacency check: two leaves "touch" if they share a non-degenerate side.
  const leafBySeed = new Map<string, RfpLeaf>();
  for (const l of leaves) leafBySeed.set(l.seedId, l);
  const touch = (a: RfpLeaf, b: RfpLeaf): boolean => {
    const horiz =
      (Math.abs(a.x1 - b.x0) < 1e-3 || Math.abs(b.x1 - a.x0) < 1e-3) &&
      Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-3;
    const vert =
      (Math.abs(a.y1 - b.y0) < 1e-3 || Math.abs(b.y1 - a.y0) < 1e-3) &&
      Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-3;
    return horiz || vert;
  };
  const satisfied: RfpConnection[] = [];
  const broken: RfpConnection[] = [];
  for (const c of connections) {
    const A = leafBySeed.get(c.aSeedId);
    const B = leafBySeed.get(c.bSeedId);
    if (A && B && touch(A, B)) satisfied.push(c);
    else broken.push(c);
  }

  return { leaves, cuts, satisfied, broken };
}
