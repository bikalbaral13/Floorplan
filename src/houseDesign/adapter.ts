/** COMPLETE PROJECT FORMAT ⇄ the Complete House Design engine.
 *
 *  The canvas plan file (./floorplan/planFormat) is a graph: nodes · segments · spaces, per level. A complete
 *  project adds PROJECT-LEVEL blocks beside them, at the top of the file (they belong to the building, not to
 *  one floor), each open-schema so a reader takes what it knows:
 *
 *    project             name, owner, address, consultant, storeys, source drawing, units …
 *    architecture        heights, grid, plinth area, stair, bylaw data
 *    site                plot, road, setbacks, plot area
 *    seismic             NBC 105 zone factor, soil type, Rμ, Ωu, importance
 *    mep                 services schedule
 *    walkthrough         walkthrough/1 — space graph, route and camera path (./floorplan/walkthrough)
 *    structure           design inputs (system, materials, covers, grid, loads) + `analysis` — the results:
 *                        seismic base shear, storey drift, MEMBER FORCES per frame and load case, and the
 *                        column / beam / slab / footing designs
 *    geotech             soil profile, SBC, founding depth, settlement limits + `results` (bearing,
 *                        settlement, straps, differential settlement, liquefaction)
 *    project_management  BOQ options, rate book, schedule start + `results` (BOQ, abstract of cost, CPM)
 *    drawings            the DWG replica (vector sheets) and the sheet index
 *
 *  The engine was written against the older "complete JSON" (everything under settings.complete); the
 *  adapter re-nests the blocks for it, and scales coordinates when the plan is not 100 px per metre (the
 *  engine reads canvas units as centimetres). Results are written back with {@link attachResults}. */
import type { CompleteJson, CLevel } from "./engine/house/inputs";
import type { HouseResult } from "./engine/house/compute";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const PROJECT_DATA_KEYS = ["project", "architecture", "site", "seismic", "mep", "structure", "geotech", "project_management", "drawings"] as const;
export const COMPLETE_PROJECT_SCHEMA = "complete-project/1";

type Plan = Record<string, any>;
const omit = (o: any, ...k: string[]) => { if (!o || typeof o !== "object") return o; const r = { ...o }; for (const x of k) delete r[x]; return r; };

/** True when a plan carries enough design data for the house engine (rooms + a structure block). */
export function isCompleteProject(plan: Plan): boolean {
  return !!(plan && (plan.structure || plan.settings?.complete) && (Array.isArray(plan.levels) || Array.isArray(plan.spaces)));
}

/** Legacy complete JSON (settings.complete) → complete project format. Geometry is untouched. */
export function fromLegacyComplete(cj: Plan): Plan {
  const c = cj.settings?.complete ?? {};
  const hd = c.houseDesign ?? {};
  const out: Plan = { ...cj, settings: omit(cj.settings, "complete") };
  out.settings.format = COMPLETE_PROJECT_SCHEMA;
  out.project = { ...(c.project ?? {}), from: c.from, generated: c.generated, tool: c.tool, units: c.units };
  for (const k of ["architecture", "site", "seismic", "mep"]) if (c[k]) out[k] = c[k];
  out.structure = { ...(c.structure ?? {}), ...(hd.loads ? { loads: hd.loads } : {}) };
  out.geotech = { ...(c.geotech ?? {}), ...(hd.soil ? { soil: hd.soil } : {}), ...(hd.gwt != null ? { gwtM: hd.gwt } : {}), ...(hd.settleAllow != null ? { settleAllowMm: hd.settleAllow } : {}), ...(hd.diffAllow != null ? { angularDistortion: hd.diffAllow } : {}), ...(hd.FSbearing != null ? { FSbearing: hd.FSbearing } : {}) };
  out.project_management = { boq: hd.boq ?? { overheadPct: 15, vatPct: 13, contingencyPct: 3, tileWastage: 5 }, rates: { book: "Kaski district rate 2081/82", overrides: hd.rateOverrides ?? {} }, schedule: { daysPerWeek: 6 } };
  if (c.drawingSet || c.drawingIndex) out.drawings = { dwg: c.drawingSet, index: c.drawingIndex };
  return out;
}

