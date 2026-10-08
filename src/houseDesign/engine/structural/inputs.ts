// Inputs for the RC-frame building module. Defaults reproduce the reference
// structural analysis report of a residential building (anonymised):
// G + 2.5 storey special RC moment-resisting frame,
// 28'×37' plan, 12"×12" columns, 9"×14" beams, 5" slab, M20 / Fe500.

export const FT = 0.3048;
export const IN = 0.0254;

export type PanelUse = "slab" | "stair" | "none";

export interface PanelDef {
  /** x-bay index, y-bay index */
  i: number;
  j: number;
  label: string;
  /** Use at each floor level (index 0 = first slab level above ground). */
  use: PanelUse[];
}

export interface StructInputs {
  project: {
    title: string;
    name: string;
    client: string;
    location: string;
    buildingType: string;
    plinthArea: string;
    storeys: string;
    consultant: string;
    engineer: string;
    date: string;
  };
  grid: {
    xSpans: number[]; // m, c/c, left → right
    ySpans: number[]; // m, c/c, front → back
    storeyHeight: number[]; // m, bottom → top
    levelNames: string[];
    panels: PanelDef[];
  };
  sections: {
    colB: number; // mm
    colD: number;
    beamB: number;
    beamD: number;
    slab: number;
    tieB: number;
    tieD: number;
    colCover: number; // clear cover mm
    beamCover: number;
    slabCover: number;
  };
  materials: {
    fck: number;
    fy: number;
    fyStirrup: number;
    gammaRC: number; // kN/m³
    gammaBrick: number;
  };
  loads: {
    floorFinish: number; // kN/m²
    partition: number; // kN/m²
    llRoom: number;
    llStair: number;
    llRoof: number;
    wallExt: number; // mm
    wallInt: number;
    openings: number; // fraction of wall area deducted for doors / windows
    parapetH: number; // m
    parapetT: number; // mm
    llMassFactor: number; // mass-source multiplier on live load
  };
  seismic: {
    Z: number;
    I: number;
    R: number;
    soil: 1 | 2 | 3;
    periodMode: "user" | "code";
    userT: number;
    ecc: number; // accidental eccentricity ratio
    driftLimit: number;
  };
  stair: {
    riser: number; // mm
    tread: number;
    risersPerFlight: number;
    waist: number; // mm overall
    finish: number; // mm
    landing1AB: number; // m
    flightAB: number;
    landing1BC: number;
    flightBC: number;
    support: number; // mm
    bar: number;
  };
  footing: {
    sbc: number; // kN/m²
    gammaSoil: number; // kN/m³
    depth: number; // m below GL
    cover: number; // mm
    bar: number;
    eqIncrease: number; // SBC increase for EQ combinations
    minSize: number; // m
    minDepth: number; // mm
  };
  /** Reference values quoted in the reference report, used by the verification chapter. */
  reference: {
    W: number;
    T: number;
    Vb: number;
    storeyForces: number[];
    driftMaxX: number;
    driftMaxY: number;
    footP: number; // T (reference spreadsheet works in tonnes)
    footMx: number; // T·m
    footMz: number;
    footCol: number; // m
    footL: number; // m
    footD: number; // m
    beamMhog: number;
    beamMsag: number;
    beamVu: number;
    beamL: number; // m
    colPu: number;
    colMx: number;
    colMy: number;
  };
}

const L3 = (a: PanelUse, b: PanelUse, c: PanelUse): PanelUse[] => [a, b, c];

export const STRUCT_DEFAULTS: StructInputs = {
  project: {
    title: "STRUCTURAL ANALYSIS REPORT",
    name: "Residential Building",
    client: "Anonymous",
    location: "Masbar, Pokhara-7, Nepal",
    buildingType: "Residential Building with Special RC moment-resisting frame",
    plinthArea: "932.0 sq. ft",
    storeys: "Ground floor + 2.5 storey",
    consultant: "Anonymous Pvt. Ltd, Pokhara, Nepal",
    engineer: "Er. Bikal Baral",
    date: "",
  },
  grid: {
    xSpans: [13 * FT, 14 * FT],
    ySpans: [14 * FT, 14 * FT, 8 * FT],
    storeyHeight: [2.8448, 2.8448, 2.8448],
    levelNames: ["FF", "SF", "TF"],
    panels: [
      { i: 0, j: 0, label: "Bed room 12'-9\"×13'-3\"", use: L3("slab", "slab", "slab") },
      { i: 1, j: 0, label: "Bed room 9'-6\"×13'-3\" + Toilet", use: L3("slab", "slab", "slab") },
      { i: 0, j: 1, label: "Bed room 12'-9\"×13'-6\" / Terrace", use: L3("slab", "slab", "none") },
      { i: 1, j: 1, label: "Living room 13'-6\"×13'-6\"", use: L3("slab", "slab", "slab") },
      { i: 1, j: 2, label: "Staircase", use: L3("stair", "stair", "slab") },
      { i: 0, j: 2, label: "Open", use: L3("none", "none", "none") },
    ],
  },
  sections: {
    colB: 304.8,
    colD: 304.8,
    beamB: 228.6,
    beamD: 355.6,
    slab: 127,
    tieB: 228.6,
    tieD: 304.8,
    colCover: 40,
    beamCover: 25,
    slabCover: 15,
  },
  materials: { fck: 20, fy: 500, fyStirrup: 415, gammaRC: 25, gammaBrick: 19.2 },
  loads: {
    floorFinish: 1.5,
    partition: 0,
    llRoom: 2,
    llStair: 3,
    llRoof: 1.5,
    wallExt: 230,
    wallInt: 115,
    openings: 0.3,
    parapetH: 0,
    parapetT: 115,
    llMassFactor: 0.25,
  },
  seismic: { Z: 0.36, I: 1, R: 5, soil: 2, periodMode: "user", userT: 0.367, ecc: 0.05, driftLimit: 0.004 },
  stair: {
    riser: 178,
    tread: 254,
    risersPerFlight: 8,
    waist: 150,
    finish: 30,
    landing1AB: 1.22,
    flightAB: 1.89,
    landing1BC: 1.07,
    flightBC: 1.12,
    support: 230,
    bar: 12,
  },
  footing: { sbc: 140, gammaSoil: 17, depth: 1.5, cover: 50, bar: 12, eqIncrease: 1.25, minSize: 1.2, minDepth: 300 },
  reference: {
    W: 2396.82,
    T: 0.367,
    Vb: 215.71,
    storeyForces: [22.5555, 89.0188, 104.1397],
    driftMaxX: 12.8,
    driftMaxY: 9.7,
    footP: 37.80632,
    footMx: 1.83,
    footMz: 0.037,
    footCol: 0.35,
    footL: 1.52,
    footD: 0.4,
    beamMhog: 39.13,
    beamMsag: 21.83,
    beamVu: 69.99,
    beamL: 3.962,
    colPu: 106.14,
    colMx: 24.42,
    colMy: 17.69,
  },
};

export type StructSection = keyof StructInputs;

/** Deep-merge persisted inputs over defaults so new fields get defaults. */
export function mergeStruct(p: Partial<StructInputs> | undefined): StructInputs {
  const d = structuredClone(STRUCT_DEFAULTS);
  if (!p) return d;
  for (const k of Object.keys(d) as StructSection[]) {
    const src = p[k] as object | undefined;
    if (src && typeof src === "object") (d as unknown as Record<string, object>)[k] = { ...(d[k] as object), ...src };
  }
  return d;
}
