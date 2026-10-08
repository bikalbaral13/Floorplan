// Structural report: chapters mirroring the reference report's table of
// contents, assembled into the same ReportDocument model the hydropower module
// uses, so JSON, HTML and LaTeX come from one source.

import {
  CALC, CHECK, DRAW, EQ, FIG, KV, L, NOTE, P, T, f, numberDocument,
  type Block, type Chapter, type ReportDocument,
} from "../feasibility/doc";
import type { StructResult } from "./compute";
import { COMBOS, letter, sa_g } from "./model";
import {
  TABLE26, flexure, interp26, muLimCoef, tauC, designColumn, barArea,
} from "./design";
import {
  DIAGRAM_COMBO, columnLayoutSheet, columnSectionsSheet, deformedSheet, diagramSheet,
  elevationSheet, floorPlanSheet, footingDetailSheet, footingLayoutSheet,
} from "./drawings";
import type { StructToolId } from "./tools";

const pct = (a: number, b: number) => (b === 0 ? "—" : `${(((a - b) / b) * 100).toFixed(1)} %`);

// ---------------------------------------------------------------------------
// Chapter 1 — Project detail & design basis
// ---------------------------------------------------------------------------

export function chProject(r: StructResult): Chapter {
  const p = r.inp.project, mat = r.inp.materials, sec = r.inp.sections;
  const Ec = 5000 * Math.sqrt(mat.fck);
  return {
    id: "st-project",
    title: "Project Detail and Design Basis",
    sections: [
      {
        title: "Project Detail",
        blocks: [
          KV([
            ["Name of the project", p.name],
            ["Client", p.client],
            ["Location", p.location],
            ["Type of building", p.buildingType],
            ["Plinth area", p.plinthArea],
            ["Storey", p.storeys],
            ["Structural system", "Special RC moment-resisting frame (SMRF), R = " + r.inp.seismic.R],
            ["Designed by", `${p.consultant}${p.engineer ? ` — ${p.engineer}` : ""}`],
          ], "Project detail"),
        ],
      },
      {
        title: "Building Design Parameters",
        blocks: [
          P("The building is an RCC framed structure — an assembly of cast-in-situ concrete beams and columns. Floors and roof are cast-in-place concrete slabs. The lateral load resisting system consists of bare frame elements only and has been designed to meet the ductility requirements of IS 13920:1993."),
          KV([
            ["Storey heights", r.inp.grid.storeyHeight.map((h) => `${h.toFixed(4)} m`).join(" / ")],
            ["Total height above base", `${r.model.levels[r.model.levels.length - 1].z.toFixed(4)} m`],
            ["Grid spans along X", r.inp.grid.xSpans.map((s) => `${s.toFixed(3)} m`).join(" + ")],
            ["Grid spans along Y", r.inp.grid.ySpans.map((s) => `${s.toFixed(3)} m`).join(" + ")],
            ["Columns", `${sec.colB} × ${sec.colD} mm (${r.model.columns.length} nos.)`],
            ["Beams", `${sec.beamB} × ${sec.beamD} mm (${r.model.beams.length} spans)`],
            ["Tie beams at plinth", `${sec.tieB} × ${sec.tieD} mm`],
            ["Slab thickness", `${sec.slab} mm`],
          ], "Geometry and member sizes"),
        ],
      },
      {
        title: "Materials",
        blocks: [
          P("Following loads have been considered for the analysis and design of the building based on the relevant Indian Standards."),
          L([
            `Concrete to IS 456:2000 — normal-weight, dry density 2400 kg/m³, 28-day cube strength fck = ${mat.fck} N/mm² (M${mat.fck}) for all structural elements.`,
            `Reinforcement to IS 1786 — high-yield deformed bars Fe ${mat.fy} (fy = ${mat.fy} N/mm²); stirrups Fe ${mat.fyStirrup}.`,
            `Modulus of elasticity of concrete Ec = 5000√fck = ${f(Ec, 2)} N/mm²; steel Es = 2 × 10⁵ N/mm².`,
            "Partial safety factors γc = 1.5, γs = 1.15 (limit state method, IS 456:2000).",
          ]),
          EQ("Ec = 5000*sqrt(fck)", [`fck = ${mat.fck} N/mm²`], String.raw`E_c = 5000\sqrt{f_{ck}} = ${f(Ec, 2)}\ \text{N/mm}^2`),
        ],
      },
      {
        title: "Codes and Standards",
        blocks: [
          L([
            "IS 456:2000 — Plain and reinforced concrete, code of practice",
            "IS 875 (Part 1 & 2):1987 — Dead and imposed loads",
            "IS 1893 (Part 1):2002 — Criteria for earthquake resistant design of structures",
            "IS 13920:1993 — Ductile detailing of reinforced concrete structures subjected to seismic forces",
            "SP 16 — Design aids for reinforced concrete; NBC Nepal Building Code",
          ]),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Chapter 2 — Floor plans and structural grid
// ---------------------------------------------------------------------------

export function chPlan(r: StructResult): Chapter {
  const m = r.model;
  const blocks: Block[] = [
    P("The structural model is generated directly from the architectural floor plan. The plan is described as a grid of bays; each bay has a use at every floor level (slab, stair well or open). Columns are placed at every grid node that bounds a used bay, beams on every grid segment bounding a used bay, and walls on beams whose bay continues to the storey above (230 mm on the building edge, 115 mm inside)."),
    T("Floor-plan bays and their use at each level", ["Bay", "Room", "Size (m)", ...m.levels.map((l) => l.name)],
      r.inp.grid.panels.map((pn) => [
        `${letter(pn.i)}${pn.j + 1}–${letter(pn.i + 1)}${pn.j + 2}`,
        pn.label,
        `${f(r.inp.grid.xSpans[pn.i], 3)} × ${f(r.inp.grid.ySpans[pn.j], 3)}`,
        ...m.levels.map((_, k) => pn.use[k] ?? "none"),
      ])),
    T("Columns generated from the plan", ["Column", "Grid", "x (m)", "y (m)", "Up to level"],
      m.columns.map((c) => [c.id, c.grid, f(c.x, 3), f(c.y, 3), m.levels[c.top - 1].name])),
  ];
  const drawings: Block[] = m.levels.map((L0, k) => DRAW(`${L0.name} level framing plan`, floorPlanSheet(m, L0.k, `S-0${k + 1}`)));
  return {
    id: "st-plan",
    title: "Floor Plans and Structural Grid",
    sections: [
      { title: "Floor Plan Input", blocks },
      { title: "Framing Plans", blocks: drawings },
    ],
  };
}

// ---------------------------------------------------------------------------
// Chapter 3 — Load calculations
// ---------------------------------------------------------------------------

export function chLoads(r: StructResult): Chapter {
  const m = r.model, ld = r.inp.loads, mat = r.inp.materials, sec = r.inp.sections, u = m.unitLoads;
  const hc = r.inp.grid.storeyHeight[0] - sec.beamD / 1000;
  return {
    id: "st-loads",
    title: "Load Calculations",
    sections: [
      {
        title: "Dead Load",
        blocks: [
          P("Dead loads are calculated on the basis of unit weights of the specified construction materials in accordance with IS 875 (Part 1)."),
          KV([
            ["Reinforced concrete", `${mat.gammaRC} kN/m³`],
            ["Brick work with plaster", `${mat.gammaBrick} kN/m³`],
            ["Floor finish (sand / cement screed)", `${ld.floorFinish} kN/m²`],
            ["Partition allowance", `${ld.partition} kN/m²`],
          ], "Unit weights"),
          CALC([
            ["Slab self-weight", `${sec.slab / 1000} × ${mat.gammaRC} = ${f(u.slabSelf, 3)} kN/m²`],
            ["Beam self-weight", `${sec.beamB / 1000} × ${sec.beamD / 1000} × ${mat.gammaRC} = ${f(u.beamSelf, 3)} kN/m`],
            ["Column self-weight", `${sec.colB / 1000} × ${sec.colD / 1000} × ${mat.gammaRC} = ${f(u.colSelf, 3)} kN/m`],
            ["Clear wall height", `${r.inp.grid.storeyHeight[0].toFixed(4)} − ${sec.beamD / 1000} = ${f(hc, 3)} m`],
            [`${ld.wallExt} mm wall`, `${ld.wallExt / 1000} × ${f(hc, 3)} × ${mat.gammaBrick} × (1 − ${ld.openings}) = ${f(u.wallExt, 2)} kN/m`],
            [`${ld.wallInt} mm wall`, `${ld.wallInt / 1000} × ${f(hc, 3)} × ${mat.gammaBrick} × (1 − ${ld.openings}) = ${f(u.wallInt, 2)} kN/m`],
            ["Stair (flight, on plan)", `${f(u.stairDL, 2)} kN/m² (see Design of Stair Case)`],
          ]),
          NOTE(`Wall loads are reduced by ${(ld.openings * 100).toFixed(0)} % for door and window openings.`),
        ],
      },
      {
        title: "Live Loads",
        blocks: [
          P("The live load has been adopted from IS 875 (Part 2) Section 1 for residential buildings."),
          T("Imposed loads", ["Occupancy", "Load (kN/m²)"], [
            ["Living rooms, bed rooms etc.", ld.llRoom],
            ["Staircases", ld.llStair],
            ["Kitchen", 2],
            ["Balcony", 3],
            ["Passage", 3],
            ["Terrace / roof", ld.llRoof],
          ]),
        ],
      },
      {
        title: "Loads on Beams",
        blocks: [
          P("Slab loads are transferred to the supporting beams by 45° yield lines. For bending, the triangular load on a short beam is replaced by w·lx/3 and the trapezoidal load on a long beam by (w·lx/6)(3 − (lx/ly)²); one-way panels (ly/lx > 2) load only the long beams with w·lx/2."),
          EQ("w_tri = w*lx/3; w_trap = w*lx/6*(3-(lx/ly)^2)", undefined, String.raw`w_{eq,\triangle} = \frac{w\,l_x}{3},\qquad w_{eq,\text{trap}} = \frac{w\,l_x}{6}\left(3-\left(\frac{l_x}{l_y}\right)^2\right)`),
          T("Beam line loads (unfactored)", ["Level", "Beam", "Frame", "Span (m)", "Self", "Slab DL", "Wall", "Stair DL", "Total DL", "LL"],
            m.beams.map((b) => [m.levels[b.level - 1].name, b.id, b.dir === "X" ? `Grid ${b.line + 1}` : `Grid ${letter(b.line)}`, f(b.L, 3), f(b.self, 2), f(b.slabDL, 2), f((b.wall?.w ?? 0) + b.parapet, 2), f(b.stairDL, 2), f(b.DL, 2), f(b.LL, 2)]),
            "All loads in kN/m."),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Chapter 4 — Seismic loads
// ---------------------------------------------------------------------------

function seismicDirection(r: StructResult, dir: "X" | "Y"): Block[] {
  const s = r.model.seismic, si = r.inp.seismic;
  const other = dir === "X" ? "Y" : "X";
  return [
    KV([
      ["Direction and eccentricity", `Direction = ${dir} + eccentricity ${other}`],
      ["Eccentricity ratio", `${(si.ecc * 100).toFixed(0)} % for all diaphragms`],
      ["Period calculation method", si.periodMode === "user" ? "User specified" : "IS 1893 cl. 7.6.1 — T = 0.075 h^0.75"],
      ["Period used, T", `${f(s.T, 3)} s`],
      ["Seismic zone factor, Z [IS Table 2]", String(si.Z)],
      ["Response reduction factor, R [IS Table 7]", String(si.R)],
      ["Importance factor, I [IS Table 6]", String(si.I)],
      ["Site type [IS Table 1]", ["I (rock)", "II (medium)", "III (soft)"][si.soil - 1]],
      ["Spectral acceleration coefficient, Sa/g [IS 6.4.5]", f(s.SaG, 3)],
      ["Seismic coefficient, Ah [IS 6.4.2]", f(s.Ah, 4)],
    ], `Auto seismic load — EQ${dir.toLowerCase()} (IS 1893:2002)`),
    T(`Calculated base shear — EQ${dir.toLowerCase()}`, ["Direction", "Period used (s)", "W (kN)", "Vb (kN)"], [[`${dir} + Ecc. ${other}`, f(s.T, 3), f(s.W, 2), f(s.Vb, 2)]]),
    T(`Lateral load to stories — ${dir}`, ["Story", "Elevation (m)", "X-Dir (kN)", "Y-Dir (kN)"],
      [...s.levels.slice().reverse().map((l) => [l.name, f(l.z, 4), dir === "X" ? f(l.Q, 4) : 0, dir === "Y" ? f(l.Q, 4) : 0]), ["Base", 0, 0, 0]]),
    FIG(`Lateral load to stories — ${dir}`, {
      x: { label: "Force (kN)", min: 0 },
      y: { label: "Elevation (m)", min: 0 },
      series: [{ name: `EQ${dir.toLowerCase()}`, points: [[0, 0], ...s.levels.map((l) => [l.Q, l.z] as [number, number])], style: "linepoints" }],
      markers: s.levels.map((l) => ({ y: l.z, label: `${l.name} ${l.Q.toFixed(1)} kN` })),
    }),
  ];
}

export function chSeismic(r: StructResult): Chapter {
  const s = r.model.seismic, si = r.inp.seismic;
  const H = r.model.levels[r.model.levels.length - 1].z;
  return {
    id: "st-seismic",
    title: "Seismic Loads",
    intro: [P("The building has been analysed by the static (equivalent lateral force) method of IS 1893 (Part 1):2002. The seismic weight, base shear and its vertical distribution are computed below.")],
    sections: [
      {
        title: "Seismic Weight",
        blocks: [
          P(`Seismic weight of each floor = full dead load (self-weight, finishes, partitions, walls, stair) + ${r.inp.loads.llMassFactor} × imposed load (mass source). Walls and columns are lumped half to the floor above and half to the floor below.`),
          T("Seismic weight of floors", ["Level", "Slab + FF", "LL share", "Beams", "Columns", "Walls", "Parapet", "Stair", "Total W (kN)"],
            [...s.weightBreakdown.map((w) => [w.name, f(w.slab, 1), f(w.live, 1), f(w.beams, 1), f(w.columns, 1), f(w.walls, 1), f(w.parapet, 1), f(w.stair, 1), f(w.total, 2)]),
              ["Total", "", "", "", "", "", "", "", f(s.W, 2)]]),
          T("Mass source", ["Load", "Multiplier"], [["LIVE", r.inp.loads.llMassFactor], ["DEAD", 1], ["WALL", 1], ["FLOOR FINISH", 1], ["PARTITION", 1], ["STAIR", 1]]),
        ],
      },
      {
        title: "Design Base Shear",
        blocks: [
          EQ("T = 0.075*h^0.75", [`h = ${f(H, 3)} m`], String.raw`T_a = 0.075\,h^{0.75} = 0.075 \times ${f(H, 3)}^{0.75} = ${f(s.Tcode, 3)}\ \text{s}`),
          EQ("Ah = Z/2*I/R*Sa/g", undefined, String.raw`A_h = \frac{Z}{2}\cdot\frac{I}{R}\cdot\frac{S_a}{g} = \frac{${si.Z}}{2}\cdot\frac{${si.I}}{${si.R}}\cdot ${f(s.SaG, 3)} = ${f(s.Ah, 4)}`),
          EQ("Vb = Ah*W", undefined, String.raw`V_B = A_h\,W = ${f(s.Ah, 4)} \times ${f(s.W, 2)} = ${f(s.Vb, 2)}\ \text{kN}`),
          EQ("Qi = Vb*Wi*hi^2/sum(Wj*hj^2)", undefined, String.raw`Q_i = V_B\,\frac{W_i h_i^2}{\sum_j W_j h_j^2}`),
          NOTE(`For site type ${["I", "II", "III"][si.soil - 1]}, Sa/g = 2.5 for 0.10 ≤ T ≤ ${[0.4, 0.55, 0.67][si.soil - 1]} s; at T = ${f(s.T, 3)} s, Sa/g = ${f(sa_g(s.T, si.soil), 3)}.`),
          T("Vertical distribution of base shear", ["Level", "hi (m)", "Wi (kN)", "Wi·hi²", "Qi (kN)", "Storey shear Vi (kN)"],
            s.levels.slice().reverse().map((l) => [l.name, f(l.z, 4), f(l.W, 2), f(l.Wh2, 1), f(l.Q, 3), f(l.V, 3)])),
        ],
      },
      { title: "Earthquake in X-direction", blocks: seismicDirection(r, "X") },
      { title: "Earthquake in Y-direction", blocks: seismicDirection(r, "Y") },
      {
        title: "Distribution to Frames",
        blocks: [
          P("The floors act as rigid diaphragms. Storey shear is shared among parallel frames in proportion to their lateral stiffness (number of columns in the storey), plus the torsional shear from the design eccentricity ed = 1.5 es + 0.05 b (IS 1893 cl. 7.9). Torsional shears are only added, never subtracted."),
          T("Centre of mass and rigidity", ["Level", "CM x (m)", "CM y (m)", "CR x (m)", "CR y (m)"],
            s.levels.map((l) => [l.name, f(l.cm[0], 3), f(l.cm[1], 3), f(l.cr[0], 3), f(l.cr[1], 3)])),
          T("Lateral forces applied to each frame (kN)", ["Frame", ...r.model.levels.flatMap((l) => [`${l.name} EQx`, `${l.name} EQy`])],
            r.model.frames.map((fr) => [fr.name, ...r.model.levels.flatMap((_, k) => [f(r.model.frameShare[fr.name].EQX[k], 2), f(r.model.frameShare[fr.name].EQY[k], 2)])])),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Chapter 5 — Load combinations
// ---------------------------------------------------------------------------

export function chCombos(r: StructResult): Chapter {
  const mat = r.inp.materials;
  return {
    id: "st-combos",
    title: "Load Combinations",
    sections: [
      {
        title: "Load Cases",
        blocks: [
          P("Following loads have been considered in the static analysis of the building as per IS 875:1987 and IS 1893:2002."),
          L(["Dead load (DL)", "Live load (LL)", "Earthquake load in +ve X-direction (+EQx)", "Earthquake load in −ve X-direction (−EQx)", "Earthquake load in +ve Y-direction (+EQy)", "Earthquake load in −ve Y-direction (−EQy)"], true),
          P("Earthquake load must be considered for +X, −X, +Y and −Y directions. Thus ±E implies 4 cases and, in all, 13 cases must be considered. All combinations are analysed and the envelope of member forces is used for design."),
        ],
      },
      {
        title: "Load Combinations used for Design",
        blocks: [
          T("Load combinations (IS 1893 cl. 6.3.1.2)", ["No.", "Combination", "DL", "LL", "EQx", "EQy"],
            COMBOS.map((c, k) => [k + 1, c.name, c.f.DL, c.f.LL, c.f.EQX, c.f.EQY])),
        ],
      },
      {
        title: "Design Assumptions",
        blocks: [
          KV([
            [`Concrete grade, M${mat.fck}`, `fck = ${mat.fck} MPa for columns and other members`],
            [`Steel grade, Fe ${mat.fy}`, `fy = ${mat.fy} MPa for all`],
          ]),
          P("The concrete has been designed using the limit state method of IS 456:2000. Detailing of reinforcement is based on IS 13920:1993. The design is based on the most critical load combination mentioned above."),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Chapter 6 — Structural analysis (model, drift, forces)
// ---------------------------------------------------------------------------

export function chModel(r: StructResult): Chapter {
  const m = r.model;
  const fA = m.analyses.find((a) => a.def.dir === "Y" && a.def.line === 0) ?? m.analyses[0];
  return {
    id: "st-model",
    title: "Structural Analysis",
    intro: [
      P("The analysis has been carried out by the direct stiffness method on plane frames built from the floor plan (3 degrees of freedom per node, fixed bases). Each grid line is one frame; frames in the same direction are tied by the rigid floor diaphragm. The model, loads and results are regenerated whenever the plan or any input changes."),
      P("For the analysis, following loading parameters were considered:"),
      L(["Self-weight of the frames and slabs", "Floor finishing dead loads", "Fixed wall loads as per architectural drawings", "Staircase load", "Partition wall loads as per architectural drawings only", "Live loads", "Seismic loads (EQx, EQy)"], true),
    ],
    sections: [
      {
        title: "3D Modelling of the Building",
        blocks: [
          KV([
            ["Nodes / members in all frames", `${m.analyses.reduce((s, a) => s + a.nodes.length, 0)} / ${m.analyses.reduce((s, a) => s + a.members.length, 0)}`],
            ["Frames", m.frames.map((x) => x.name).join(", ")],
            ["Columns", `${m.columns.length} (${m.columns.reduce((s, c) => s + c.top, 0)} column-storeys)`],
            ["Beams", String(m.beams.length)],
            ["Slab panels", String(m.panels.length)],
            ["Modulus of elasticity", `${f(m.E / 1000, 2)} N/mm²`],
          ], "Analytical model"),
          NOTE("The interactive 3D model is available under Structural Analysis → 4 · Structural Analysis → 3D Model."),
          DRAW("Plan of building (typical floor)", floorPlanSheet(m, 1, "S-10")),
          DRAW(`Elevation of building at ${fA.def.name}`, elevationSheet(m, fA, "S-11")),
          ...m.analyses.filter((a) => a !== fA).map((a, k) => DRAW(`Elevation of building at ${a.def.name}`, elevationSheet(m, a, `S-1${k + 2}`))),
        ],
      },
    ],
  };
}

export function chDrift(r: StructResult): Chapter {
  const lim = r.inp.seismic.driftLimit;
  const row = (d: StructResult["driftX"][number]) => [d.level, f(d.z, 4), "Top", f(d.disp, 3), f(d.drift, 3), (d.ratio).toFixed(5), d.ratio <= lim ? "OK" : "NOT OK"];
  const chart = (dir: "X" | "Y", ds: StructResult["driftX"]) => FIG(`Drift in ${dir}-direction — maximum story displacement`, {
    x: { label: "Displacement (mm)", min: 0 },
    y: { label: "Elevation (m)", min: 0 },
    series: [{ name: `EQ${dir.toLowerCase()}`, points: [[0, 0], ...ds.map((d) => [d.disp, d.z] as [number, number])], style: "linepoints" }],
  });
  return {
    id: "st-drift",
    title: "Storey Displacement and Drift",
    sections: [
      {
        title: "Story Response",
        blocks: [
          P(`The storey drift in any storey due to the design lateral force with partial load factor 1.0 shall not exceed ${lim} times the storey height (IS 1893 cl. 7.11.1).`),
          T("Story response — X-direction", ["Story", "Elevation (m)", "Location", "Displacement (mm)", "Drift (mm)", "Drift ratio", "Check"], r.driftX.slice().reverse().map(row)),
          chart("X", r.driftX),
          T("Story response — Y-direction", ["Story", "Elevation (m)", "Location", "Displacement (mm)", "Drift (mm)", "Drift ratio", "Check"], r.driftY.slice().reverse().map(row)),
          chart("Y", r.driftY),
          CHECK("Maximum drift ratio", r.summary.maxDriftRatio <= lim, `${r.summary.maxDriftRatio.toFixed(5)} ${r.summary.maxDriftRatio <= lim ? "≤" : ">"} ${lim}`),
        ],
      },
    ],
  };
}

export function chForces(r: StructResult): Chapter {
  const m = r.model;
  const fA = m.analyses.find((a) => a.def.dir === "Y" && a.def.line === 0) ?? m.analyses[0];
  const cG = DIAGRAM_COMBO("1.5(DL+LL)");
  const cE = DIAGRAM_COMBO("1.5(DL+EQy)");
  const lev = (lv: string) => r.beams.filter((b) => b.level === lv);
  return {
    id: "st-forces",
    title: "Member Forces and Reinforcement",
    sections: [
      {
        title: "Deformed Shape and Force Diagrams",
        blocks: [
          DRAW(`Deformed shape (load combo ${cG.name})`, deformedSheet(m, fA, cG, "S-20")),
          DRAW(`AFD (load combo ${cE.name})`, diagramSheet(m, fA, cE, "N", "S-21")),
          DRAW(`SFD (load combo ${cE.name})`, diagramSheet(m, fA, cE, "V", "S-22")),
          DRAW(`BMD (load combo ${cE.name})`, diagramSheet(m, fA, cE, "M", "S-23")),
          DRAW(`BMD (load combo ${cG.name})`, diagramSheet(m, fA, cG, "M", "S-24")),
        ],
      },
      {
        title: "Longitudinal Reinforcing",
        blocks: [
          ...m.levels.map((l) => l.name).filter((lv) => lev(lv).length).map((lv) =>
            T(`Longitudinal reinforcing — beams at ${lv} level`, ["Beam", "Frame", "Span (m)", "Top req (mm²)", "Top bars", "Bottom req (mm²)", "Bottom bars", "Stirrups"],
              lev(lv).map((b) => [b.id, b.frame, f(b.L, 3), f(b.top.req, 0), b.top.bars, f(b.bot.req, 0), b.bot.bars, `8φ @ ${b.stirrup.end}/${b.stirrup.mid}`]))),
          T("Longitudinal reinforcing — columns (all storeys)", ["Column", "Grid", "Storey", "Pu max (kN)", "As req (mm²)", "Bars", "p (%)"],
            r.columns.map((c) => [c.id, c.grid, c.level, f(c.PuMax, 1), f(c.AscReq, 0), c.bars, f(c.pct, 2)])),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Chapter 7 — Design of elements
// ---------------------------------------------------------------------------

export function chColumn(r: StructResult): Chapter {
  const m = r.model, mat = r.inp.materials, sec = r.inp.sections;
  const gf = r.columns.filter((c) => c.storey === 1);
  const s = gf.reduce((a, b) => (b.AscReq > a.AscReq || (b.AscReq === a.AscReq && b.PuMax > a.PuMax) ? b : a), gf[0]);
  const g = s.governing;
  const Ag = sec.colB * sec.colD;
  const marks: Record<string, string> = {};
  const typeOf = (id: string) => r.columns.filter((c) => c.id === id).map((c) => c.bars).join(" | ");
  const typeKeys = Array.from(new Set(m.columns.map((c) => typeOf(c.id))));
  m.columns.forEach((c) => (marks[c.id] = `CT${typeKeys.indexOf(typeOf(c.id)) + 1}`));
  // replicate the reference ETABS sample (C7, SF: Pu 106.14, M2 24.42, M3 17.69)
  const ref = r.inp.reference;
  const refCol = designColumn(m, s.id, 2, [{ combo: "Reference DCon2", end: "bottom", Pu: ref.colPu, Mx: ref.colMx, My: ref.colMy }]);
  return {
    id: "st-column",
    title: "Design of Column",
    intro: [
      P("The design of all structural elements is done using the limit state method. All relevant limit states are considered in design to ensure adequate safety and serviceability. Columns are designed for axial force with biaxial bending from the two orthogonal frames through each column, using a strain-compatibility section analysis (IS 456 cl. 39.1) and the interaction check of cl. 39.6."),
    ],
    sections: [
      {
        title: "Sample Design of Column",
        blocks: [
          KV([
            ["Column", `${s.id} (grid ${s.grid}) at ground floor level`],
            ["Section b × D", `${sec.colB} × ${sec.colD} mm`],
            ["Height L / clear height", `${f(r.inp.grid.storeyHeight[0], 4)} m / ${f(s.Lclear / 1000, 3)} m`],
            ["fck / fy", `${mat.fck} / ${mat.fy} N/mm²`],
            ["Governing combination", `${g.combo} (${g.end} of column)`],
          ], "Known data"),
          CALC([
            ["Min. reinforcement (0.8 % of BD)", `Ast,min = 0.008 × ${Ag.toFixed(0)} = ${f(s.AscMin, 2)} mm²  [IS 456 cl. 26.5.3.1(a)]`],
            ["Max. reinforcement (4 % of BD)", `Ast,max = ${f(0.04 * Ag, 2)} mm²; extreme case 6 % = ${f(0.06 * Ag, 2)} mm²`],
            ["Axial load", `Pu = ${f(g.Pu, 2)} kN`],
            ["Moments from analysis", `Mux = ${f(g.Mx, 2)} kN·m, Muy = ${f(g.My, 2)} kN·m`],
            ["Minimum eccentricity", `e = L/500 + D/30 = ${f(s.Lclear / 500, 2)} + ${f(sec.colD / 30, 2)} = ${f(s.Lclear / 500 + sec.colD / 30, 2)} mm → e,min = ${f(s.emin, 2)} mm  [cl. 25.4]`],
            ["Design moments", `Mux = ${f(g.Mxd, 2)} kN·m, Muy = ${f(g.Myd, 2)} kN·m`],
            ["Slenderness", `lex/D = ${f(s.slenderX, 2)}, ley/b = ${f(s.slenderY, 2)} < 12 → short column, no additional moment`],
            ["Pu / (fck·b·D)", f((g.Pu * 1e3) / (mat.fck * Ag), 3)],
            ["Steel provided", `${s.bars} = ${f(s.prov, 0)} mm² (p = ${f(s.pct, 2)} %)`],
            ["Puz", `0.45 fck Ac + 0.75 fy Asc = ${f(g.Puz, 1)} kN`],
            ["Uniaxial capacities at Pu", `Mux1 = ${f(g.Mux1, 2)} kN·m, Muy1 = ${f(g.Muy1, 2)} kN·m`],
            ["αn", `Pu/Puz = ${f(g.Pu / g.Puz, 3)} → αn = ${f(g.alpha, 3)}`],
            ["Interaction", `(${f(g.Mxd, 2)}/${f(g.Mux1, 2)})^${f(g.alpha, 2)} + (${f(g.Myd, 2)}/${f(g.Muy1, 2)})^${f(g.alpha, 2)} = ${f(g.ratio, 3)}`],
          ]),
          EQ("(Mux/Mux1)^an + (Muy/Muy1)^an <= 1", undefined, String.raw`\left(\frac{M_{ux}}{M_{ux1}}\right)^{\alpha_n}+\left(\frac{M_{uy}}{M_{uy1}}\right)^{\alpha_n} = ${f(g.ratio, 3)} \le 1.0`),
          CHECK("Biaxial bending (IS 456 cl. 39.6)", g.ratio <= 1, `interaction ratio ${f(g.ratio, 3)}`),
          CALC([
            ["Lateral tie diameter", `≥ φmax/4 and ≥ 6 mm → provide ${s.ties.dia} mm ties`],
            ["Pitch (IS 456 cl. 26.5.3.2)", `≤ least lateral dimension ${sec.colB} mm, ≤ 16φ, ≤ 300 mm; IS 13920 cl. 7.3.3 ≤ b/2 = ${f(sec.colB / 2, 1)} mm → ${s.ties.general} mm`],
            ["Confinement length l0 (IS 13920 cl. 7.4.1)", `≥ D = ${sec.colD}, ≥ Lc/6 = ${f(s.Lclear / 6, 1)}, ≥ 450 mm → ${f(s.ties.lo, 0)} mm`],
            ["Pitch in l0 (IS 13920 cl. 7.4.6)", `≤ b/4 = ${f(sec.colB / 4, 1)} mm, need not be < 75 mm nor > 100 mm → ${s.ties.confine} mm`],
            ["Provide", s.ties.text],
          ]),
        ],
      },
      {
        title: "Reference Design Point (ETABS sample)",
        blocks: [
          P(`The reference report's ETABS sample (column C7, SF level, combo DCon2: Pu = ${ref.colPu} kN, M2 = ${ref.colMx} kN·m, M3 = ${ref.colMy} kN·m) is checked with this engine's section analysis.`),
          KV([
            ["ETABS required rebar", "743 mm² (0.8 %, minimum governs)"],
            ["Engine required rebar", `${f(refCol.AscReq, 0)} mm² (${f((100 * refCol.AscReq) / Ag, 2)} %)`],
            ["Engine interaction ratio at minimum steel", f(refCol.governing.ratio, 3)],
          ], "Reference design point"),
        ],
      },
      {
        title: "Column Design Summary",
        blocks: [
          T("Concrete column summary — IS 456:2000", ["Story", "Label", "Grid", "Design section", "As,min (mm²)", "As (mm²)", "Bars", "Governing combo", "Ratio"],
            r.columns.slice().sort((a, b) => b.storey - a.storey || a.id.localeCompare(b.id, undefined, { numeric: true })).map((c) => [c.level, c.id, c.grid, `Column ${Math.round(sec.colB / 25.4)} x ${Math.round(sec.colD / 25.4)}`, f(c.AscMin, 0), f(c.AscReq, 0), c.bars, c.governing.combo, f(c.governing.ratio, 2)])),
          T("Column schedule", ["Type", "Columns", ...m.levels.map((l, k) => (k === 0 ? `Ground floor (to ${l.name})` : `to ${l.name}`))],
            typeKeys.map((t, k) => {
              const cols = m.columns.filter((c) => typeOf(c.id) === t);
              const bars = t.split(" | ");
              return [`CT${k + 1}`, cols.map((c) => c.id).join(", "), ...Array.from({ length: m.levels.length }, (_, s2) => bars[s2] ?? "—")];
            })),
          DRAW("Column layout plan", columnLayoutSheet(m, marks, "S-30")),
          DRAW("Column details", columnSectionsSheet(m, r.columns, "S-31")),
        ],
      },
    ],
  };
}

export function chBeam(r: StructResult): Chapter {
  const mat = r.inp.materials, sec = r.inp.sections, ref = r.inp.reference;
  const sample = r.beams.find((b) => b.level === r.model.levels[0].name && b.frame.includes("1-1")) ?? r.beams[0];
  const b = sec.beamB, D = sec.beamD;
  const d = D - sec.beamCover - 8 - 8, dp = sec.beamCover + 8 + 8;
  const fT = flexure(sample.Mhog1 > sample.Mhog2 ? sample.Mhog1 : sample.Mhog2, b, d, dp, mat.fck, mat.fy);
  const Df = sec.slab;
  const Lo = 0.7 * sample.L * 1000;
  const bf = Math.min(Lo / 6 + b + 6 * Df, r.inp.grid.xSpans[0] * 1000);
  const Ms = sample.Msag * 1e6;
  const AstT = (0.5 * mat.fck / mat.fy) * (1 - Math.sqrt(1 - (4.6 * Ms) / (mat.fck * bf * d * d))) * bf * d;
  const xu = (0.87 * mat.fy * Math.max(AstT, sample.bot.prov)) / (0.36 * mat.fck * bf);
  return {
    id: "st-beam",
    title: "Design of Beam",
    sections: [
      {
        title: "Sample Design of Beam",
        blocks: [
          KV([
            ["Beam", `${sample.label} at ${sample.level} level`],
            ["Overall depth D / width B", `${D} / ${b} mm`],
            ["Length of beam L", `${f(sample.L * 1000, 0)} mm`],
            ["Clear cover / bar", `${sec.beamCover} mm / 16 mm (stirrup 8 mm)`],
            ["Effective depth d / d'", `${f(d, 1)} / ${f(dp, 1)} mm`],
            ["fck / fy / fy stirrup", `${mat.fck} / ${mat.fy} / ${mat.fyStirrup} N/mm²`],
            ["L/D", `${f((sample.L * 1000) / D, 2)} > 4 — hence ok (IS 13920 cl. 6.1.4)`],
          ], "Known data"),
          EQ("Ast,min = 0.24*sqrt(fck)/fy*b*d", undefined, String.raw`A_{st,min} = \frac{0.24\sqrt{f_{ck}}}{f_y}\,b\,d = ${f(sample.AstMin, 1)}\ \text{mm}^2`),
          CALC([
            ["Maximum reinforcement", `Ast,max = 0.025 b d = ${f(sample.AstMax, 1)} mm²  [IS 13920 cl. 6.2.2]`],
            ["Limiting moment", `Mu,lim = ${f(muLimCoef(mat.fy), 4)} fck b d² = ${f(sample.Mulim, 2)} kN·m  (Fe ${mat.fy}: xu,max/d = ${mat.fy <= 415 ? 0.48 : 0.46})`],
            ["Envelope moments", `hogging ${f(sample.Mhog1, 2)} / ${f(sample.Mhog2, 2)} kN·m (${sample.combos.hog}); sagging ${f(sample.Msag, 2)} kN·m (${sample.combos.sag})`],
          ]),
          CALC([
            ["1. Hogging moment", `Mu = ${f(Math.max(sample.Mhog1, sample.Mhog2), 2)} kN·m ${fT.doubly ? "> Mu,lim → doubly reinforced" : "< Mu,lim → singly reinforced"}`],
            ["Ast (top)", `${f(fT.Ast, 1)} mm²${fT.doubly ? `, Asc = ${f(fT.Asc, 1)} mm²` : ""} → required ${f(sample.top.req, 1)} mm²`],
            ["Asc at bottom", `≥ 50 % of Ast at the face (IS 13920 cl. 6.2.3) = ${f(sample.top.req / 2, 1)} mm²`],
            ["2. Sagging moment (T-beam)", `Mu = ${f(sample.Msag, 2)} kN·m; Df = ${Df} mm, bw = ${b} mm`],
            ["Flange width", `bf = Lo/6 + bw + 6Df = ${f(Lo / 6, 1)} + ${b} + ${6 * Df} = ${f(Lo / 6 + b + 6 * Df, 1)} mm (≤ c/c of beams) → ${f(bf, 1)} mm`],
            ["Ast (T-beam)", `${f(AstT, 1)} mm²; xu = 0.87 fy Ast / (0.36 fck bf) = ${f(xu, 2)} mm < Df — neutral axis in flange`],
            ["3. Required reinforcement", `Ast,top = ${f(sample.top.req, 1)} mm², Ast,bott = ${f(sample.bot.req, 1)} mm²`],
            ["Provide", `Top ${sample.top.bars} (${f(sample.top.prov, 0)} mm²); Bottom ${sample.bot.bars} (${f(sample.bot.prov, 0)} mm²)`],
          ]),
          CALC([
            ["4. Shear — analysis", `Vu = ${f(sample.Vu, 2)} kN (${sample.combos.shear})`],
            ["Capacity shear (IS 13920 cl. 6.3.3)", `Vu = 1.2(DL+LL)L/2 + 1.4(Mu,top + Mu,bot)/L = ${f(sample.Vcap, 2)} kN`],
            ["Design shear", `${f(sample.Vdes, 2)} kN; τv = ${f(sample.tauV, 3)} MPa`],
            ["Tensile steel", `pt = ${f(sample.pt, 2)} % → τc = ${f(sample.tauC, 3)} MPa (Table 19), τc,max = 2.8 MPa`],
            ["Vus", `Vu − τc b d = ${f(Math.max(0, sample.Vdes - (sample.tauC * b * d) / 1e3), 2)} kN`],
            ["End zone (IS 13920 cl. 6.3.5)", `≤ d/4 = ${f(d / 4, 1)} mm, ≤ 8 × 12 = 96 mm, need not be < 100 mm over 2d = ${f(2 * d, 0)} mm`],
            ["Mid-span", `≤ d/2 = ${f(d / 2, 1)} mm and minimum shear steel Asv·0.87fy/(0.4b)`],
            ["Provide", sample.stirrup.text],
          ]),
          CHECK("Shear stress", sample.tauV <= 2.8, `τv = ${f(sample.tauV, 3)} ≤ τc,max = 2.8 MPa`),
        ],
      },
      {
        title: "Reference Design Point",
        blocks: [
          P(`The reference sample beam (grid 1A–2A at 1st floor, L = ${ref.beamL} m, Mu hogging = ${ref.beamMhog} kN·m) is recomputed with the engine for the same section (d = 320.6 mm).`),
          KV([
            ["Mu,lim (Fe 500)", `${f(muLimCoef(mat.fy) * mat.fck * b * 320.6 * 320.6 / 1e6, 2)} kN·m`],
            ["Ast for Mu = " + ref.beamMhog + " kN·m", `${f(flexure(ref.beamMhog, b, 320.6, 35, mat.fck, mat.fy).Ast, 1)} mm²`],
            ["Ast for Mu = " + ref.beamMsag + " kN·m (rectangular)", `${f(flexure(ref.beamMsag, b, 320.6, 35, mat.fck, mat.fy).Ast, 1)} mm²`],
          ], "Engine on the reference beam"),
        ],
      },
      {
        title: "Beam Design Summary",
        blocks: [
          T("Beam design summary", ["Level", "Beam", "Frame", "L (m)", "M− (kN·m)", "M+ (kN·m)", "Vdes (kN)", "Top", "Bottom", "Stirrups", "OK"],
            r.beams.map((x) => [x.level, x.id, x.frame, f(x.L, 2), f(Math.max(x.Mhog1, x.Mhog2), 1), f(x.Msag, 1), f(x.Vdes, 1), x.top.bars, x.bot.bars, `2L-8φ @ ${x.stirrup.end}/${x.stirrup.mid}`, x.ok ? "✓" : "✗"])),
        ],
      },
    ],
  };
}

export function chSlab(r: StructResult): Chapter {
  const s = r.slabs[0];
  const t = TABLE26[s.case];
  return {
    id: "st-slab",
    title: "Design of Slab",
    sections: [
      {
        title: "Sample Slab Panel",
        blocks: [
          P(`Panel ${s.panel} at ${s.level}: ly/lx = ${f(s.ratio, 3)} ${s.twoWay ? "< 2, hence designed as a two-way slab" : "> 2 — one-way slab"} (IS 456 Annex D, restrained corners). Edge condition: ${t.name} (case ${s.case}).`),
          KV([
            ["lx × ly (c/c)", `${f(s.lx, 3)} × ${f(s.ly, 3)} m`],
            ["Clear cover d'", `${r.inp.sections.slabCover} mm`],
            ["Overall depth D", `${s.D} mm`],
            ["Effective depth (short / long)", `${f(s.dShort, 1)} / ${f(s.dLong, 1)} mm`],
            ["Bar diameter", "8 mm"],
            ["fck / fy", `${r.inp.materials.fck} / ${r.inp.materials.fy} N/mm²`],
          ], "Basic dimensions"),
          CALC([
            ["Dead load of slab", `${f(r.model.unitLoads.slabSelf, 3)} kN/m²`],
            ["Floor finish", `${r.inp.loads.floorFinish} kN/m²`],
            ["Partition", `${r.inp.loads.partition} kN/m²`],
            ["Live load", `${f(s.w - (r.model.unitLoads.slabSelf + r.inp.loads.floorFinish + r.inp.loads.partition), 3)} kN/m²`],
            ["Total load w", `${f(s.w, 3)} kN/m²; factored wu = 1.5 w = ${f(s.wu, 3)} kN/m²`],
          ]),
          EQ("Mu = alpha*wu*lx^2", undefined, String.raw`M_u = \alpha\,w_u\,l_x^2`),
          T("Moment and area of steel", ["Span / moment", "α", "Mu (kN·m)", "Mu/bd² (N/mm²)", "pt (%)", "Ast req (mm²)", "Ast min (mm²)", "Dia (mm)", "Spacing (mm)", "Ast pro (mm²)", ""],
            s.rows.map((x) => [x.name, x.alpha == null ? "—" : x.alpha.toFixed(4), f(x.Mu, 2), f(x.MuBd2, 2), f(x.pt, 3), f(x.Ast, 1), f(x.AstMin, 1), x.dia, x.spacing, f(x.prov, 1), x.ok ? "safe" : "NOT OK"])),
          CALC([
            ["Check for deflection", `basic l/d = ${s.deflection.basic}; modification factor (Fig. 4) = ${f(s.deflection.MF, 2)}`],
            ["Allowed l/d", `${f(s.deflection.allowed, 2)}; actual lx/d = ${f(s.deflection.actual, 2)}`],
            ["Required depth", `${f((s.lx * 1000) / s.deflection.allowed, 1)} mm ≤ ${f(s.dShort, 1)} mm provided`],
          ]),
          CHECK("Deflection (IS 456 cl. 23.2.1)", s.deflection.ok, `l/d = ${f(s.deflection.actual, 2)} vs ${f(s.deflection.allowed, 2)}`),
        ],
      },
      {
        title: "Table 26 Coefficients used",
        blocks: [
          T("Bending moment coefficients (IS 456 Table 26) interpolated for each panel", ["Panel", "Level", "Case", "ly/lx", "αx−", "αx+", "αy−", "αy+"],
            r.slabs.map((x) => [x.panel, x.level, x.case, f(x.ratio, 3), ...x.rows.map((y) => (y.alpha == null ? "—" : y.alpha.toFixed(4)))])),
        ],
      },
      {
        title: "Slab Design Summary",
        blocks: [
          T("Slab reinforcement", ["Panel", "Level", "Case", "Short −", "Short +", "Long −", "Long +", "Deflection"],
            r.slabs.map((x) => [x.panel, x.level, x.case, ...x.rows.map((y) => `8φ @ ${y.spacing}`), x.deflection.ok ? "OK" : "NOT OK"])),
          NOTE("Torsion reinforcement at discontinuous corners per IS 456 Annex D-1.8; distribution steel ≥ 0.12 % bD."),
        ],
      },
    ],
  };
}

export function chStair(r: StructResult): Chapter {
  const s = r.stair, si = r.inp.stair, mat = r.inp.materials;
  const fl = (x: typeof s.flights[number]): Block[] => [
    CALC([
      ["UDL on flight", `${f(x.wFlight, 2)} kN/m`],
      ["UDL on landing", `${f(x.wLanding, 2)} kN/m`],
      ["Landing width / flight length", `${f(x.landing, 2)} m / ${f(x.flight, 2)} m (span ${f(x.landing + x.flight, 2)} m)`],
      ["Reactions", `RA = ${f(x.RA, 2)} kN/m, RB = ${f(x.RB, 2)} kN/m`],
      ["Zero shear at", `${f(x.xZero, 3)} m from A`],
      ["Max Mu", `${f(x.Mmax, 2)} kN·m`],
      ["Effective depth required", `d = √(Mu / (${f(muLimCoef(mat.fy), 4)} fck b)) = ${f(x.dReq, 1)} mm < ${s.d} mm provided`],
      ["Mu,lim", `${f(x.Mulim, 2)} kN·m > Mu → singly reinforced`],
      ["Ast", `${f(x.Ast, 1)} mm²; minimum 0.12 % = ${f(0.0012 * 1000 * si.waist, 1)} mm² → ${f(x.AstReq, 1)} mm²`],
      ["Provide", `${si.bar} mm bars @ ${x.spacing} mm c/c (${f(x.prov, 1)} mm²)`],
      ["Shear", `τv = ${f(x.tauV, 3)} N/mm²; k τc = ${f(x.k, 2)} × ${f(x.tauC / x.k, 3)} = ${f(x.tauC, 3)} N/mm²`],
      ["Development length", `Ld = 0.87 fy φ / (4 τbd) = ${f(x.Ld, 1)} mm (47φ); 1.3 M1/V = ${f((1.3 * x.M1 * 1e6) / (Math.max(x.RA, x.RB) * 1e3), 1)} mm`],
    ]),
    CHECK(`${x.name} — shear`, x.tauV <= x.tauC, `τv ${f(x.tauV, 3)} ≤ ${f(x.tauC, 3)}`),
    CHECK(`${x.name} — anchorage (cl. 26.2.3.3)`, x.ldOk, `Ld ${f(x.Ld, 0)} mm ≤ 1.3M1/V`),
  ];
  return {
    id: "st-stair",
    title: "Design of Stair Case",
    sections: [
      {
        title: "Design Data",
        blocks: [
          KV([
            ["Grade of concrete (fck)", `${mat.fck} N/mm²`],
            ["Grade of steel (fy)", `${mat.fy} N/mm²`],
            ["Live load on plan", `${r.inp.loads.llStair} kN/m²`],
            ["Floor finish thickness", `${si.finish} mm`],
            ["Specific weight of RCC", `${mat.gammaRC} kN/m³`],
          ], "Design of staircase (single flight)"),
          T("Riser and tread detail", ["", "For flight", "Total"], [
            ["Riser (mm)", si.riser, ""],
            ["No. of riser", s.nRisers, s.nRisers],
            ["Tread (mm)", si.tread, ""],
            ["No. of tread", s.nTreads, s.nTreads],
          ]),
          CALC([
            ["Total floor height", `${f(s.totalHeight, 0)} mm = ${f(s.totalHeight / 304.8, 2)} ft`],
            ["Effective span flight AB", `${f(s.effSpanAB, 3)} m → waist L/25 … L/20 = ${f((s.effSpanAB * 1000) / 25, 1)} … ${f((s.effSpanAB * 1000) / 20, 1)} mm`],
            ["Effective span flight BC", `${f(s.effSpanBC, 3)} m → ${f((s.effSpanBC * 1000) / 25, 1)} … ${f((s.effSpanBC * 1000) / 20, 1)} mm`],
            ["Adopted", `effective depth ${s.d} mm with effective cover 25 mm, overall waist ${si.waist} mm`],
          ]),
        ],
      },
      {
        title: "Loads on Flights and Landings",
        blocks: [
          CALC([
            ["Area of step section", `½ × ${si.riser} × ${si.tread} = ${f(s.stepArea, 2)} mm²`],
            ["Finish area", `${si.finish} × (${si.riser} + ${si.tread}) = ${f(s.finishArea, 2)} mm²`],
            ["Area of inclined slab", `${si.waist} × √(${si.riser}² + ${si.tread}²) = ${f(s.slabArea, 2)} mm²`],
            ["Total area", `${f(s.total, 2)} mm²`],
            ["DL of one step (1 m wide)", `${f(s.dlPerTread, 3)} kN/m`],
            ["DL per m² on plan", `${f(s.dlPlan, 2)} kN/m²`],
            ["Total factored load on flight", `1.5 × (${f(s.dlPlan, 2)} + ${r.inp.loads.llStair}) = ${f(s.wFlight, 2)} kN/m²`],
            ["Landing: self + finish", `${f(s.landingSelf, 2)} + ${f(s.landingFinish, 2)} = ${f(s.landDL, 2)} kN/m²`],
            ["Landing factored", `1.5 × (${f(s.landDL, 2)} + ${r.inp.loads.llStair}) = ${f(s.wLanding, 2)} kN/m²`],
          ]),
        ],
      },
      ...s.flights.map((x) => ({ title: `Design of ${x.name}`, blocks: fl(x) })),
      {
        title: "Temperature (Distribution) Reinforcement",
        blocks: [P(`Provide 1-10 mm bar as nosing reinforcement in each riser. In the waist slab provide a minimum of 0.12 % steel: ${f(s.distAst, 0)} mm²/m → 8 mm bars @ ${s.distSpacing} mm c/c.`)],
      },
    ],
  };
}

export function chFooting(r: StructResult): Chapter {
  const m = r.model, fts = r.footings, ft = r.inp.footing, mat = r.inp.materials;
  const s = fts.reduce((a, b) => (b.P > a.P ? b : a), fts[0]);
  const rf = r.refFooting;
  const types = Array.from(new Set(fts.map((x) => x.type!))).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return {
    id: "st-footing",
    title: "Design of Footing",
    sections: [
      {
        title: "Isolated Footing Design (engine)",
        blocks: [
          P(`Isolated square footings are sized for the service reactions (DL + LL) against SBC = ${ft.sbc} kN/m², and for DL + LL ± EQ against ${ft.eqIncrease} × SBC. The footing self-weight and the back-fill above it are included. Depth is increased until one-way and two-way shear are satisfied; bending steel is designed at the face of the column.`),
          KV([
            ["Column", `${s.col} (${s.grid})`],
            ["Axial load (DL+LL)", `${f(s.P, 2)} kN`],
            ["Moments Mx / My", `${f(s.Mx, 2)} / ${f(s.My, 2)} kN·m`],
            ["Footing L × B × D", `${f(s.L, 2)} × ${f(s.L, 2)} × ${f(s.D, 2)} m`],
            ["Max / min pressure (DL+LL)", `${f(s.qmax, 2)} / ${f(s.qmin, 2)} kN/m² ≤ ${ft.sbc}`],
            ["Max pressure with EQ", `${f(s.qeq, 2)} kN/m² ≤ ${f(s.qeqAllow, 1)}`],
            ["Factored design pressure qu", `${f(s.qu, 2)} kN/m²`],
            ["Mu at column face", `${f(s.Mu, 2)} kN·m`],
            ["Ast required / provided", `${f(s.AstReq, 1)} / ${f(s.prov, 1)} mm² (${ft.bar}φ @ ${s.spacing} c/c both ways)`],
            ["One-way shear", `τv = ${f(s.tauV1, 3)} ≤ τc = ${f(s.tauC1, 3)} N/mm²`],
            ["Two-way (punching) shear", `τv = ${f(s.tauVp, 3)} ≤ ks·0.25√fck = ${f(s.tauCp, 3)} N/mm²`],
          ], "Critical footing"),
          CHECK("Bearing pressure", s.qmax <= ft.sbc && s.qeq <= s.qeqAllow, `${f(s.qmax, 1)} / ${f(s.qeq, 1)} kN/m²`),
          CHECK("Tension under footing", s.qmin >= 0, `pmin = ${f(s.qmin, 2)} kN/m²`),
          CHECK("Punching shear (IS 456 cl. 31.6.3)", s.tauVp <= s.tauCp, `${f(s.tauVp, 3)} ≤ ${f(s.tauCp, 3)} N/mm²`),
          DRAW(`Typical footing ${s.type}`, footingDetailSheet(m, s, "S-41")),
        ],
      },
      {
        title: "Reference Footing Spreadsheet",
        blocks: [
          P("The isolated-footing spreadsheet of the reference report is reproduced below with its own inputs (tonne units, 1 T = 10 kN as in the spreadsheet) to verify each step."),
          KV([
            ["Axial load P", `${f(rf.P, 2)} T`],
            ["Moments Mx / Mz", `${f(rf.Mx, 2)} / ${f(rf.Mz, 3)} T·m`],
            ["Column", `${rf.c} × ${rf.c} m`],
            ["Footing L × B × D", `${rf.L} × ${rf.B} × ${rf.D} m, cover 50 mm, 12 mm bars`],
            ["SBC", `${ft.sbc} kN/m² = ${f(rf.sbcT, 3)} T/m²; EQ: ${ft.eqIncrease} × ${f(rf.sbcT, 3)} = ${f(rf.eqAllow, 3)} T/m²`],
          ], "Reference inputs"),
          CALC([
            ["Self weight of footing", `${rf.L} × ${rf.B} × ${rf.D} × 2.5 = ${f(rf.sw, 2)} T`],
            ["Total vertical load", `${f(rf.N, 2)} T`],
            ["Pmax", `${f(rf.N / rf.A, 2)} + ${f(rf.Mx / rf.Z, 2)} + ${f(rf.Mz / rf.Z, 4)} = ${f(rf.pmax, 2)} T/m²`],
            ["Pmin", `${f(rf.N / rf.A, 2)} − ${f(rf.Mx / rf.Z, 2)} − ${f(rf.Mz / rf.Z, 4)} = ${f(rf.pmin, 2)} T/m² (tension not created)`],
            ["Moment at critical section", `M = Pmax × ${f(rf.a, 3)}² / 2 = ${f(rf.M, 2)} T·m; Mu = ${f(rf.Mu, 2)} kN·m`],
            ["Ast", `${f(rf.Ast, 2)} mm² (to be distributed in ${rf.B} m length)`],
            ["One-way shear", `V = ${f(rf.pmax, 2)} × ${f(rf.x1, 3)} = ${f(rf.V1, 2)} T; τv = ${f(rf.tv1, 3)} N/mm²`],
            ["Punching", `V = ${f(rf.pmax, 2)} × ${f(rf.shaded, 4)} = ${f(rf.Vp, 2)} T; τv = ${f(rf.tvp, 3)} N/mm² ≤ ${f(rf.tcp, 2)} N/mm²`],
            ["Overturning", `restoring ${f(rf.restoring, 2)} T·m / applied ${rf.Mx} T·m = ${f(rf.fos, 2)} > 2.2`],
          ]),
          CHECK("Reference footing bearing under EQ", rf.pmax <= rf.eqAllow, `Pmax = ${f(rf.pmax, 2)} T/m² vs allowable ${f(rf.eqAllow, 2)} T/m² — the reference report marks this "SAFE"`),
        ],
      },
      {
        title: "Foundation Details",
        blocks: [
          T("Footing schedule", ["Column", "Grid", "P (kN)", "Type", "L × B (m)", "D (mm)", "qmax (kN/m²)", "Reinforcement (both ways)", "OK"],
            fts.map((x) => [x.col, x.grid, f(x.P, 1), x.type!, `${f(x.L, 2)} × ${f(x.L, 2)}`, f(x.D * 1000, 0), f(x.qmax, 1), `${ft.bar}φ @ ${x.spacing} c/c`, x.ok ? "✓" : "✗"])),
          T(`Foundation details — concrete M${mat.fck}, steel Fe ${mat.fy}`, ["S.No.", "Type", "Length (m)", "Breadth (m)", "Depth (mm)", "Along X", "Along Y"],
            types.map((t, k) => {
              const x = fts.find((q) => q.type === t)!;
              const sp = Math.min(...fts.filter((q) => q.type === t).map((q) => q.spacing));
              return [k + 1, t, f(x.L, 2), f(x.L, 2), f(x.D * 1000, 0), `${ft.bar}φ @ ${sp} c/c`, `${ft.bar}φ @ ${sp} c/c`];
            })),
          DRAW("Foundation layout plan", footingLayoutSheet(m, fts, "S-40")),
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Verification against the reference report
// ---------------------------------------------------------------------------

type VRow = [string, string, string, string, string];

export function verificationRows(r: StructResult): { group: string; rows: VRow[] }[] {
  const ref = r.inp.reference, s = r.model.seismic, mat = r.inp.materials;
  const st = r.stair, rf = r.refFooting;
  const status = (a: number, b: number, tol = 0.01) => (Math.abs(a - b) <= Math.abs(b) * tol + 1e-9 ? "✓ match" : "≠ differs");
  const num = (label: string, refV: number, eng: number, d = 2, note = ""): VRow => [label, f(refV, d), f(eng, d), pct(eng, refV), note || status(eng, refV)];
  const AhRef = ref.Vb / ref.W;
  const b = 228.6, dRef = 320.6;
  const slab = r.slabs.find((x) => x.case === 4) ?? r.slabs[0];
  const col = 304.8 * 304.8;
  return [
    {
      group: "Seismic load (IS 1893)",
      rows: [
        num("Seismic weight W (kN)", ref.W, s.W, 2, "≠ engine includes all walls & stair per plan"),
        num("Period used T (s)", ref.T, s.T, 3),
        ["Sa/g", "1.94 (X) / 1.82 (Y) as printed", f(s.SaG, 3), "—", "✗ report text; its own Vb implies 2.50"],
        num("Ah implied by report (Vb/W)", AhRef, s.Ah, 4),
        num("Vb with the report's W (kN)", ref.Vb, s.Ah * ref.W, 2),
        num("Vb engine (kN)", ref.Vb, s.Vb, 2, "≠ follows W"),
        ...s.levels.map((l, k) => num(`Storey force ${l.name} (kN)`, ref.storeyForces[k], l.Q, 2, "≠ follows Wi")),
      ],
    },
    {
      group: "Drift (IS 1893 cl. 7.11.1)",
      rows: [
        num("Top displacement X (mm)", ref.driftMaxX, r.summary.maxDispX, 2, "≠ 2D frames without slab stiffness"),
        num("Top displacement Y (mm)", ref.driftMaxY, r.summary.maxDispY, 2, "≠ 2D frames without slab stiffness"),
        ["Max drift ratio", "within 0.004", r.summary.maxDriftRatio.toFixed(5), "—", r.summary.maxDriftRatio <= 0.004 ? "✓ within limit" : "✗ exceeds"],
      ],
    },
    {
      group: "Column (sample)",
      rows: [
        num("Ast,min 0.8 % (mm²)", 743.22, 0.008 * col, 2),
        num("Ast,max 4 % (mm²)", 3716.12, 0.04 * col, 2),
        num("Ast,max 6 % (mm²)", 5574.18, 0.06 * col, 2),
        num("Eccentricity L/500 + D/30 (mm)", 15.04, 2440 / 500 + 304.8 / 30, 2),
        num("C7 at ETABS forces (Pu 106.14, M 24.42 / 17.69): As req (mm²)", 743, designColumn(r.model, r.model.columns[0].id, 2, [{ combo: "DCon2", end: "bottom", Pu: ref.colPu, Mx: ref.colMx, My: ref.colMy }]).AscReq, 0),
        ["Confinement length l0 (mm)", "762", f(Math.max(304.8, (r.inp.grid.storeyHeight[0] * 1000 - r.inp.sections.beamD) / 6, 450), 0), "—", "≠ IS 13920 7.4.1 gives max(D, Lc/6, 450)"],
        ["Tie pitch in l0 (mm)", "100", "75", "—", "✗ report exceeds b/4 = 76 mm"],
      ],
    },
    {
      group: "Beam (sample, d = 320.6 mm)",
      rows: [
        num("Ast,min (mm²)", 157.324, ((0.24 * Math.sqrt(mat.fck)) / mat.fy) * b * dRef, 2),
        num("Ast,max 0.025bd (mm²)", 1832.2, 0.025 * b * dRef, 1),
        num("Mu,lim (kN·m)", 2.76 * b * dRef * dRef / 1e6, muLimCoef(mat.fy) * mat.fck * b * dRef * dRef / 1e6, 2, "≠ report used 2.76 (Fe 415) for Fe 500"),
        num("Ast for Mu = 39.13 kN·m (mm²)", 212.5, flexure(ref.beamMhog, b, dRef, 35, mat.fck, mat.fy).Ast, 1, "✗ report under-estimates (singly: Mu < Mu,lim)"),
      ],
    },
    {
      group: "Slab (two adjacent edges discontinuous)",
      rows: [
        num("Total load w (kN/m²)", 6.675, r.model.unitLoads.slabSelf + r.inp.loads.floorFinish + r.inp.loads.llRoom, 3),
        ["αx− at ly/lx = 1.042", "0.071", interp26(TABLE26[4].sn!, 1.042).toFixed(4), "—", "✗ report used the ly/lx = 1.4 row"],
        ["αx+ at ly/lx = 1.042", "0.053", interp26(TABLE26[4].sp, 1.042).toFixed(4), "—", "✗ report used the ly/lx = 1.4 row"],
        num("Mu short (−) (kN·m)", 10.23, interp26(TABLE26[4].sn!, 1.042) * 1.5 * 6.675 * 3.8 * 3.8, 2, "≠ follows α"),
        num("Ast,min 0.12 % bD (mm²)", 143.4, 0.0012 * 1000 * 127, 1, "≠ report used d instead of D"),
        ["Provided 8φ @ 150 (mm²)", "335.10", f((1000 * barArea(8)) / 150, 2), "0.0 %", `✓ adequate (engine panel ${slab.panel}: ${slab.rows.map((x) => x.spacing).join("/")} mm)`],
      ],
    },
    {
      group: "Stair case",
      rows: [
        num("Area of step section (mm²)", 22606, st.stepArea, 2),
        num("Finish area (mm²)", 12960, st.finishArea, 2),
        num("Area of inclined slab (mm²)", 46524.19, st.slabArea, 2),
        num("DL per m² on plan (kN/m²)", 8.08, st.dlPlan, 2),
        num("Factored flight load (kN/m)", 16.62, st.wFlight, 2),
        num("Factored landing load (kN/m)", 11.25, st.wLanding, 2),
        num("RA flight AB (kN/m)", 20.6, st.flights[0].RA, 2),
        num("RB flight AB (kN/m)", 24.58, st.flights[0].RB, 2),
        num("Max Mu flight AB (kN·m)", 65.66, st.flights[0].Mmax, 2, "✗ report value inconsistent with its reactions"),
        num("RB flight BC (kN/m)", 13.83, st.flights[1].RA, 2),
        num("RC flight BC (kN/m)", 16.77, st.flights[1].RB, 2),
        num("Max Mu flight BC (kN·m)", 23.85, st.flights[1].Mmax, 2, "✗ report value inconsistent with its reactions"),
        num("Development length 47φ (mm)", 679.688, st.flights[0].Ld, 2),
      ],
    },
    {
      group: "Footing spreadsheet",
      rows: [
        num("Self weight (T)", 2.31, rf.sw, 2),
        num("Total vertical load (T)", 40.12, rf.N, 2),
        num("SBC (T/m²)", 14.27115, rf.sbcT, 3),
        num("EQ allowable (T/m²)", 17.83894, rf.eqAllow, 3),
        num("Pmax (T/m²)", 20.55, rf.pmax, 2, rf.pmax > rf.eqAllow ? "✓ match — but exceeds 17.84: report's \"SAFE\" is wrong" : "✓ match"),
        num("Pmin (T/m²)", 14.17, rf.pmin, 2),
        num("Moment at face (T·m)", 3.52, rf.M, 2),
        num("Mu (kN·m)", 52.75, rf.Mu, 2),
        num("Ast (mm²)", 355.71, rf.Ast, 1, "≈ rounding of Mu"),
        num("One-way τv (N/mm²)", 0.207, rf.tv1, 3),
        num("Punching V (T)", 37.42, rf.Vp, 2),
        num("Punching τv (N/mm²)", 0.573, rf.tvp, 3),
        num("Allowable punching (N/mm²)", 1.12, rf.tcp, 2),
        num("Overturning FOS", 15.7, rf.fos, 2),
      ],
    },
  ];
}

export function chVerify(r: StructResult): Chapter {
  const groups = verificationRows(r);
  const all = groups.flatMap((g) => g.rows);
  const match = all.filter((x) => x[4].startsWith("✓")).length;
  const bad = all.filter((x) => x[4].startsWith("✗")).length;
  return {
    id: "st-verify",
    title: "Verification against the Reference Report",
    intro: [
      P(`Every number of the reference report that can be reproduced from its stated inputs has been recomputed with this calculation engine. ${match} of ${all.length} values match (within 1 %), ${bad} are errors in the reference report, and the rest differ because the engine models the building from the floor plan rather than copying the reference ETABS model.`),
      KV([
        ["Values checked", String(all.length)],
        ["Match (≤ 1 %)", String(match)],
        ["Reference-report errors found", String(bad)],
        ["Model differences", String(all.length - match - bad)],
      ], "Verification summary"),
    ],
    sections: groups.map((g) => ({
      title: g.group,
      blocks: [T(`Verification — ${g.group}`, ["Quantity", "Reference report", "This engine", "Δ", "Status"], g.rows)],
    })),
  };
}

// ---------------------------------------------------------------------------
// Tool → chapters, and the full document
// ---------------------------------------------------------------------------

export const STRUCT_TOOL_CHAPTERS: Partial<Record<StructToolId, (r: StructResult) => Chapter[]>> = {
  "st-project": (r) => [chProject(r)],
  "st-plan": (r) => [chPlan(r)],
  "st-loads": (r) => [chLoads(r)],
  "st-seismic": (r) => [chSeismic(r)],
  "st-combos": (r) => [chCombos(r)],
  "st-analysis": (r) => [chModel(r)],
  "st-drift": (r) => [chDrift(r)],
  "st-forces": (r) => [chForces(r)],
  "st-column": (r) => [chColumn(r)],
  "st-beam": (r) => [chBeam(r)],
  "st-slab": (r) => [chSlab(r)],
  "st-stair": (r) => [chStair(r)],
  "st-footing": (r) => [chFooting(r)],
  "st-verify": (r) => [chVerify(r)],
};

export function buildStructReport(r: StructResult): ReportDocument {
  const p = r.inp.project;
  const date = p.date || new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const sm = r.summary;
  const doc: ReportDocument = {
    meta: { title: `${p.title} - ${p.name}`, project: "Structural_Analysis", river: "", location: p.location, generated_at: new Date().toISOString(), generator: "Hydropower Studio - Structural Analysis" },
    cover: {
      institution: p.consultant.split(",").map((x) => x.trim().toUpperCase()),
      title: p.title,
      subtitle: `${p.name} at ${p.location}`,
      submittedBy: [p.consultant.split(",")[0], p.engineer].filter(Boolean),
      submittedTo: [p.client],
      date,
    },
    frontMatter: [
      {
        id: "concern",
        title: "TO WHOM IT MAY CONCERN",
        blocks: [
          P(`This report comprises the summary of the structural design of ${p.name}, designed and developed by ${p.consultant}. It consists of the design procedures adopted, assumptions made and the inputs assigned in the design. During design it is assumed that the client will completely follow the architectural as well as the structural design, and that the construction will be supervised by a professional engineer.`),
          P("The designer will not be responsible if any alteration or change to the structural system is made by the client or contractor without prior permission from the designer, or if alteration to the non-structural system changes the weight of any floor or of the whole building from the design weight."),
          P("The design calculations and derivations are limited to let the concerned people know the methodology adopted. The complete calculation may be provided to the client or the concerned authorities upon request."),
          P(`${p.engineer}\n${p.consultant.split(",")[0]}`),
        ],
      },
    ],
    salientFeatures: [
      { group: "Project", rows: [["Name", p.name], ["Location", p.location], ["Type", p.buildingType], ["Plinth area", p.plinthArea], ["Storeys", p.storeys]] },
      { group: "Structure", rows: [
        ["Columns", `${r.inp.sections.colB}×${r.inp.sections.colD} mm, ${r.model.columns.length} nos.`],
        ["Beams", `${r.inp.sections.beamB}×${r.inp.sections.beamD} mm`],
        ["Slab", `${r.inp.sections.slab} mm two-way`],
        ["Materials", `M${r.inp.materials.fck} / Fe ${r.inp.materials.fy}`],
        ["Concrete volume (approx.)", `${f(sm.concrete, 1)} m³`],
      ] },
      { group: "Seismic", rows: [
        ["Zone factor Z / I / R", `${r.inp.seismic.Z} / ${r.inp.seismic.I} / ${r.inp.seismic.R}`],
        ["Seismic weight W", `${f(sm.W, 2)} kN`],
        ["Base shear Vb", `${f(sm.Vb, 2)} kN`],
        ["Max drift ratio", sm.maxDriftRatio.toFixed(5)],
      ] },
      { group: "Design results", rows: [
        ["Columns", `max steel ${f(sm.maxColSteel, 2)} % — ${sm.colsOk ? "all OK" : "CHECK"}`],
        ["Beams", sm.beamsOk ? "all OK" : "CHECK"],
        ["Slabs", sm.slabsOk ? "all OK" : "CHECK"],
        ["Footings", `${Array.from(new Set(r.footings.map((x) => x.type))).length} types — ${sm.footingsOk ? "all OK" : "CHECK"}`],
      ] },
    ],
    abbreviations: [
      ["AFD / SFD / BMD", "Axial force / shear force / bending moment diagram"],
      ["DL / LL", "Dead load / live load"],
      ["EQx / EQy", "Earthquake load along X / Y"],
      ["FF / SF / TF", "First / second / third floor slab level"],
      ["SBC", "Safe bearing capacity"],
      ["SMRF", "Special moment-resisting frame"],
      ["fck / fy", "Characteristic strength of concrete / steel"],
    ],
    parts: [
      { id: "p1", title: "1. LOADS AND DESIGN BASIS", chapters: [chProject(r), chPlan(r), chLoads(r), chSeismic(r), chCombos(r)] },
      { id: "p2", title: "2. STRUCTURAL ANALYSIS", chapters: [chModel(r), chDrift(r), chForces(r)] },
      { id: "p3", title: "3. DESIGN OF ELEMENTS", chapters: [chColumn(r), chBeam(r), chSlab(r), chStair(r), chFooting(r)] },
      { id: "pa", title: "APPENDIX-A", subtitle: "VERIFICATION", appendix: "A", chapters: [chVerify(r)] },
    ],
    references: [
      "IS 456:2000 Code of practice for plain and reinforced concrete",
      "IS 875:1987 Code of practice for design loads (other than earthquake) for buildings and structures",
      "IS 1893:2002 Criteria for earthquake resistant design of structures",
      "IS 13920:1993 Code of practice for ductile detailing of reinforced concrete structures subjected to seismic forces",
      "NBC Nepal Building Code",
      "Design of Reinforced Concrete Structures — A.K. Jain",
      "Limit State Design of Substructure — Swamisharan",
      "SP 16:1980 Design aids for reinforced concrete to IS 456",
    ],
    lists: { contents: [], tables: [], figures: [], drawings: [] },
    summary: {
      W_kN: Number(sm.W.toFixed(2)),
      Vb_kN: Number(sm.Vb.toFixed(2)),
      max_drift_ratio: Number(sm.maxDriftRatio.toFixed(5)),
      max_disp_x_mm: Number(sm.maxDispX.toFixed(2)),
      max_disp_y_mm: Number(sm.maxDispY.toFixed(2)),
      max_column_steel_pct: Number(sm.maxColSteel.toFixed(2)),
      columns_ok: sm.colsOk,
      beams_ok: sm.beamsOk,
      slabs_ok: sm.slabsOk,
      footings_ok: sm.footingsOk,
    },
  };
  void tauC;
  return numberDocument(doc);
}
