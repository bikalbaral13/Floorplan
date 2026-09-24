/** Build library/Objects/Architectural/sofa.json — grey chenille roll-arm sofa — from expr.txt.
 *
 *  node tools/tmp-sofa/build.mjs            → tools/tmp-sofa/out/sofa.json
 *
 *  Param ids whose MEANING changed from the old box sofa got NEW ids: armHeight / backHeight were measured
 *  from the leg top, armTop / backTop are from the floor; backThk became backDepth. Placed sofas store every
 *  param as an override, so reusing the old ids would distort them silently.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const expr = readFileSync(join(here, "expr.txt"), "utf8");

const R = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const S = (id, name, value, options) => ({ id, name, type: "select", value, options });
const C = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
const X = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1, options: [], editable: true, showInCanvas: false, necessary: true });

const props = [
  { id: "P", name: "Host — node / segment / space [[x, y], …]", type: "text", value: "[[0, 0]]", options: [] },
  R("length", "Overall length", 2.15, 1.2, 3.4, 0.01),
  R("depth", "Overall depth", 0.95, 0.75, 1.2, 0.01),
  R("seatHeight", "Seat height (top of cushion)", 0.47, 0.38, 0.55, 0.005),
  R("cushionThk", "Seat cushion thickness", 0.15, 0.08, 0.24, 0.005),
  R("seats", "Seat cushions", 2, 1, 5, 1),
  R("armWidth", "Arm width (0 = armless)", 0.22, 0, 0.35, 0.005),
  R("armTop", "Arm height (from floor)", 0.63, 0.5, 0.8, 0.005),
  R("armFlare", "Arm flare at the top", 0.035, 0, 0.08, 0.001),
  R("backDepth", "Back frame depth", 0.2, 0.1, 0.3, 0.005),
  R("backFrameTop", "Back frame height (from floor)", 0.74, 0.55, 0.95, 0.005),
  C("backCushions", "Back cushions", true),
  R("backTop", "Back cushion top (from floor)", 0.9, 0.7, 1.1, 0.005),
  R("backCushionThk", "Back cushion thickness", 0.2, 0.1, 0.3, 0.005),
  R("backLean", "Back cushion lean (deg)", 13, 0, 25, 0.5),
  C("armPillows", "Pillows in the arm corners", true),
  R("scatterCushions", "Scatter cushions", 2, 0, 4, 1),
  R("scatterSize", "Scatter cushion size", 0.45, 0.3, 0.6, 0.01),
  C("piping", "Piping on cushion seams", true),
  R("pipingDia", "Piping diameter (m)", 0.008, 0.004, 0.016, 0.001),
  R("legHeight", "Foot height", 0.05, 0, 0.2, 0.005),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { ...S("edgeCharacter", "Edge character", "Plump", ["Crisp", "Soft", "Plump"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "mid-grey chenille upholstery with self piping, teal and cream abstract-print scatter cushions, dark walnut block feet"),
  X("semantics", "Semantics", "large contemporary two-seat sofa, flared pillow-top arms, split upholstered base, piped box cushions, plump reclining back cushions, arm pillows, patterned scatter cushions"),
  X("materialPath", "Material (Library/Materials/…)", "Fabric/chenille-grey.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Scatter=Fabric/print-teal.json; Legs=Finishes/walnut.json; *=Fabric/chenille-grey.json"),
];
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);

const OUT = [
  ["Base3D", "Base — mesh"], ["Arms3D", "Arms — mesh"], ["BackFrame3D", "Back frame — mesh"],
  ["SeatCushions3D", "Seat cushions — mesh"], ["BackCushions3D", "Back cushions — mesh"],
  ["ArmPillows3D", "Arm pillows — mesh"], ["Scatter3D", "Scatter cushions — mesh"], ["Piping3D", "Piping — mesh"], ["Legs3D", "Legs — mesh"],
  ["FramePlan", "Frame — plan"], ["ArmsPlan", "Arms — plan"], ["SeatPlan", "Seat cushions — plan"], ["BackPlan", "Back — plan"],
  ["overallLength", "Overall length (m)"], ["overallDepth", "Overall depth (m)"], ["overallHeight", "Overall height (m)"],
  ["seatTopHeight", "Seat height (m)"], ["armTopHeight", "Arm height (m)"], ["seatDepth", "Seat depth (m)"],
  ["seatCushions", "Seat cushions"], ["cushionCount", "Cushions (all)"], ["footprint", "Footprint (m²)"], ["scale", "Fit scale"], ["meshFaces", "Mesh faces"],
];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([name], i) => [name, `s${i + 1}`]));

const L = "Sofa";
const r2d = [
  { id: "p2_frame", kind: "polygon", name: "Frame", color: "#8f8b86", layer: L, show: true },
  { id: "p2_arms", kind: "polygon", name: "Arms", color: "#9a9691", layer: L, show: true },
  { id: "p2_seat", kind: "polygon", name: "Seat cushions", color: "#a8a49f", layer: L, show: true },
  { id: "p2_back", kind: "polygon", name: "Back", color: "#9a9691", layer: L, show: true },
];
const P3 = (id, name, color) => ({ id, kind: "polyhedron", name, color, layer: L, x: 0, y: 0, z: 0, show: true });
const r3d = [
  P3("p3_base", "Base", "#9a9691"), P3("p3_arms", "Arms", "#9d9994"), P3("p3_backframe", "Back frame", "#96928d"),
  P3("p3_seat", "Seat cushions", "#a3a09b"), P3("p3_back", "Back cushions", "#a09c97"), P3("p3_armpillows", "Arm pillows", "#a6a29d"),
  P3("p3_scatter", "Scatter cushions", "#2f5d62"), P3("p3_piping", "Piping", "#8e8a85"), P3("p3_legs", "Legs", "#3b2f27"),
];
const rowWire = {
  Base3D: ["r3d", "p3_base"], Arms3D: ["r3d", "p3_arms"], BackFrame3D: ["r3d", "p3_backframe"], SeatCushions3D: ["r3d", "p3_seat"],
  BackCushions3D: ["r3d", "p3_back"], ArmPillows3D: ["r3d", "p3_armpillows"], Scatter3D: ["r3d", "p3_scatter"], Piping3D: ["r3d", "p3_piping"], Legs3D: ["r3d", "p3_legs"],
  FramePlan: ["r2d", "p2_frame"], ArmsPlan: ["r2d", "p2_arms"], SeatPlan: ["r2d", "p2_seat"], BackPlan: ["r2d", "p2_back"],
};

const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [name] of OUT) edges.push({ id: `e_math_out_${name}`, source: "math", target: "out", sourceHandle: `val-${name}`, targetHandle: `valin-${slotOf[name]}` });
for (const [name, [node, row]] of Object.entries(rowWire)) edges.push({ id: `e_out_${node}_${row}`, source: "out", target: node, sourceHandle: `val-${slotOf[name]}`, targetHandle: `valin-${row}` });
for (const row of ["p3_base", "p3_arms", "p3_backframe", "p3_seat", "p3_back", "p3_armpillows", "p3_piping"]) edges.push({ id: `e_mat_${row}`, source: "mat_chenille", target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });
edges.push({ id: "e_mat_p3_scatter", source: "mat_print", target: "r3d", sourceHandle: "mat", targetHandle: "matin-p3_scatter" });
edges.push({ id: "e_mat_p3_legs", source: "mat_walnut", target: "r3d", sourceHandle: "mat", targetHandle: "matin-p3_legs" });

const description = `A parametric UPHOLSTERED SOFA on the six-node spine — Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE, A SEGMENT OR A SPACE. Against a wall segment the sofa takes the wall's direction and the BACK faces it; Flip side swaps which way it looks. At rotation 0 the back is at +y.

WHAT IT BUILDS. A split upholstered base (one deck per seat, with a seam between), two flared pillow-top arms, a back frame, piped box seat cushions, plump piped back cushions reclining against the frame, a pillow propped in each arm corner, printed scatter cushions, and low dark block feet. Nine mesh rows, three materials: grey chenille, a teal-and-cream print on the scatter cushions, walnut on the feet.

EVERY CUSHION IS ONE ROW OF A TABLE AND ONE GENERATOR. A cushion is a superellipse face outline carried along its thickness axis. A BOX cushion has a straight boxing strip between two domed faces and is piped on both seams; a KNIFE cushion has no strip, just two domes meeting at one seam. Each row carries its own frame as two angles: the direction its face looks in plan, and how far it leans back from vertical. So a seat lying flat, a back cushion reclining 13 degrees and a pillow propped at 28 degrees in a corner are the same code with different numbers. Scatter cushions are each turned a few degrees off square, because identical yaw on every pillow is as obvious as having none.

THE ARMS FLARE. Each arm is an eased, pillow-topped soft box, then sheared so only its OUTER face moves outward with height while the inner face stays plumb against the seat. That flare is the whole silhouette of a roll-arm sofa seen from the front.

PIPING is a small circle swept along each seam outline, pushed a little outward along the outline's own normal, so it sits on the seam rather than inside the cushion.

ONE DETAIL DIAL sets every sample count: Blocky / Medium / Fine / Smooth. Edge character sets how round the cushion faces and arm tops are.

DIMENSIONS AT THE DEFAULTS: 2.19 × 0.95 m including the arm flare, seat at 0.47 m, arms at 0.63 m, back cushions to 0.90 m.

WHAT THIS CANNOT DO. Cushions are ideal soft solids, not simulated cloth: no creases where someone sat. The scatter print is a procedural material, not a specific textile design. Feet are blocks, not turned legs.`;

const flow = {
  version: 1,
  id: "sofa-with-math",
  title: "Sofa (mesh) — flared roll arms, piped box cushions, reclining back cushions, pillows",
  category: "Furniture",
  object: {
    hostKind: "node", name: "Sofa", units: "m",
    icon: { paths: ["M4 18v-2", "M20 18v-2", "M3 16h18v-4a2 2 0 00-2-2H5a2 2 0 00-2 2z", "M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3", "M12 5v5"] },
  },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "Sofa maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    { id: "mat_chenille", position: { x: 640, y: -420 }, data: { tool: "material", params: { path: "Materials/Fabric/chenille-grey.json" } } },
    { id: "mat_print", position: { x: 640, y: -300 }, data: { tool: "material", params: { path: "Materials/Fabric/print-teal.json" } } },
    { id: "mat_walnut", position: { x: 640, y: -180 }, data: { tool: "material", params: { path: "Materials/Finishes/walnut.json" } } },
  ],
  edges,
};

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "sofa.json"), JSON.stringify(flow, null, 2));
console.log(`wrote out/sofa.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges, expr ${expr.split("\n").length} lines`);
