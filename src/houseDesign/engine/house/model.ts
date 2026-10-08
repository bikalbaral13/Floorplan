// Complete JSON → one typed house model (metres, plan frame x →, y ↓ as on the canvas) plus the inputs of the
// structural and geotechnical engines. Nothing here is specific to one house: walls, openings, rooms, columns,
// beams, footings, slabs, stair and services are read from the canvas objects; settings.complete adds the
// design data (materials, SBC, seismic) the canvas cannot carry.

import type { CAttachment, CLevel, CompleteJson, CSegment, HouseDesignOptions } from "./inputs";
import { houseOptions } from "./inputs";
import { STRUCT_DEFAULTS, type PanelDef, type PanelUse, type StructInputs } from "../structural/inputs";
import type { GeoInputs, Layer } from "../geotech/inputs";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type P2 = [number, number];
export interface Wall { id: string; level: string; a: P2; b: P2; t: number; h: number; kind: "wall" | "door" | "window" | "opening"; mark?: string; label?: string; width: number; sill?: number; lintel?: number; leaves?: string }
export interface Room { id: string; level: string; label: string; tag: string; use: string; poly: P2[]; area: number; perimeter: number; wet: boolean }
export interface Col { id: string; level: string; x: number; y: number; b: number; d: number; h: number; base: number; bars?: number; label: string }
export interface BeamM { id: string; level: string; layer: string; a: P2; b: P2; w: number; d: number; L: number; label: string }
export interface FootM { id: string; x: number; y: number; B: number; L: number; rcc: number; frustumH: number; pcc: number; soling: number; label: string; eccentric: boolean }
export interface SlabM { id: string; level: string; poly: P2[]; area: number; t: number; label: string }
export interface Fixture { level: string; kind: string; x: number; y: number; label: string }
export interface Run { level: string; layer: string; kind: string; dia: number; L: number; label: string }
export interface Opening { mark: string; kind: "door" | "window" | "opening"; w: number; h: number; sill: number; level: string; wallT: number; label: string }

