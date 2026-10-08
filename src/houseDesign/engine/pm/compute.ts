// One entry point: inputs → network → CPM, PERT, Monte Carlo, resource
// histograms, smoothing and levelling. (LP verification and crashing are
// asynchronous — see lp.ts.)

import type { PmInputs } from "./inputs";
import { buildNet, cpm, fmtDate, makeCalendar, monteCarlo, pert, type Cpm, type MonteCarlo, type Net, type Pert } from "./cpm";
import { level, profiles, smooth, type ScheduleRes } from "./resources";

export interface PmResult {
  inp: PmInputs;
  net: Net;
  d: number[];
  cpm: Cpm;
  pert: Pert;
  mc: MonteCarlo;
  crashCpm: Cpm; // all activities at crash duration
  early: ScheduleRes;
  late: ScheduleRes;
  smoothed: ScheduleRes;
  levelled: ScheduleRes & { log: { id: string; es: number; start: number; delay: number }[] };
  date: (k: number) => string; // working day → calendar date
  summary: {
    activities: number;
    T: number;
    start: string;
    finish: string;
    critical: number;
    paths: number;
    Te: number;
    pertSd: number;
    pTarget: number;
    mcP80: number;
    levelledT: number;
    cost: number;
  };
}

export function computePm(inp: PmInputs): PmResult {
  if (!inp.activities.length) throw new Error("Add at least one activity.");
  for (const a of inp.activities) {
    if (!(a.dur >= 0)) throw new Error(`Activity ${a.id}: duration must be ≥ 0.`);
    if (a.opt > a.dur || a.pess < a.dur) throw new Error(`Activity ${a.id}: need optimistic ≤ most likely ≤ pessimistic.`);
  }
  const net = buildNet(inp.activities);
  const d = inp.activities.map((a) => a.dur);
  const c = cpm(net, d);
  const pt = pert(inp, net);
  const mc = monteCarlo(inp, net);
  const crashCpm = cpm(net, inp.activities.map((a) => Math.min(a.crashDur, a.dur)));
  const ES = c.rows.map((r) => r.ES), LS = c.rows.map((r) => r.LS);
  const early = { label: "Early start (CPM)", starts: ES, ...profiles(inp, d, ES) };
  const late = { label: "Late start (CPM)", starts: LS, ...profiles(inp, d, LS) };
  const smoothed = smooth(inp, net, d, ES, c.T);
  const levelled = level(inp, net, d, { LS, TF: c.rows.map((r) => r.TF), ES });
  const horizon = Math.ceil(Math.max(c.T, levelled.T, pt.Te, mc.finishes[mc.finishes.length - 1]) * 1.2) + 30;
  const cal = makeCalendar(inp.settings.startDate, inp.settings.daysPerWeek, horizon);
  const date = (k: number) => fmtDate(cal(k));
  return {
    inp, net, d, cpm: c, pert: pt, mc, crashCpm, early, late, smoothed, levelled, date,
    summary: {
      activities: inp.activities.length,
      T: c.T,
      start: date(0),
      finish: date(Math.max(0, c.T - 1)),
      critical: c.rows.filter((r) => r.critical).length,
      paths: c.paths.length,
      Te: pt.Te,
      pertSd: pt.sd,
      pTarget: pt.pTarget,
      mcP80: mc.pct.find((p) => p.p === 0.8)!.T,
      levelledT: levelled.T,
      cost: inp.activities.reduce((s, a) => s + a.cost, 0),
    },
  };
}
