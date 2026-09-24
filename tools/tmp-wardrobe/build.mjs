/** Build library/Objects/Architectural/wardrobe.json — two-tone fitted wardrobe with loft — from
 *  preamble.txt + body.txt.   node tools/tmp-wardrobe/build.mjs   → tools/tmp-wardrobe/out/wardrobe.json
 *
 *  Kept from the old object with the SAME meaning (placed wardrobes store them as overrides): width, depth,
 *  height, panelThk, plinthHeight, doorGap, doors, doorStyle, doorFace (+ frame / flute settings), mirrorPanel,
 *  handles, topFiller, fillerTo, endPanel, shelves, hangingRail, railDrop. Dropped: grooveStyle / grooveWidth /
 *  grooveCount (replaced by handleStyle). New: handleStyle, frontFinish, drawerBay, bayWidth, drawers,
 *  drawerZone, loftStyle, loftDoors, ledStrip.
 */
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
  R("width", "Width", 2.7, 0.6, 5, 0.01),
  R("depth", "Depth", 0.6, 0.35, 0.75, 0.01),
  R("height", "Tall section height", 2.1, 1.6, 2.6, 0.01),
  R("panelThk", "Panel thickness", 0.018, 0.012, 0.025, 0.001),
  R("plinthHeight", "Plinth height", 0.08, 0, 0.15, 0.005),
  R("doorGap", "Shadow gap between fronts", 0.003, 0.001, 0.008, 0.0005),
  R("doors", "Door leaves (main section)", 5, 1, 10, 1),
  S("doorStyle", "Door style", "Hinged", ["Hinged", "Sliding"]),
  S("doorFace", "Door face", "Flat", ["Flat", "Shaker", "Fluted"]),
  R("doorFrameWidth", "Shaker frame width", 0.09, 0.04, 0.15, 0.005),
  R("doorPanelInset", "Shaker panel inset", 0.008, 0.002, 0.012, 0.001),
  R("doorFlutes", "Flutes per leaf", 9, 2, 24, 1),
  R("doorFluteGap", "Flute gap", 0.008, 0.002, 0.02, 0.001),
  S("mirrorPanel", "Mirror", "None", ["None", "First panel", "Last panel", "All panels"]),
  C("handles", "Handles", true),
  S("handleStyle", "Handle style", "Long bar", ["Long bar", "Short bar", "None"]),
  S("frontFinish", "Front finish", "Two-tone", ["Two-tone", "All oak", "All white"]),
  S("drawerBay", "Drawer bay", "Right", ["None", "Right", "Left"]),
  R("bayWidth", "Drawer bay width", 0.62, 0.35, 1.0, 0.01),
  R("drawers", "Drawers", 3, 1, 6, 1),
  R("drawerZone", "Drawer bank height", 0.62, 0.3, 1.0, 0.01),
  C("topFiller", "Loft to the ceiling", true),
  R("fillerTo", "Ceiling height (loft top)", 2.95, 2.2, 3.6, 0.005),
  S("loftStyle", "Loft", "Cabinets", ["Cabinets", "Filler"]),
  R("loftDoors", "Loft doors", 8, 1, 14, 1),
  C("ledStrip", "LED strip under the loft", true),
  S("endPanel", "End panel", "Right", ["None", "Left", "Right", "Both"]),
  R("shelves", "Shelves (main section)", 3, 0, 8, 1),
  C("hangingRail", "Hanging rail", true),
  R("railDrop", "Rail drop below the top", 0.12, 0.05, 0.4, 0.005),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { ...S("edgeCharacter", "Edge character", "Soft", ["Crisp", "Soft", "Plump"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "light oak veneer tall doors and drawer fronts, warm-white matte loft and bay doors, matte black bar handles, espresso plinth, warm LED under the loft"),
  X("semantics", "Semantics", "floor-to-ceiling fitted wardrobe, two-tone oak and white, loft cabinets, drawer bank, long black bar handles, handleless shadow gaps, LED strip"),
  X("materialPath", "Material (Library/Materials/…)", "Finishes/oak-veneer.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Fronts — white=Finishes/paint-eggshell.json; Handles=Metal/matte-black.json; Plinth=Finishes/walnut.json; Hanging rail=Metal/steel.json; Mirror=Glazing/mirror.json; LED strip=Emissive/led-warm.json"),
];
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);

