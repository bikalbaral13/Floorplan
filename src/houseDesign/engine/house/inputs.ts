// Complete House Design — the input IS the "complete JSON" of a house (the BuilderPluss canvas schema:
// settings.complete {project, architecture, structure, geotech, seismic, site, mep, drawingSet} + levels of
// nodes / segments / spaces with parametric-object attachments). Canvas units are cm (y down), object
// params metres. An optional `settings.complete.houseDesign` block overrides the engineering assumptions.

// (vendored from Hydropower src/house; the bundled Kabita default is not shipped here)

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface CAttachment { id: string; objectId: string; objectPath?: string; params?: Record<string, any>; t?: number }
export interface CNode { id: string; x: number; y: number; layer?: string; attachments?: CAttachment[] }
export interface CSegment { id: string; fromNodeId: string; toNodeId: string; layer?: string; thickness?: number; label?: string; attachments?: CAttachment[]; isObjectOpening?: boolean }
export interface CSpace { id: string; nodeIds: string[]; layer?: string; label?: string; roomTag?: string; use?: string; attachments?: CAttachment[] }
export interface CLevel { id: string; name: string; elevation: number; height: number; nodes: CNode[]; segments: CSegment[]; spaces: CSpace[] }

export interface HouseDesignOptions {
  soil: { name: string; thick: number; gamma: number; gammaSat: number; c: number; phi: number; E: number; nu: number; N: number; FC: number }[];
  gwt: number; // m below GL
  settleAllow: number; // mm, isolated footings
  diffAllow: number; // angular distortion limit (1/n)
  FSbearing: number;
  loads: { floorFinish: number; partition: number; llRoom: number; llRoof: number; llStair: number };
  boq: { overheadPct: number; vatPct: number; contingencyPct: number; tileWastage: number };
  rateOverrides: Record<string, number>; // resource key → NPR
}

export interface CompleteJson {
  schemaVersion?: number;
  settings: { northbearing?: number; keywords?: string; source?: any; complete: any & { houseDesign?: Partial<HouseDesignOptions> } };
  layers?: any[];
  levels: CLevel[];
  [k: string]: unknown;
}

export const HOUSE_OPTION_DEFAULTS: HouseDesignOptions = {
  // Pokhara valley: a thin fill over the Pokhara (Ghachok) formation — gravelly silty sand / conglomeratic fan
  // deposit. Parameters are typical values, not a site investigation; the drawing adopts SBC = 140 kN/m².
  soil: [
    { name: "Fill / brown silty topsoil", thick: 0.6, gamma: 17, gammaSat: 18, c: 5, phi: 26, E: 8, nu: 0.3, N: 6, FC: 45 },
    { name: "Medium dense gravelly silty sand (SM-GM)", thick: 4.4, gamma: 18.5, gammaSat: 19.5, c: 2, phi: 30, E: 22, nu: 0.3, N: 16, FC: 22 },
    { name: "Dense sandy gravel / weak conglomerate", thick: 6, gamma: 20, gammaSat: 21, c: 0, phi: 36, E: 60, nu: 0.28, N: 38, FC: 8 },
  ],
  gwt: 6,
  settleAllow: 50,
  diffAllow: 500,
  FSbearing: 3,
  loads: { floorFinish: 1.5, partition: 1.0, llRoom: 2, llRoof: 1.5, llStair: 3 },
  boq: { overheadPct: 15, vatPct: 13, contingencyPct: 3, tileWastage: 5 },
  rateOverrides: {},
};

export const HOUSE_DEFAULTS: CompleteJson = { settings: { complete: {} }, levels: [] };

export function houseOptions(cj: CompleteJson): HouseDesignOptions {
  const o = cj.settings?.complete?.houseDesign ?? {};
  const d = structuredClone(HOUSE_OPTION_DEFAULTS);
  return {
    ...d, ...o,
    soil: Array.isArray(o.soil) && o.soil.length ? o.soil : d.soil,
    loads: { ...d.loads, ...(o.loads ?? {}) },
    boq: { ...d.boq, ...(o.boq ?? {}) },
    rateOverrides: { ...(o.rateOverrides ?? {}) },
  };
}

/** Accept any object that looks like a complete JSON; fill the few required holes. */
export function mergeHouse(raw: unknown): CompleteJson {
  const r = raw as Partial<CompleteJson> | undefined;
  if (!r || typeof r !== "object" || !Array.isArray(r.levels)) return structuredClone(HOUSE_DEFAULTS);
  return { ...r, settings: { ...(r.settings ?? {}), complete: r.settings?.complete ?? {} }, levels: r.levels } as CompleteJson;
}

export function houseChecks(x: CompleteJson): string[] {
  const out: string[] = [];
  if (!x.levels?.length) out.push("levels[] is empty.");
  const g = x.levels?.find((l) => Math.abs(l.elevation) < 1e-6 && l.spaces?.some((s) => s.layer === "space"));
  if (!g) out.push("No ground level (elevation 0) with room spaces (layer 'space').");
  for (const l of x.levels ?? []) {
    const ids = new Set(l.nodes.map((n) => n.id));
    for (const s of l.segments) if (!ids.has(s.fromNodeId) || !ids.has(s.toNodeId)) { out.push(`Level ${l.id}: segment ${s.id} refers to a missing node.`); break; }
    for (const s of l.spaces) if (s.nodeIds.some((i) => !ids.has(i))) { out.push(`Level ${l.id}: space ${s.id} refers to a missing node.`); break; }
  }
  if (!x.settings?.complete?.structure) out.push("settings.complete.structure is missing — columns/beams will be derived from the canvas objects only.");
  return out;
}
