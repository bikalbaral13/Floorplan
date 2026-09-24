/** Build library/Objects/Architectural/tv-unit.json — full TV feature wall — from preamble + body + kernel + tail.
 *  Kept with the SAME meaning as the old console: length, width (console depth), height (console body),
 *  topThk, legHeight (float gap), doorGap, underLed, pullType, screenSize (diagonal), screenHeight (centre),
 *  showScreen. Dropped: base, bays, mountHeight. Everything else is new. */
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
  R("length", "Overall width of the wall unit", 2.8, 1.2, 5, 0.01),
  R("width", "Console depth", 0.45, 0.3, 0.6, 0.01),
  R("height", "Console body height", 0.42, 0.25, 0.7, 0.01),
  R("topThk", "Console top thickness", 0.03, 0.015, 0.06, 0.001),
  R("legHeight", "Console floats above the floor by", 0.12, 0, 0.4, 0.005),
  R("doorGap", "Shadow gap between fronts", 0.004, 0.001, 0.01, 0.0005),
  R("drawers", "Drawers (split either side of the niche)", 4, 0, 8, 1),
  C("centreNiche", "Open centre niche", true),
  R("nicheWidth", "Niche width", 0.62, 0.3, 1.2, 0.01),
  S("pullType", "Pulls", "Bar", ["Bar", "Knob", "Push"]),
  C("underLed", "LED under the console", true),
  C("towers", "Shelf towers either side", true),
  R("towerWidth", "Tower width", 0.42, 0.25, 0.8, 0.01),
  R("towerDepth", "Tower depth", 0.3, 0.2, 0.45, 0.01),
  R("towerHeight", "Tower top (from floor)", 2.45, 1.4, 3.2, 0.01),
  R("towerShelves", "Bays per tower", 4, 1, 8, 1),
  C("shelfLed", "LED under every tower shelf", true),
  C("backPanel", "Back panel between the towers", true),
  R("flutedWidth", "Fluted slat panel width (0 = none)", 0.55, 0, 1.2, 0.01),
  S("tvPanel", "TV backdrop", "Marble", ["Marble", "None"]),
  R("panelWidth", "Marble panel width", 1.55, 0.8, 3, 0.01),
  R("panelHeight", "Marble panel height", 0.95, 0.5, 1.6, 0.01),
  C("panelHalo", "LED halo behind the marble panel", true),
  R("screenSize", "Screen diagonal (m)", 1.4, 0.8, 2.2, 0.01),
  R("screenHeight", "Screen centre height", 1.3, 0.9, 1.8, 0.01),
  C("showScreen", "Show the screen", true),
  C("topShelf", "Floating shelf over the screen", true),
  R("topShelfHeight", "Floating shelf height", 1.95, 1.4, 2.6, 0.01),
  R("shelfDownlights", "Downlights under the shelf", 3, 0, 6, 1),
  C("decor", "Decor on the tower shelves", true),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { ...S("edgeCharacter", "Edge character", "Soft", ["Crisp", "Soft", "Plump"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "warm oak towers, console carcass, floating shelf and fluted slats; warm-white matte drawer fronts; honed marble TV panel with LED halo; brass pulls; warm LED shelf lighting"),
  X("semantics", "Semantics", "contemporary TV feature wall: floating console with drawers and open niche, lit oak shelf towers, marble backdrop with halo, fluted oak slats, floating shelf with downlights"),
  X("materialPath", "Material (Library/Materials/…)", "Finishes/oak-veneer.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Fronts=Finishes/paint-eggshell.json; Marble=Finishes/marble.json; Back panel=Finishes/plaster.json; LED=Emissive/led-warm.json; Screen=Glazing/screen.json; Pulls=Metal/brass-polished.json; Ceramic=Finishes/ceramic.json; Brass=Metal/brass-polished.json"),
];
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);
const OUT = [["Oak3D", "Oak — mesh"], ["Fronts3D", "Fronts — mesh"], ["Marble3D", "Marble panel — mesh"], ["BackPanel3D", "Back panel — mesh"], ["Led3D", "LED — mesh"],
  ["Screen3D", "Screen — mesh"], ["Pulls3D", "Pulls — mesh"], ["DecorCeramic3D", "Decor ceramic — mesh"], ["DecorBrass3D", "Decor brass — mesh"],
  ["ConsolePlan", "Console — plan"], ["TowersPlan", "Towers — plan"],
  ["overallWidth", "Overall width (m)"], ["overallDepth", "Overall depth (m)"], ["overallHeight", "Overall height (m)"], ["consoleTop", "Console top (m)"],
  ["screenWidth", "Screen width (m)"], ["screenLevel", "Screen centre (m)"], ["drawerCount", "Drawers"], ["towerShelfCount", "Tower bays"],
  ["footprint", "Footprint (m²)"], ["scale", "Fit scale"], ["boxCount", "Parts (boxes)"], ["meshFaces", "Mesh faces (approx.)"]];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([n], i) => [n, `s${i + 1}`]));
