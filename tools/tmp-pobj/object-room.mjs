/** room.json — a SPACE-hosted parametric object on the six-node spine (see plot.json).
 *
 *  One editable parameter: Colour. Because a 2D/3D Render row's colour is a property OF THE ROW —
 *  `spineObject.ts` reads `fillColor.push(row.color)` and nothing else — a Math Engine can never put
 *  a colour on a wire. So the choice is expressed as WHICH ROW RECEIVES THE OUTLINE: one row per
 *  colour, exactly one of them fed, the rest handed an empty list and skipped.
 */

export const PALETTE = [
  { key: "Grey", fill: "#cbd5e1", solid: "#94a3b8" },
  { key: "Blue", fill: "#93c5fd", solid: "#60a5fa" },
  { key: "Green", fill: "#86efac", solid: "#4ade80" },
  { key: "Yellow", fill: "#fde047", solid: "#facc15" },
  { key: "Orange", fill: "#fdba74", solid: "#fb923c" },
  { key: "Red", fill: "#fca5a5", solid: "#f87171" },
  { key: "Purple", fill: "#d8b4fe", solid: "#c084fc" },
  { key: "Teal", fill: "#5eead4", solid: "#2dd4bf" },
];

const slug = (k) => k.toLowerCase();
/** The 2D row property bag the editor writes (matches plot.json's rows field-for-field). */
const row2d = (id, name, color) => ({
  id, kind: "polygon", name, color, layer: "",
  radius: 1, width: 0.1, tubeRadius: 0.1, length: 3, breadth: 2, height: 3,
  radiusTop: 0.8, topLength: 2, topBreadth: 1.5, arcDeg: 360, x: 0, y: 0, z: 0,
  lineStyle: "solid", fillMode: "filled", hatch: "none", hatchSpacing: 8, hatchWeight: 1,
  opacity: 1, displayType: "solid", showEdges: false, show: true,
});
const row3d = (id, name, color) => ({ id, kind: "polyhedron", name, color, x: 0, y: 0, z: 0, show: true });

const prop = (o) => ({ min: 0, max: 10, step: 1, options: [], editable: false, showInCanvas: false, necessary: true, ...o });

const expr = [
  "# Space metrics from the selected Space's outline. P arrives as [[x, y], ...] in metres,",
  "# local to the flow anchor.",
  "",
  "_n = rows(P)",
  "_ok = _n >= 3 ? 1 : 0",
  "# Nothing selected yet, or a degenerate outline: fall back to a 3-point stub so the row maths",
  "# below is always well formed. Every published figure is gated on _ok, so the readout is zeros",
  "# rather than a crash or a phantom shape.",
  "_Q = _ok > 0 ? P : vcat(hcat(0, 0), hcat(0, 0), hcat(0, 0))",
  "_x = col(_Q, 0)",
  "_y = col(_Q, 1)",
  "",
  "# The same ring advanced by one vertex — `shift` rolls the ROW ORDER cyclically, so the last",
  "# vertex wraps back to the first and every edge-wise term below has its partner.",
  "_Q2 = shift(_Q, -1)",
  "_x2 = col(_Q2, 0)",
  "_y2 = col(_Q2, 1)",
  "",
  "# Shoelace, absolute so winding direction does not flip the sign. Holes are not subtracted:",
  "# this is the outline's area.",
  "area = _ok * abs(sum(_x * _y2 - _x2 * _y)) / 2",
  "perimeter = _ok * sum(len(_Q2 - _Q))",
  "",
  "# Bounding box, not the edge lengths — correct for an L or a T, where no single edge is the",
  "# overall width.",
  "dimX = _ok * (max(_x) - min(_x))",
  "dimY = _ok * (max(_y) - min(_y))",
  "",
  "# GREATER over SMALLER, so the ratio is >= 1 whichever way the space is turned: a 2 x 7 room",
  "# reads 3.5, not 0.286.",
  "aspect = _ok * max(dimX, dimY) / max(min(dimX, dimY), 1e-9)",
  "",
  "# CENTROID of the outline (the area centroid, not the average of the vertices — those differ the",
  "# moment the vertices are unevenly spaced, and it is the area centroid a label wants to sit on).",
  "_cr = _x * _y2 - _x2 * _y",
  "_sa = sum(_cr)",
  "_den = abs(_sa) > 1e-12 ? (3 * _sa) : 1e-12",
  "centroidX = _ok * sum((_x + _x2) * _cr) / _den",
  "centroidY = _ok * sum((_y + _y2) * _cr) / _den",
  "",
  "# The floor plate for the 3D rows: the outline extruded from z = 0 to 0.001 m. Thin enough to",
  "# read as a plate rather than a volume, and it is a real solid so the 3D view can shade it.",
  "# Built ONCE and then routed, so adding a colour costs a comparison, not another extrusion.",
  "_Slab = _ok > 0 ? mprism(_Q, 0, 0.001) : zeros(0, 4)",
  "",
  "# COLOUR -> WHICH ROW GETS THE OUTLINE.",
  "# A Render row's colour is a property OF THE ROW, not of the geometry: a Math Engine can only put",
  "# numbers on a wire, never a colour, so ONE row cannot change hue on a condition. N rows can, and",
  "# the switch becomes a question of which row is fed. The chosen row receives _Q and draws the room;",
  "# every other row receives an EMPTY list and is skipped outright, because a Render row with no",
  "# parseable geometry draws nothing rather than drawing something invisible on top. No two rows are",
  "# ever filled at once, so exactly one colour is on screen.",
  "# Grey is the FALLBACK arm rather than an equality test, so a blank or unrecognised colour still",
  "# draws the room instead of vanishing. Nothing selected (_ok = 0) fills no row at all, which keeps",
  "# the \"nothing selected is not an error\" rule the rest of this engine follows.",
  "",
  ...PALETTE.slice(1).map((c) => `_is${c.key} = color == '${c.key}' ? 1 : 0`),
  `_named = ${PALETTE.slice(1).map((c) => `_is${c.key}`).join(" + ")}`,
  "_isGrey = _named < 1 ? 1 : 0",
  "",
  ...PALETTE.map((c) => `Room${c.key} = _ok > 0 && _is${c.key} > 0 ? _Q : zeros(0, 2)`),
  "",
  ...PALETTE.map((c) => `Slab${c.key} = _is${c.key} > 0 ? _Slab : zeros(0, 4)`),
].join("\n");

