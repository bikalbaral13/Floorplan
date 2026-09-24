/** Build library/Objects/Architectural/nightstand.json — mid-century oak nightstand with lamp — from
 *  preamble + body + kernel + tail. Kept with the same meaning: length, width, height (top), topThk,
 *  legHeight, base (Legs|Plinth|Wall-hung), drawers, doorGap, mountHeight, underLed, pullType (+ Knob). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const expr = ["preamble.txt", "body.txt", "kernel.txt", "tail.txt"].map((f) => readFileSync(join(here, f), "utf8")).join("\n");
const R = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const S = (id, name, value, options) => ({ id, name, type: "select", value, options });
const C = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
const X = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1, options: [], editable: true, showInCanvas: false, necessary: true });
const props = [
  { id: "P", name: "Host — node / segment / space [[x, y], …]", type: "text", value: "[[0, 0]]", options: [] },
  R("length", "Width", 0.55, 0.3, 0.9, 0.01),
  R("width", "Depth", 0.4, 0.28, 0.55, 0.01),
  R("height", "Top height (from floor)", 0.56, 0.35, 0.8, 0.01),
  R("topThk", "Top thickness", 0.025, 0.012, 0.05, 0.001),
  R("legHeight", "Leg height", 0.15, 0, 0.35, 0.005),
  R("legSplay", "Leg splay (deg)", 7, 0, 15, 0.5),
  S("base", "Base", "Legs", ["Legs", "Plinth", "Wall-hung"]),
  R("mountHeight", "Wall-hung top height", 0.558, 0.35, 0.9, 0.005),
  R("drawers", "Drawers", 2, 1, 4, 1),
  R("doorGap", "Gap round the drawers", 0.004, 0.001, 0.01, 0.0005),
  S("pullType", "Pulls", "Knob", ["Knob", "Handle", "Groove", "Push"]),
  C("underLed", "LED under a wall-hung / plinth case", false),
  C("lamp", "Table lamp on top", true),
  R("lampHeight", "Lamp height", 0.55, 0.3, 0.8, 0.01),
  R("shadeDia", "Lamp shade diameter", 0.36, 0.2, 0.5, 0.01),
  C("decor", "Plant pot and mug on top", true),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { ...S("edgeCharacter", "Edge character", "Soft", ["Crisp", "Soft", "Plump"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "natural oak veneer case and drawer fronts, turned oak knobs and splayed legs; white glazed ceramic lamp with linen drum shade"),
  X("semantics", "Semantics", "mid-century oak bedside table, two inset drawers, round knobs, splayed tapered legs, ceramic table lamp"),
  X("materialPath", "Material (Library/Materials/…)", "Finishes/oak-veneer.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Ceramic=Finishes/ceramic.json; Shade=Fabric/linen.json; Bulb=Emissive/diffuser.json; Foliage=Organic/leaf-glossy.json; LED=Emissive/led-warm.json"),
];
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);
const OUT = [["Case3D", "Case — mesh"], ["Drawers3D", "Drawer fronts — mesh"], ["Legs3D", "Legs — mesh"], ["Knobs3D", "Knobs — mesh"], ["Led3D", "LED — mesh"],
  ["Ceramic3D", "Ceramic — mesh"], ["Shade3D", "Lamp shade — mesh"], ["Bulb3D", "Bulb — mesh"], ["Foliage3D", "Foliage — mesh"], ["CasePlan", "Case — plan"],
  ["overallWidth", "Overall width (m)"], ["overallDepth", "Overall depth (m)"], ["topHeight", "Top height (m)"], ["overallHeight", "Overall height (m)"],
  ["drawerCount", "Drawers"], ["drawerHeight", "Drawer front height (m)"], ["lampOn", "Lamp"], ["mountLift", "Mount lift (m)"], ["footprint", "Footprint (m²)"], ["scale", "Fit scale"], ["boxCount", "Parts (boxes)"]];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([n], i) => [n, `s${i + 1}`]));
const Ly = "Nightstand";
const P3 = (id, name, color) => ({ id, kind: "polyhedron", name, color, layer: Ly, x: 0, y: 0, z: 0, show: true });
const r3d = [P3("p3_case", "Case", "#c9a57a"), P3("p3_drawers", "Drawer fronts", "#c9a57a"), P3("p3_legs", "Legs", "#c9a57a"), P3("p3_knobs", "Knobs", "#b8905f"),
  P3("p3_led", "LED", "#ffcf8a"), P3("p3_ceramic", "Ceramic", "#f2eee8"), P3("p3_shade", "Shade", "#f5efe4"), P3("p3_bulb", "Bulb", "#fff4dd"), P3("p3_foliage", "Foliage", "#4d7c3f")];
const r2d = [{ id: "p2_case", kind: "polygon", name: "Case", color: "#c9a57a", layer: Ly, show: true }];
const rowWire = { Case3D: "p3_case", Drawers3D: "p3_drawers", Legs3D: "p3_legs", Knobs3D: "p3_knobs", Led3D: "p3_led", Ceramic3D: "p3_ceramic", Shade3D: "p3_shade", Bulb3D: "p3_bulb", Foliage3D: "p3_foliage", CasePlan: "p2_case" };
const MATS = { mat_oak: ["Materials/Finishes/oak-veneer.json", ["p3_case", "p3_drawers", "p3_legs", "p3_knobs"]], mat_cer: ["Materials/Finishes/ceramic.json", ["p3_ceramic"]],
  mat_shade: ["Materials/Fabric/linen.json", ["p3_shade"]], mat_bulb: ["Materials/Emissive/diffuser.json", ["p3_bulb"]], mat_leaf: ["Materials/Organic/leaf-glossy.json", ["p3_foliage"]],
  mat_led: ["Materials/Emissive/led-warm.json", ["p3_led"]] };
const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [n] of OUT) edges.push({ id: `e_math_out_${n}`, source: "math", target: "out", sourceHandle: `val-${n}`, targetHandle: `valin-${slotOf[n]}` });
for (const [n, row] of Object.entries(rowWire)) edges.push({ id: `e_out_${row}`, source: "out", target: row.startsWith("p3") ? "r3d" : "r2d", sourceHandle: `val-${slotOf[n]}`, targetHandle: `valin-${row}` });
for (const [mid, [, rows]] of Object.entries(MATS)) for (const row of rows) edges.push({ id: `e_${mid}_${row}`, source: mid, target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });
const description = `A parametric MID-CENTURY NIGHTSTAND on the six-node spine: Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE, beside the bed. At rotation 0 the drawers face -y (back at +y).

WHAT IT BUILDS. An oak case whose front edges form a continuous frame, with the drawers INSET inside it (set 4 mm back, a divider rail between them) and turned round knobs; four tapered round legs splayed outward; and on top a table lamp — white glazed gourd base, linen drum shade as a thin shell, a warm bulb — with a small potted sprig and a mug. Plinth and Wall-hung bases are kept from the previous version.

HOW. The case is rows of the shared rounded-box kernel (wardrobe, tv-unit). Legs are horizontal slices of a tilted cone, so the foot is flat on the floor at any splay. Knobs, lamp, pot and mug are lathes: a profile in (r, z) revolved into rings and skinned — the knobs revolve about the drawer's normal, the rest about vertical.

Kept with the same meaning: length, width, height (top), topThk, legHeight, base, mountHeight, drawers, doorGap, underLed, pullType (Knob added and now the default).

DIMENSIONS AT THE DEFAULTS: 0.55 × 0.40 m, top at 0.56 m, two drawers, a 0.55 m lamp with a 0.36 m shade.

WHAT THIS CANNOT DO. Drawers are shown closed. The lamp is geometry with an emissive bulb; the light it casts in a render comes from a light object.`;
const flow = { version: 1, id: "nightstand-with-math", title: "Nightstand (mesh) — mid-century oak, inset drawers, splayed legs, table lamp", category: "Furniture",
  object: { hostKind: "node", name: "Nightstand", units: "m", icon: { paths: ["M4 9h16v8H4z", "M4 13h16", "M6 17l-1 4", "M18 17l1 4", "M12 11v.01", "M12 15v.01", "M10 9l1-3h2l1 3", "M9 6h6l-1-3h-4z"] } },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "Nightstand maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    ...Object.entries(MATS).map(([mid, [path]], i) => ({ id: mid, position: { x: 640, y: -760 + i * 110 }, data: { tool: "material", params: { path } } })),
  ], edges };
mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "nightstand.json"), JSON.stringify(flow, null, 2));
console.log(`wrote out/nightstand.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges`);
