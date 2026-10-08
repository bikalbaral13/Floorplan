// Project-management report: chapters assembled into the shared
// ReportDocument model so JSON, HTML and LaTeX all come from one source.

import {
  CALC, CHECK, DRAW, EQ, FIG, KV, L, NOTE, P, T, f, numberDocument,
  type Chapter, type ReportDocument,
} from "../feasibility/doc";
import type { ChartSpec } from "../feasibility/charts";
import type { PmResult } from "./compute";
import type { ScheduleRes } from "./resources";
import { linksText } from "./inputs";
import { normCdf } from "./cpm";
import { ganttSheet, networkSheet } from "./drawings";
import type { Crashing, LpCheck } from "./lp";
import type { PmToolId } from "./tools";

export interface PmAsync { lp: LpCheck; crash: Crashing }

/** Monthly average of a daily series (calendar months). */
function monthly(r: PmResult, daily: number[]): { label: string; v: number }[] {
  const out: { label: string; v: number; n: number }[] = [];
  daily.forEach((x, k) => {
    const m = r.date(k).slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.label === m) {
      last.v += x;
      last.n++;
    } else out.push({ label: m, v: x, n: 1 });
  });
  return out.map((o) => ({ label: o.label, v: o.v / o.n }));
}

function histChart(r: PmResult, sets: ScheduleRes[], resId: string): ChartSpec {
  const res = r.inp.resources.find((x) => x.id === resId)!;
  const series = sets.map((s) => {
    const m = monthly(r, s.profiles.find((p) => p.id === resId)!.daily);
    return { name: s.label, style: "line" as const, points: m.map((o, k) => [k + 1, o.v] as [number, number]) };
  });
  return { x: { label: "Month from start", min: 0 }, y: { label: `${res.name} (${res.unit}, monthly mean)`, min: 0 }, series, markers: [{ y: res.limit, label: `limit ${res.limit}` }] };
}


export function chProject(r: PmResult): Chapter {
  const p = r.inp.project, s = r.summary;
  return {
    id: "pm-project",
    title: "Project and Planning Basis",
    sections: [
      {
        title: "Project Detail",
        blocks: [
          KV([
            ["Name of the project", p.name],
            ["Installed capacity", p.capacity],
            ["Employer", p.client],
            ["Location", p.location],
            ["Planned start", `${s.start} (working day 0)`],
            ["Working calendar", `${r.inp.settings.daysPerWeek}-day week, 8 h/day${r.inp.settings.daysPerWeek === 6 ? " (Saturday off)" : ""}`],
            ["Activities", `${s.activities} in ${new Set(r.inp.activities.map((a) => a.wbs)).size} WBS groups`],
            ["Prepared by", `${p.consultant}${p.engineer ? ` — ${p.engineer}` : ""}`],
          ], "Project detail"),
          NOTE("The activity list, durations, resources and costs form an illustrative construction schedule for a 100 MW run-of-river scheme; replace them with the contract programme for a real project."),
        ],
      },
      {
        title: "Techniques Used",
        blocks: [
          L([
            "Critical Path Method (precedence diagramming, FS/SS/FF/SF links with lags): early and late dates, total, free, independent and interfering float, critical path(s).",
            "PERT: three-point estimates, expected durations, variance along the critical path and probability of meeting the target date.",
            "Monte Carlo schedule-risk analysis with beta-PERT activity durations: completion-date distribution, P50/P80/P90 and criticality index.",
            "Resource histograms, resource smoothing (Burgess method, end date fixed) and resource levelling (serial schedule generation with resource limits).",
            "Time-cost trade-off (crashing) solved exactly as a linear programme with HiGHS; optimum duration including indirect cost.",
            "Verification: CPM dates re-derived as linear programmes with HiGHS; exchange files for Primavera P6 (XER) and MS Project / ProjectLibre (MSPDI XML).",
          ]),
        ],
      },
    ],
  };
}