const Ly = "TV unit";
const P3 = (id, name, color) => ({ id, kind: "polyhedron", name, color, layer: Ly, x: 0, y: 0, z: 0, show: true });
const r3d = [P3("p3_oak", "Oak", "#96663a"), P3("p3_fronts", "Fronts", "#ebe7df"), P3("p3_marble", "Marble", "#ece7de"), P3("p3_back", "Back panel", "#e2d6c4"),
  P3("p3_led", "LED", "#ffcf8a"), P3("p3_screen", "Screen", "#0b0e12"), P3("p3_pulls", "Pulls", "#c9a24a"), P3("p3_ceramic", "Decor ceramic", "#f2eee8"), P3("p3_brass", "Decor brass", "#c9a24a")];
const r2d = [{ id: "p2_console", kind: "polygon", name: "Console", color: "#96663a", layer: Ly, show: true }, { id: "p2_towers", kind: "polygon", name: "Towers", color: "#7c5530", layer: Ly, show: true }];
const rowWire = { Oak3D: "p3_oak", Fronts3D: "p3_fronts", Marble3D: "p3_marble", BackPanel3D: "p3_back", Led3D: "p3_led", Screen3D: "p3_screen", Pulls3D: "p3_pulls",
  DecorCeramic3D: "p3_ceramic", DecorBrass3D: "p3_brass", ConsolePlan: "p2_console", TowersPlan: "p2_towers" };
const MATS = { mat_oak: ["Materials/Finishes/oak-veneer.json", ["p3_oak"]], mat_white: ["Materials/Finishes/paint-eggshell.json", ["p3_fronts"]],
  mat_marble: ["Materials/Finishes/marble.json", ["p3_marble"]], mat_back: ["Materials/Finishes/plaster.json", ["p3_back"]],
  mat_led: ["Materials/Emissive/led-warm.json", ["p3_led"]], mat_screen: ["Materials/Glazing/screen.json", ["p3_screen"]],
  mat_brass: ["Materials/Metal/brass-polished.json", ["p3_pulls", "p3_brass"]], mat_ceramic: ["Materials/Finishes/ceramic.json", ["p3_ceramic"]] };
const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [n] of OUT) edges.push({ id: `e_math_out_${n}`, source: "math", target: "out", sourceHandle: `val-${n}`, targetHandle: `valin-${slotOf[n]}` });
for (const [n, row] of Object.entries(rowWire)) edges.push({ id: `e_out_${row}`, source: "out", target: row.startsWith("p3") ? "r3d" : "r2d", sourceHandle: `val-${slotOf[n]}`, targetHandle: `valin-${row}` });
for (const [mid, [, rows]] of Object.entries(MATS)) for (const row of rows) edges.push({ id: `e_${mid}_${row}`, source: mid, target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });
const description = `A parametric TV FEATURE WALL on the six-node spine: Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE, OR ON A WALL SEGMENT, where it takes the wall's direction with its back to the wall. At rotation 0 the fronts face -y.

WHAT IT BUILDS. A floating console (open carcass, drawers split either side of an open niche, brass bar pulls, warm LED underneath); two oak shelf towers standing on it, lit under every shelf; between them a back panel, fluted oak slats, a marble TV backdrop floating 30 mm off the wall with an LED halo behind its edges, the screen (16:9 from its diagonal), and a floating oak shelf with small downlights; and turned decor — white ceramic vases and brass spheres — alternating up the tower bays.

EVERY PART IS ONE ROW OF A BOX TABLE and one vectorised rounded-box kernel (the same one wardrobe.json uses) turns all of them into geometry in a single pass; the decor pieces are small lathes. The shadow gap between fronts is a parameter, because on slab fronts the gap is the detail. The LEDs are emissive strips placed where a joiner puts them — under the front edge of each shelf, behind the panel edge, under the console — so a render lights the way the reference does.

Kept from the old console with the same meaning: length, width (console depth), height (console body), topThk, legHeight (the float gap), doorGap, underLed, pullType, screenSize (diagonal), screenHeight (centre), showScreen.

DIMENSIONS AT THE DEFAULTS: 2.80 m wide, towers to 2.45 m, console 0.45 deep floating 0.12 m, a 1.55 × 0.95 m marble panel, a 1.4 m screen centred at 1.30 m.

WHAT THIS CANNOT DO. Drawers and doors are shown closed. Decor is a fixed pair of turned shapes, not a library of ornaments; plants are separate objects.`;
const flow = { version: 1, id: "tv-unit-with-math", title: "TV Unit (mesh) — feature wall: floating console, lit towers, marble backdrop, fluted slats", category: "Furniture",
  object: { hostKind: "node", name: "TV Unit", units: "m", icon: { paths: ["M2 20h20", "M3 16h18v3H3z", "M3 3h4v13H3z", "M17 3h4v13h-4z", "M8.5 6h7v5h-7z", "M8 3h8"] } },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "TV unit maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    ...Object.entries(MATS).map(([mid, [path]], i) => ({ id: mid, position: { x: 640, y: -900 + i * 110 }, data: { tool: "material", params: { path } } })),
  ], edges };
mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "tv-unit.json"), JSON.stringify(flow, null, 2));
console.log(`wrote out/tv-unit.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges`);
