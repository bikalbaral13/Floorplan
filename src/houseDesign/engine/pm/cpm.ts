// Critical Path Method on an activity-on-node network with FS / SS / FF / SF
// relationships and lags (precedence diagramming method), plus PERT and a
// Monte Carlo schedule-risk analysis. Times are working days from day 0.
//
// Forward pass  (ES_j ≥ …)          Backward pass  (LF_i ≤ …)
//   FS  ES_j ≥ EF_i + lag             LF_i ≤ LS_j − lag
//   SS  ES_j ≥ ES_i + lag             LF_i ≤ LS_j − lag + d_i
//   FF  ES_j ≥ EF_i + lag − d_j       LF_i ≤ LF_j − lag
//   SF  ES_j ≥ ES_i + lag − d_j       LF_i ≤ LF_j − lag + d_i

import type { Activity, Link, PmInputs } from "./inputs";

export interface Net {
  acts: Activity[];
  idx: Map<string, number>;
  order: number[]; // topological order
  succs: { j: number; link: Link }[][]; // successors of i with the link on j
}

export function buildNet(acts: Activity[]): Net {
  const idx = new Map(acts.map((a, i) => [a.id, i]));
  if (idx.size !== acts.length) {
    const seen = new Set<string>();
    for (const a of acts) {
      if (seen.has(a.id)) throw new Error(`Duplicate activity id ${a.id}.`);
      seen.add(a.id);
    }
  }
  const succs: { j: number; link: Link }[][] = acts.map(() => []);
  const indeg = acts.map(() => 0);
  acts.forEach((a, j) =>
    a.preds.forEach((l) => {
      const i = idx.get(l.pred);
      if (i == null) throw new Error(`Activity ${a.id} has unknown predecessor ${l.pred}.`);
      if (i === j) throw new Error(`Activity ${a.id} cannot precede itself.`);
      succs[i].push({ j, link: l });
      indeg[j]++;
    }),
  );
  const order: number[] = [];
  const q = acts.map((_, i) => i).filter((i) => indeg[i] === 0);
  while (q.length) {
    const i = q.shift()!;
    order.push(i);
    for (const s of succs[i]) if (--indeg[s.j] === 0) q.push(s.j);
  }
  if (order.length !== acts.length) throw new Error("The logic has a loop — check the predecessors.");
  return { acts, idx, order, succs };
}

/** Earliest start of j allowed by one link, given the predecessor's start si and durations. */
export function linkStart(type: Link["type"], lag: number, si: number, di: number, dj: number): number {
  switch (type) {
    case "FS": return si + di + lag;
    case "SS": return si + lag;
    case "FF": return si + di + lag - dj;
    case "SF": return si + lag - dj;
  }
}

export function forward(net: Net, d: number[]): number[] {
  const ES = d.map(() => 0);
  for (const j of net.order) {
    let es = 0;
    for (const l of net.acts[j].preds) {
      const i = net.idx.get(l.pred)!;
      es = Math.max(es, linkStart(l.type, l.lag, ES[i], d[i], d[j]));
    }
    ES[j] = es;
  }
  return ES;
}

export function backward(net: Net, d: number[], T: number): number[] {
  const LF = d.map(() => T);
  for (const i of [...net.order].reverse()) {
    let lf = T;
    for (const { j, link } of net.succs[i]) {
      const LSj = LF[j] - d[j];
      const b = link.type === "FS" ? LSj - link.lag : link.type === "SS" ? LSj - link.lag + d[i] : link.type === "FF" ? LF[j] - link.lag : LF[j] - link.lag + d[i];
      lf = Math.min(lf, b);
    }
    LF[i] = lf;
  }
  return LF;
}

export interface CpmRow {
  a: Activity;
  d: number;
  ES: number;
  EF: number;
  LS: number;
  LF: number;
  TF: number;
  FF: number; // free float
  IF: number; // independent float
  INTF: number; // interfering float = TF − FF
  critical: boolean;
}

export interface Cpm {
  rows: CpmRow[];
  T: number;
  paths: string[][]; // critical paths (activity ids)
  driving: [string, string][]; // critical driving links
}

