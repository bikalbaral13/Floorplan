/** Build library/Objects/Architectural/rug.json — carved high-low pile rug with an organic leaf pattern.
 *  Kept with the same meaning: length, width, height (pile), borderWidth, fringeLength, shape, showBorder,
 *  and the space-host defaults (fitMode Max, margin 0.4). New: leaves, leafLength, leafWidth, relief,
 *  tanShare, seed. Also writes the three pile materials to out/. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const expr = ["preamble.txt", "body.txt"].map((f) => readFileSync(join(here, f), "utf8")).join("\n");
const R = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const S = (id, name, value, options) => ({ id, name, type: "select", value, options });
const C = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
const X = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1, options: [], editable: true, showInCanvas: false, necessary: true });
const props = [
  { id: "P", name: "Host — node / segment / space [[x, y], …]", type: "text", value: "[[0, 0]]", options: [] },
  R("length", "Length", 2.4, 0.6, 5, 0.01),
  R("width", "Width", 1.6, 0.4, 4, 0.01),
  R("height", "Pile height", 0.012, 0.004, 0.04, 0.001),
  S("shape", "Shape", "Rectangular", ["Rectangular", "Runner", "Round"]),
  R("leaves", "Carved pattern leaves (0 = plain rug)", 0, 0, 60, 1),
  R("leafLength", "Leaf length (largest)", 1.0, 0.2, 2.5, 0.01),
  R("leafWidth", "Leaf width (largest)", 0.24, 0.05, 0.6, 0.005),
  R("relief", "Carved relief of the pattern", 0.004, 0, 0.012, 0.0005),
  R("tanShare", "Share of tan leaves (rest sage)", 0.3, 0, 1, 0.05),
  R("seed", "Pattern seed", 5, 0, 99, 1),
  C("showBorder", "Border band on the long sides", false),
  R("borderWidth", "Border width", 0.12, 0.03, 0.4, 0.005),
  R("fringeLength", "Fringe on the short ends (0 = none)", 0, 0, 0.15, 0.005),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Max", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0.4, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { ...S("edgeCharacter", "Edge character", "Crisp", ["Crisp", "Soft", "Plump"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "plain ivory low-pile wool/viscose, soft abrash streaks, fine tufted texture, high sheen; optional carved sage and tan leaf pattern"),
  X("semantics", "Semantics", "plain ivory low-pile area rug, soft tonal abrash, calm minimal bedroom"),
  X("materialPath", "Material (Library/Materials/…)", "Fabric/rug-plain-ivory.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Field=Fabric/rug-plain-ivory.json; Border=Fabric/rug-plain-ivory.json; Sage=Fabric/rug-pile-sage.json; Tan=Fabric/rug-pile-tan.json; Fringe=Fabric/rug-pile-cream.json"),
];
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);
const OUT = [["Field3D", "Field — mesh"], ["Border3D", "Border — mesh"], ["LeavesGreen3D", "Sage leaves — mesh"], ["LeavesTan3D", "Tan leaves — mesh"], ["Fringe3D", "Fringe — mesh"],
  ["RugPlan", "Rug — plan"], ["rugLength", "Length incl. fringe (m)"], ["rugWidth", "Width (m)"], ["pileHeight", "Pile + relief (m)"], ["leafCount", "Pattern leaves"], ["area", "Area (m²)"], ["scale", "Fit scale"]];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([n], i) => [n, `s${i + 1}`]));
const Ly = "Rug";
const P3 = (id, name, color) => ({ id, kind: "polyhedron", name, color, layer: Ly, x: 0, y: 0, z: 0, show: true });
const r3d = [P3("p3_field", "Field", "#e9e1d2"), P3("p3_border", "Border", "#e9e1d2"), P3("p3_sage", "Sage leaves", "#7d8f6a"), P3("p3_tan", "Tan leaves", "#b9976c"), P3("p3_fringe", "Fringe", "#e9e1d2")];
const r2d = [{ id: "p2_rug", kind: "polygon", name: "Rug", color: "#e9e1d2", layer: Ly, show: true }];
const rowWire = { Field3D: "p3_field", Border3D: "p3_border", LeavesGreen3D: "p3_sage", LeavesTan3D: "p3_tan", Fringe3D: "p3_fringe", RugPlan: "p2_rug" };
const MATS = { mat_cream: ["Materials/Fabric/rug-plain-ivory.json", ["p3_field", "p3_border", "p3_fringe"]], mat_sage: ["Materials/Fabric/rug-pile-sage.json", ["p3_sage"]], mat_tan: ["Materials/Fabric/rug-pile-tan.json", ["p3_tan"]] };
const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [n] of OUT) edges.push({ id: `e_math_out_${n}`, source: "math", target: "out", sourceHandle: `val-${n}`, targetHandle: `valin-${slotOf[n]}` });
for (const [n, row] of Object.entries(rowWire)) edges.push({ id: `e_out_${row}`, source: "out", target: row.startsWith("p3") ? "r3d" : "r2d", sourceHandle: `val-${slotOf[n]}`, targetHandle: `valin-${row}` });
for (const [mid, [, rows]] of Object.entries(MATS)) for (const row of rows) edges.push({ id: `e_${mid}_${row}`, source: mid, target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });
const description = `A parametric RUG — by default a PLAIN ivory low-pile rug whose texture is all in its material (fibre, abrash streaks, mottle, sheen: Fabric/rug-plain-ivory), with an optional CARVED leaf pattern in sage and tan (Leaves > 0) — on the six-node spine: Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A SPACE and it fits inside the room with a margin (fitMode Max, 0.4 m), along the space's long direction; on a node it takes its stated size.

THE PATTERN IS GEOMETRY, NOT A TEXTURE. Each leaf is one row of a table: it springs from one of the four edges, points inward on a diagonal and bows into a stretched S; its length, width, bend and colour come from a hash of (index, seed), so Seed draws a new rug. Every leaf is a flat strip lofted along its spine — narrow at the base, full through the middle, pointed at the tip — standing a few millimetres proud of the field, which is exactly what a carved (high-low) rug is. Points that fall outside the rug are pulled back onto its edge, so leaves run off the border the way the reference's do. Because it is geometry, the pattern shows on the canvas, in a GLB and in SketchUp — not only in a renderer that can read a procedural.

The field is a soft slab with a rolled pile edge; Round makes it an ellipse; optional border band and fringe are kept from the previous version.

DIMENSIONS AT THE DEFAULTS: 2.4 × 1.6 m, 12 mm plain pile, crisp edge; pattern off (Leaves 0).

WHAT THIS CANNOT DO. The leaves are drawn as strips, so the thin cream channels between leaves are the gaps the layout leaves rather than a designed negative. Leaves may overlap one another (one simply lies over the other).`;
const flow = { version: 1, id: "rug-with-math", title: "Rug (mesh) — plain ivory low pile with abrash; optional carved leaf pattern", category: "Furniture",
  object: { hostKind: "space", name: "Rug", units: "m", icon: { paths: ["M3 6h18v12H3z", "M6 16c3-4 5-6 9-9", "M10 17c1-3 4-6 8-7", "M5 9c2 0 4 1 5 3"] } },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "Rug maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    ...Object.entries(MATS).map(([mid, [path]], i) => ({ id: mid, position: { x: 640, y: -420 + i * 120 }, data: { tool: "material", params: { path } } })),
  ], edges };
mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "rug.json"), JSON.stringify(flow, null, 2));
// the three pile materials, derived from Fabric/rug-pile (same voronoi pile, same sheen), recoloured
const base = JSON.parse(readFileSync(join(here, "out", "rug-pile.json"), "utf8"));
const mk = (id, title, a, b, pbrC, desc) => {
  const m = JSON.parse(JSON.stringify(base));
  Object.assign(m, { id, title, description: desc });
  m.procedural.params = { ...m.procedural.params, colorA: a, colorB: b };
  m.pbr = { ...m.pbr, baseColor: pbrC };
  if (m.plan2d) m.plan2d.color = pbrC;
  return m;
};
writeFileSync(join(here, "out", "rug-pile-cream.json"), JSON.stringify(mk("fabric.rug-pile.cream", "Fabric — cut-pile rug, ivory", "#efe8da", "#ddd4c3", "#e9e1d2", "Ivory cut-pile wool — the field of a carved rug. Same pile recipe as Fabric/rug-pile, recoloured."), null, 2));
writeFileSync(join(here, "out", "rug-pile-sage.json"), JSON.stringify(mk("fabric.rug-pile.sage", "Fabric — cut-pile rug, sage green", "#8a9b76", "#6f805d", "#7d8f6a", "Sage-green cut-pile wool for the carved pattern of a rug. Same pile recipe as Fabric/rug-pile, recoloured."), null, 2));
writeFileSync(join(here, "out", "rug-pile-tan.json"), JSON.stringify(mk("fabric.rug-pile.tan", "Fabric — cut-pile rug, warm tan", "#c4a47a", "#a8875d", "#b9976c", "Warm tan cut-pile wool for the carved pattern of a rug. Same pile recipe as Fabric/rug-pile, recoloured."), null, 2));
console.log(`wrote out/rug.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges; + 3 pile materials`);
