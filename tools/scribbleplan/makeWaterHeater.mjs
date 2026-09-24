/** Author `Objects/Architectural/water-heater.json` — the one object this house needs that the
 *  library does not have. Run: node tools/scribbleplan/makeWaterHeater.mjs [--upload]
 *
 *  Built on the same six-node spine every object in the bucket uses:
 *
 *      Geometry → Input Properties → Math Engine → Output → 2D Render + 3D Render
 *
 *  The host-frame preamble (read the host points, build the u/v axes, apply `rotation` /
 *  `anchorDir` / `fitMode`) is the shared opening of every one of those objects and is reproduced
 *  verbatim — it is the contract with the host, not this object's idea. What is this object's own is
 *  everything after it: CAPACITY drives the geometry rather than the other way round, because that
 *  is the number a geyser is bought by. Litres and the jacketed diameter give the inner radius, the
 *  inner radius gives the body length, and the plan symbol is a stadium lying on the wall (or a
 *  circle, stood up), with the inlet and outlet stubs drawn where the plumber needs them.
 */
import fs from "node:fs";
import path from "node:path";

const P = (id, name, type, value, extra = {}) => ({ id, name, type, value, options: [], ...extra });
const RANGE = (id, name, value, min, max, step) => P(id, name, "range", value, { min, max, step });
const SELECT = (id, name, value, options) => ({ id, name, type: "select", value, options });

const props = [
  P("P", "Host — node / segment / space [[x, y], …]", "text", "[[0, 0]]"),
  RANGE("capacity", "Capacity (litres)", 25, 6, 200, 1),
  RANGE("diameter", "Outer diameter", 0.4, 0.24, 0.75, 0.01),
  RANGE("jacket", "Insulation jacket", 0.03, 0, 0.1, 0.005),
  SELECT("orientation", "Orientation", "Horizontal", ["Horizontal", "Vertical"]),
  RANGE("mountHeight", "Mount height (underside)", 1.8, 0, 2.6, 0.05),
  RANGE("pipeRadius", "Pipe radius", 0.012, 0.005, 0.03, 0.001),
  RANGE("bracketDepth", "Bracket projection", 0.06, 0, 0.2, 0.005),
  P("showPipes", "Show inlet / outlet", "checkbox", true),
  RANGE("rotation", "Rotation", 0, 0, 360, 1),
  SELECT("anchorDir", "Anchor", "Center", [
    "Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center",
    "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right",
  ]),
  SELECT("fitMode", "Fit to host", "Off", ["Off", "Max", "Exact"]),
  RANGE("margin", "Margin from host", 0, 0, 1, 0.01),
  P("flipSide", "Flip side", "checkbox", false),
  P("semantics", "Semantics", "text", "white enamelled storage water heater, wall bracket, chrome inlet and outlet",
    { min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true }),
];

/** The host frame + fit + anchor preamble, shared with every Architectural object. `natural` is the
 *  expression giving the object's own length, which is what `fitMode` scales against. */
const hostFrame = (natural) => `_natL = ${natural}
# Host frame — node, segment or space
_e1 = hcat(1, 0)
_np = rows(P)
_isSeg = _np == 2
_isSpace = _np > 2
_edges = _isSpace ? (shift(P, -1) - P) : _e1
_edgeLen = len(_edges)
_longest = max(_edgeLen)
_spaceDir = _isSpace ? row(compress(_edges, eq(_edgeLen, _longest)), 0) : _e1
_segDir = _isSeg ? (row(P, 1) - row(P, 0)) : _e1
_dir = _isSpace ? _spaceDir : (_isSeg ? _segDir : _e1)
_dirLen = len(_dir)
_axisB = _dirLen > 0 ? normalize(_dir) : _e1
_rot = rotation * PI / 180
_crot = cos(_rot)
_srot = sin(_rot)
_bx = sub(_axisB, 0, 0, 1, 1)
_by = sub(_axisB, 0, 1, 1, 1)
_axisU = hcat(_bx * _crot - _by * _srot, _bx * _srot + _by * _crot)
_axisV = (flipSide > 0 ? -1 : 1) * perp(_axisU)
_ux = sub(_axisU, 0, 0, 1, 1)
_uy = sub(_axisU, 0, 1, 1, 1)
_vx = sub(_axisV, 0, 0, 1, 1)
_vy = sub(_axisV, 0, 1, 1, 1)
_Qu = col(P, 0) * _ux + col(P, 1) * _uy
_Qv = col(P, 0) * _vx + col(P, 1) * _vy
_hu0 = _np > 0 ? min(_Qu) : 0
_hu1 = _np > 0 ? max(_Qu) : 0
_hv0 = _np > 0 ? min(_Qv) : 0
_hv1 = _np > 0 ? max(_Qv) : 0
_hcu = (_hu0 + _hu1) / 2
_hcv = (_hv0 + _hv1) / 2
_hostL = _hu1 - _hu0
_hostW = _hv1 - _hv0
# Fit to host — one uniform scale, Max never enlarges
_availL = max(0, _hostL - 2 * margin)
_notOff = fitMode != 'Off'
_exact = fitMode == 'Exact'
_sRaw = _natL > 0 ? _availL / _natL : 1
_sFit = (_notOff && _availL > 0) ? (_exact ? _sRaw : min(1, _sRaw)) : 1
scale = max(0.15, min(5, _sFit))
_s = scale`;