export function cpm(net: Net, d: number[]): Cpm {
  const ES = forward(net, d);
  const T = Math.max(0, ...ES.map((s, i) => s + d[i]));
  const LF = backward(net, d, T);
  // start of j allowed by pred i, evaluated with i at its late times
  const rows: CpmRow[] = net.acts.map((a, i) => {
    const EF = ES[i] + d[i], LS = LF[i] - d[i], TF = LS - ES[i];
    let FF = T - EF;
    for (const { j, link } of net.succs[i]) FF = Math.min(FF, ES[j] - linkStart(link.type, link.lag, ES[i], d[i], d[j]));
    // independent float: free float left when all predecessors finish as late as possible
    let esLate = 0;
    for (const l of a.preds) {
      const p = net.idx.get(l.pred)!;
      esLate = Math.max(esLate, linkStart(l.type, l.lag, LF[p] - d[p], d[p], d[i]));
    }
    const IF = Math.max(0, FF - Math.max(0, esLate - ES[i]));
    return { a, d: d[i], ES: ES[i], EF, LS, LF: LF[i], TF, FF, IF, INTF: TF - FF, critical: TF <= 1e-9 };
  });
  // driving critical links (zero slack between two critical activities)
  const driving: [string, string][] = [];
  const next: number[][] = net.acts.map(() => []);
  net.acts.forEach((_, i) => {
    if (!rows[i].critical) return;
    for (const { j, link } of net.succs[i]) {
      if (rows[j].critical && Math.abs(ES[j] - linkStart(link.type, link.lag, ES[i], d[i], d[j])) < 1e-9) {
        driving.push([net.acts[i].id, net.acts[j].id]);
        next[i].push(j);
      }
    }
  });
  const hasDrivingPred = new Set(driving.map(([, b]) => b));
  const paths: string[][] = [];
  const dfs = (i: number, path: string[]) => {
    if (paths.length >= 20) return;
    const p = [...path, net.acts[i].id];
    if (!next[i].length) {
      if (Math.abs(rows[i].EF - T) < 1e-9 || !net.succs[i].length) paths.push(p);
      return;
    }
    for (const j of next[i]) dfs(j, p);
  };
  rows.forEach((r, i) => { if (r.critical && r.ES === 0 && !hasDrivingPred.has(r.a.id)) dfs(i, []); });
  return { rows, T, paths, driving };
}

// ---------------------------------------------------------------------------
// PERT
// ---------------------------------------------------------------------------

