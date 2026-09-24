/** A 2-STOREY BUILDING: 12 columns on a 4 × 3 grid, as a canvas plan the frame flow can analyse —
 *  plus the matching floor plan with slab panels, and the abstract model the PyNite reference reads.
 *
 *  THE GRID IS A PLAN; THE ANALYSIS IS AN ELEVATION. Those are different drawings, and the honest way
 *  to put a 3D building through a PLANE frame solver is the way it is done in practice: take the
 *  building apart into FRAME LINES and analyse each. The 4 × 3 grid gives three frame lines of four
 *  columns in the X direction, and all three are drawn side by side on one canvas — which is also how
 *  they would appear on a drawing sheet. The solver handles them at once because each has its own
 *  supports; they are three independent components of one stiffness matrix, not one frame.
 *
 *  THE BEAM LOADS COME FROM THE SLAB OBJECT, not from a guess: a 6.0 × 5.0 m panel at 150 mm with
 *  1.5 kN/m² finishes and 3.0 imposed gives 8.25 kN/m² and a tributary UDL of 12.03 kN/m on each 6 m
 *  edge beam. An INTERIOR frame line collects a panel from both sides and takes twice that. The same
 *  arithmetic at roof level with 1.5 imposed gives 9.84 / 19.69.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PPM = 20;
const PAD = 2;

const OBJ = {
  beam: { id: "frame-beam-with-math", path: "Objects/Structural/frame-beam.json" },
  column: { id: "frame-column-with-math", path: "Objects/Structural/frame-column.json" },
  joint: { id: "frame-joint-with-math", path: "Objects/Structural/frame-joint.json" },
  slab: { id: "slab-with-math", path: "Objects/Structural/slab.json" },
};
const r4 = (v) => +Number(v).toFixed(4);

// ── The building ──────────────────────────────────────────────────────────────
const BAYS_X = [6, 6, 6];        // 4 columns in X
const BAYS_Y = [5, 5];           // 3 grid lines in Y  → 4 × 3 = 12 columns
const STOREY = [3.5, 3.5];       // 2 storeys
const FRAME_GAP = 6;             // metres between frame elevations on the sheet
const E = 25;                    // GPa
const COL = [0.30, 0.45];        // b (out of plane), h (in plane)
const BM = [0.30, 0.55];

/** Slab: 6.0 × 5.0 panel, 150 mm, service combination. Numbers mirror the Slab object exactly. */
const slabUdl = (imposed) => {
  const t = 0.150, w = t * 25 + 1.5 + imposed;
  const Lx = 5, Ly = 6;                       // short, long
  return w * Lx * (2 * Ly - Lx) / (4 * Ly);   // tributary UDL on the 6 m (long) edge
};
const FLOOR_EDGE = slabUdl(3.0);
const ROOF_EDGE = slabUdl(1.5);
/** Interior frame lines pick up a panel from BOTH sides. */
const udlFor = (line, level) => {
  const interior = line === 1;
  const base = level === STOREY.length ? ROOF_EDGE : FLOOR_EDGE;
  return r4(base * (interior ? 2 : 1));
};
/** Notional lateral load per frame line and level, larger on the interior line for the same reason. */
const lateralFor = (line, level) => r4((line === 1 ? 2 : 1) * (level === 1 ? 8 : 13));

const xs = BAYS_X.reduce((a, b) => [...a, a[a.length - 1] + b], [0]);
const levels = STOREY.reduce((a, b) => [...a, a[a.length - 1] + b], [0]);
const frameWidth = xs[xs.length - 1];

const nodes = {}, members = {}, supports = {}, loads = {}, udl = {};
BAYS_Y.concat([0]).forEach((_, line) => {           // 3 frame lines
  const ox = line * (frameWidth + FRAME_GAP);
  xs.forEach((x, c) => levels.forEach((y, L) => { nodes[`F${line}C${c}L${L}`] = [ox + x, y]; }));
  xs.forEach((_, c) => levels.forEach((__, L) => {
    if (L < levels.length - 1) members[`F${line}C${c}S${L}`] = [`F${line}C${c}L${L}`, `F${line}C${c}L${L + 1}`, "column"];
  }));
  xs.forEach((_, c) => { if (c < xs.length - 1) levels.forEach((__, L) => {
    if (L > 0) { members[`F${line}B${c}L${L}`] = [`F${line}C${c}L${L}`, `F${line}C${c + 1}L${L}`, "beam"]; udl[`F${line}B${c}L${L}`] = udlFor(line, L); }
  }); });
  xs.forEach((_, c) => { supports[`F${line}C${c}L0`] = [true, true, true]; });
  levels.forEach((__, L) => { if (L > 0) loads[`F${line}C0L${L}`] = [lateralFor(line, L), 0, 0]; });
});

