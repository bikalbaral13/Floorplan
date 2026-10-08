// Plane-frame direct stiffness solver (3 DOF / node: ux, uz, θ).
// Units: kN, m. Member loads are uniform, gravity-direction (global −z).
// Sign convention for results: axial N tension +, internal moment sagging +
// (for columns: + = tension on the local "−y" face, consistent along a frame).

export interface FNode {
  x: number;
  z: number;
  fixed?: boolean;
}

export interface FMember {
  i: number;
  j: number;
  E: number; // kN/m²
  A: number; // m²
  I: number; // m⁴
}

export interface FLoadCase {
  /** Uniform gravity load per member (kN/m, downward), indexed by member. */
  udl: number[];
  /** Nodal loads [Fx, Fz, M] indexed by node. */
  nodal: [number, number, number][];
}

export interface MemberResult {
  N: number; // axial, tension +
  V1: number; // shear at i (local y)
  M1: number; // internal moment at i (sagging +)
  M2: number; // internal moment at j
  Mmid: number; // max sagging along span (beams) or mid value
  Mx: (x: number) => number;
  Vx: (x: number) => number;
  L: number;
  w: number;
}

export interface FrameResult {
  u: number[]; // global DOF vector
  members: MemberResult[];
  reactions: [number, number, number][]; // per node (0 when free)
}

function geom(n1: FNode, n2: FNode) {
  const dx = n2.x - n1.x;
  const dz = n2.z - n1.z;
  const L = Math.hypot(dx, dz);
  return { L, c: dx / L, s: dz / L };
}

/** Local 6×6 stiffness. */
function kLocal(m: FMember, L: number): number[][] {
  const { E, A, I } = m;
  const a = (E * A) / L;
  const b = (12 * E * I) / L ** 3;
  const c = (6 * E * I) / L ** 2;
  const d = (4 * E * I) / L;
  const e = (2 * E * I) / L;
  return [
    [a, 0, 0, -a, 0, 0],
    [0, b, c, 0, -b, c],
    [0, c, d, 0, -c, e],
    [-a, 0, 0, a, 0, 0],
    [0, -b, -c, 0, b, -c],
    [0, c, e, 0, -c, d],
  ];
}

function tMatrix(c: number, s: number): number[][] {
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

const mul = (A: number[][], B: number[][]) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const tr = (A: number[][]) => A[0].map((_, j) => A.map((r) => r[j]));
const mv = (A: number[][], v: number[]) => A.map((r) => r.reduce((s, x, k) => s + x * v[k], 0));

/** Gaussian elimination with partial pivoting. */
function solve(K: number[][], F: number[]): number[] {
  const n = F.length;
  const A = K.map((r, i) => [...r, F[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const piv = A[c][c];
    if (Math.abs(piv) < 1e-12) throw new Error("Frame is unstable (singular stiffness matrix)");
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / piv;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

export function solveFrame(nodes: FNode[], members: FMember[], lc: FLoadCase): FrameResult {
  const nd = nodes.length * 3;
  const K = Array.from({ length: nd }, () => new Array(nd).fill(0));
  const F = new Array(nd).fill(0);
  const cache = members.map((m) => {
    const g = geom(nodes[m.i], nodes[m.j]);
    const T = tMatrix(g.c, g.s);
    const kl = kLocal(m, g.L);
    const kg = mul(mul(tr(T), kl), T);
    const dofs = [3 * m.i, 3 * m.i + 1, 3 * m.i + 2, 3 * m.j, 3 * m.j + 1, 3 * m.j + 2];
    return { g, T, kl, kg, dofs };
  });

  members.forEach((_, k) => {
    const { kg, dofs, g, T } = cache[k];
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) K[dofs[a]][dofs[b]] += kg[a][b];
    const w = lc.udl[k] ?? 0;
    if (w) {
      // Gravity load (global −z) resolved into local components.
      const wy = -w * g.c; // local y component per unit length
      const wx = -w * g.s;
      const L = g.L;
      const fefLocal = [(wx * L) / 2, (wy * L) / 2, (wy * L * L) / 12, (wx * L) / 2, (wy * L) / 2, (-wy * L * L) / 12];
      const fefGlobal = mv(tr(T), fefLocal);
      for (let a = 0; a < 6; a++) F[dofs[a]] += fefGlobal[a];
    }
  });
  lc.nodal.forEach((p, n) => {
    if (!p) return;
    F[3 * n] += p[0];
    F[3 * n + 1] += p[1];
    F[3 * n + 2] += p[2];
  });

  const free: number[] = [];
  nodes.forEach((n, i) => {
    if (!n.fixed) free.push(3 * i, 3 * i + 1, 3 * i + 2);
  });
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const uf = solve(Kff, free.map((r) => F[r]));
  const u = new Array(nd).fill(0);
  free.forEach((d, k) => (u[d] = uf[k]));

  const reactions: [number, number, number][] = nodes.map(() => [0, 0, 0]);
  const results: MemberResult[] = members.map((m, k) => {
    const { g, T, kl, dofs } = cache[k];
    const w = lc.udl[k] ?? 0;
    const wy = -w * g.c;
    const wx = -w * g.s;
    const L = g.L;
    const ul = mv(T, dofs.map((d) => u[d]));
    const fef = [(wx * L) / 2, (wy * L) / 2, (wy * L * L) / 12, (wx * L) / 2, (wy * L) / 2, (-wy * L * L) / 12];
    const f = mv(kl, ul).map((v, a) => v - fef[a]); // end actions on member
    const [N1, V1, M1] = f;
    const q = -wy; // load intensity acting in local −y
    const Mx = (x: number) => V1 * x - M1 - (q * x * x) / 2;
    const Vx = (x: number) => V1 - q * x;
    let Mmid = Mx(L / 2);
    for (let s = 0; s <= 20; s++) Mmid = Math.max(Mmid, Mx((L * s) / 20));
    if (nodes[m.i].fixed) {
      const fg = mv(tr(T), f.slice(0, 3).concat([0, 0, 0]));
      reactions[m.i] = [reactions[m.i][0] + fg[0], reactions[m.i][1] + fg[1], reactions[m.i][2] + fg[2]];
    }
    return { N: -N1, V1, M1: -M1, M2: Mx(L), Mmid, Mx, Vx, L, w };
  });
  return { u, members: results, reactions };
}