export function normCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function normInv(p: number): number {
  let lo = -8, hi = 8;
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if (normCdf(m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

export interface PertRow { id: string; a: number; m: number; b: number; te: number; sd: number; v: number }
export interface Pert {
  rows: PertRow[];
  cpm: Cpm; // schedule on expected durations
  path: string[]; // critical path used for σ
  Te: number;
  sd: number;
  target: number;
  pTarget: number;
  table: { T: number; z: number; p: number }[];
  forP: { p: number; T: number }[];
}

export function pert(inp: PmInputs, net: Net): Pert {
  const rows = inp.activities.map((a) => {
    const te = (a.opt + 4 * a.dur + a.pess) / 6, sd = (a.pess - a.opt) / 6;
    return { id: a.id, a: a.opt, m: a.dur, b: a.pess, te, sd, v: sd * sd };
  });
  const c = cpm(net, rows.map((r) => r.te));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const variance = (p: string[]) => p.reduce((s, id) => s + byId.get(id)!.v, 0);
  const path = c.paths.reduce((a, b) => (variance(b) > variance(a) ? b : a), c.paths[0] ?? []);
  const sd = Math.sqrt(variance(path));
  const target = inp.settings.targetDays;
  const z = (T: number) => (sd > 0 ? (T - c.T) / sd : T >= c.T ? 99 : -99);
  const table = [-3, -2, -1, -0.5, 0, 0.5, 1, 1.645, 2, 3].map((k) => {
    const T = c.T + k * sd;
    return { T, z: k, p: normCdf(k) };
  });
  return {
    rows, cpm: c, path, Te: c.T, sd, target, pTarget: normCdf(z(target)), table,
    forP: [0.5, 0.8, 0.9, 0.95].map((p) => ({ p, T: c.T + normInv(p) * sd })),
  };
}

// ---------------------------------------------------------------------------
// Monte Carlo (beta-PERT durations)
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gamma(rnd: () => number, k: number): number {
  // Marsaglia & Tsang
  if (k < 1) return gamma(rnd, k + 1) * Math.pow(rnd(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = rnd() || 1e-12, u2 = rnd();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rnd();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaPert(rnd: () => number, a: number, m: number, b: number): number {
  if (b <= a) return m;
  const al = 1 + (4 * (m - a)) / (b - a), be = 1 + (4 * (b - m)) / (b - a);
  const x = gamma(rnd, al), y = gamma(rnd, be);
  return a + ((b - a) * x) / (x + y);
}

export interface MonteCarlo {
  runs: number;
  finishes: number[]; // sorted
  mean: number;
  sd: number;
  pct: { p: number; T: number }[];
  pTarget: number;
  critIndex: { id: string; ci: number }[];
  hist: { x0: number; x1: number; n: number }[];
}

export function monteCarlo(inp: PmInputs, net: Net): MonteCarlo {
  const N = Math.max(100, Math.min(20000, Math.round(inp.settings.runs)));
  const rnd = mulberry32(inp.settings.seed);
  const acts = inp.activities;
  const fin: number[] = [];
  const crit = acts.map(() => 0);
  for (let k = 0; k < N; k++) {
    const d = acts.map((a) => betaPert(rnd, a.opt, a.dur, a.pess));
    const ES = forward(net, d);
    const T = Math.max(...ES.map((s, i) => s + d[i]));
    const LF = backward(net, d, T);
    ES.forEach((s, i) => { if (LF[i] - d[i] - s < 1e-6) crit[i]++; });
    fin.push(T);
  }
  fin.sort((a, b) => a - b);
  const mean = fin.reduce((s, x) => s + x, 0) / N;
  const sd = Math.sqrt(fin.reduce((s, x) => s + (x - mean) ** 2, 0) / (N - 1));
  const q = (p: number) => fin[Math.min(N - 1, Math.max(0, Math.round(p * (N - 1))))];
  const lo = fin[0], hi = fin[N - 1], nb = 24, w = (hi - lo) / nb || 1;
  const hist = Array.from({ length: nb }, (_, b) => ({ x0: lo + b * w, x1: lo + (b + 1) * w, n: 0 }));
  for (const x of fin) hist[Math.min(nb - 1, Math.floor((x - lo) / w))].n++;
  return {
    runs: N, finishes: fin, mean, sd,
    pct: [0.1, 0.5, 0.8, 0.9, 0.95].map((p) => ({ p, T: q(p) })),
    pTarget: fin.filter((x) => x <= inp.settings.targetDays).length / N,
    critIndex: acts.map((a, i) => ({ id: a.id, ci: crit[i] / N })),
    hist,
  };
}

// ---------------------------------------------------------------------------
// Working-day calendar
// ---------------------------------------------------------------------------

export function isWork(date: Date, perWeek: number): boolean {
  const wd = date.getUTCDay(); // 0 Sun … 6 Sat
  if (perWeek >= 7) return true;
  if (perWeek === 6) return wd !== 6; // Saturday off (Nepal)
  return wd !== 6 && wd !== 0;
}

/** Calendar date of working day k (0 = first working day on/after the start). */
export function makeCalendar(start: string, perWeek: number, horizon: number): (k: number) => Date {
  const s = new Date(`${start}T00:00:00Z`);
  const days: Date[] = [];
  const d = new Date(s);
  while (days.length < horizon + 2) {
    if (isWork(d, perWeek)) days.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return (k: number) => {
    const i = Math.max(0, Math.floor(k));
    return days[Math.min(i, days.length - 1)];
  };
}

export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