// ── Canvas plan ───────────────────────────────────────────────────────────────
const ids = Object.keys(nodes);
const maxY = Math.max(...ids.map((n) => nodes[n][1]));
const minX = Math.min(...ids.map((n) => nodes[n][0]));
const pos = Object.fromEntries(ids.map((n) => {
  const [x, y] = nodes[n];
  return [n, { x: r4(((x - minX) + PAD) * PPM), y: r4(((maxY - y) + PAD) * PPM) }];
}));

const segments = Object.entries(members).map(([nm, [i, j, kind]]) => {
  const [b, h] = kind === "column" ? COL : BM;
  return {
    id: `mem_${nm}`, fromNodeId: i, toNodeId: j, layer: "frame",
    thickness: Math.max(2, r4(h * PPM)),
    color: kind === "column" ? "#0f766e" : "#b45309",
    segmentType: kind, label: nm,
    attachments: [{
      id: `att_${nm}`, objectId: OBJ[kind].id, objectPath: OBJ[kind].path, t: 0.5,
      params: {
        E, b: r4(b * 1000), h: r4(h * 1000), fy: 12, density: 25, selfWeight: true,
        udl: r4(udl[nm] ?? 0), releaseStart: false, releaseEnd: false,
        spanMode: "Fill segment", ownLength: 4,
        N1: 0, V1: 0, M1: 0, N2: 0, V2: 0, M2: 0,
        u1: 0, v1: 0, r1: 0, u2: 0, v2: 0, r2: 0,
        diagram: "Bending moment", bmdScale: 0.01, sfdScale: 0.01, axialScale: 0.004, defScale: 300,
      },
    }],
  };
});

const planNodes = ids.map((n) => {
  const sup = supports[n] ?? [false, false, false];
  const ld = loads[n] ?? [0, 0, 0];
  return {
    id: n, x: pos[n].x, y: pos[n].y, layer: "frame",
    label: n, showLabel: false, type: "point",
    attachments: [{
      id: `att_${n}`, objectId: OBJ.joint.id, objectPath: OBJ.joint.path, t: 0,
      params: {
        fixX: !!sup[0], fixY: !!sup[1], fixR: !!sup[2],
        Fx: r4(ld[0]), Fy: r4(ld[1]), Mz: r4(ld[2]),
        markerSize: 0.4, dispScale: 300,
        ux: 0, uy: 0, rotZ: 0, Rx: 0, Ry: 0, Rz: 0, height: 0,
      },
    }],
  };
});

const plan = {
  schemaVersion: 1,
  settings: {
    library_path: "/Library/", units: "m", northbearing: 0, pixelsPerMeter: PPM,
    keywords: "structural, 2 storey building, plane frames, 12 columns",
    building: {
      grid: `${xs.length} x ${BAYS_Y.length + 1} columns = ${xs.length * (BAYS_Y.length + 1)}`,
      storeys: STOREY.length, storeyHeights: STOREY, baysX: BAYS_X, baysY: BAYS_Y,
      note: "The 4 x 3 column grid is a PLAN; this drawing is the three X-direction FRAME LINES in elevation, side by side. Each has its own fixed bases, so the solver treats them as three independent components of one stiffness matrix.",
      floorEdgeUdl: r4(FLOOR_EDGE), roofEdgeUdl: r4(ROOF_EDGE),
      loadNote: "Beam UDLs are the Slab object's tributary edge load for a 6.0 x 5.0 panel; interior frame lines collect from both sides.",
      generator: "tools/struct/make-building.mjs",
    },
  },
  nodes: planNodes,
  segments,
  spaces: [],
  layers: [
    { id: "0", name: "0", color: "#94a3b8", visible: true, locked: false, order: 0 },
    { id: "frame", name: "Frame", color: "#0f766e", visible: true, locked: false, order: 1 },
  ],
  imageUnderlay: null,
  customSegmentTypes: {
    beam: { id: "beam", displayName: "Beam", fill: "#b45309", params: [] },
    column: { id: "column", displayName: "Column", fill: "#0f766e", params: [] },
  },
};

