// Construction programme for the house, fed to the Project Management engine (CPM · PERT · Monte Carlo ·
// resource smoothing / levelling · crashing). Every activity's work content comes from the BOQ: labour-days
// (skilled + unskilled from the rate analysis) ÷ crew size = duration; BOQ amount = direct cost. Curing and
// formwork-striking waits are lags on the links.

import { PM_DEFAULTS, type Activity, type PmInputs } from "../pm/inputs";
import type { BoqItem, BoqResult } from "./boq";
import type { HouseModel } from "./model";

interface Pkg { id: string; name: string; wbs: string; match: (i: BoqItem) => boolean; crew: number; preds: string; min?: number; fixedCost?: number; extraDays?: number }

export function buildSchedule(h: HouseModel, boq: BoqResult, startDate = new Date().toISOString().slice(0, 10)): PmInputs {
  const has = (re: RegExp) => (i: BoqItem) => re.test(i.desc);
  const P: Pkg[] = [
    { id: "A10", name: "Mobilisation, site clearing & layout", wbs: "1 Preliminaries", match: () => false, crew: 4, preds: "", min: 3, fixedCost: 25000 },
    { id: "A20", name: "Excavation for footings & strap beams", wbs: "2 Substructure", match: (i) => /^1 /.test(i.group) && /Earthwork in excavation/.test(i.desc), crew: 10, preds: "A10" },
    { id: "A30", name: "Soling & PCC under footings", wbs: "2 Substructure", match: (i) => /^1 /.test(i.group) && /soling|PCC/i.test(i.desc), crew: 8, preds: "A20 SS+2" },
    { id: "A40", name: "Footings, pedestals & strap beams (steel, formwork, concrete)", wbs: "2 Substructure", match: (i) => has(/footing|pedestal|strap/i)(i) && /^(2|3|4) /.test(i.group), crew: 10, preds: "A30" },
    { id: "A50", name: "Backfilling & plinth masonry", wbs: "2 Substructure", match: (i) => /Backfilling|plinth \/ foundation/.test(i.desc), crew: 8, preds: "A40 FS+3" },
    { id: "A60", name: "Plinth tie beams", wbs: "2 Substructure", match: (i) => has(/tie beam|tie & strap/i)(i), crew: 8, preds: "A50" },
    { id: "A70", name: "Plinth filling, soling & PCC floor base", wbs: "2 Substructure", match: (i) => /Earth filling in plinth|soling 6|3" floor base/.test(i.desc), crew: 8, preds: "A60 FS+3" },
    { id: "B10", name: "Ground-floor columns", wbs: "3 Superstructure", match: (i) => /columns/i.test(i.desc) && !/pedestal/i.test(i.desc) && /^(2|3|4) /.test(i.group) || /Formwork to columns/.test(i.desc), crew: 8, preds: "A60 FS+2" },
    { id: "B20", name: "Brick masonry to beam soffit", wbs: "3 Superstructure", match: (i) => /superstructure, 9"|partition/.test(i.desc), crew: 12, preds: "B10 FS+2" },
    { id: "B30", name: "Beams, roof slab & stair (steel, formwork, concrete)", wbs: "3 Superstructure", match: (i) => /beams below|roof slab|stair|slabs \(|beams B1|Formwork to beams|slab soffit|lintel/i.test(i.desc) && /^(2|3|4) /.test(i.group), crew: 14, preds: "B20" },
    { id: "B40", name: "Curing & de-shuttering of roof slab", wbs: "3 Superstructure", match: () => false, crew: 2, preds: "B30", min: 14, fixedCost: 12000 },
    { id: "B50", name: "Stair cover, parapet & roof water-proofing", wbs: "3 Superstructure", match: (i) => /parapet|IPS 1:2:4/.test(i.desc), crew: 8, preds: "B40" },
    { id: "C10", name: "Electrical conduits & plumbing rough-in", wbs: "4 Services", match: (i) => /^(8|10) /.test(i.group) && !/commode|basin|sink|trap|tank/i.test(i.desc), crew: 4, preds: "B40" },
    { id: "C20", name: "Septic tank, soak pit & inspection chambers", wbs: "4 Services", match: (i) => /^9 /.test(i.group) || /inspection chamber/i.test(i.desc), crew: 6, preds: "A70" },
    { id: "D10", name: "Internal & external plaster, ceiling plaster", wbs: "5 Finishes", match: (i) => /plaster/i.test(i.desc) && /^6 /.test(i.group), crew: 12, preds: "C10 SS+5; B50" },
    { id: "D20", name: "Door & window frames, shutters, grills", wbs: "5 Finishes", match: (i) => /^7 /.test(i.group), crew: 4, preds: "D10 SS+5" },
    { id: "D30", name: "Flooring & tiling", wbs: "5 Finishes", match: (i) => /floor tiles/.test(i.desc), crew: 6, preds: "D10" },
    { id: "D40", name: "Sanitary fixtures, OHT & electrical fittings", wbs: "5 Finishes", match: (i) => /commode|basin|sink|trap|tank|point wiring|distribution board|Earthing/i.test(i.desc), crew: 4, preds: "D30; C20" },
    { id: "D50", name: "Putty, primer & painting", wbs: "5 Finishes", match: (i) => /emulsion/.test(i.desc), crew: 8, preds: "D30; D20" },
    { id: "E10", name: "Cleaning, testing, snag list & handover", wbs: "6 Completion", match: () => false, crew: 4, preds: "D40; D50", min: 3, fixedCost: 15000 },
  ];
  const used = new Set<BoqItem>();
  const acts: Activity[] = P.map((p) => {
    const its = boq.items.filter((i) => !used.has(i) && p.match(i));
    its.forEach((i) => used.add(i));
    const ld = its.reduce((a, i) => a + i.qty * ((i.norm.skilled ?? 0) + (i.norm.unskilled ?? 0)), 0);
    const cost = its.reduce((a, i) => a + i.amount, 0) + (p.fixedCost ?? 0);
    const dur = Math.max(p.min ?? 1, Math.ceil(ld / p.crew));
    const crash = Math.max(1, Math.ceil(dur * (p.min && !its.length ? 1 : 0.7)));
    return {
      id: p.id, name: p.name, wbs: p.wbs, dur, opt: Math.max(1, Math.floor(dur * 0.8)), pess: Math.ceil(dur * 1.5), preds: parse(p.preds),
      res: { LAB: its.length ? p.crew : Math.min(p.crew, 4), MAS: /masonry|plaster|tiling/i.test(p.name) ? Math.ceil(p.crew / 3) : 0, CON: /concrete|slab|footings|columns|tie beams/i.test(p.name) ? 1 : 0 },
      cost: cost / 1e6, crashDur: crash, crashCost: (cost * (crash < dur ? 1.18 : 1)) / 1e6,
      workItems: its.map((i) => i.code),
    } as Activity & { workItems: string[] };
  });
  // anything left over joins the nearest-group activity (keeps total cost = BOQ subtotal)
  const left = boq.items.filter((i) => !used.has(i));
  for (const i of left) { const a = acts.find((q) => q.id === "D40")!; a.cost += i.amount / 1e6; a.crashCost += i.amount / 1e6; }
  const total = acts.reduce((a, q) => a + q.dur, 0);
  return {
    ...structuredClone(PM_DEFAULTS),
    project: { title: "CONSTRUCTION PROGRAMME AND PROJECT MANAGEMENT REPORT", name: h.meta.project?.name ?? "House", client: h.meta.project?.owner ?? "", location: h.meta.project?.address ?? "", consultant: h.meta.project?.consultant ?? "", engineer: h.meta.project?.designer ?? "", date: "", capacity: `${(h.meta.architecture?.plinthAreaSqft ?? 0)} sq ft` },
    settings: { startDate, daysPerWeek: 6, targetDays: Math.ceil(total * 0.75), indirectCost: 0.004, runs: 2000, seed: 7, levelPriority: "LS", smoothPasses: 3 },
    resources: [
      { id: "LAB", name: "Labour gang (skilled + unskilled)", unit: "persons", limit: 16 },
      { id: "MAS", name: "Mason teams", unit: "teams", limit: 4 },
      { id: "CON", name: "Concrete mixer + vibrator set", unit: "sets", limit: 1 },
    ],
    activities: acts,
  };
}

function parse(s: string) {
  return s.split(";").map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^(\w+)\s*(FS|SS|FF|SF)?\s*([+-]\d+)?$/)!;
    return { pred: m[1], type: (m[2] ?? "FS") as "FS" | "SS" | "FF" | "SF", lag: m[3] ? Number(m[3]) : 0 };
  });
}
