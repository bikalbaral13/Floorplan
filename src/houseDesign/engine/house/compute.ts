// One entry point: complete JSON → architecture · structure ⇄ geotechnics · BOQ & cost · programme (CPM) ·
// drawings (DWG replica + model sheets) · verification of the model against the DWG.

import type { CompleteJson } from "./inputs";
import { buildHouseModel, toStructInputs, type HouseModel, type StructMap } from "./model";
import { computeArch, type ArchResult } from "./arch";
import { designFoundation, type FoundationResult } from "./foundation";
import { computeBoq, type BoqResult } from "./boq";
import { buildSchedule } from "./schedule";
import { computePm, type PmResult } from "../pm/compute";
import { drawingSetOf, dwgSheet, modelSheets, type DrawingSet } from "./drawings";
import type { DrawingSheet } from "../feasibility/drawing";

export interface DwgVerify { sheet: number; segments: number; matched: number; tolMm: number; misses: { label: string; kind: string; cover: number[] }[]; note: string }

export interface HouseResult {
  h: HouseModel;
  arch: ArchResult;
  map: StructMap;
  found: FoundationResult;
  boq: BoqResult;
  pm: PmResult;
  dwg: DrawingSet | null;
  dwgSheets: DrawingSheet[];
  sheets: DrawingSheet[];
  verify: DwgVerify | null;
  summary: Record<string, number | string | boolean>;
}

/** Every model wall face / opening jamb must lie on a DWG line (the plan sheet of the drawing set). */
export function verifyAgainstDwg(h: HouseModel, ds: DrawingSet | null, tolMm = 10): DwgVerify | null {
  const src = h.cj.settings?.source ?? {};
  const origin = src.planOriginDxf as [number, number] | undefined;
  if (!ds || !origin) return null;
  const tol = tolMm / 1000;
  // plan sheet = the sheet that contains the plan origin
  const k = ds.sheets.findIndex((s) => origin[0] >= s.box[0] && origin[0] <= s.box[2] && origin[1] >= s.box[1] && origin[1] <= s.box[3]);
  if (k < 0) return null;
  const s = ds.sheets[k];
  const ox = origin[0] - s.box[0], oy = origin[1] - s.box[1];
  const L: [number, number, number, number][] = [];
  const push = (x1: number, y1: number, x2: number, y2: number) => L.push([(x1 - ox) * 0.0254, -(y1 - oy) * 0.0254, (x2 - ox) * 0.0254, -(y2 - oy) * 0.0254]);
  for (let i = 0; i + 3 < s.L.length; i += 4) push(s.L[i], s.L[i + 1], s.L[i + 2], s.L[i + 3]);
  for (const p of s.P) for (let i = 1; i + 3 < p.length; i += 2) push(p[i], p[i + 1], p[i + 2], p[i + 3]);
  const o = h.outline;
  const inBox = L.filter((l) => [l[0], l[2]].every((x) => x > o.x0 - 1 && x < o.x1 + 1) && [l[1], l[3]].every((y) => y > o.y0 - 1 && y < o.y1 + 1));
  const cover = (horiz: boolean, k0: number, a: number, b: number) => {
    const iv: [number, number][] = [];
    for (const [x1, y1, x2, y2] of inBox) {
      if (horiz && Math.abs(y1 - y2) < 1e-3 && Math.abs(y1 - k0) <= tol) iv.push([Math.min(x1, x2), Math.max(x1, x2)]);
      if (!horiz && Math.abs(x1 - x2) < 1e-3 && Math.abs(x1 - k0) <= tol) iv.push([Math.min(y1, y2), Math.max(y1, y2)]);
    }
    iv.sort((p, q) => p[0] - q[0]);
    let c = 0, cur = a;
    for (const [s0, e0] of iv) { if (e0 <= cur) continue; const s1 = Math.max(s0, cur), e1 = Math.min(e0, b); if (s1 < e1) { c += e1 - s1; cur = e1; } }
    return c / Math.max(b - a, 1e-9);
  };
  let matched = 0;
  const misses: DwgVerify["misses"] = [];
  const walls = h.walls.filter((w) => w.level === h.ground);
  for (const w of walls) {
    const horiz = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const lo = horiz ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), hi = horiz ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
    const k0 = horiz ? w.a[1] : w.a[0];
    const faces = [k0 - w.t / 2, k0 + w.t / 2];
    const cv = w.kind === "wall" ? faces.map((f) => cover(horiz, f, lo, hi)) : [lo, hi].map((e) => cover(!horiz, e, faces[0], faces[1]));
    const ok = cv.every((c) => c >= 0.6) || (w.kind === "wall" && hi - lo <= 0.31);
    if (ok) matched++; else misses.push({ label: w.label ?? w.id, kind: w.kind, cover: cv.map((c) => Math.round(c * 100) / 100) });
  }
  return { sheet: k + 1, segments: walls.length, matched, tolMm, misses, note: `DWG sheet ${k + 1} (${s.title}); plan origin ${origin.map((v) => v.toFixed(2)).join(", ")} in DXF inches` };
}

export function computeHouse(cj: CompleteJson, opts?: { drawingSet?: DrawingSet | null; startDate?: string }): HouseResult {
  const h = buildHouseModel(cj);
  const arch = computeArch(h);
  const { inp, map } = toStructInputs(h);
  const found = designFoundation(h, inp, map);
  const boq = computeBoq(h);
  const pmInp = buildSchedule(h, boq, opts?.startDate);
  const pm = computePm(pmInp);
  const dwg = opts?.drawingSet ?? drawingSetOf(h);
  const project = h.meta.project?.name ?? "House";
  const dwgSheets = dwg ? dwg.sheets.map((s, i) => dwgSheet(s, i, project)) : [];
  const sheets = modelSheets(h, found);
  const verify = verifyAgainstDwg(h, dwg);
  const S = found.struct.summary;
  return {
    h, arch, map, found, boq, pm, dwg, dwgSheets, sheets, verify,
    summary: {
      plinthSqft: +(arch.areas.plinth * 10.7639).toFixed(1), coverage: +arch.areas.coverage.toFixed(2), far: +arch.areas.far.toFixed(3), archOk: arch.ok,
      W: +S.W.toFixed(1), Vb: +S.Vb.toFixed(1), maxDrift: +S.maxDriftRatio.toFixed(5), structOk: S.colsOk && S.beamsOk && S.slabsOk && S.footingsOk,
      sbcDesign: found.sbcDesign, foundationOk: found.ok, maxSettlement: +Math.max(...found.rows.map((r) => r.s)).toFixed(1),
      costTotal: Math.round(boq.total), costPerSqft: Math.round(boq.perSqft), concrete: +boq.concreteM3.toFixed(2), steelKg: Math.round(boq.steelKg),
      durationDays: pm.cpm.T, dwgMatch: verify ? `${verify.matched}/${verify.segments}` : "—",
    },
  };
}