// ── The floor plan: the 4 × 3 grid with slab panels ───────────────────────────
const ysP = BAYS_Y.reduce((a, b) => [...a, a[a.length - 1] + b], [0]);
const gp = (x, y) => ({ x: r4((x + PAD) * PPM), y: r4((ysP[ysP.length - 1] - y + PAD) * PPM) });
const planGridNodes = [];
const planGridSegs = [];
xs.forEach((x, cx) => ysP.forEach((y, cy) => {
  const id = `G${cx}${cy}`;
  const p = gp(x, y);
  planGridNodes.push({
    id, x: p.x, y: p.y, layer: "grid", label: `C${cx + 1}${String.fromCharCode(65 + cy)}`, showLabel: true,
    type: "column", columnShape: "rectangular", dimX: COL[0], dimY: COL[1],
  });
}));
// Grid beams between adjacent columns, so the slab panels have edges to sit on.
xs.forEach((x, cx) => ysP.forEach((y, cy) => {
  if (cx < xs.length - 1) planGridSegs.push({ id: `gx_${cx}${cy}`, fromNodeId: `G${cx}${cy}`, toNodeId: `G${cx + 1}${cy}`, layer: "grid", thickness: r4(BM[1] * PPM), color: "#b45309", segmentType: "beam", label: `BX${cx}${cy}` });
  if (cy < ysP.length - 1) planGridSegs.push({ id: `gy_${cx}${cy}`, fromNodeId: `G${cx}${cy}`, toNodeId: `G${cx}${cy + 1}`, layer: "grid", thickness: r4(BM[1] * PPM), color: "#b45309", segmentType: "beam", label: `BY${cx}${cy}` });
}));
const spaces = [];
xs.forEach((x, cx) => ysP.forEach((y, cy) => {
  if (cx >= xs.length - 1 || cy >= ysP.length - 1) return;
  spaces.push({
    id: `panel_${cx}${cy}`, layer: "grid",
    nodeIds: [`G${cx}${cy}`, `G${cx + 1}${cy}`, `G${cx + 1}${cy + 1}`, `G${cx}${cy + 1}`],
    name: `Panel ${cx + 1}${String.fromCharCode(65 + cy)}`, roomType: "room",
    fill: "rgba(148,163,184,0.18)", stroke: "#64748b",
    attachments: [{
      id: `att_slab_${cx}${cy}`, objectId: OBJ.slab.id, objectPath: OBJ.slab.path, t: 0,
      params: { thickness: 150, density: 25, finishes: 1.5, imposed: 3, spanning: "Two-way", combination: "1.0 D + 1.0 L (service)", spanDepthLimit: 30, steelRate: 90, showPanel: true, levelZ: 3.5 },
    }],
  });
}));

const planGrid = {
  schemaVersion: 1,
  settings: {
    library_path: "/Library/", units: "m", northbearing: 0, pixelsPerMeter: PPM,
    keywords: "structural, floor plan, column grid, slab panels",
    building: { note: "The PLAN of the same building: 4 x 3 = 12 columns, grid beams between them, and a Slab panel on each of the 6 bays. The slab's tributary edge UDL is what the frame elevation's beams carry.", generator: "tools/struct/make-building.mjs" },
  },
  nodes: planGridNodes,
  segments: planGridSegs,
  spaces,
  layers: [
    { id: "0", name: "0", color: "#94a3b8", visible: true, locked: false, order: 0 },
    { id: "grid", name: "Column grid", color: "#0f766e", visible: true, locked: false, order: 1 },
  ],
  imageUnderlay: null,
};

// ── The abstract model, for the PyNite reference — one source of truth for both sides ──
const model = {
  E: E * 1e6, nodes, members, supports, node_loads: loads, udl,
  sections: { column: COL, beam: BM },
  // Self weight is ON for every member; the reference has to add it the same way the flow does.
  selfWeightDensity: 25,
};

mkdirSync("tools/struct/out-plan", { recursive: true });
writeFileSync("tools/struct/out-plan/building_2storey.json", JSON.stringify(plan, null, 1) + "\n", "utf8");
writeFileSync("tools/struct/out-plan/building_2storey_plan.json", JSON.stringify(planGrid, null, 1) + "\n", "utf8");
writeFileSync("tools/struct/out-plan/building_2storey.model.json", JSON.stringify(model, null, 1) + "\n", "utf8");

const nCol = Object.values(members).filter((m) => m[2] === "column").length;
const nBm = Object.values(members).filter((m) => m[2] === "beam").length;
console.log(`ok   building_2storey.json        ${planNodes.length} joints, ${segments.length} members (${nCol} column, ${nBm} beam), ${BAYS_Y.length + 1} frame lines`);
console.log(`ok   building_2storey_plan.json   ${planGridNodes.length} grid columns, ${planGridSegs.length} grid beams, ${spaces.length} slab panels`);
console.log(`     grid ${xs.length} x ${ysP.length} = ${xs.length * ysP.length} columns · storeys ${STOREY.join(" + ")} m`);
console.log(`     slab UDL: floor edge ${FLOOR_EDGE.toFixed(2)} kN/m, roof edge ${ROOF_EDGE.toFixed(2)} kN/m (interior lines ×2)`);