export function chActivities(r: PmResult): Chapter {
  const res = r.inp.resources;
  return {
    id: "pm-activities",
    title: "Activities, Logic and Resources",
    sections: [
      {
        title: "Activity List",
        blocks: [
          T("Activities and logic", ["ID", "Activity", "WBS", "Dur (d)", "a (d)", "b (d)", "Predecessors"], r.inp.activities.map((a) => [a.id, a.name, a.wbs, a.dur, a.opt, a.pess, linksText(a.preds) || "—"])),
          NOTE("Predecessor notation: “B20 SS+60” = start-to-start with a 60-day lag; a plain ID is finish-to-start with no lag. Durations and lags are working days."),
        ],
      },
      {
        title: "Resources and Costs",
        blocks: [
          T("Resource pool", ["ID", "Resource", "Unit", "Available per day"], res.map((x) => [x.id, x.name, x.unit, x.limit])),
          T("Resource demand and cost per activity", ["ID", ...res.map((x) => `${x.id} (${x.unit}/d)`), "Cost (M NRs)", "Crash dur (d)", "Crash cost (M NRs)"],
            r.inp.activities.map((a) => [a.id, ...res.map((x) => a.res[x.id] ?? 0), f(a.cost, 0), a.crashDur, f(a.crashCost, 0)])),
        ],
      },
    ],
  };
}

export function chCpm(r: PmResult): Chapter {
  const c = r.cpm, ex = c.rows.find((x) => x.a.preds.some((l) => l.type !== "FS")) ?? c.rows[1];
  return {
    id: "pm-cpm",
    title: "Critical Path Method",
    sections: [
      {
        title: "Forward and Backward Pass",
        blocks: [
          P("The network is analysed as an activity-on-node precedence diagram. The forward pass gives the earliest start ES of each activity as the largest of the dates its predecessors allow; the backward pass from the project finish T gives the latest finish LF as the smallest of the dates its successors allow."),
          T("Relationship rules (d = duration, lag in working days)", ["Link", "Forward pass", "Backward pass"], [
            ["FS", "ES_j ≥ EF_i + lag", "LF_i ≤ LS_j − lag"],
            ["SS", "ES_j ≥ ES_i + lag", "LF_i ≤ LS_j − lag + d_i"],
            ["FF", "ES_j ≥ EF_i + lag − d_j", "LF_i ≤ LF_j − lag"],
            ["SF", "ES_j ≥ ES_i + lag − d_j", "LF_i ≤ LF_j − lag + d_i"],
          ]),
          EQ("TF = LS − ES = LF − EF", ["TF = total float"], String.raw`TF = LS - ES = LF - EF`),
          EQ("FF = min(ES_succ allowed) − ES", ["FF = free float: delay that does not affect any successor's early start"], String.raw`FF_i = \min_j\left(ES_j - ES_j^{(i)}\right)`),
          EQ("IF = max(0, FF − (ES_late − ES))", ["IF = independent float: free float left when all predecessors finish late"], String.raw`IF_i = \max\left(0,\ FF_i - (ES_i^{late} - ES_i)\right)`),
          EQ("Interfering float = TF − FF", [], String.raw`INTF = TF - FF`),
          CALC([
            [`${ex.a.id}: predecessors`, linksText(ex.a.preds) || "none"],
            ["Earliest start / finish", `ES = ${ex.ES}, EF = ${ex.ES} + ${ex.d} = ${ex.EF}`],
            ["Latest start / finish", `LF = ${ex.LF}, LS = ${ex.LF} − ${ex.d} = ${ex.LS}`],
            ["Floats", `TF = ${ex.TF}, FF = ${ex.FF}, IF = ${ex.IF}, interfering = ${ex.INTF}`],
          ]),
          T("CPM schedule (working days from start)", ["ID", "Dur", "ES", "EF", "LS", "LF", "TF", "FF", "IF", "INTF", "Early start date", "Early finish date", "Critical"],
            c.rows.map((x) => [x.a.id, x.d, x.ES, x.EF, x.LS, x.LF, x.TF, x.FF, x.IF, x.INTF, r.date(x.ES), r.date(Math.max(x.ES, x.EF - 1)), x.critical ? "Yes" : ""])),
        ],
      },
      {
        title: "Critical Path",
        blocks: [
          KV([
            ["Project duration", `${c.T} working days`],
            ["Planned completion (COD)", r.summary.finish],
            ["Critical activities", `${r.summary.critical} of ${r.summary.activities}`],
            ...c.paths.map((p, k) => [`Critical path ${k + 1}`, p.join(" → ")] as [string, string]),
          ], "CPM result"),
          DRAW("Precedence network diagram", networkSheet(r, "PM-01")),
          DRAW("Gantt chart — early start schedule", ganttSheet(r, r.early.starts, "early start", "PM-02")),
          FIG("Total float of each activity", {
            x: { label: "Activity", categories: c.rows.map((x) => x.a.id) },
            y: { label: "Float (working days)", min: 0 },
            series: [{ name: "Total float", style: "bar", points: c.rows.map((x, k) => [k, x.TF]) }, { name: "Free float", style: "points", points: c.rows.map((x, k) => [k, x.FF]) }],
          }),
        ],
      },
      {
        title: "Cost S-curve",
        blocks: [
          P("Cumulative direct cost with every activity on its early and on its late dates; the band between the curves is the scheduling flexibility available for cash-flow planning."),
          FIG("Cumulative cost — early vs late start", sCurve(r)),
        ],
      },
    ],
  };
}

