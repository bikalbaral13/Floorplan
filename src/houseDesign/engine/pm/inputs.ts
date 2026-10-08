// Project Management — inputs. A project is a list of activities (work
// items) with durations, three-point (PERT) estimates, logic links (FS / SS /
// FF / SF with lags), resource demands and time-cost data. Defaults describe
// the construction schedule of a sample 100 MW run-of-river hydropower
// project in Nepal. Durations are in working days.

export type RelType = "FS" | "SS" | "FF" | "SF";

export interface Link {
  pred: string;
  type: RelType;
  lag: number; // working days (may be negative)
}

export interface Activity {
  id: string;
  name: string;
  wbs: string;
  dur: number; // most likely duration (days)
  opt: number; // optimistic (a)
  pess: number; // pessimistic (b)
  preds: Link[];
  res: Record<string, number>; // units per day
  cost: number; // normal direct cost (M NRs)
  crashDur: number; // shortest possible duration (days)
  crashCost: number; // direct cost at crash duration (M NRs)
}

export interface Resource {
  id: string;
  name: string;
  unit: string;
  limit: number; // available per day
}

export interface PmInputs {
  project: {
    title: string;
    name: string;
    client: string;
    location: string;
    consultant: string;
    engineer: string;
    date: string;
    capacity: string;
  };
  settings: {
    startDate: string; // ISO yyyy-mm-dd
    daysPerWeek: number; // 5, 6 or 7 working days
    targetDays: number; // contractual duration for PERT probability (working days)
    indirectCost: number; // M NRs per working day (overheads, IDC, lost revenue)
    runs: number; // Monte Carlo iterations
    seed: number;
    levelPriority: "LS" | "TF" | "ES" | "DUR";
    smoothPasses: number;
  };
  resources: Resource[];
  activities: Activity[];
}

/** "B20 FS+30; A60 SS" → links */
export function parseLinks(s: string): Link[] {
  return s.split(/[;,]/).map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^([A-Za-z0-9_.-]+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?$/i);
    if (!m) throw new Error(`Cannot read predecessor "${t}" — use e.g. "A10", "A10 SS+20", "B30 FF-5".`);
    return { pred: m[1], type: (m[2]?.toUpperCase() ?? "FS") as RelType, lag: m[3] ? Number(m[3].replace(/\s/g, "")) : 0 };
  });
}

export function linksText(ls: Link[]): string {
  return ls.map((l) => `${l.pred}${l.type !== "FS" || l.lag ? ` ${l.type}` : ""}${l.lag ? (l.lag > 0 ? `+${l.lag}` : `${l.lag}`) : ""}`).join("; ");
}