const anchorBlock = `# Anchor — place the footprint by any of the nine box points
_anchorL = anchorDir == 'Top-Left' || anchorDir == 'Left-Center' || anchorDir == 'Bottom-Left'
_anchorR = anchorDir == 'Top-Right' || anchorDir == 'Right-Center' || anchorDir == 'Bottom-Right'
_anchorT = anchorDir == 'Top-Left' || anchorDir == 'Top-Center' || anchorDir == 'Top-Right'
_anchorB = anchorDir == 'Bottom-Left' || anchorDir == 'Bottom-Center' || anchorDir == 'Bottom-Right'
_ax = _anchorR - _anchorL
_ay = _anchorB - _anchorT
_hau = _hcu + _ax * max(0, _hostL / 2 - margin)
_hav = _hcv + _ay * max(0, _hostW / 2 - margin)
_cu = _hau - _ax * _bodyL / 2
_cv = _hav - _ay * _bodyW / 2`;

const expr = `${hostFrame("(capacity / 1000) / (PI * max(0.01, (diameter / 2 - jacket)) * max(0.01, (diameter / 2 - jacket))) + diameter")}
# Capacity drives the cylinder: litres and the jacketed bore give the length of the shell.
_dia = diameter * _s
_rOut = _dia / 2
_rIn = max(0.02, _rOut - jacket * _s)
_volM3 = capacity / 1000
# The two dished ends are hemispheres — together a sphere of the bore — and they hold water too, so
# the straight shell only has to make up the REMAINDER. Ignoring that overstates a 25 L cylinder by
# about a fifth of a metre.
_capVol = (4 / 3) * PI * _rIn * _rIn * _rIn
_shellLen = max(0.04, (_volM3 - _capVol) / (PI * _rIn * _rIn))
_len = _shellLen + _dia
_vert = orientation == 'Vertical' ? 1 : 0
# Plan footprint: a stadium lying on the wall, or a circle stood on end.
_bodyL = _vert > 0 ? _dia : _len
_bodyW = _dia
_hs = max(0, (_len - _dia) / 2)
${anchorBlock}
_k = arange(16)
_t1 = 0 - PI / 2 + _k * PI / 15
_cap1 = hcat(_hs + _rOut * cos(_t1), _rOut * sin(_t1))
_t2 = PI / 2 + _k * PI / 15
_cap2 = hcat(0 - _hs + _rOut * cos(_t2), _rOut * sin(_t2))
_stadium = vcat(_cap1, _cap2)
_c = arange(28)
_ct = _c * 2 * PI / 28
_circle = hcat(_rOut * cos(_ct), _rOut * sin(_ct))
_bodyLocal = _vert > 0 ? _circle : _stadium
_toWorld_bu = _cu + col(_bodyLocal, 0)
_toWorld_bv = _cv + col(_bodyLocal, 1)
BodyPlan = hcat(_toWorld_bu * _ux + _toWorld_bv * _vx, _toWorld_bu * _uy + _toWorld_bv * _vy)
# The shell hangs from its bracket: horizontal is one diameter deep, vertical is the full length.
_z0 = mountHeight
_z1 = mountHeight + (_vert > 0 ? _len : _dia)
Body3D = mprism(BodyPlan, _z0, _z1)
# Inlet and outlet, drawn where the plumber has to reach them.
_pipeR = max(0.004, pipeRadius * _s)
_pu = _vert > 0 ? _rOut * 0.55 : _hs
_pk = arange(12)
_pt = _pk * 2 * PI / 12
_p1u = _cu + _pu + _pipeR * cos(_pt)
_p1v = _cv + _pipeR * sin(_pt)
_p2u = _cu - _pu + _pipeR * cos(_pt)
_p2v = _cv + _pipeR * sin(_pt)
_hasPipes = showPipes > 0 ? 1 : 0
Inlet = _hasPipes > 0 ? hcat(_p1u * _ux + _p1v * _vx, _p1u * _uy + _p1v * _vy) : zeros(0, 2)
Outlet = _hasPipes > 0 ? hcat(_p2u * _ux + _p2v * _vx, _p2u * _uy + _p2v * _vy) : zeros(0, 2)
Inlet3D = _hasPipes > 0 ? mprism(Inlet, _z0 - 0.18, _z0 + 0.02) : zeros(0, 4)
Outlet3D = _hasPipes > 0 ? mprism(Outlet, _z0 - 0.18, _z0 + 0.02) : zeros(0, 4)
# Wall bracket — the strap the cylinder actually hangs on, shown in plan as its projection.
_brD = max(0.001, bracketDepth * _s)
_brU = _vert > 0 ? _rOut : _hs + _rOut * 0.4
_brLocal = hcat(0 - _brU, 0 - _rOut - _brD, _brU, 0 - _rOut - _brD, _brU, 0 - _rOut, 0 - _brU, 0 - _rOut)
_br1u = _cu + hcat(sub(_brLocal, 0, 0, 1, 1), sub(_brLocal, 0, 2, 1, 1), sub(_brLocal, 0, 4, 1, 1), sub(_brLocal, 0, 6, 1, 1))
_br1v = _cv + hcat(sub(_brLocal, 0, 1, 1, 1), sub(_brLocal, 0, 3, 1, 1), sub(_brLocal, 0, 5, 1, 1), sub(_brLocal, 0, 7, 1, 1))
_brU4 = reshape(_br1u, 4, 1)
_brV4 = reshape(_br1v, 4, 1)
BracketPlan = bracketDepth > 0 ? hcat(_brU4 * _ux + _brV4 * _vx, _brU4 * _uy + _brV4 * _vy) : zeros(0, 2)
Bracket3D = bracketDepth > 0 ? mprism(BracketPlan, _z0 - 0.05, _z0 + 0.05) : zeros(0, 4)
# Metrics — what a geyser is specified and installed by.
litres = capacity
shellLength = _shellLen
overallLength = _len
overallDiameter = _dia
surfaceArea = 2 * PI * _rOut * _shellLen + 2 * PI * _rOut * _rOut
emptyWeight = 4 + 0.62 * capacity
fullWeight = 4 + 0.62 * capacity + capacity
mountedTop = _z1
footprint = _vert > 0 ? PI * _rOut * _rOut : (_shellLen * _dia + PI * _rOut * _rOut)`;

