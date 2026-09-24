/** Build library/Objects/Architectural/plant.json — potted Strelitzia-style plant — from preamble.txt + body.txt.
 *  The old plant.json was a generic tree (radius / height / trunk…); every param here is NEW, so a stored
 *  override of the old ones cannot distort it. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const expr = readFileSync(join(here, "preamble.txt"), "utf8") + "\n" + readFileSync(join(here, "body.txt"), "utf8");
const R = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const S = (id, name, value, options) => ({ id, name, type: "select", value, options });
const C = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
const X = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1, options: [], editable: true, showInCanvas: false, necessary: true });
const props = [
  { id: "P", name: "Host — node / segment / space [[x, y], …]", type: "text", value: "[[0, 0]]", options: [] },
  R("plantHeight", "Plant height (floor to top leaf)", 1.75, 0.6, 3.0, 0.01),
  R("spread", "Spread (radius of the crown)", 0.55, 0.2, 1.2, 0.01),
  R("leaves", "Leaves", 16, 5, 30, 1),
  R("leafLength", "Largest blade length", 0.55, 0.2, 1.0, 0.01),
  R("leafWidth", "Largest blade width", 0.22, 0.06, 0.4, 0.005),
  R("arch", "Droop of the outer leaves", 0.35, 0, 0.8, 0.01),
  R("foldDepth", "Midrib V-fold", 0.18, 0, 0.5, 0.01),
  R("stemDia", "Stem diameter", 0.018, 0.006, 0.04, 0.001),
  R("potTopDia", "Planter top diameter", 0.46, 0.2, 0.8, 0.01),
  R("potBottomDia", "Planter base diameter", 0.34, 0.15, 0.7, 0.01),
  R("potHeight", "Planter height", 0.5, 0.2, 0.9, 0.01),
  R("rimThk", "Planter wall / rim thickness", 0.025, 0.01, 0.05, 0.001),
  R("soilDrop", "Soil below the rim", 0.035, 0.01, 0.1, 0.005),
  R("seed", "Variation seed", 3, 0, 99, 1),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "glossy deep-green banana-type leaves, matte speckled off-white stone planter, dark soil"),
  X("semantics", "Semantics", "tall potted bird-of-paradise (Strelitzia) indoor plant, large paddle leaves, tapered white stone planter"),
  X("materialPath", "Material (Library/Materials/…)", "Organic/leaf-glossy.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Planter=Finishes/planter-stone.json; Soil=Organic/bark.json; Stems=Organic/leaf-glossy.json; Leaves=Organic/leaf-glossy.json"),
];
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);
const OUT = [["Pot3D", "Planter — mesh"], ["Soil3D", "Soil — mesh"], ["Stems3D", "Stems — mesh"], ["Leaves3D", "Leaves — mesh"],
  ["PotPlan", "Planter — plan"], ["CanopyPlan", "Canopy — plan"], ["overallHeight", "Overall height (m)"], ["canopyDiameter", "Canopy diameter (m)"],
  ["potDiameter", "Planter diameter (m)"], ["potHeightM", "Planter height (m)"], ["leafCount", "Leaves"], ["footprint", "Canopy footprint (m²)"], ["scale", "Fit scale"], ["meshFaces", "Mesh faces"]];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([n], i) => [n, `s${i + 1}`]));
const L = "Plant";
const r2d = [{ id: "p2_canopy", kind: "polygon", name: "Canopy", color: "#4d7c3f", layer: L, show: true }, { id: "p2_pot", kind: "polygon", name: "Planter", color: "#e6e1d8", layer: L, show: true }];
const P3 = (id, name, color) => ({ id, kind: "polyhedron", name, color, layer: L, x: 0, y: 0, z: 0, show: true });
const r3d = [P3("p3_pot", "Planter", "#e6e1d8"), P3("p3_soil", "Soil", "#3b2a1e"), P3("p3_stems", "Stems", "#5a8a3a"), P3("p3_leaves", "Leaves", "#2f5a2a")];
const rowWire = { Pot3D: "p3_pot", Soil3D: "p3_soil", Stems3D: "p3_stems", Leaves3D: "p3_leaves", PotPlan: "p2_pot", CanopyPlan: "p2_canopy" };
const MATS = { mat_leaf: ["Materials/Organic/leaf-glossy.json", ["p3_leaves", "p3_stems"]], mat_pot: ["Materials/Finishes/planter-stone.json", ["p3_pot"]], mat_soil: ["Materials/Organic/bark.json", ["p3_soil"]] };
const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [n] of OUT) edges.push({ id: `e_math_out_${n}`, source: "math", target: "out", sourceHandle: `val-${n}`, targetHandle: `valin-${slotOf[n]}` });
for (const [n, row] of Object.entries(rowWire)) edges.push({ id: `e_out_${row}`, source: "out", target: row.startsWith("p3") ? "r3d" : "r2d", sourceHandle: `val-${slotOf[n]}`, targetHandle: `valin-${row}` });
for (const [mid, [, rows]] of Object.entries(MATS)) for (const row of rows) edges.push({ id: `e_${mid}_${row}`, source: mid, target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });
const description = `A parametric POTTED PLANT — a tall bird-of-paradise (Strelitzia) type in a tapered stone planter — on the six-node spine: Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE. In plan it is the drafting symbol: the planter rim and the canopy circle. In 3D it is the plant.

THE PLANTER AND THE SOIL ARE LATHES: a profile in (radius, height) — eased foot, tapered wall with a slight belly, a rim rounded over half its thickness, down the inside — revolved into rings and skinned into one closed surface.

EVERY LEAF IS ONE ROW OF A TABLE, laid out by rule. Leaves go round at the golden angle (137.5 degrees) so none stack. Index runs inside to out: early leaves stand near vertical and tall, late ones lean out, sit lower and droop more; blades are largest through the middle of the run. A hash of index and seed jitters every angle and length, so no two leaves match and Seed gives a new plant.

A STEM is a circle swept along a Bezier that leaves the soil almost vertical and bends toward its blade. A BLADE is a loft along its own curved spine: at every station the cross-section is laid across the leaf in the frame T (spine tangent), L (horizontal, T x z), N (L x T), with a V-fold that lifts the edges off the midrib and a real thickness. The width runs narrow at the stem, full through the middle and to a point at the tip.

DIMENSIONS AT THE DEFAULTS: about 1.75 m tall, a 0.46 m planter 0.5 m high, 16 leaves.

WHAT THIS CANNOT DO. Leaves are smooth blades — no splits or tears, no individual veins (the material carries those). The stem cluster is separate tubes, not a fused rhizome.`;
const flow = { version: 1, id: "plant-with-math", title: "Plant (mesh) — potted bird-of-paradise, golden-angle leaves, stone planter", category: "Furniture",
  object: { hostKind: "node", name: "Plant", units: "m", icon: { paths: ["M8 21h8l1-6H7z", "M12 15V7", "M12 11c-3-1-5-4-5-7 3 0 5 3 5 7z", "M12 9c2-2 5-3 7-2-1 3-4 4-7 2z"] } },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "Plant maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    ...Object.entries(MATS).map(([mid, [path]], i) => ({ id: mid, position: { x: 640, y: -420 + i * 120 }, data: { tool: "material", params: { path } } })),
  ], edges };
mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "plant.json"), JSON.stringify(flow, null, 2));
console.log(`wrote out/plant.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges`);