function sCurve(r: PmResult): ChartSpec {
  const cum = (starts: number[]) => {
    const T = r.cpm.T, daily = new Array(T + 1).fill(0);
    r.inp.activities.forEach((a, i) => {
      if (a.dur === 0) return;
      for (let t = starts[i]; t < starts[i] + a.dur; t++) daily[t] += a.cost / a.dur;
    });
    const pts: [number, number][] = [];
    let s = 0;
    daily.forEach((x, k) => { s += x; if (k % 30 === 0 || k === T) pts.push([k, s]); });
    return pts;
  };
  return { x: { label: "Working day", min: 0 }, y: { label: "Cumulative cost (M NRs)", min: 0 }, series: [{ name: "Early start", style: "line", points: cum(r.early.starts) }, { name: "Late start", style: "line", dashed: true, points: cum(r.late.starts) }] };
}

export function chPert(r: PmResult): Chapter {
  const p = r.pert;
  const byId = new Map(p.rows.map((x) => [x.id, x]));
  return {
    id: "pm-pert",
    title: "PERT Analysis",
    sections: [
      {
        title: "Expected Durations",
        blocks: [
          EQ("te = (a + 4m + b) / 6", ["a = optimistic, m = most likely, b = pessimistic duration"], String.raw`t_e = \frac{a + 4m + b}{6}`),
          EQ("σ = (b − a) / 6", [], String.raw`\sigma = \frac{b - a}{6},\qquad \sigma^2 = \left(\frac{b - a}{6}\right)^2`),
          T("Three-point estimates", ["ID", "a", "m", "b", "te", "σ", "σ²", "On PERT critical path"], p.rows.map((x) => [x.id, x.a, x.m, x.b, f(x.te, 1), f(x.sd, 2), f(x.v, 1), p.path.includes(x.id) ? "Yes" : ""])),
        ],
      },
      {
        title: "Probability of Completion",
        blocks: [
          CALC([
            ["PERT critical path", p.path.join(" → ")],
            ["Expected duration Te", `${f(p.Te, 1)} working days`],
            ["Standard deviation σ_T = √Σσ²", `√(${p.path.map((id) => f(byId.get(id)!.v, 1)).join(" + ")}) = ${f(p.sd, 2)} days`],
            ["Target duration", `${p.target} working days (${r.date(p.target - 1)})`],
            ["z = (T − Te)/σ", `(${p.target} − ${f(p.Te, 1)}) / ${f(p.sd, 2)} = ${f((p.target - p.Te) / p.sd, 3)}`],
            ["P(T ≤ target) = Φ(z)", `${f(p.pTarget * 100, 1)} %`],
          ]),
          EQ("z = (Ts − Te) / σ", ["Ts = scheduled / target duration"], String.raw`z = \frac{T_s - T_e}{\sigma_T},\qquad P = \Phi(z)`),
          T("Probability of completion", ["Duration (d)", "Date", "z", "Probability"], p.table.map((x) => [f(x.T, 0), r.date(Math.round(x.T) - 1), f(x.z, 3), `${f(x.p * 100, 1)} %`])),
          T("Duration for a required confidence", ["Confidence", "Duration (d)", "Completion date"], p.forP.map((x) => [`${x.p * 100} %`, f(x.T, 0), r.date(Math.round(x.T) - 1)])),
          FIG("PERT completion probability (normal approximation)", {
            x: { label: "Project duration (working days)" },
            y: { label: "Probability of completion", min: 0, max: 1 },
            series: [{ name: "Φ((T − Te)/σ)", style: "line", points: Array.from({ length: 61 }, (_, k) => { const T = p.Te + (k - 30) * p.sd / 10; return [T, normCdf((T - p.Te) / p.sd)] as [number, number]; }) }],
            markers: [{ x: p.target, label: "target" }],
          }),
          NOTE("PERT considers only the variance of the single critical path and ignores merge bias from near-critical paths; the Monte Carlo analysis in the next chapter removes that limitation."),
        ],
      },
    ],
  };
}