const slots = [
  { id: "s1", label: "Area (m2)", showInCanvas: true, necessary: true },
  { id: "s2", label: "Perimeter (m)", showInCanvas: false, necessary: false },
  { id: "s3", label: "Dimension X (m)", showInCanvas: false, necessary: false },
  { id: "s4", label: "Dimension Y (m)", showInCanvas: false, necessary: false },
  { id: "s5", label: "Aspect ratio (greater : smaller)", showInCanvas: false, necessary: false },
  { id: "s6", label: "Centroid X (m)", showInCanvas: false, necessary: false },
  { id: "s7", label: "Centroid Y (m)", showInCanvas: false, necessary: false },
  { id: "s8", label: "Colour", showInCanvas: false, necessary: true },
];

const edges = [
  { id: "e_geo_props", source: "source", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" },
  { id: "e_props_math_P", source: "props", target: "math", sourceHandle: "val-P", targetHandle: "valin-P" },
  { id: "e_props_math_color", source: "props", target: "math", sourceHandle: "val-color", targetHandle: "valin-color" },
  { id: "e_math_out_s1", source: "math", target: "out", sourceHandle: "val-area", targetHandle: "valin-s1" },
  { id: "e_math_out_s2", source: "math", target: "out", sourceHandle: "val-perimeter", targetHandle: "valin-s2" },
  { id: "e_math_out_s3", source: "math", target: "out", sourceHandle: "val-dimX", targetHandle: "valin-s3" },
  { id: "e_math_out_s4", source: "math", target: "out", sourceHandle: "val-dimY", targetHandle: "valin-s4" },
  { id: "e_math_out_s5", source: "math", target: "out", sourceHandle: "val-aspect", targetHandle: "valin-s5" },
  { id: "e_math_out_s6", source: "math", target: "out", sourceHandle: "val-centroidX", targetHandle: "valin-s6" },
  { id: "e_math_out_s7", source: "math", target: "out", sourceHandle: "val-centroidY", targetHandle: "valin-s7" },
  { id: "e_props_out_s8", source: "props", target: "out", sourceHandle: "val-color", targetHandle: "valin-s8" },
  ...PALETTE.map((c) => ({ id: `e_math_r2d_pr_${slug(c.key)}`, source: "math", target: "r2d", sourceHandle: `val-Room${c.key}`, targetHandle: `valin-pr_${slug(c.key)}` })),
  ...PALETTE.map((c) => ({ id: `e_math_r3d_p3_${slug(c.key)}`, source: "math", target: "r3d", sourceHandle: `val-Slab${c.key}`, targetHandle: `valin-p3_${slug(c.key)}` })),
];

export const room = {
  version: 1,
  id: "room-with-math",
  title: "Room — a space-hosted colour fill, with its measured area, perimeter, dimensions and centroid",
  category: "Building",
  object: { hostKind: "space", name: "Room" },
  description: `Select a Space and it reads as a room: a coloured surface in plan, a paper-thin floor plate in 3D, and its area, perimeter, bounding dimensions, aspect ratio and centroid as numbers. Six nodes: Geometry -> Input Properties -> Math Engine -> Output Metrics, with a 2D Render node and a 3D Render node alongside — the same shape as plot.json and road.json.

  IDENTIFYING TYPE is a CLASSIFIER, not a setting: it reads "room" and is EDITABLE: FALSE because changing it would make the object lie about what it is. It exists so consumers can ask what a space IS without matching on this file's \`id\`, which breaks the moment the object is renamed. Its partners are "plot" on plot.json and "road" on road.json.

  WHAT YOU DECLARE. Colour, and for now only colour. Space outline is EDITABLE: FALSE because it is the HOST — it carries a coordinate list, not a setting, and it arrives from whichever Space the object is attached to.

  WHY COLOUR IS A LIST AND NOT A PICKER. This is the one thing worth understanding before extending the file. A Render row's colour is a property OF THE ROW — the attached-object runtime reads it as \`row.color\` and from nowhere else — and a Math Engine can only put NUMBERS on a wire. So no expression, and no colour-picker parameter, can reach it: a picker would render happily in the Properties panel and change nothing on screen.

  What CAN change is WHICH ROW RECEIVES THE OUTLINE. So there is one 2D row and one 3D row per colour, and the Math Engine feeds exactly one pair: the chosen row gets \`_Q\`, every other row gets an EMPTY list. A Render row with nothing parseable wired draws nothing at all — not a transparent shape on top of the others — so exactly one colour is ever on screen. Eight colours, sixteen rows, one comparison each.

  GREY IS THE FALLBACK ARM, not an equality test: \`_isGrey = _named < 1\`, where \`_named\` is the sum of the seven other flags. A blank, misspelt or newly-unrecognised colour therefore still draws the room in grey instead of vanishing — the failure mode of a chain of equality tests, where nothing matches and nothing is fed.

  THE SLAB IS BUILT ONCE AND THEN ROUTED. \`mprism\` runs a single time into \`_Slab\`; the eight 3D outputs are cheap ternaries over it. Adding a ninth colour costs a comparison, not another extrusion.

  NOTHING SELECTED IS NOT AN ERROR. \`_ok\` gates every published figure, and the outline falls back to a degenerate 3-point stub so the row maths downstream is always well formed. With no space attached the metrics read zero and no row is fed, rather than the engine throwing or a phantom shape appearing at the origin.

  THE METRICS ARE MEASURED, NOT DECLARED. Area is the shoelace sum, absolute so winding direction cannot flip its sign. Dimension X and Y are the BOUNDING BOX, not edge lengths — correct for an L-shaped or T-shaped room, where no single edge is the overall width. Aspect is greater over smaller, so it is >= 1 whichever way the room is turned. The centroid is the AREA centroid rather than the average of the vertices: those two differ the moment the vertices are unevenly spaced, and it is the area centroid that a room label should sit on.

  WHAT THIS CANNOT DO. The palette is fixed at authoring time, because that is what the row model requires — an arbitrary user-chosen hex is not reachable without a change to the Render row itself. Holes are not subtracted from the area: this is the outline's area. There is no wall, ceiling or volume — the 3D output is a 1 mm floor plate, not a room in the solid sense.`,
  nodes: [
    { id: "source", position: { x: -1180, y: 40 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry — selected Space" } } },
    { id: "props", position: { x: -880, y: 0 }, data: { tool: "input-props", params: { props: [
      prop({ id: "P", name: "Space outline [[x, y], ...]", type: "text", value: "[]" }),
      prop({ id: "identifyingType", name: "Identifying type", type: "text", value: "room", necessary: false }),
      prop({ id: "color", name: "Colour", type: "select", value: "Grey", options: PALETTE.map((c) => c.key), editable: true }),
    ] } } },
    { id: "math", position: { x: -460, y: 0 }, data: { tool: "expr", params: { name: "Room metrics & colour routing", expr } } },
    { id: "out", position: { x: 40, y: 0 }, data: { tool: "output", params: { slots } } },
    { id: "r2d", position: { x: 460, y: -160 }, data: { tool: "render-2d", params: { prims: PALETTE.map((c) => row2d(`pr_${slug(c.key)}`, `Room — ${c.key.toLowerCase()}`, c.fill)) } } },
    { id: "r3d", position: { x: 460, y: 160 }, data: { tool: "render-3d", params: { prims: PALETTE.map((c) => row3d(`p3_${slug(c.key)}`, `Floor plate — ${c.key.toLowerCase()}`, c.solid)) } } },
  ],
  edges,
};
