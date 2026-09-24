/** Build library/Objects/Architectural/chair.json — the upholstered tub chair — from expr.txt.
 *
 *  node tools/tmp-chair/build.mjs            → tools/tmp-chair/out/chair.json
 *
 *  Param ids whose MEANING changed from the old slatted chair were given NEW ids on purpose
 *  (backTop, cushionThk, shellThk, armStyle): a placed chair stores every param as an override, and the
 *  old `backHeight: 0.9` (above the seat) would otherwise hand this body a 1.35 m back.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const expr = readFileSync(join(here, "expr.txt"), "utf8");

const R = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const S = (id, name, value, options) => ({ id, name, type: "select", value, options });
const C = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
const X = (id, name, value) => ({
  id, name, type: "text", value, min: 0, max: 10, step: 1, options: [],
  editable: true, showInCanvas: false, necessary: true,
});

const props = [
  { id: "P", name: "Host — node / segment / space [[x, y], …]", type: "text", value: "[[0, 0]]", options: [] },
  R("width", "Overall width", 0.56, 0.42, 0.8, 0.01),
  R("depth", "Overall depth", 0.58, 0.42, 0.8, 0.01),
  R("seatHeight", "Seat height", 0.48, 0.38, 0.6, 0.005),
  R("cushionThk", "Seat body thickness", 0.1, 0.05, 0.18, 0.005),
  R("backTop", "Back height above the seat", 0.36, 0.15, 0.6, 0.01),
  S("armStyle", "Arms", "Tub arms", ["Tub arms", "Low arms", "Armless"]),
  R("armHeight", "Arm height (from floor)", 0.65, 0.52, 0.78, 0.005),
  R("shellThk", "Shell thickness", 0.065, 0.035, 0.12, 0.005),
  R("backCurve", "Back wrap (share of half-width)", 0.55, 0.15, 0.95, 0.01),
  R("backRake", "Back rake (deg)", 9, 0, 20, 0.5),
  S("quilting", "Inner back quilting", "Diamond", ["Diamond", "Channel", "Plain"]),
  R("quiltPitch", "Quilt pitch (m)", 0.075, 0.04, 0.16, 0.005),
  R("quiltAspect", "Quilt diamond height / width", 1.15, 0.6, 2, 0.05),
  R("quiltDepth", "Quilt puff depth (m)", 0.008, 0, 0.02, 0.001),
  C("piping", "Piping on the seams", true),
  R("pipingDia", "Piping diameter (m)", 0.009, 0.004, 0.016, 0.001),
  R("legSize", "Leg diameter at the top", 0.042, 0.025, 0.07, 0.001),
  R("legFootDia", "Leg diameter at the foot", 0.024, 0.012, 0.06, 0.001),
  R("legSplay", "Leg splay (deg)", 8, 0, 16, 0.5),
  R("rotation", "Rotation (deg)", 0, 0, 360, 1),
  S("anchorDir", "Anchor Direction", "Center", ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"]),
  S("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  R("margin", "Margin from host", 0, 0, 1, 0.01),
  C("flipSide", "Flip side", false),
  { ...S("detail", "Mesh detail", "Fine", ["Blocky", "Medium", "Fine", "Smooth"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { ...S("edgeCharacter", "Edge character", "Soft", ["Crisp", "Soft", "Plump"]), min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  X("material", "Material", "cream faux-leather shell and seat with self piping, diamond-quilted inner back, solid light-oak tapered legs"),
  X("semantics", "Semantics", "modern upholstered dining armchair, tub back wrapping into arms, diamond quilting, piped seams, splayed oak legs"),
  X("materialPath", "Material (Library/Materials/…)", "Finishes/leather-cream.json"),
  X("finishes", "Per-row finishes (Row=path; …)", "Legs=Finishes/light-oak.json; Piping=Finishes/leather-cream.json; Seat=Finishes/leather-cream.json; Shell=Finishes/leather-cream.json"),
];
// Every non-text prop feeds the Math Engine; text props are carried, not computed.
const wired = props.filter((p) => p.type !== "text" || p.id === "P").map((p) => p.id);

const OUT = [
  ["Shell3D", "Shell — mesh"], ["Seat3D", "Seat — mesh"], ["Piping3D", "Piping — mesh"], ["Legs3D", "Legs — mesh"],
  ["ShellPlan", "Shell — plan"], ["SeatPlan", "Seat — plan"], ["LegsPlan", "Legs — plan"],
  ["overallWidth", "Overall width (m)"], ["overallDepth", "Overall depth (m)"], ["overallHeight", "Overall height (m)"],
  ["seatTop", "Seat height (m)"], ["armTop", "Arm height (m)"], ["backTopHeight", "Back top (m)"],
  ["footprint", "Footprint (m²)"], ["scale", "Fit scale"], ["quiltCells", "Quilt cells (approx.)"],
  ["meshFaces", "Mesh faces"], ["shellStations", "Shell stations"],
];
const slots = OUT.map(([, label], i) => ({ id: `s${i + 1}`, label }));
const slotOf = Object.fromEntries(OUT.map(([name], i) => [name, `s${i + 1}`]));

const r2d = [
  { id: "p2_legs", kind: "polygon", name: "Legs", color: "#b88a5a", layer: "Chair", show: true },
  { id: "p2_seat", kind: "polygon", name: "Seat", color: "#e9e0d0", layer: "Chair", show: true },
  { id: "p2_shell", kind: "polygon", name: "Shell", color: "#d9ccb7", layer: "Chair", show: true },
];
const r3d = [
  { id: "p3_shell", kind: "polyhedron", name: "Shell", color: "#e6dccb", layer: "Chair", x: 0, y: 0, z: 0, show: true },
  { id: "p3_seat", kind: "polyhedron", name: "Seat", color: "#ebe2d2", layer: "Chair", x: 0, y: 0, z: 0, show: true },
  { id: "p3_piping", kind: "polyhedron", name: "Piping", color: "#d8ccb8", layer: "Chair", x: 0, y: 0, z: 0, show: true },
  { id: "p3_legs", kind: "polyhedron", name: "Legs", color: "#c49a6c", layer: "Chair", x: 0, y: 0, z: 0, show: true },
];
const rowWire = { Shell3D: ["r3d", "p3_shell"], Seat3D: ["r3d", "p3_seat"], Piping3D: ["r3d", "p3_piping"], Legs3D: ["r3d", "p3_legs"], ShellPlan: ["r2d", "p2_shell"], SeatPlan: ["r2d", "p2_seat"], LegsPlan: ["r2d", "p2_legs"] };

const edges = [{ id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" }];
for (const id of wired) edges.push({ id: `e_props_math_${id}`, source: "props", target: "math", sourceHandle: `val-${id}`, targetHandle: `valin-${id}` });
for (const [name] of OUT) edges.push({ id: `e_math_out_${name}`, source: "math", target: "out", sourceHandle: `val-${name}`, targetHandle: `valin-${slotOf[name]}` });
for (const [name, [node, row]] of Object.entries(rowWire)) edges.push({ id: `e_out_${node}_${row}`, source: "out", target: node, sourceHandle: `val-${slotOf[name]}`, targetHandle: `valin-${row}` });
for (const row of ["p3_shell", "p3_seat", "p3_piping"]) edges.push({ id: `e_mat_${row}`, source: "mat_leather", target: "r3d", sourceHandle: "mat", targetHandle: `matin-${row}` });
edges.push({ id: "e_mat_p3_legs", source: "mat_oak", target: "r3d", sourceHandle: "mat", targetHandle: "matin-p3_legs" });

const description = `A parametric UPHOLSTERED DINING ARMCHAIR on the six-node spine — Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE, A SEGMENT OR A SPACE. On a segment or a space the chair faces along the host's direction; Rotation turns it about its host and Flip side swaps which way it looks. At rotation 0 the back is at -x.

WHAT IT BUILDS. A tub SHELL that wraps the back and runs forward as the arms, a thick SEAT with a rolled edge and a crowned top, self PIPING along the seat edge and the shell's top, and four TAPERED ROUND LEGS splayed out and raked back. Four mesh rows, four material bindings: cream faux leather on the upholstery, light oak on the legs.

THE SHELL IS ONE LOFT, NOT THREE BOXES. Its plan line is the centreline of the shell's thickness — a quarter superellipse round each back corner, then straight to the arm tip — resampled by arc length. Every station carries the same ring (outer face, half-round top, inner face, foot), so back and arms are one continuous surface. Height along the line is flat across the back, smoothsteps through the corners to arm height, falls gently along the arm and rolls down onto the seat at the tip.

THE QUILTING IS A DISPLACEMENT OF THE INNER FACE, not added geometry: two waves at ±45° in the unrolled (arc length, height) plane, multiplied and square-rooted, so the stitch lines stay put and every diamond puffs toward the sitter. Measured from the back centre, the pattern is symmetric at every width. A plain border frames it above the seat, under the roll and before the arm turns down. Channel and Plain are the other two faces.

THE SEAT IS THE SHELL'S OWN FOOT closed across the front: its back and sides are the shell's outer face pushed out 2.5 mm, so the shell stands exactly on the seat edge at every width and wrap, and the seat piping covers the one seam where they meet. Section: eased foot, straight side, a roll on a stated radius (Edge character), then a low crown closed by scaling toward the middle.

PIPING is a circle swept along a rail by parallel transport, so it does not twist where the shell turns the corner and climbs down the arm. LEGS are horizontal slices of a tilted cone, so the foot sits flat on the floor and the top meets the underside flat at any splay.

ONE DETAIL DIAL sets every sample count: Blocky (low poly, no quilt or piping) / Medium / Fine / Smooth. Fine is ~12k faces.

DIMENSIONS AT THE DEFAULTS: about 0.57 × 0.64 m over the splayed feet, seat at 0.48 m, arms at 0.65 m, back top 0.84 m.

WHAT THIS CANNOT DO. The quilt is a displacement, so its buttons are not separate parts. The shell is a single thickness, not a frame under foam. The arm tip closes with a flat cap on a small section.`;

const flow = {
  version: 1,
  id: "chair-with-math",
  title: "Chair (mesh) — upholstered tub armchair, quilted shell, piped seams, splayed oak legs",
  category: "Furniture",
  object: {
    hostKind: "node", name: "Chair", units: "m",
    icon: { paths: ["M6 20l1-6", "M18 20l-1-6", "M5 14h14", "M5 14V8a7 5 0 0114 0v6", "M5 11h3", "M16 11h3"] },
  },
  description,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -200, y: 60 }, data: { tool: "expr", params: { name: "Chair maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: r2d } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: r3d } } },
    { id: "mat_leather", position: { x: 640, y: -360 }, data: { tool: "material", params: { path: "Materials/Finishes/leather-cream.json" } } },
    { id: "mat_oak", position: { x: 640, y: -220 }, data: { tool: "material", params: { path: "Materials/Finishes/light-oak.json" } } },
  ],
  edges,
};

mkdirSync(join(here, "out"), { recursive: true });
writeFileSync(join(here, "out", "chair.json"), JSON.stringify(flow, null, 2));
console.log(`wrote out/chair.json — ${props.length} props, ${slots.length} slots, ${edges.length} edges, expr ${expr.split("\n").length} lines`);