const OUT = [
  ["Carcass3D", "Carcass — mesh"], ["FrontsOak3D", "Fronts oak — mesh"], ["FrontsWhite3D", "Fronts white — mesh"],
  ["Handles3D", "Handles — mesh"], ["Plinth3D", "Plinth — mesh"], ["Shelves3D", "Shelves — mesh"], ["Rail3D", "Hanging rail — mesh"],
  ["Mirror3D", "Mirror — mesh"], ["Led3D", "LED strip — mesh"],
  ["CarcassPlan", "Carcass — plan"], ["DoorsPlan", "Doors — plan"], ["EndPanelsPlan", "End panels — plan"], ["RailPlan", "Rail — plan"],
  ["overallWidth", "Overall width (m)"], ["overallDepth", "Overall depth (m)"], ["totalHeight", "Total height (m)"], ["tallHeight", "Tall section height (m)"],
  ["doorLeaves", "Door leaves"], ["doorWidth", "Door width (m)"], ["drawerCount", "Drawers"], ["loftLeaves", "Loft doors"],
  ["handleCount", "Handles"], ["mirroredLeaves", "Mirrored leaves"], ["internalVolume", "Internal volume (m³)"], ["footprint", "Footprint (m²)"],
  ["scale", "Fit scale"], ["boxCount", "Parts (boxes)"], ["meshFaces", "Mesh faces"],
];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([name], i) => [name, `s${i + 1}`]));

const L = "Wardrobe";
const r2d = [
  { id: "p2_carc", kind: "polygon", name: "Carcass", color: "#c8a87c", layer: L, show: true },
  { id: "p2_doors", kind: "polygon", name: "Doors", color: "#a98761", layer: L, show: true },
  { id: "p2_epn", kind: "polygon", name: "End panels", color: "#ebe7df", layer: L, show: true },
  { id: "p2_rail", kind: "polygon", name: "Hanging rail", color: "#6b7280", layer: L, show: true },
];
const P3 = (id, name, color) => ({ id, kind: "polyhedron", name, color, layer: L, x: 0, y: 0, z: 0, show: true });
const r3d = [
  P3("p3_carc", "Carcass", "#c8a87c"), P3("p3_oak", "Fronts — oak", "#c9a97e"), P3("p3_white", "Fronts — white", "#ebe7df"),
  P3("p3_handles", "Handles", "#1c1c1c"), P3("p3_plinth", "Plinth", "#4a2f1e"), P3("p3_shelf", "Shelves", "#c8a87c"),
  P3("p3_rail", "Hanging rail", "#9ca3af"), P3("p3_mir", "Mirror", "#cfd8dc"), P3("p3_led", "LED strip", "#ffd9a0"),
];
const rowWire = {
  Carcass3D: ["r3d", "p3_carc"], FrontsOak3D: ["r3d", "p3_oak"], FrontsWhite3D: ["r3d", "p3_white"], Handles3D: ["r3d", "p3_handles"],
  Plinth3D: ["r3d", "p3_plinth"], Shelves3D: ["r3d", "p3_shelf"], Rail3D: ["r3d", "p3_rail"], Mirror3D: ["r3d", "p3_mir"], Led3D: ["r3d", "p3_led"],
  CarcassPlan: ["r2d", "p2_carc"], DoorsPlan: ["r2d", "p2_doors"], EndPanelsPlan: ["r2d", "p2_epn"], RailPlan: ["r2d", "p2_rail"],
};
const MATS = {
  mat_oak: ["Materials/Finishes/oak-veneer.json", ["p3_carc", "p3_oak", "p3_shelf"]],
  mat_white: ["Materials/Finishes/paint-eggshell.json", ["p3_white"]],
  mat_black: ["Materials/Metal/matte-black.json", ["p3_handles"]],
  mat_walnut: ["Materials/Finishes/walnut.json", ["p3_plinth"]],
  mat_steel: ["Materials/Metal/steel.json", ["p3_rail"]],
  mat_mirror: ["Materials/Glazing/mirror.json", ["p3_mir"]],
  mat_led: ["Materials/Emissive/led-warm.json", ["p3_led"]],
};