export function chRisk(r: PmResult): Chapter {
  const m = r.mc;
  const cdf = m.finishes.filter((_, k) => k % Math.max(1, Math.floor(m.runs / 200)) === 0).map((x, k, arr) => [x, (k + 1) / arr.length] as [number, number]);
  return {
    id: "pm-risk",
    title: "Monte Carlo Schedule Risk Analysis",
    sections: [
      {
        title: "Simulation",
        blocks: [
          P(`${m.runs} iterations were run (seed ${r.inp.settings.seed}). In each, every activity duration is drawn from a beta-PERT distribution on (a, m, b) with shape α = 1 + 4(m − a)/(b − a), β = 1 + 4(b − m)/(b − a), and the full CPM forward and backward passes are repeated.`),
          KV([
            ["Mean duration", `${f(m.mean, 1)} d`],
            ["Standard deviation", `${f(m.sd, 1)} d`],
            ...m.pct.map((x) => [`P${x.p * 100}`, `${f(x.T, 0)} d — ${r.date(Math.round(x.T) - 1)}`] as [string, string]),
            ["P(T ≤ target)", `${f(m.pTarget * 100, 1)} % (PERT: ${f(r.pert.pTarget * 100, 1)} %)`],
            ["Deterministic CPM", `${r.cpm.T} d`],
          ], "Simulation results"),
          FIG("Distribution of project duration", {
            x: { label: "Project duration (working days)" },
            y: { label: "Iterations", min: 0 },
            series: [{ name: "Frequency", style: "bar", points: m.hist.map((b) => [(b.x0 + b.x1) / 2, b.n]) }],
            markers: [{ x: r.cpm.T, label: "CPM" }, { x: r.inp.settings.targetDays, label: "target" }],
          }),
          FIG("Cumulative probability of completion (S-curve)", {
            x: { label: "Project duration (working days)" },
            y: { label: "Probability", min: 0, max: 1 },
            series: [{ name: "Monte Carlo", style: "line", points: cdf }, { name: "PERT", style: "line", dashed: true, points: cdf.map(([x]) => [x, normCdf((x - r.pert.Te) / r.pert.sd)] as [number, number]) }],
          }),
        ],
      },
      {
        title: "Criticality Index",
        blocks: [
          P("The criticality index is the fraction of iterations in which an activity had zero total float. Activities with a high index but float in the deterministic schedule are near-critical and need monitoring."),
          T("Criticality index", ["ID", "Activity", "Deterministic TF (d)", "Criticality index"], m.critIndex.map((x, i) => [x.id, r.inp.activities[i].name, r.cpm.rows[i].TF, `${f(x.ci * 100, 1)} %`])),
        ],
      },
    ],
  };
}

export function chResources(r: PmResult): Chapter {
  return {
    id: "pm-resources",
    title: "Resource Histograms",
    sections: r.inp.resources.map((res) => {
      const e = r.early.profiles.find((p) => p.id === res.id)!, l = r.late.profiles.find((p) => p.id === res.id)!;
      return {
        title: res.name,
        blocks: [
          KV([
            ["Available", `${res.limit} ${res.unit}/day`],
            ["Peak — early / late start", `${f(e.peak, 0)} / ${f(l.peak, 0)}`],
            ["Days over the limit — early / late", `${e.overDays} / ${l.overDays}`],
            ["Mean daily demand", f(e.avg, 1)],
          ]),
          FIG(`${res.name}: early vs late start`, histChart(r, [r.early, r.late], res.id)),
        ],
      };
    }),
  };
}

function compareRows(r: PmResult, a: ScheduleRes, b: ScheduleRes) {
  return r.inp.resources.map((res) => {
    const pa = a.profiles.find((p) => p.id === res.id)!, pb = b.profiles.find((p) => p.id === res.id)!;
    return [res.id, f(pa.peak, 0), f(pb.peak, 0), f(pa.moment / 1e3, 0), f(pb.moment / 1e3, 0), `${f(((pb.moment - pa.moment) / Math.max(1, pa.moment)) * 100, 1)} %`, pa.overDays, pb.overDays];
  });
}