/** Complete project → the engine's complete JSON. Accepts a legacy file too (passed through). */
export function toEngineJson(plan: Plan): CompleteJson {
  if (plan.settings?.complete && !plan.structure) return plan as CompleteJson;
  const ppm = Number(plan.settings?.pixelsPerMeter) || 100;
  const k = 100 / ppm;
  const scaleLevel = (l: any): CLevel => ({
    ...l,
    nodes: (l.nodes ?? []).map((n: any) => (k === 1 ? n : { ...n, x: n.x * k, y: n.y * k })),
    segments: l.segments ?? [], spaces: l.spaces ?? [],
  });
  const levels: CLevel[] = Array.isArray(plan.levels) && plan.levels.length
    ? plan.levels.map(scaleLevel)
    : [scaleLevel({ id: "L0", name: "Ground floor", elevation: 0, height: plan.architecture?.heights?.floorM ?? 3, nodes: plan.nodes, segments: plan.segments, spaces: plan.spaces })];
  const g = plan.geotech ?? {}, pm = plan.project_management ?? {}, st = plan.structure ?? {};
  const houseDesign: Record<string, unknown> = {};
  if (Array.isArray(g.soil) && g.soil.length) houseDesign.soil = g.soil;
  if (g.gwtM != null) houseDesign.gwt = g.gwtM;
  if (g.settleAllowMm != null) houseDesign.settleAllow = g.settleAllowMm;
  if (g.angularDistortion != null) houseDesign.diffAllow = g.angularDistortion;
  if (g.FSbearing != null) houseDesign.FSbearing = g.FSbearing;
  if (st.loads) houseDesign.loads = st.loads;
  if (pm.boq) houseDesign.boq = pm.boq;
  if (pm.rates?.overrides) houseDesign.rateOverrides = pm.rates.overrides;
  const p = plan.project ?? {};
  return {
    schemaVersion: plan.schemaVersion,
    settings: {
      northbearing: plan.settings?.northbearing ?? 0,
      source: plan.settings?.source,
      complete: {
        from: p.from, generated: p.generated, tool: p.tool, units: p.units,
        project: omit(p, "from", "generated", "tool", "units"),
        architecture: plan.architecture, site: plan.site, seismic: plan.seismic, mep: plan.mep,
        structure: omit(st, "analysis", "loads"),
        geotech: omit(g, "results", "soil", "gwtM", "settleAllowMm", "angularDistortion", "FSbearing"),
        drawingSet: plan.drawings?.dwg, drawingIndex: plan.drawings?.index,
        houseDesign,
      },
    },
    layers: plan.layers,
    levels,
  } as CompleteJson;
}

const r = (v: number, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);
const rr = (a: number[], d = 3) => a.map((v) => r(v, d));

/** The engine's results, reduced to plain JSON that is worth keeping in the file. */
export function resultsOf(res: HouseResult) {
  const S = res.found.struct, m = S.model;
  const analysis = {
    engine: "Complete House Design (NBC 105:2020 / IS 456:2000), direct stiffness plane frames",
    summary: S.summary,
    seismic: m.seismic,
    driftX: S.driftX, driftY: S.driftY,
    grid: { xs: m.xs, ys: m.ys, levels: m.levels },
    combos: ["DL", "LL", "EQX", "EQY"],
    /** Member forces per frame, per load case: axial N (kN), and M / V (kNm / kN) sampled at 11 stations. */
    memberForces: m.analyses.map((a) => ({
      frame: a.def.name,
      dir: a.def.dir,
      members: a.members.map((mem, i) => ({
        kind: mem.kind, ref: mem.ref, storey: mem.storey, level: mem.level, L: r(mem.L),
        cases: Object.fromEntries((["DL", "LL", "EQX", "EQY"] as const).map((c) => {
          const s = a.cases[c].samples[i];
          return [c, { N: r(s.N, 2), M: rr(s.M, 2), V: rr(s.V, 2) }];
        })),
      })),
    })),
    beams: S.beams, columns: S.columns, slabs: S.slabs, stair: S.stair, footings: S.footings,
  };
  const f = res.found;
  const geo = { sbcGiven: f.sbcGiven, sbcDesign: f.sbcDesign, Df: f.Df, ok: f.ok, footings: f.rows, iterations: f.iterations, methods: f.methods, straps: f.straps, differential: f.diff, liquefaction: f.liq };
  const b = res.boq;
  const pm = {
    boq: { items: b.items.map((i) => ({ code: i.code, group: i.group, desc: i.desc, unit: i.unit, qty: r(i.qty), rate: r(i.rate, 2), amount: Math.round(i.amount), basis: i.basis })), groups: b.groups, subtotal: b.subtotal, contingency: b.contingency, vat: b.vat, total: b.total, perSqft: b.perSqft, perM2: b.perM2, materials: b.materials, source: b.source },
    rates: b.resources,
    schedule: { summary: res.pm.summary, activities: res.pm.cpm.rows.map((x) => ({ id: x.a.id, name: x.a.name, wbs: x.a.wbs, d: x.d, ES: x.ES, EF: x.EF, LS: x.LS, LF: x.LF, TF: x.TF, critical: x.critical })) },
  };
  return { analysis, geo, pm, arch: { areas: res.arch.areas, ok: res.arch.ok }, summary: res.summary };
}

/** Write the results into the project blocks (structure.analysis, geotech.results, project_management.results). */
export function attachResults(plan: Plan, res: HouseResult): Plan {
  const o = resultsOf(res);
  return {
    ...plan,
    structure: { ...(plan.structure ?? {}), analysis: o.analysis },
    geotech: { ...(plan.geotech ?? {}), results: o.geo },
    project_management: { ...(plan.project_management ?? {}), results: o.pm },
    architecture: { ...(plan.architecture ?? {}), results: o.arch },
    project: { ...(plan.project ?? {}), summary: o.summary },
  };
}
