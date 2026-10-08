// Structural Analysis tool ids and the input fields each workbench shows.

import type { StructSection } from "./inputs";

export type StructToolId =
  | "st-present"
  | "st-input-json"
  | "st-project"
  | "st-plan"
  | "st-loads"
  | "st-seismic"
  | "st-combos"
  | "st-analysis"
  | "st-3d"
  | "st-rebar"
  | "st-drift"
  | "st-forces"
  | "st-column"
  | "st-beam"
  | "st-slab"
  | "st-stair"
  | "st-footing"
  | "st-verify"
  | "st-report-json"
  | "st-report-html"
  | "st-report-latex";

export type SField =
  | { kind: "num"; sec: StructSection; key: string; label: string; unit?: string; step?: number }
  | { kind: "text"; sec: StructSection; key: string; label: string }
  | { kind: "select"; sec: StructSection; key: string; label: string; options: { value: string; label: string }[]; numeric?: boolean }
  | { kind: "spans"; key: "xSpans" | "ySpans" | "storeyHeight"; label: string }
  | { kind: "panels" }
  | { kind: "heading"; label: string };

const n = (sec: StructSection, key: string, label: string, unit?: string, step?: number): SField => ({ kind: "num", sec, key, label, unit, step });
const t = (sec: StructSection, key: string, label: string): SField => ({ kind: "text", sec, key, label });
const hd = (label: string): SField => ({ kind: "heading", label });