export function chSmoothing(r: PmResult): Chapter {
  const moved = r.cpm.rows.map((x, i) => ({ id: x.a.id, from: x.ES, to: r.smoothed.starts[i], TF: x.TF })).filter((x) => x.to !== x.from);
  return {
    id: "pm-smooth",
    title: "Resource Smoothing",
    sections: [
      {
        title: "Method",
        blocks: [
          P("Resource smoothing keeps the project end date and moves activities only within their float to make the demand as uniform as possible (Burgess method). Activities are taken from the latest to the earliest; each is moved to the start, inside the window its current predecessors and successors allow, that minimises the resource moment."),
          EQ("M = Σ_r Σ_t (R_r(t) / limit_r)^2", ["R_r(t) = demand of resource r on day t"], String.raw`M = \sum_r \sum_t \left(\frac{R_r(t)}{\text{limit}_r}\right)^2`),
          T("Effect of smoothing", ["Resource", "Peak before", "Peak after", "Σ R² before (×10³)", "Σ R² after (×10³)", "Change", "Days over limit before", "after"], compareRows(r, r.early, r.smoothed)),
          T("Activities moved", ["ID", "Early start", "Smoothed start", "Shift (d)", "Total float"], moved.map((x) => [x.id, x.from, x.to, x.to - x.from, x.TF])),
          ...r.inp.resources.map((res) => FIG(`${res.name}: early start vs smoothed`, histChart(r, [r.early, r.smoothed], res.id))),
          CHECK("Project end date unchanged", r.smoothed.T === r.cpm.T, `${r.smoothed.T} d`),
        ],
      },
    ],
  };
}

export function chLevelling(r: PmResult): Chapter {
  const lv = r.levelled;
  return {
    id: "pm-level",
    title: "Resource Levelling",
    sections: [
      {
        title: "Method",
        blocks: [
          P(`Resource levelling respects the resource limits and lets the project extend. A serial schedule-generation scheme places one activity at a time: among the activities whose predecessors are already scheduled, the one with the highest priority (${r.inp.settings.levelPriority === "LS" ? "least late start" : r.inp.settings.levelPriority === "TF" ? "least total float" : r.inp.settings.levelPriority === "ES" ? "earliest early start" : "longest duration"}, ties by total float) is started at the first day its logic and the remaining capacity allow.`),
          KV([
            ["Duration — CPM", `${r.cpm.T} d (${r.summary.finish})`],
            ["Duration — levelled", `${lv.T} d (${r.date(lv.T - 1)})`],
            ["Extension", `${lv.T - r.cpm.T} d`],
            ["Activities delayed", String(lv.log.filter((x) => x.delay > 0).length)],
          ], "Levelling result"),
          T("Effect of levelling", ["Resource", "Peak CPM", "Peak levelled", "Σ R² CPM (×10³)", "Σ R² levelled (×10³)", "Change", "Days over limit CPM", "levelled"], compareRows(r, r.early, lv)),
          T("Levelling log (order of placement)", ["Order", "ID", "Logic start (d)", "Scheduled start (d)", "Delay (d)"], lv.log.map((x, k) => [k + 1, x.id, x.es, x.start, x.delay])),
          ...r.inp.resources.map((res) => FIG(`${res.name}: early start vs levelled`, histChart(r, [r.early, lv], res.id))),
          CHECK("All resource limits respected", lv.profiles.every((p) => p.overDays === 0), lv.profiles.map((p) => `${p.id} peak ${f(p.peak, 0)}/${p.limit}`).join(", ")),
          DRAW("Gantt chart — resource-levelled schedule", ganttSheet(r, lv.starts, "resource levelled", "PM-03")),
        ],
      },
    ],
  };
}