const OUT_SLOTS = [
  ["s1", "Shell — solid", "Body3D"],
  ["s2", "Bracket — solid", "Bracket3D"],
  ["s3", "Inlet — solid", "Inlet3D"],
  ["s4", "Outlet — solid", "Outlet3D"],
  ["s5", "Shell — plan", "BodyPlan"],
  ["s6", "Bracket — plan", "BracketPlan"],
  ["s7", "Inlet — plan", "Inlet"],
  ["s8", "Outlet — plan", "Outlet"],
  ["s9", "Capacity (L)", "litres"],
  ["s10", "Shell length (m)", "shellLength"],
  ["s11", "Overall length (m)", "overallLength"],
  ["s12", "Outer diameter (m)", "overallDiameter"],
  ["s13", "Surface area (m²)", "surfaceArea"],
  ["s14", "Empty weight (kg)", "emptyWeight"],
  ["s15", "Full weight (kg)", "fullWeight"],
  ["s16", "Top of cylinder (m)", "mountedTop"],
  ["s17", "Footprint (m²)", "footprint"],
];

/** slot id → [2D prim, 3D prim] wiring. Only the four geometry pairs render; the rest are metrics. */
const RENDER = {
  s1: ["p3_shell", "polyhedron", "Shell", "#e2e8f0"],
  s2: ["p3_bracket", "polyhedron", "Bracket", "#94a3b8"],
  s3: ["p3_inlet", "polyhedron", "Inlet", "#38bdf8"],
  s4: ["p3_outlet", "polyhedron", "Outlet", "#f87171"],
  s5: ["p2_shell", "polygon", "Shell", "#cbd5e1"],
  s6: ["p2_bracket", "polygon", "Bracket", "#94a3b8"],
  s7: ["p2_inlet", "polygon", "Inlet", "#38bdf8"],
  s8: ["p2_outlet", "polygon", "Outlet", "#f87171"],
};