const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [name] of OUT) edges.push({ id: `e_math_out_${name}`, source: "math", target: "out", sourceHandle: `val-${name}`, targetHandle: `valin-${slotOf[name]}` });
for (const [name, [node, row]] of Object.entries(rowWire)) edges.push({ id: `e_out_${node}_${row}`, source: "out", target: node, sourceHandle: `val-${slotOf[name]}`, targetHandle: `valin-${row}` });
for (const [mid, [, rows]] of Object.entries(MATS)) for (const row of rows) edges.push({ id: `e_${mid}_${row}`, source: mid, target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });

const description = `A parametric FITTED WARDROBE on the six-node spine — Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE, A SEGMENT OR A SPACE. On a wall segment it takes the wall's direction and the fronts face into the room; Flip side turns it round. At rotation 0 the fronts face -y.

WHAT IT BUILDS. A floor-to-ceiling run: a tall section of hinged (or sliding) leaves hung in pairs, an optional drawer bay with two doors over a drawer bank, loft cabinets up to the ceiling, a warm LED strip in the oak rail under the loft, a recessed dark plinth, end panels, and the interior (shelves, hanging rail). Two-tone by default — light-oak tall doors and drawers, warm-white loft and bay doors — with matte black bar handles: long bars where each pair of tall doors meets, short bars on the bay and loft doors, horizontal bars on the drawers.

EVERY FRONT IS ONE ROW OF A TABLE — position, face plane, finish group, handle type and handle position — and every part, from a carcass side to a handle post, is one row of a BOX table. One vectorised kernel turns all of them into geometry in a single pass: a rounded-rectangle ring (quarter arcs of the edge radius) swept along the part's axis. A wardrobe is 150+ parts; one broadcast pass keeps it well under a second where a solid-kernel call per part would not. Radius 0 is a true cuboid; the shadow gap between fronts is a parameter, because on slab doors the gap IS the detail.

LEFT AND RIGHT (drawer bay, end panel) are as seen standing in front of the doors.

DOOR FACE applies to doors, never drawers: Flat slabs, Shaker (stiles and rails at full thickness, the panel set back), or Fluted (half-round flutes on a thin backer). Sliding leaves lap their neighbours and alternate between two planes by index. Mirror covers the chosen main leaves.

ONE DETAIL DIAL sets the arc resolution of every eased edge: Blocky (chamfered) / Medium / Fine / Smooth.

DIMENSIONS AT THE DEFAULTS: 2.72 × 0.66 m over the handles and end panel, tall section 2.10 m, loft to 2.95 m, five 0.416 m leaves, a 0.62 m bay with three drawers, eight loft doors.

WHAT THIS CANNOT DO. Doors are shown closed — no swing or open state. The drawer boxes behind the fronts are not modelled. The LED strip is an emissive surface; the light it casts comes from whatever lamp the scene adds.`;

const flow = {
  version: 1,
  id: "wardrobe-with-math",
  title: "Wardrobe (mesh) — fitted two-tone run, loft, drawer bay, bar handles, LED",
  category: "Furniture",
  object: { hostKind: "node", name: "Wardrobe", units: "m", icon: { paths: ["M3 2h18v20H3z", "M3 7h18", "M9 7v15", "M15 7v15", "M15 16h6", "M15 19h6", "M8 11v5", "M10 11v5"] } },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "Wardrobe maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    ...Object.entries(MATS).map(([mid, [path]], i) => ({ id: mid, position: { x: 640, y: -760 + i * 110 }, data: { tool: "material", params: { path } } })),
  ],
  edges,
};

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "wardrobe.json"), JSON.stringify(flow, null, 2));
console.log(`wrote out/wardrobe.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges, expr ${expr.split("\n").length} lines`);
