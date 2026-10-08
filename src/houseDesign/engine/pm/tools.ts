// Project Management tool ids and the input fields each workbench shows.

export type PmToolId =
  | "pm-present"
  | "pm-input-json"
  | "pm-project"
  | "pm-activities"
  | "pm-resources-in"
  | "pm-cpm"
  | "pm-pert"
  | "pm-risk"
  | "pm-histogram"
  | "pm-smooth"
  | "pm-level"
  | "pm-crash"
  | "pm-gantt"
  | "pm-network"
  | "pm-rchart"
  | "pm-verify"
  | "pm-report-json"
  | "pm-report-html"
  | "pm-report-latex";

export type PmField =
  | { kind: "num"; key: string; label: string; unit?: string; step?: number }
  | { kind: "text"; sec: "project" | "settings"; key: string; label: string }
  | { kind: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: "activities" }
  | { kind: "resources" }
  | { kind: "exports" }
  | { kind: "heading"; label: string };

const n = (key: string, label: string, unit?: string, step?: number): PmField => ({ kind: "num", key, label, unit, step });
const t = (sec: "project" | "settings", key: string, label: string): PmField => ({ kind: "text", sec, key, label });
const hd = (label: string): PmField => ({ kind: "heading", label });

export const PM_TOOLS: Record<Exclude<PmToolId, "pm-present" | "pm-input-json" | "pm-gantt" | "pm-network" | "pm-rchart" | "pm-report-json" | "pm-report-html" | "pm-report-latex">, { title: string; hint: string; fields: PmField[]; wide?: boolean }> = {
  "pm-project": {
    title: "Project & Calendar",
    hint: "Project description, start date and working calendar.",
    fields: [
      hd("Project"), t("project", "title", "Report title"), t("project", "name", "Name of the project"), t("project", "capacity", "Capacity"), t("project", "client", "Employer"), t("project", "location", "Location"), t("project", "consultant", "Consultant"), t("project", "engineer", "Planner"), t("project", "date", "Report date (blank = today)"),
      hd("Calendar"), t("settings", "startDate", "Start date (yyyy-mm-dd)"), n("daysPerWeek", "Working days per week", "d", 1), n("targetDays", "Target / contract duration", "working d", 1),
    ],
  },
  "pm-activities": { title: "Activities & Logic", hint: "Work items with most-likely, optimistic and pessimistic durations (working days) and predecessors, e.g. “B20 SS+60; A60”.", fields: [{ kind: "activities" }], wide: true },
  "pm-resources-in": { title: "Resources & Costs", hint: "Resource pool with daily availability, demand of each activity, normal cost and crash data.", fields: [{ kind: "resources" }], wide: true },
  "pm-cpm": { title: "CPM — Floats & Critical Path", hint: "Forward and backward pass with FS/SS/FF/SF links; total, free, independent and interfering float.", fields: [n("targetDays", "Target duration", "d", 1)] },
  "pm-pert": { title: "PERT", hint: "Expected durations, variance along the critical path and probability of meeting the target.", fields: [n("targetDays", "Target duration", "d", 1)] },
  "pm-risk": { title: "Monte Carlo Risk", hint: "Beta-PERT simulation of the whole network: P50/P80/P90 and criticality index.", fields: [n("runs", "Iterations", "", 100), n("seed", "Random seed", "", 1), n("targetDays", "Target duration", "d", 1)] },
  "pm-histogram": { title: "Resource Histograms", hint: "Daily demand of each resource on early and late dates.", fields: [] },
  "pm-smooth": { title: "Resource Smoothing", hint: "Burgess smoothing within float, end date fixed.", fields: [n("smoothPasses", "Passes", "", 1)] },
  "pm-level": { title: "Resource Levelling", hint: "Serial schedule generation within resource limits; the end date may move.", fields: [{ kind: "select", key: "levelPriority", label: "Priority rule", options: [{ value: "LS", label: "Least late start" }, { value: "TF", label: "Least total float" }, { value: "ES", label: "Earliest early start" }, { value: "DUR", label: "Longest duration" }] }] },
  "pm-crash": { title: "Time-Cost Trade-off", hint: "Optimal crashing by linear programming (HiGHS) and the total-cost curve.", fields: [n("indirectCost", "Indirect cost", "M NRs/day")] },
  "pm-verify": { title: "Verification (LP · P6 · MS Project)", hint: "CPM dates re-solved as linear programmes with HiGHS; XER / MSPDI export for Primavera P6, MS Project and ProjectLibre.", fields: [{ kind: "exports" }] },
};

export function isPmTool(t: unknown): t is PmToolId {
  return typeof t === "string" && t.startsWith("pm-");
}

export function isPmWorkbenchTool(t: unknown): t is keyof typeof PM_TOOLS {
  return typeof t === "string" && t in PM_TOOLS;
}
