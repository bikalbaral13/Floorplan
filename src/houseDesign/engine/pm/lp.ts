// Linear programming with HiGHS (open-source LP/MIP solver, compiled to
// WebAssembly). Used for
//   1. Independent verification of the CPM dates: the earliest schedule is the
//      optimum of  min Σ S_i  subject to every relationship; the latest
//      schedule is  max Σ S_i  with every activity finishing by T.
//   2. Time-cost trade-off (crashing): for each target duration T,
//      min Σ c_i x_i  subject to the relationships with durations d_i − x_i,
//      0 ≤ x_i ≤ d_i − d_crash,i  and every finish ≤ T  (Fulkerson / Kelley).

import type { PmInputs } from "./inputs";
import type { Net } from "./cpm";

type Highs = { solve: (lp: string, opts?: Record<string, unknown>) => { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number }> } };
export type HighsLoader = () => Promise<Highs>;

const defaultLoader: HighsLoader = async () => {
  const [{ default: load }, { default: wasmUrl }] = await Promise.all([import("highs"), import("highs/runtime?url")]);
  return (load as unknown as (o: object) => Promise<Highs>)({ locateFile: () => wasmUrl });
};

// link (i → j):  S_j − S_i + a·x_i − b·x_j ≥ lag + a·d_i − b·d_j
//   a = 1 when the link starts from the predecessor's finish (FS, FF)
//   b = 1 when the link ends at the successor's finish (FF, SF)
function linkRows(net: Net, d: number[], crash: boolean): string[] {
  const rows: string[] = [];
  let k = 0;
  net.acts.forEach((act, j) => {
    for (const l of act.preds) {
      const i = net.idx.get(l.pred)!;
      const a = l.type === "FS" || l.type === "FF" ? 1 : 0;
      const b = l.type === "FF" || l.type === "SF" ? 1 : 0;
      const terms = [`s${j}`, `- s${i}`];
      if (crash && a) terms.push(`+ x${i}`);
      if (crash && b) terms.push(`- x${j}`);
      rows.push(` l${k++}: ${terms.join(" ")} >= ${l.lag + a * d[i] - b * d[j]}`);
    }
  });
  return rows;
}

function lpText(sense: "Minimize" | "Maximize", obj: string, rows: string[], bounds: string[]): string {
  // keep lines short: the LP file format limits line length
  const terms = (obj || "0 s0").split(" + ");
  const objLines: string[] = [];
  for (let k = 0; k < terms.length; k += 8) objLines.push(terms.slice(k, k + 8).join(" + "));
  return [sense, ` obj: ${objLines.join("\n + ")}`, "Subject To", ...rows, "Bounds", ...bounds, "End"].join("\n");
}

export interface LpCheck {
  ES: number[];
  LS: number[];
  T: number;
  status: [string, string];
}

export async function lpCpm(net: Net, d: number[], load: HighsLoader = defaultLoader): Promise<LpCheck> {
  const h = await load();
  const n = net.acts.length;
  const S = Array.from({ length: n }, (_, i) => `s${i}`);
  const rows = linkRows(net, d, false);
  const bounds = S.map((s) => ` ${s} >= 0`);
  const r1 = h.solve(lpText("Minimize", S.join(" + "), rows, bounds));
  const ES = S.map((s) => r1.Columns[s]?.Primal ?? 0);
  const T = Math.max(...ES.map((s, i) => s + d[i]));
  const fin = S.map((s, i) => ` f${i}: ${s} <= ${T - d[i]}`);
  const r2 = h.solve(lpText("Maximize", S.join(" + "), [...rows, ...fin], bounds));
  const LS = S.map((s) => r2.Columns[s]?.Primal ?? 0);
  return { ES, LS, T, status: [r1.Status, r2.Status] };
}

export interface CrashPoint {
  T: number;
  direct: number;
  indirect: number;
  total: number;
  crashed: { id: string; x: number }[];
  status: string;
}

export interface Crashing {
  normalT: number;
  crashT: number;
  slopes: { id: string; slope: number; maxX: number }[];
  curve: CrashPoint[];
  optimum: CrashPoint;
}

export async function lpCrash(inp: PmInputs, net: Net, normalT: number, crashT: number, load: HighsLoader = defaultLoader): Promise<Crashing> {
  const h = await load();
  const acts = inp.activities;
  const d = acts.map((a) => a.dur);
  const slopes = acts.map((a) => {
    const maxX = Math.max(0, a.dur - Math.min(a.crashDur, a.dur));
    return { id: a.id, maxX, slope: maxX > 0 ? Math.max(0, (a.crashCost - a.cost) / maxX) : 0 };
  });
  const base = acts.reduce((s, a) => s + a.cost, 0);
  const rows = linkRows(net, d, true);
  const obj = slopes.map((s, i) => (s.maxX > 0 ? `${s.slope.toFixed(6)} x${i}` : "")).filter(Boolean).join(" + ");
  const bounds = [...acts.map((_, i) => ` s${i} >= 0`), ...slopes.map((s, i) => ` 0 <= x${i} <= ${s.maxX}`)];
  const nPts = 12;
  const Ts = Array.from(new Set(Array.from({ length: nPts }, (_, k) => Math.round(normalT - ((normalT - crashT) * k) / (nPts - 1))))).sort((a, b) => b - a);
  const curve: CrashPoint[] = [];
  for (const T of Ts) {
    const fin = acts.map((_, i) => ` f${i}: s${i} - x${i} <= ${T - d[i]}`);
    const r = h.solve(lpText("Minimize", obj, [...rows, ...fin], bounds));
    const x = acts.map((_, i) => r.Columns[`x${i}`]?.Primal ?? 0);
    const direct = base + x.reduce((s, xi, i) => s + xi * slopes[i].slope, 0);
    curve.push({
      T, direct, indirect: inp.settings.indirectCost * T, total: direct + inp.settings.indirectCost * T,
      crashed: x.map((xi, i) => ({ id: acts[i].id, x: xi })).filter((c) => c.x > 1e-6), status: r.Status,
    });
  }
  const ok = curve.filter((c) => c.status === "Optimal");
  const optimum = (ok.length ? ok : curve).reduce((a, b) => (b.total < a.total ? b : a));
  return { normalT, crashT, slopes, curve, optimum };
}
