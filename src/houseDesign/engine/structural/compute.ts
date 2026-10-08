// One entry point: inputs → model → analysis → member design.

import type { StructInputs } from "./inputs";
import { buildModel, storeyDisplacements, type StructModel } from "./model";
import {
  designBeams, designColumns, designFootings, designSlabs, designStair, referenceFooting,
  type BeamDesign, type ColumnDesign, type FootingDesign, type SlabDesign,
} from "./design";

export interface StructResult {
  inp: StructInputs;
  model: StructModel;
  driftX: ReturnType<typeof storeyDisplacements>;
  driftY: ReturnType<typeof storeyDisplacements>;
  beams: BeamDesign[];
  columns: ColumnDesign[];
  slabs: SlabDesign[];
  stair: ReturnType<typeof designStair>;
  footings: FootingDesign[];
  refFooting: ReturnType<typeof referenceFooting>;
  summary: {
    W: number;
    Vb: number;
    maxDriftRatio: number;
    maxDispX: number;
    maxDispY: number;
    maxColSteel: number;
    colsOk: boolean;
    beamsOk: boolean;
    slabsOk: boolean;
    footingsOk: boolean;
    concrete: number; // m³ (frame + slabs + footings)
  };
}

export function computeStructure(inp: StructInputs): StructResult {
  const model = buildModel(inp);
  const driftX = storeyDisplacements(model, "X");
  const driftY = storeyDisplacements(model, "Y");
  const beams = designBeams(model);
  const columns = designColumns(model);
  const slabs = designSlabs(model);
  const stair = designStair(inp);
  const footings = designFootings(model);
  const sec = inp.sections;
  const conc =
    model.beams.reduce((s, b) => s + b.L * (sec.beamB / 1000) * (sec.beamD / 1000), 0) +
    model.columns.reduce((s, c) => s + (sec.colB / 1000) * (sec.colD / 1000) * inp.grid.storeyHeight.slice(0, c.top).reduce((a, h) => a + h, 0), 0) +
    model.panels.filter((p) => p.use === "slab").reduce((s, p) => s + (p.x1 - p.x0) * (p.y1 - p.y0) * (sec.slab / 1000), 0) +
    footings.reduce((s, f) => s + f.L * f.L * f.D, 0);
  return {
    inp, model, driftX, driftY, beams, columns, slabs, stair, footings,
    refFooting: referenceFooting(inp),
    summary: {
      W: model.seismic.W,
      Vb: model.seismic.Vb,
      maxDriftRatio: Math.max(...driftX.map((d) => d.ratio), ...driftY.map((d) => d.ratio)),
      maxDispX: Math.max(...driftX.map((d) => d.disp)),
      maxDispY: Math.max(...driftY.map((d) => d.disp)),
      maxColSteel: Math.max(...columns.map((c) => c.pct)),
      colsOk: columns.every((c) => c.ok),
      beamsOk: beams.every((b) => b.ok),
      slabsOk: slabs.every((s) => s.deflection.ok && s.rows.every((r) => r.ok)),
      footingsOk: footings.every((f) => f.ok),
      concrete: conc,
    },
  };
}