export function chCrashing(r: PmResult, v: PmAsync | null, err?: string | null): Chapter {
  if (!v) return { id: "pm-crash", title: "Time-Cost Trade-off (Crashing)", sections: [{ title: "Linear programme", blocks: [NOTE(err ? `HiGHS could not be run: ${err}` : "HiGHS is solving the crashing linear programmes…")] }] };
  const c = v.crash;
  return {
    id: "pm-crash",
    title: "Time-Cost Trade-off (Crashing)",
    sections: [
      {
        title: "Formulation",
        blocks: [
          P("Each activity can be shortened from its normal duration to its crash duration at a linear cost slope. For a target duration T the cheapest set of reductions is the solution of a linear programme, solved exactly with HiGHS for a range of T. Adding the indirect cost per day gives the total-cost curve and the optimum duration."),
          EQ("slope = (Cc − Cn) / (Dn − Dc)", ["C = cost, D = duration; n = normal, c = crash"], String.raw`c_i = \frac{C_{c,i} - C_{n,i}}{D_{n,i} - D_{c,i}}`),
          EQ("min Σ c_i x_i  s.t. links with d_i − x_i, S_i + d_i − x_i ≤ T, 0 ≤ x_i ≤ Dn − Dc", [], String.raw`\min \sum_i c_i x_i\quad \text{s.t. } S_j \ge S_i + (d_i - x_i) + \text{lag},\ S_i + d_i - x_i \le T,\ 0 \le x_i \le D_{n,i} - D_{c,i}`),
          T("Cost slopes", ["ID", "Normal (d)", "Crash (d)", "Max reduction (d)", "Slope (M NRs/d)"], c.slopes.map((s, i) => [s.id, r.inp.activities[i].dur, r.inp.activities[i].crashDur, s.maxX, f(s.slope, 3)])),
        ],
      },
      {
        title: "Time-Cost Curve",
        blocks: [
          T("Optimal crashing for each duration", ["Duration (d)", "Direct (M NRs)", "Indirect (M NRs)", "Total (M NRs)", "Activities shortened (days)"],
            c.curve.map((p) => [p.T, f(p.direct, 0), f(p.indirect, 0), f(p.total, 0), p.crashed.map((x) => `${x.id} ${f(x.x, 0)}`).join(", ") || "—"])),
          FIG("Project time-cost curve", {
            x: { label: "Project duration (working days)" },
            y: { label: "Cost (M NRs)" },
            series: [
              { name: "Direct", style: "linepoints", points: c.curve.map((p) => [p.T, p.direct]) },
              { name: "Total", style: "linepoints", points: c.curve.map((p) => [p.T, p.total]) },
            ],
            markers: [{ x: c.optimum.T, label: "optimum" }],
          }),
          KV([
            ["Normal duration / total cost", `${c.curve[0].T} d / ${f(c.curve[0].total, 0)} M NRs`],
            ["All-crash duration", `${c.crashT} d`],
            ["Optimum duration", `${c.optimum.T} d (${r.date(c.optimum.T - 1)})`],
            ["Optimum total cost", `${f(c.optimum.total, 0)} M NRs (saving ${f(c.curve[0].total - c.optimum.total, 0)})`],
            ["Indirect cost", `${r.inp.settings.indirectCost} M NRs per working day`],
          ], "Optimum"),
        ],
      },
    ],
  };
}