export const STRUCT_TOOLS: Record<Exclude<StructToolId, "st-present" | "st-input-json" | "st-3d" | "st-rebar" | "st-report-json" | "st-report-html" | "st-report-latex">, { title: string; hint: string; fields: SField[] }> = {
  "st-project": {
    title: "Project Detail & Materials",
    hint: "Project detail, building design parameters and materials (report § Project Detail, Materials, Concrete, Reinforcement).",
    fields: [
      hd("Project"),
      t("project", "title", "Report title"),
      t("project", "name", "Name of the project"),
      t("project", "client", "Client (submitted to)"),
      t("project", "location", "Location"),
      t("project", "buildingType", "Type of building"),
      t("project", "plinthArea", "Plinth area"),
      t("project", "storeys", "Storey"),
      t("project", "consultant", "Consultant"),
      t("project", "engineer", "Engineer"),
      t("project", "date", "Date (blank = today)"),
      hd("Materials"),
      n("materials", "fck", "Concrete fck", "N/mm²"),
      n("materials", "fy", "Main steel fy", "N/mm²"),
      n("materials", "fyStirrup", "Stirrup steel fy", "N/mm²"),
      n("materials", "gammaRC", "Unit weight RCC", "kN/m³"),
      n("materials", "gammaBrick", "Unit weight brick + plaster", "kN/m³"),
    ],
  },
  "st-plan": {
    title: "Floor Plan & Structural Grid",
    hint: "The architectural floor plan as a grid of bays. Columns, beams, walls and slabs are generated from it — change a span or a bay's use and the whole analysis follows.",
    fields: [
      hd("Grid (m, c/c)"),
      { kind: "spans", key: "xSpans", label: "Spans along X (left → right)" },
      { kind: "spans", key: "ySpans", label: "Spans along Y (front → back)" },
      { kind: "spans", key: "storeyHeight", label: "Storey heights (bottom → top)" },
      hd("Bays"),
      { kind: "panels" },
      hd("Member sizes (mm)"),
      n("sections", "colB", "Column b"),
      n("sections", "colD", "Column D"),
      n("sections", "beamB", "Beam b"),
      n("sections", "beamD", "Beam D"),
      n("sections", "slab", "Slab thickness"),
      n("sections", "tieB", "Tie beam b"),
      n("sections", "tieD", "Tie beam D"),
      n("sections", "colCover", "Column clear cover"),
      n("sections", "beamCover", "Beam clear cover"),
      n("sections", "slabCover", "Slab clear cover"),
    ],
  },
  "st-loads": {
    title: "Dead & Live Loads",
    hint: "IS 875 Part 1 & 2 unit weights and imposed loads; wall loads on beams from the plan.",
    fields: [
      hd("Dead load"),
      n("loads", "floorFinish", "Floor finish", "kN/m²", 0.1),
      n("loads", "partition", "Partition allowance", "kN/m²", 0.1),
      n("loads", "wallExt", "Exterior wall thickness", "mm"),
      n("loads", "wallInt", "Interior wall thickness", "mm"),
      n("loads", "openings", "Openings deduction", "fraction", 0.05),
      n("loads", "parapetH", "Parapet height (0 = none)", "m", 0.1),
      n("loads", "parapetT", "Parapet thickness", "mm"),
      hd("Live load"),
      n("loads", "llRoom", "Rooms", "kN/m²", 0.5),
      n("loads", "llStair", "Staircase", "kN/m²", 0.5),
      n("loads", "llRoof", "Terrace / roof", "kN/m²", 0.25),
    ],
  },
  "st-seismic": {
    title: "Seismic Loads (IS 1893:2002)",
    hint: "Seismic weight, base shear by the static coefficient method and its distribution to storeys and frames.",
    fields: [
      n("seismic", "Z", "Zone factor Z", "", 0.01),
      n("seismic", "I", "Importance factor I", "", 0.1),
      n("seismic", "R", "Response reduction R", "", 0.5),
      { kind: "select", sec: "seismic", key: "soil", label: "Site type", numeric: true, options: [{ value: "1", label: "I — rock / hard" }, { value: "2", label: "II — medium" }, { value: "3", label: "III — soft" }] },
      { kind: "select", sec: "seismic", key: "periodMode", label: "Period", options: [{ value: "user", label: "User specified" }, { value: "code", label: "IS 1893 0.075h^0.75" }] },
      n("seismic", "userT", "User period T", "s", 0.001),
      n("seismic", "ecc", "Accidental eccentricity", "ratio", 0.01),
      n("loads", "llMassFactor", "Live load in mass source", "×", 0.05),
    ],
  },
  "st-combos": { title: "Load Combinations", hint: "The 13 IS 1893 combinations used for design, mass source and design assumptions.", fields: [] },
  "st-analysis": { title: "Structural Analysis — Model", hint: "Direct-stiffness plane-frame model generated from the plan: plan and elevations of every frame.", fields: [] },
  "st-drift": {
    title: "Storey Drift",
    hint: "Storey displacements and inter-storey drift ratio under EQx and EQy (load factor 1.0).",
    fields: [n("seismic", "driftLimit", "Drift limit", "× h", 0.0005)],
  },
  "st-forces": { title: "Member Forces & Reinforcing", hint: "Deformed shape, AFD / SFD / BMD of grid A-A and the longitudinal reinforcement of every beam and column.", fields: [] },
  "st-column": { title: "Design of Column", hint: "Biaxial bending with strain-compatibility section analysis (IS 456 cl. 39) and IS 13920 confinement.", fields: [n("sections", "colCover", "Clear cover", "mm")] },
  "st-beam": { title: "Design of Beam", hint: "Flexure (singly / doubly / T-beam), capacity shear and ductile detailing (IS 13920 cl. 6).", fields: [n("sections", "beamCover", "Clear cover", "mm"), n("materials", "fyStirrup", "Stirrup fy", "N/mm²")] },
  "st-slab": { title: "Design of Slab", hint: "Two-way slabs by IS 456 Annex D Table 26 with edge conditions read from the plan.", fields: [n("sections", "slab", "Slab thickness", "mm"), n("sections", "slabCover", "Clear cover", "mm")] },
  "st-stair": {
    title: "Design of Stair Case",
    hint: "Dog-legged stair: loads on flights and landings, reactions, bending, shear and anchorage.",
    fields: [
      n("stair", "riser", "Riser", "mm"),
      n("stair", "tread", "Tread", "mm"),
      n("stair", "waist", "Waist slab", "mm"),
      n("stair", "finish", "Finish", "mm"),
      n("stair", "landing1AB", "Landing (flight AB)", "m", 0.01),
      n("stair", "flightAB", "Flight AB going", "m", 0.01),
      n("stair", "landing1BC", "Landing (flight BC)", "m", 0.01),
      n("stair", "flightBC", "Flight BC going", "m", 0.01),
      n("stair", "bar", "Main bar", "mm"),
    ],
  },
  "st-footing": {
    title: "Design of Footing",
    hint: "Isolated footings from the base reactions, plus the reference spreadsheet reproduced step by step.",
    fields: [
      n("footing", "sbc", "Safe bearing capacity", "kN/m²"),
      n("footing", "eqIncrease", "SBC increase with EQ", "×", 0.05),
      n("footing", "depth", "Founding depth", "m", 0.1),
      n("footing", "gammaSoil", "Soil unit weight", "kN/m³"),
      n("footing", "cover", "Cover", "mm"),
      n("footing", "bar", "Bar diameter", "mm"),
      n("footing", "minSize", "Minimum size", "m", 0.05),
      n("footing", "minDepth", "Minimum depth", "mm"),
    ],
  },
  "st-verify": {
    title: "Verification vs Reference Report",
    hint: "Every reproducible number of the reference report recomputed with this engine: matches, model differences and errors in the reference.",
    fields: [
      hd("Reference values (from the report)"),
      n("reference", "W", "Seismic weight W", "kN"),
      n("reference", "Vb", "Base shear Vb", "kN"),
      n("reference", "driftMaxX", "Top displacement X", "mm"),
      n("reference", "driftMaxY", "Top displacement Y", "mm"),
      n("reference", "beamMhog", "Sample beam Mu (hog)", "kN·m"),
      n("reference", "colPu", "Sample column Pu", "kN"),
      n("reference", "footP", "Sample footing P", "T"),
      n("reference", "footMx", "Sample footing Mx", "T·m"),
    ],
  },
};

export function isStructTool(t: unknown): t is StructToolId {
  return typeof t === "string" && t.startsWith("st-");
}

export function isStructWorkbenchTool(t: unknown): t is keyof typeof STRUCT_TOOLS {
  return typeof t === "string" && t in STRUCT_TOOLS;
}