export interface HouseModel {
  cj: CompleteJson;
  opt: HouseDesignOptions;
  meta: any;
  levels: { id: string; name: string; elevation: number; height: number }[];
  ground: string;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  columns: Col[];
  beams: BeamM[];
  footings: FootM[];
  slabs: SlabM[];
  stair: any | null;
  fixtures: Fixture[];
  runs: Run[];
  site: { plot: P2[]; road: P2[][]; setback: P2[]; row: P2[][]; sanitation: Fixture[] };
  outline: { x0: number; y0: number; x1: number; y1: number };
  grid: { x: number[]; y: number[]; xNames: string[]; yNames: string[] };
  northBearing: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
export const polyArea = (p: P2[]) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;
export const polyPerim = (p: P2[]) => p.reduce((s, q, i) => s + Math.hypot(p[(i + 1) % p.length][0] - q[0], p[(i + 1) % p.length][1] - q[1]), 0);
const att = (a: CAttachment[] | undefined, re: RegExp) => (a ?? []).find((q) => re.test(q.objectId));

export function buildHouseModel(cj: CompleteJson): HouseModel {
  const opt = houseOptions(cj);
  const meta = cj.settings?.complete ?? {};
  const levels = [...cj.levels].sort((a, b) => a.elevation - b.elevation);
  const ground = (levels.find((l) => Math.abs(l.elevation) < 1e-6 && l.spaces.some((s) => s.layer === "space")) ?? levels[0]).id;
  const walls: Wall[] = [], rooms: Room[] = [], columns: Col[] = [], beams: BeamM[] = [], footings: FootM[] = [], slabs: SlabM[] = [];
  const fixtures: Fixture[] = [], runs: Run[] = [], openings: Opening[] = [];
  let stair: any = null;
  const site = { plot: [] as P2[], road: [] as P2[][], setback: [] as P2[], row: [] as P2[][], sanitation: [] as Fixture[] };

  for (const L of levels) {
    const N = new Map(L.nodes.map((n) => [n.id, n]));
    const P = (id: string): P2 => { const n = N.get(id)!; return [r3(n.x / 100), r3(n.y / 100)]; };
    for (const s of L.segments) {
      const A = N.get(s.fromNodeId), B = N.get(s.toNodeId);
      if (!A || !B) continue;
      const a = P(s.fromNodeId), b = P(s.toNodeId), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const layer = s.layer ?? "";
      if (["wall", "door", "window", "opening"].includes(layer)) {
        const w = att(s.attachments, /^wall-/)?.params ?? {};
        const d = att(s.attachments, /^door-/)?.params, win = att(s.attachments, /^window-/)?.params, op = att(s.attachments, /^opening-/)?.params;
        const t = w.thickness ?? (op?.thickness ?? (s.thickness ?? 23) / 100);
        const kind = (d ? "door" : win ? "window" : op ? "opening" : "wall") as Wall["kind"];
        const mark = d?.mark ?? win?.mark ?? (s.label ?? "").split(" ")[0];
        walls.push({ id: s.id, level: L.id, a, b, t, h: w.height ?? L.height, kind, mark: kind === "wall" ? undefined : mark, label: s.label, width: len, sill: win?.sillHeight, lintel: d?.lintelHeight ?? win?.lintelHeight ?? op?.lintelHeight, leaves: d?.leaves });
        if (kind !== "wall") openings.push({ mark: kind === "opening" ? "OP" : mark, kind, w: len, h: (d?.lintelHeight ?? win?.lintelHeight ?? 2.13) - (win?.sillHeight ?? 0), sill: win?.sillHeight ?? 0, level: L.id, wallT: t, label: s.label ?? "" });
        continue;
      }
      const beamP = att(s.attachments, /^beam-/)?.params;
      if (beamP && /struct-(beam|strap)/.test(layer)) { beams.push({ id: s.id, level: L.id, layer, a, b, w: beamP.width, d: beamP.depth, L: len, label: s.label ?? "" }); continue; }
      const pipe = att(s.attachments, /^(pipe|conduit|duct|refrigerant)-/);
      if (pipe) runs.push({ level: L.id, layer, kind: pipe.objectId.replace("-with-math", ""), dia: pipe.params?.diameter ?? 0, L: len, label: s.label ?? "" });
      if (layer === "site-setback" && s.fromNodeId !== s.toNodeId) { if (!site.setback.length) site.setback.push(a); site.setback.push(b); }
    }
    for (const n of L.nodes) {
      const x = r3(n.x / 100), y = r3(n.y / 100);
      for (const a of n.attachments ?? []) {
        const p = a.params ?? {};
        const label = L.segments.find((s) => s.fromNodeId === n.id && s.toNodeId === n.id)?.label ?? a.objectId;
        if (/^column-/.test(a.objectId)) columns.push({ id: `${L.id}:${columns.length + 1}`, level: L.id, x, y, b: p.length ?? 0.3, d: p.breadth ?? 0.3, h: p.height ?? L.height, base: p.base ?? 0, bars: p.mainBars, label });
        else if (/^footing-/.test(a.objectId)) footings.push({ id: `F${footings.length + 1}`, x, y, B: p.baseWidth, L: p.baseDepth, rcc: p.rccThickness ?? 0.3, frustumH: p.type === "Spread" ? 0 : p.frustumHeight ?? 0, pcc: p.pccThickness ?? 0.075, soling: p.solingThickness ?? 0.15, label, eccentric: /eccentric|F2/i.test(label) });
        else if (/^staircase-/.test(a.objectId)) stair = { ...p, x, y, level: L.id, label };
        else if (/^(toilet|washbasin|kitchen-sink|floor-drain|water-heater|light|ceiling-fan|exhaust-fan|socket-outlet|switch-plate|distribution-board|tank|inspection-chamber|septic-tank|well)-/.test(a.objectId)) {
          const f = { level: L.id, kind: a.objectId.replace("-with-math", ""), x, y, label };
          if (n.layer === "site-sanitation") site.sanitation.push(f); else fixtures.push(f);
          (f as any).params = p;
        }
      }
    }
    for (const s of L.spaces) {
      const poly = s.nodeIds.map(P);
      const layer = s.layer ?? "";
      if (layer === "space") {
        const label = (s.label ?? "").split("\n")[0].trim();
        rooms.push({ id: s.id, level: L.id, label, tag: s.roomTag ?? label, use: s.use ?? label, poly, area: polyArea(poly), perimeter: polyPerim(poly), wet: /T\/B|TOILET|BATH|WC|KITCHEN/i.test(label) });
      } else if (layer === "struct-slab") {
        const sp = att(s.attachments, /^slab-/)?.params;
        if (sp) slabs.push({ id: s.id, level: L.id, poly, area: polyArea(poly), t: (sp.thickness ?? 125) / 1000, label: s.label ?? "" });
      } else if (layer === "site-boundary" && poly.length >= 3 && !site.plot.length) site.plot = poly;
      else if (layer === "site-road") (/ROW|widening/i.test(s.label ?? "") ? site.row : site.road).push(poly);
    }
  }

  const gw = walls.filter((w) => w.level === ground);
  const xs = gw.flatMap((w) => [w.a[0] - w.t / 2, w.b[0] - w.t / 2, w.a[0] + w.t / 2, w.b[0] + w.t / 2]);
  const ys = gw.flatMap((w) => [w.a[1] - w.t / 2, w.b[1] - w.t / 2, w.a[1] + w.t / 2, w.b[1] + w.t / 2]);
  const oi = meta.architecture?.outline_in;
  const outline = oi ? { x0: oi.x0 * 0.0254, y0: oi.y0 * 0.0254, x1: oi.x1 * 0.0254, y1: oi.y1 * 0.0254 } : { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const gr = meta.architecture?.grid ?? meta.structure?.grid;
  const grid = gr?.x_m
    ? { x: gr.x_m, y: gr.y_m, xNames: gr.x_names, yNames: gr.y_names }
    : gr?.x_cm
      ? { x: gr.x_cm.map((v: number) => v / 100), y: gr.y_cm.map((v: number) => v / 100), xNames: gr.x_cm.map((_: number, i: number) => String(i + 1)), yNames: gr.y_cm.map((_: number, i: number) => String.fromCharCode(65 + i)) }
      : (() => {
        const cc = columns.filter((c) => c.level === ground);
        const ux = [...new Set(cc.map((c) => c.x))].sort((a, b) => a - b), uy = [...new Set(cc.map((c) => c.y))].sort((a, b) => a - b);
        return { x: ux, y: uy, xNames: ux.map((_, i) => String(i + 1)), yNames: uy.map((_, i) => String.fromCharCode(65 + i)) };
      })();
  return {
    cj, opt, meta, levels: levels.map((l) => ({ id: l.id, name: l.name, elevation: l.elevation, height: l.height })), ground,
    walls, openings, rooms, columns, beams, footings, slabs, stair, fixtures, runs, site, outline, grid,
    northBearing: cj.settings?.northbearing ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Structural engine input. The engine names bays with letters along its x axis and numbers along y; when the
// drawing names rows with letters (A, B, … down the plan) and lines with numbers, the drawing's y axis becomes
// the engine's x axis, so every column / beam label in the analysis reads exactly as on the drawings.
// ---------------------------------------------------------------------------------------------------------
export interface StructMap { swap: boolean; engineToDrawing: (gi: number, gj: number) => string }

export function toStructInputs(h: HouseModel): { inp: StructInputs; map: StructMap } {
  const { grid, meta, opt } = h;
  const lettersOnY = /^[A-Z]$/.test(grid.yNames[0] ?? "");
  const ex = lettersOnY ? grid.y : grid.x, ey = lettersOnY ? grid.x : grid.y;
  const spans = (v: number[]) => v.slice(1).map((q, i) => +(q - v[i]).toFixed(4));
  // storeys = levels from the ground up that carry rooms (the top one may be a terrace with a stair cover)
  const storeyLv = h.levels.filter((l) => l.elevation >= -1e-6 && h.rooms.some((r) => r.level === l.id));
  const cellUse = (i: number, j: number, k: number): PanelUse => {
    const cx = (ex[i] + ex[i + 1]) / 2, cy = (ey[j] + ey[j + 1]) / 2;
    const [px, py] = lettersOnY ? [cy, cx] : [cx, cy];
    const inside = (poly: P2[]) => {
      let c = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const [xa, ya] = poly[a], [xb, yb] = poly[b];
        if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) c = !c;
      }
      return c;
    };
    const here = storeyLv[k];
    const above = storeyLv[k + 1];
    const roomsHere = h.rooms.filter((r) => r.level === here.id && inside(r.poly));
    if (!roomsHere.length) return "none";
    const isStair = roomsHere.some((r) => /STAIR(?!.*COVER)/i.test(r.label));
    const open = roomsHere.every((r) => /TERRACE|OPEN/i.test(r.label));
    if (open) return "none";
    if (isStair && above && h.rooms.some((r) => r.level === above.id && inside(r.poly) && /STAIR/i.test(r.label))) return "stair";
    return "slab";
  };
  const panels: PanelDef[] = [];
  for (let i = 0; i < ex.length - 1; i++) for (let j = 0; j < ey.length - 1; j++) {
    const use = storeyLv.map((_, k) => cellUse(i, j, k));
    if (use.every((u) => u === "none")) continue;
    const name = lettersOnY ? `${grid.yNames[i]}${grid.xNames[j]}–${grid.yNames[i + 1]}${grid.xNames[j + 1]}` : `${grid.xNames[i]}${grid.yNames[j]}–${grid.xNames[i + 1]}${grid.yNames[j + 1]}`;
    panels.push({ i, j, label: `Bay ${name}`, use });
  }
  const st = meta.structure ?? {};
  const col = h.columns.find((c) => c.level === h.ground);
  const beam = h.beams.find((b) => b.layer === "struct-beam" && b.level === h.ground);
  const tie = h.beams.find((b) => /TB|tie/i.test(b.label));
  const slab = h.slabs.find((s) => s.level !== h.ground && s.t > 0.09);
  const fck = Number(String(st.materials?.concrete ?? "M20").match(/M(\d+)/)?.[1] ?? 20);
  const fy = Number(String(st.materials?.steel ?? "Fe500").match(/(\d{3})/)?.[1] ?? 500);
  const seis = meta.seismic ?? {};
  const Znbc = seis.zoneFactorZ ?? 0.3, Rmu = seis.ductilityRmu ?? 4, Om = seis.overstrengthOmega ?? 1.5;
  const sto = h.levels.filter((l) => storeyLv.some((s) => s.id === l.id));
  const stairP = h.stair ?? {};
  const soilClass = String(seis.soilType ?? "C").toUpperCase();
  const inp: StructInputs = {
    ...structuredClone(STRUCT_DEFAULTS),
    project: {
      title: "STRUCTURAL ANALYSIS AND DESIGN REPORT", name: meta.project?.name ?? "Residential building", client: meta.project?.owner ?? "",
      location: meta.project?.address ?? "", buildingType: st.system ?? "RC special moment-resisting frame", plinthArea: meta.architecture?.plinthAreaSqft ? `${meta.architecture.plinthAreaSqft} sq. ft` : "",
      storeys: meta.project?.storeyNote ? `${meta.project.storeys} (${meta.project.storeyNote.split(";")[0]})` : String(storeyLv.length), consultant: meta.project?.consultant ?? "", engineer: meta.project?.designer ?? "", date: "",
    },
    grid: {
      xSpans: spans(ex), ySpans: spans(ey), storeyHeight: sto.map((l) => l.height), levelNames: sto.map((l, k) => (k === sto.length - 1 && sto.length > 1 ? "Stair-cover roof" : k === 0 ? "Roof / terrace" : l.name)),
      panels,
    },
    sections: {
      colB: (col?.b ?? 0.3) * 1000, colD: (col?.d ?? 0.3) * 1000, beamB: (beam?.w ?? 0.23) * 1000, beamD: (beam?.d ?? 0.35) * 1000, slab: (slab?.t ?? 0.125) * 1000,
      tieB: (tie?.w ?? 0.23) * 1000, tieD: (tie?.d ?? 0.3) * 1000, colCover: st.materials?.cover?.column ?? 40, beamCover: st.materials?.cover?.beam ?? 25, slabCover: st.materials?.cover?.slab ?? 20,
    },
    materials: { fck, fy, fyStirrup: fy, gammaRC: 25, gammaBrick: 19.2 },
    loads: {
      ...opt.loads, wallExt: 230, wallInt: Math.round(Math.min(...h.walls.filter((w) => w.kind === "wall" && w.level === h.ground).map((w) => w.t)) * 1000) || 115, openings: 0.3,
      parapetH: meta.architecture?.heights?.parapetM ?? 0.9, parapetT: 115, llMassFactor: 0.25,
    },
    // NBC 105:2020 → engine form Ah = (Z/2)(I/R)(Sa/g): with Z_e = 2·Z and R_e = Rμ·Ωu, Ah = Z·I·Ch(T)/(Rμ·Ωu) at the plateau
    seismic: { Z: 2 * Znbc, I: seis.importanceI ?? 1, R: Rmu * Om, soil: soilClass === "A" || soilClass === "B" ? 1 : soilClass === "D" ? 3 : 2, periodMode: "code", userT: 0.3, ecc: 0.05, driftLimit: 0.0025 },
    stair: {
      riser: (stairP.riser ?? 0.17) * 1000, tread: (stairP.tread ?? 0.25) * 1000, risersPerFlight: Math.round((stairP.steps ?? 16) / (/U-shape/.test(stairP.config ?? "") ? 2 : 1)),
      waist: (stairP.waist ?? 0.125) * 1000, finish: 25, landing1AB: stairP.landingWidth ?? 1.0, flightAB: ((stairP.steps ?? 16) / 2 - 1) * (stairP.tread ?? 0.25), landing1BC: stairP.landingWidth ?? 1.0,
      flightBC: ((stairP.steps ?? 16) / 2 - 1) * (stairP.tread ?? 0.25), support: 230, bar: Number(String(meta.architecture?.stair?.mainBar ?? "12").match(/(\d+)/)?.[1] ?? 12),
    },
    footing: {
      sbc: meta.geotech?.sbcKPa ?? 150, gammaSoil: 18, depth: meta.geotech?.foundingDepthM ?? 1.5, cover: st.materials?.cover?.footing ?? 50, bar: 12, eqIncrease: 1.5,
      minSize: 1.2, minDepth: Math.max(300, Math.round(((h.footings[0]?.rcc ?? 0.23) + (h.footings[0]?.frustumH ?? 0)) * 1000)),
    },
  };
  const map: StructMap = {
    swap: lettersOnY,
    engineToDrawing: (gi, gj) => (lettersOnY ? `${grid.yNames[gi]}-${grid.xNames[gj]}` : `${grid.xNames[gi]}-${grid.yNames[gj]}`),
  };
  return { inp, map };
}

export function toGeoInputs(h: HouseModel, B: number, Df: number, P: number): GeoInputs {
  const o = h.opt;
  const layers: Layer[] = o.soil.map((s, i) => ({ id: `L${i + 1}`, name: s.name, uscs: "", thick: s.thick, gamma: s.gamma, gammaSat: s.gammaSat, c: s.c, phi: s.phi, cu: 0, E: s.E, nu: s.nu, Cc: 0, Cr: 0, e0: 0.6, OCR: 1, cv: 0, N: s.N, FC: s.FC }));
  return {
    project: { title: "Foundation design", name: h.meta.project?.name ?? "", client: "", location: h.meta.project?.address ?? "", consultant: "", engineer: "", date: "" },
    site: { area: h.meta.site?.plotAreaM2 ?? 200, beta: 1, H: 0.1, setback: 50, gwt: o.gwt, pga: (h.meta.seismic?.zoneFactorZ ?? 0.3), Mw: 7.8, khFactor: 0.5 },
    building: { storeys: 1, Bb: h.outline.x1 - h.outline.x0, Lb: h.outline.y1 - h.outline.y0, floorLoad: 12 },
    footing: { B, L: B, Df, P },
    raft: { Df: 1.0 },
    criteria: { FSbearing: o.FSbearing, sAllowIsolated: o.settleAllow, sAllowRaft: 75, FSslope: 1.5, FSslopeSeismic: 1.1, FSliq: 1.2, method: "IS" },
    layers,
  };
}

export const wallsOn = (h: HouseModel, level: string) => h.walls.filter((w) => w.level === level);
export const isH = (w: { a: P2; b: P2 }) => Math.abs(w.a[1] - w.b[1]) < 1e-6;
export type { CLevel, CSegment };