export function chVerify(r: PmResult, v: PmAsync | null, err?: string | null): Chapter {
  const keyRows = r.cpm.rows.filter((x) => x.critical || x.a.dur === 0 || x.TF >= 300).slice(0, 14);
  const base: Chapter["sections"] = [
    {
      title: "Verification in Primavera P6 / MS Project",
      blocks: [
        P("The schedule is exported as a Primavera P6 XER file and as a Microsoft Project XML (MSPDI) file from the “Verification” tool. Import either into Primavera P6 (File → Import), MS Project or ProjectLibre, schedule it (P6: F9, retained logic, total float = finish float) and compare with the values below. Both files carry the calendar, activities, relationships with lags, resources and this program's dates."),
        T("Expected results for comparison", ["ID", "Early start", "Early finish", "Late start", "Late finish", "Total float (d)", "Free float (d)"],
          keyRows.map((x) => [x.a.id, r.date(x.ES), r.date(Math.max(x.ES, x.EF - 1)), r.date(x.LS), r.date(Math.max(x.LS, x.LF - 1)), x.TF, x.FF])),
        KV([["Project finish", `${r.summary.finish} (${r.cpm.T} working days)`], ["Critical path", r.cpm.paths[0]?.join(" → ") ?? "—"]]),
        NOTE("Primavera P6 is proprietary desktop software and cannot run inside this application; the comparison above has to be made by the user after import. Differences of one day in finish dates are expected where P6 shows the end of a day as 17:00 of the same date."),
      ],
    },
  ];
  if (!v) return { id: "pm-verify", title: "Verification", sections: [{ title: "Linear-programming check", blocks: [NOTE(err ? `HiGHS could not be run: ${err}` : "HiGHS is solving the verification linear programmes…")] }, ...base] };
  const dES = v.lp.ES.map((e, i) => Math.abs(e - r.cpm.rows[i].ES)), dLS = v.lp.LS.map((e, i) => Math.abs(e - r.cpm.rows[i].LS));
  const ok = Math.max(...dES, ...dLS) < 1e-6 && Math.abs(v.lp.T - r.cpm.T) < 1e-6;
  return {
    id: "pm-verify",
    title: "Verification",
    sections: [
      {
        title: "Linear-programming Check (HiGHS)",
        blocks: [
          P("The CPM forward/backward-pass code is checked against an independent formulation. The earliest schedule is the optimum of min Σ S_i subject to one inequality per relationship; the latest schedule is the optimum of max Σ S_i with, in addition, every activity finishing by T. Both are solved by the HiGHS simplex solver (open source, WebAssembly)."),
          EQ("min Σ S_i  s.t.  S_j − S_i ≥ lag + a·d_i − b·d_j,  S_i ≥ 0", ["a = 1 for FS, FF; b = 1 for FF, SF"], String.raw`\min \sum S_i\ \ \text{s.t.}\ S_j - S_i \ge \text{lag} + a\,d_i - b\,d_j,\ S_i \ge 0`),
          T("CPM vs LP", ["ID", "ES (CPM)", "ES (LP)", "LS (CPM)", "LS (LP)", "Status"], r.cpm.rows.map((x, i) => [x.a.id, x.ES, f(v.lp.ES[i], 2), x.LS, f(v.lp.LS[i], 2), dES[i] < 1e-6 && dLS[i] < 1e-6 ? "OK" : "✗"])),
          CHECK("CPM agrees with the LP solution", ok, `solver status ${v.lp.status.join(" / ")}; project duration ${r.cpm.T} d (CPM) vs ${f(v.lp.T, 2)} d (LP); max difference ${f(Math.max(...dES, ...dLS), 4)} d`),
        ],
      },
      ...base,
    ],
  };
}

export const PM_TOOL_CHAPTERS: Partial<Record<PmToolId, (r: PmResult, v: PmAsync | null, err?: string | null) => Chapter[]>> = {
  "pm-project": (r) => [chProject(r)],
  "pm-activities": (r) => [chActivities(r)],
  "pm-resources-in": (r) => [chActivities(r)],
  "pm-cpm": (r) => [chCpm(r)],
  "pm-pert": (r) => [chPert(r)],
  "pm-risk": (r) => [chRisk(r)],
  "pm-histogram": (r) => [chResources(r)],
  "pm-smooth": (r) => [chSmoothing(r)],
  "pm-level": (r) => [chLevelling(r)],
  "pm-crash": (r, v, e) => [chCrashing(r, v, e)],
  "pm-verify": (r, v, e) => [chVerify(r, v, e)],
};

