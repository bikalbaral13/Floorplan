// Resource analysis on a schedule of activity starts.
//
//   Histogram   daily demand of each resource.
//   Smoothing   (Burgess) project end fixed: activities are moved one at a time
//               inside the window their current neighbours allow, to the start
//               that minimises Σ (R(t)/limit)², i.e. the flattest profile.
//   Levelling   resource limits fixed: serial schedule-generation scheme —
//               repeatedly take the eligible activity with the highest
//               priority (least late start, then least float …) and place it at
//               the first time its logic and the remaining capacity allow;
//               the project may extend.

import type { PmInputs } from "./inputs";
import { linkStart, type Net } from "./cpm";

export interface Profile {
  id: string;
  daily: number[]; // length T
  peak: number;
  avg: number;
  moment: number; // Σ R² (units² · day)
  overDays: number; // days above limit
  limit: number;
}

export interface ScheduleRes {
  label: string;
  starts: number[];
  T: number;
  profiles: Profile[];
}

export function profiles(inp: PmInputs, d: number[], starts: number[]): { T: number; profiles: Profile[] } {
  const T = Math.max(1, ...starts.map((s, i) => s + d[i]));
  const out = inp.resources.map((r) => {
    const daily = new Array(Math.ceil(T)).fill(0);
    inp.activities.forEach((a, i) => {
      const u = a.res[r.id] ?? 0;
      if (!u) return;
      for (let t = Math.floor(starts[i]); t < Math.floor(starts[i] + d[i]); t++) daily[t] += u;
    });
    const peak = Math.max(0, ...daily);
    const work = daily.reduce((s, x) => s + x, 0);
    return {
      id: r.id, daily, peak, avg: work / Math.max(1, daily.length),
      moment: daily.reduce((s, x) => s + x * x, 0), overDays: daily.filter((x) => x > r.limit + 1e-9).length, limit: r.limit,
    };
  });
  return { T, profiles: out };
}

/** Window [lo, hi] for activity i given the current starts of its neighbours and project end T. */
function window(net: Net, d: number[], S: number[], i: number, T: number): [number, number] {
  let lo = 0, hi = T - d[i];
  for (const l of net.acts[i].preds) {
    const p = net.idx.get(l.pred)!;
    lo = Math.max(lo, linkStart(l.type, l.lag, S[p], d[p], d[i]));
  }
  for (const { j, link } of net.succs[i]) {
    // S[j] ≥ linkStart(type, lag, S[i], d[i], d[j]) → bound on S[i]
    const off = linkStart(link.type, link.lag, 0, d[i], d[j]);
    hi = Math.min(hi, S[j] - off);
  }
  return [lo, hi];
}

export function smooth(inp: PmInputs, net: Net, d: number[], early: number[], T: number): ScheduleRes {
  const S = [...early];
  const R = inp.resources;
  const load = R.map((r) => {
    const a = new Array(Math.ceil(T) + 1).fill(0);
    inp.activities.forEach((act, i) => { for (let t = S[i]; t < S[i] + d[i]; t++) a[t] += act.res[r.id] ?? 0; });
    return a;
  });
  const passes = Math.max(1, Math.round(inp.settings.smoothPasses));
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    const order = inp.activities.map((_, i) => i).sort((a, b) => S[b] - S[a]); // latest first (Burgess)
    for (const i of order) {
      const a = inp.activities[i];
      if (d[i] <= 0 || R.every((r) => !(a.res[r.id] ?? 0))) continue;
      const [lo, hi] = window(net, d, S, i, T);
      if (hi <= lo) continue;
      // take the activity out, then price each candidate start with prefix sums
      R.forEach((r, k) => { const u = a.res[r.id] ?? 0; for (let t = S[i]; t < S[i] + d[i]; t++) load[k][t] -= u; });
      const pref = load.map((row) => { const p = [0]; for (const x of row) p.push(p[p.length - 1] + x); return p; });
      let best = S[i], bestC = Infinity;
      for (let s = lo; s <= hi; s++) {
        let c = 0;
        R.forEach((r, k) => {
          const u = a.res[r.id] ?? 0;
          if (!u) return;
          const sum = pref[k][s + d[i]] - pref[k][s];
          c += (u * (2 * sum + u * d[i])) / (r.limit * r.limit);
        });
        if (c < bestC - 1e-9 || (Math.abs(c - bestC) <= 1e-9 && s === S[i])) {
          bestC = c;
          best = s;
        }
      }
      if (best !== S[i]) moved = true;
      S[i] = best;
      R.forEach((r, k) => { const u = a.res[r.id] ?? 0; for (let t = S[i]; t < S[i] + d[i]; t++) load[k][t] += u; });
    }
    if (!moved) break;
  }
  const p = profiles(inp, d, S);
  return { label: "Smoothed (end date fixed)", starts: S, ...p };
}

export function level(inp: PmInputs, net: Net, d: number[], prio: { LS: number[]; TF: number[]; ES: number[] }): ScheduleRes & { log: { id: string; es: number; start: number; delay: number }[] } {
  const n = inp.activities.length;
  const S = new Array(n).fill(-1);
  const R = inp.resources;
  const H = Math.ceil(d.reduce((s, x) => s + x, 0)) + 10;
  const used = R.map(() => new Array(H).fill(0));
  const log: { id: string; es: number; start: number; delay: number }[] = [];
  const key = (i: number): number[] => {
    const p = inp.settings.levelPriority;
    const main = p === "LS" ? prio.LS[i] : p === "TF" ? prio.TF[i] : p === "ES" ? prio.ES[i] : -d[i];
    return [main, prio.TF[i], prio.ES[i], i];
  };
  const cmp = (a: number[], b: number[]) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; };
  for (let placed = 0; placed < n; placed++) {
    const eligible = inp.activities.map((_, i) => i).filter((i) => S[i] < 0 && inp.activities[i].preds.every((l) => S[net.idx.get(l.pred)!] >= 0));
    eligible.sort((a, b) => cmp(key(a), key(b)));
    const i = eligible[0];
    let es = 0;
    for (const l of inp.activities[i].preds) {
      const p = net.idx.get(l.pred)!;
      es = Math.max(es, linkStart(l.type, l.lag, S[p], d[p], d[i]));
    }
    let s = es;
    const a = inp.activities[i];
    const fits = (t0: number) => R.every((r, k) => {
      const u = a.res[r.id] ?? 0;
      if (!u) return true;
      if (u > r.limit) return true; // cannot ever fit — schedule anyway, reported as over-allocation
      for (let t = t0; t < t0 + d[i]; t++) if ((used[k][t] ?? 0) + u > r.limit + 1e-9) return false;
      return true;
    });
    while (!fits(s) && s < H) s++;
    S[i] = s;
    R.forEach((r, k) => { const u = a.res[r.id] ?? 0; for (let t = s; t < s + d[i]; t++) { if (t >= used[k].length) used[k].push(0); used[k][t] += u; } });
    log.push({ id: a.id, es, start: s, delay: s - es });
  }
  const p = profiles(inp, d, S);
  return { label: "Levelled (resource limits)", starts: S, ...p, log };
}