// id, name, wbs, dur, a, b, preds, resources [L, X, C], cost M NRs, crash dur, crash cost
type Row = [string, string, string, number, number, number, string, [number, number, number], number, number, number];
const ROWS: Row[] = [
  ["A10", "Detailed engineering design", "1 Pre-construction", 180, 150, 240, "", [40, 0, 0], 450, 150, 520],
  ["A20", "Land acquisition & compensation", "1 Pre-construction", 150, 120, 270, "", [20, 0, 0], 900, 130, 960],
  ["A30", "Access road (18 km)", "1 Pre-construction", 240, 200, 330, "A20", [250, 6, 0], 1200, 180, 1450],
  ["A40", "Construction power & camp", "1 Pre-construction", 120, 100, 160, "A20", [120, 2, 0], 350, 90, 420],
  ["A50", "Tender & award of civil contract", "1 Pre-construction", 120, 90, 180, "A10 SS+60", [10, 0, 0], 40, 100, 50],
  ["A60", "Contractor mobilisation", "1 Pre-construction", 60, 45, 90, "A50; A40", [150, 4, 0], 300, 45, 360],
  ["B10", "River diversion (cofferdam & tunnel)", "2 Headworks", 210, 180, 300, "A60; A30", [300, 8, 1], 1100, 170, 1350],
  ["B20", "Headworks excavation", "2 Headworks", 150, 120, 210, "B10", [200, 10, 0], 800, 120, 980],
  ["B30", "Concrete weir & undersluice", "2 Headworks", 300, 250, 420, "B20", [350, 2, 3], 2600, 240, 3050],
  ["B40", "Intake & gravel trap", "2 Headworks", 240, 200, 320, "B20 SS+60", [220, 2, 2], 1400, 200, 1650],
  ["B50", "Settling basin", "2 Headworks", 270, 230, 360, "B20", [240, 3, 2], 1700, 220, 2000],
  ["B60", "Hydromechanical works (gates)", "2 Headworks", 150, 120, 210, "B30 SS+120; B40 FF", [80, 0, 0], 950, 120, 1080],
  ["C10", "Adits & tunnel portals", "3 Waterway", 120, 100, 160, "A60; A30", [150, 4, 0], 500, 100, 590],
  ["C20", "Headrace tunnel excavation & support (8 km)", "3 Waterway", 720, 600, 960, "C10", [450, 8, 1], 7800, 560, 9400],
  ["C30", "Headrace tunnel concrete lining", "3 Waterway", 360, 300, 480, "C20 SS+240; C20 FF+90", [300, 1, 3], 3900, 280, 4550],
  ["C40", "Surge shaft", "3 Waterway", 300, 250, 400, "C10 FS+60", [150, 2, 1], 1300, 240, 1520],
  ["C50", "Penstock fabrication", "3 Waterway", 300, 250, 390, "A50 FS+90", [100, 0, 0], 2200, 240, 2520],
  ["C60", "Penstock installation", "3 Waterway", 270, 220, 360, "C50 SS+120; D10", [180, 1, 1], 1600, 210, 1880],
  ["D10", "Powerhouse excavation", "4 Powerhouse", 180, 150, 240, "A60; A30", [200, 8, 0], 700, 140, 850],
  ["D20", "Powerhouse substructure concrete", "4 Powerhouse", 240, 200, 320, "D10", [300, 1, 3], 1800, 190, 2100],
  ["D30", "Powerhouse superstructure", "4 Powerhouse", 210, 180, 280, "D20", [200, 1, 1], 1200, 170, 1380],
  ["D40", "Tailrace", "4 Powerhouse", 150, 120, 200, "D10 FS+30", [150, 3, 1], 600, 120, 700],
  ["E10", "E&M contract award & design", "5 Electromechanical", 180, 150, 240, "A10", [15, 0, 0], 60, 150, 75],
  ["E20", "Turbine & generator manufacture", "5 Electromechanical", 540, 480, 660, "E10", [0, 0, 0], 9500, 480, 10400],
  ["E30", "E&M installation", "5 Electromechanical", 360, 300, 450, "E20; D20", [180, 0, 0], 2300, 290, 2700],
  ["E40", "Switchyard", "5 Electromechanical", 180, 150, 240, "D10 FS+120; E10", [100, 1, 1], 900, 150, 1020],
  ["F10", "220 kV transmission line (40 km)", "6 Transmission", 480, 400, 660, "A20 FS+60", [250, 2, 0], 3200, 380, 3650],
  ["G10", "Waterway filling & dry tests", "7 Commissioning", 60, 45, 90, "C30; C60; B60; B50; C40", [60, 0, 0], 120, 45, 150],
  ["G20", "Wet commissioning & reliability run", "7 Commissioning", 90, 70, 130, "G10; E30; E40; F10; D30; D40", [80, 0, 0], 250, 70, 300],
  ["G30", "Commercial operation date (COD)", "7 Commissioning", 0, 0, 0, "G20", [0, 0, 0], 0, 0, 0],
];

const ACTIVITIES: Activity[] = ROWS.map(([id, name, wbs, dur, opt, pess, preds, [L, X, C], cost, crashDur, crashCost]) => ({
  id, name, wbs, dur, opt, pess, preds: parseLinks(preds),
  res: { LAB: L, EXC: X, CON: C }, cost, crashDur, crashCost,
}));

export const PM_DEFAULTS: PmInputs = {
  project: {
    title: "Construction Planning and Scheduling Report",
    name: "Sample 100 MW Run-of-River Hydropower Project",
    client: "Independent Power Producer / Employer",
    location: "Gandaki Province, Nepal",
    consultant: "Hydropower Studio",
    engineer: "",
    date: "",
    capacity: "100 MW",
  },
  settings: {
    startDate: "2026-01-04",
    daysPerWeek: 6,
    targetDays: 1450,
    indirectCost: 6,
    runs: 2000,
    seed: 20260101,
    levelPriority: "LS",
    smoothPasses: 4,
  },
  resources: [
    { id: "LAB", name: "Labour (skilled + unskilled)", unit: "persons", limit: 1500 },
    { id: "EXC", name: "Excavators / loaders", unit: "nos", limit: 26 },
    { id: "CON", name: "Concrete crews (batching + placing)", unit: "crews", limit: 8 },
  ],
  activities: ACTIVITIES,
};

export type PmSection = keyof PmInputs;

export function mergePm(p: Partial<PmInputs> | undefined): PmInputs {
  const d = structuredClone(PM_DEFAULTS);
  if (!p) return d;
  if (p.project) d.project = { ...d.project, ...p.project };
  if (p.settings) d.settings = { ...d.settings, ...p.settings };
  if (Array.isArray(p.resources) && p.resources.length) d.resources = p.resources;
  if (Array.isArray(p.activities) && p.activities.length) d.activities = p.activities;
  return d;
}