export function buildPmReport(r: PmResult, v: PmAsync | null, err?: string | null): ReportDocument {
  const p = r.inp.project, s = r.summary;
  const date = p.date || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const doc: ReportDocument = {
    meta: { title: `${p.title} - ${p.name}`, project: "Project_Schedule", river: "", location: p.location, generated_at: new Date().toISOString(), generator: "Hydropower Studio - Project Management" },
    cover: {
      institution: p.consultant.split(",").map((x) => x.trim().toUpperCase()),
      title: p.title,
      subtitle: `${p.name}, ${p.location}`,
      submittedBy: [p.consultant.split(",")[0], p.engineer].filter(Boolean),
      submittedTo: [p.client],
      date,
    },
    frontMatter: [{
      id: "summary",
      title: "EXECUTIVE SUMMARY",
      blocks: [
        P(`The construction programme of the ${p.capacity} ${p.name} has ${s.activities} activities. By the critical path method the project takes ${s.T} working days from ${s.start} to commercial operation on ${s.finish}; the critical path is ${r.cpm.paths[0]?.join(" → ") ?? "—"}.`),
        P(`With three-point estimates PERT gives an expected duration of ${f(s.Te, 0)} days (σ = ${f(s.pertSd, 0)} d) and a ${f(s.pTarget * 100, 0)} % chance of meeting the ${r.inp.settings.targetDays}-day target; the Monte Carlo P80 is ${f(s.mcP80, 0)} days. Levelling to the available resources extends the programme to ${s.levelledT} days.${v ? ` The optimum crashed duration including indirect cost is ${v.crash.optimum.T} days.` : ""}`),
      ],
    }],
    salientFeatures: [
      { group: "Project", rows: [["Name", p.name], ["Capacity", p.capacity], ["Location", p.location], ["Start", s.start]] },
      { group: "Schedule (CPM)", rows: [["Duration", `${s.T} working days`], ["Completion (COD)", s.finish], ["Critical activities", String(s.critical)], ["Direct cost", `${f(s.cost, 0)} M NRs`]] },
      { group: "Risk", rows: [["PERT Te / σ", `${f(s.Te, 0)} / ${f(s.pertSd, 0)} d`], ["P(target)", `${f(s.pTarget * 100, 1)} %`], ["Monte Carlo P50 / P80", `${f(r.mc.pct.find((x) => x.p === 0.5)!.T, 0)} / ${f(s.mcP80, 0)} d`]] },
      { group: "Resources & cost", rows: [["Labour peak early / smoothed / levelled", `${f(r.early.profiles[0]?.peak ?? 0, 0)} / ${f(r.smoothed.profiles[0]?.peak ?? 0, 0)} / ${f(r.levelled.profiles[0]?.peak ?? 0, 0)}`], ["Levelled duration", `${s.levelledT} d`], ...(v ? [["Optimum crashed duration", `${v.crash.optimum.T} d`] as [string, string]] : [])] },
    ],
    abbreviations: [
      ["CPM", "Critical path method"], ["PERT", "Programme evaluation and review technique"], ["AON", "Activity on node"],
      ["ES / EF / LS / LF", "Early start / early finish / late start / late finish"], ["TF / FF / IF", "Total / free / independent float"],
      ["FS / SS / FF / SF", "Finish-to-start / start-to-start / finish-to-finish / start-to-finish"], ["COD", "Commercial operation date"],
      ["P80", "Duration with 80 % probability of not being exceeded"], ["XER", "Primavera P6 exchange format"], ["MSPDI", "Microsoft Project XML data interchange"],
    ],
    parts: [
      { id: "p1", title: "1. PLANNING BASIS", chapters: [chProject(r), chActivities(r)] },
      { id: "p2", title: "2. TIME ANALYSIS", chapters: [chCpm(r), chPert(r), chRisk(r)] },
      { id: "p3", title: "3. RESOURCES AND COST", chapters: [chResources(r), chSmoothing(r), chLevelling(r), chCrashing(r, v, err)] },
      { id: "pa", title: "APPENDIX-A", subtitle: "VERIFICATION", appendix: "A", chapters: [chVerify(r, v, err)] },
    ],
    references: [
      "Kelley, J.E. and Walker, M.R. (1959). Critical-path planning and scheduling. Proc. Eastern Joint Computer Conference.",
      "Malcolm, D.G. et al. (1959). Application of a technique for research and development program evaluation (PERT). Operations Research 7(5).",
      "Burgess, A.R. and Killebrew, J.B. (1962). Variation in activity level on a cyclical arrow diagram. J. Industrial Engineering.",
      "Kolisch, R. (1996). Serial and parallel resource-constrained project scheduling methods revisited. EJOR 90.",
      "Fulkerson, D.R. (1961). A network flow computation for project cost curves. Management Science 7(2).",
      "Huangfu, Q. and Hall, J.A.J. (2018). Parallelizing the dual revised simplex method (HiGHS). Math. Prog. Computation 10.",
      "PMI (2019). Practice Standard for Scheduling, 3rd ed. — AACE RP 57R-09 Integrated cost and schedule risk analysis.",
    ],
    lists: { contents: [], tables: [], figures: [], drawings: [] },
    summary: {
      activities: s.activities,
      duration_days: s.T,
      start: s.start,
      finish: s.finish,
      critical_path: r.cpm.paths[0]?.join(">") ?? "",
      pert_te: Number(s.Te.toFixed(1)),
      pert_sd: Number(s.pertSd.toFixed(2)),
      p_target: Number(s.pTarget.toFixed(4)),
      mc_p50: Number(r.mc.pct.find((x) => x.p === 0.5)!.T.toFixed(1)),
      mc_p80: Number(s.mcP80.toFixed(1)),
      levelled_days: s.levelledT,
      optimum_crash_days: v ? v.crash.optimum.T : "",
      lp_verified: v ? Math.max(...v.lp.ES.map((e, i) => Math.abs(e - r.cpm.rows[i].ES))) < 1e-6 : false,
    },
  };
  return numberDocument(doc);
}