const edges = [];
let n = 0;
const edge = (source, sourceHandle, target, targetHandle) =>
  edges.push({ id: `e${++n}_${source}_${sourceHandle}__${target}_${targetHandle}`, source, sourceHandle, target, targetHandle });

edge("geo", "val-points", "props", "valin-P");
for (const p of props) if (p.id !== "P") edge("props", `val-${p.id}`, "math", `valin-${p.id}`);
edge("props", "val-P", "math", "valin-P");
for (const [slot, , value] of OUT_SLOTS) {
  edge("math", `val-${value}`, "out", `valin-${slot}`);
  const r = RENDER[slot];
  if (r) edge("out", `val-${slot}`, r[1] === "polygon" ? "r2d" : "r3d", `valin-${r[0]}`);
}

const prims = (kind) => Object.values(RENDER).filter((r) => r[1] === kind).map(([id, k, name, color]) => ({
  id, kind: k, name, color, layer: "Sanitary", show: true,
  ...(k === "polyhedron" ? { x: 0, y: 0, z: 0 } : {}),
}));

const file = {
  version: 1,
  id: "water-heater-with-math",
  title: "Water Heater — one Math Engine, capacity-driven shell",
  category: "Sanitary",
  object: {
    hostKind: "node",
    name: "Water Heater",
    units: "m",
    icon: { paths: ["M6 4h12v16H6z", "M9 4v-2", "M15 4v-2", "M9 12h6"] },
  },
  description: `A parametric STORAGE WATER HEATER (geyser) on the six-node spine:

  Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render

CAPACITY IS THE INPUT, NOT THE LENGTH. A geyser is bought in litres, so litres is what drives the geometry here: the jacketed bore (\`diameter\` less twice \`jacket\`) gives the inner radius, and the shell length falls out of the volume. Change 15 L to 25 L and the cylinder grows along the wall by itself — which is the behaviour you want when a client changes the spec, and the reason this is not just a box with three dimensions typed into it.

THE PLAN SYMBOL. Horizontal is the usual wall-hung installation and reads as a STADIUM — the straight shell with its two dished ends — lying along the wall, with the bracket projecting behind it and the inlet and outlet drawn as small circles at the two ends, which is where the plumbing has to land. Vertical stands the same cylinder on end, so the symbol becomes a plain circle and the shell runs UP from \`mountHeight\` instead of across.

WHAT IT REPORTS. Capacity, shell length, overall length over the dished ends, outer diameter, heat-loss surface area, empty weight and — the number that decides the fixing — FULL weight, which is the empty shell plus a kilogram per litre. A 25 L geyser at the defaults is 19.5 kg empty and 44.5 kg full, which is what the wall and its plugs have to carry.

WHAT IT DOES NOT DO. No element, thermostat or anode is modelled; no flue, because this is the electric storage type rather than gas. The bracket is a single strap shown as its plan projection, not a real two-arm cradle. It does not cut the wall it hangs on.`,
  nodes: [
    { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
    { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
    { id: "math", position: { x: -180, y: 40 }, data: { tool: "expr", params: { name: "Water Heater maths", expr } } },
    { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots: OUT_SLOTS.map(([id, label]) => ({ id, label })) } } },
    { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: prims("polygon") } } },
    { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: prims("polyhedron") } } },
  ],
  edges,
};

const out = path.resolve("tools/scribbleplan/water-heater.json");
fs.writeFileSync(out, JSON.stringify(file, null, 1));
console.log(`${out}\n  ${props.length} params · ${OUT_SLOTS.length} outputs · ${edges.length} edges · ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
