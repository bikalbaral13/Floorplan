/** Author two SEGMENT-hosted objects the library lacks:
 *
 *    Objects/Architectural/channel-gate.json — a collapsible (scissor) gate across a wall opening
 *    Objects/Architectural/opening.json      — an unglazed opening: jambs, lintel, optional parapet
 *
 *  Run: node tools/scribbleplan/makeSegmentObjects.mjs
 *
 *  Both use the DOOR's segment-host preamble verbatim — `P` is the two ends of the host piece, `_u`
 *  runs along it, `_W` fills it under "Fill segment" — so they cut into a wall exactly the way a door
 *  does: on a pre-cut opening piece carrying the Wall object and this one. Geometry is written in the
 *  host's (u, v) frame about the piece midpoint and mapped to world by the same quad-prism block every
 *  Architectural object uses (see floor-drain.json), so a gate on a diagonal wall is still a gate.
 */
import fs from "node:fs";

const P = (id, name, type, value, extra = {}) => ({ id, name, type, value, options: [], ...extra });
const RANGE = (id, name, value, min, max, step) => P(id, name, "range", value, { min, max, step });
const SELECT = (id, name, value, options) => ({ id, name, type: "select", value, options });
const TAIL = (semantics) => [
  P("semantics", "Semantics", "text", semantics, { min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true }),
];

/** The door's host frame: host piece → `_u` along it, `_W` = its length under Fill, `_m` its midpoint,
 *  `_jL`/`_jR` its ends. Then the (u, v) frame about the midpoint for the quad block. */
const SEG_FRAME = `_e1 = hcat(1, 0)
_n = rows(P)
_isSeg = _n == 2
_isSpace = _n > 2
_edges = _isSpace ? (shift(P, -1) - P) : _e1
_eLen = len(_edges)
_longest = max(_eLen)
_mask = eq(_eLen, _longest)
_sDir = _isSpace ? row(compress(_edges, _mask), 0) : _e1
_sA = _isSpace ? row(compress(P, _mask), 0) : row(P, 0)
_segV = _isSeg ? (row(P, 1) - row(P, 0)) : _sDir
_dir = _isSeg ? _segV : (_isSpace ? _sDir : _e1)
_dLen = min(len(_dir))
_u = _dLen > 1e-9 ? normalize(_dir) : _e1
_ux = sub(_u, 0, 0, 1, 1)
_uy = sub(_u, 0, 1, 1, 1)
_vx = 0 - _uy
_vy = _ux
_hosted = (_isSeg || _isSpace) && _dLen > 1e-9
_fill = fitMode == 'Fill segment'
_W = _hosted ? (_fill ? _dLen : min(max(0.3, width), _dLen)) : max(0.3, width)
_pA = _isSpace ? _sA : row(P, 0)
_pax = sub(_pA, 0, 0, 1, 1)
_pay = sub(_pA, 0, 1, 1, 1)
_mx = _hosted ? _pax + _ux * _dLen / 2 : _pax
_my = _hosted ? _pay + _uy * _dLen / 2 : _pay
_hw = _W / 2
_cu = _mx * _ux + _my * _uy
_cv = _mx * _vx + _my * _vy`;

/** Q rows are [u1,v1, u2,v2, u3,v3, u4,v4, z0, z1, group] about the midpoint; this sweeps each into a
 *  6-face prism and maps (u, v) → world. Outputs: _WD [n,5] = x,y,z,faceId,group ; _WP [n,4] = x,y,ringId,group. */
const QUAD_BLOCK = `_nq = rows(Q)
_r4 = ones(4,1)
_a1 = col(Q,0)
_b1 = col(Q,1)
_a2 = col(Q,2)
_b2 = col(Q,3)
_a3 = col(Q,4)
_b3 = col(Q,5)
_a4 = col(Q,6)
_b4 = col(Q,7)
_qz0 = col(Q,8)
_qz1 = col(Q,9)
_gq = kron(col(Q,10), _r4)
_fq = kron(arange(_nq), _r4) * 6
_q0 = hcat(reshape(hcat(_a1,_b1,_qz0,_a2,_b2,_qz0,_a3,_b3,_qz0,_a4,_b4,_qz0), 4*_nq, 3), _fq + 0, _gq)
_q1 = hcat(reshape(hcat(_a1,_b1,_qz1,_a2,_b2,_qz1,_a3,_b3,_qz1,_a4,_b4,_qz1), 4*_nq, 3), _fq + 1, _gq)
_q2 = hcat(reshape(hcat(_a1,_b1,_qz0,_a2,_b2,_qz0,_a2,_b2,_qz1,_a1,_b1,_qz1), 4*_nq, 3), _fq + 2, _gq)
_q3 = hcat(reshape(hcat(_a2,_b2,_qz0,_a3,_b3,_qz0,_a3,_b3,_qz1,_a2,_b2,_qz1), 4*_nq, 3), _fq + 3, _gq)
_q4 = hcat(reshape(hcat(_a3,_b3,_qz0,_a4,_b4,_qz0,_a4,_b4,_qz1,_a3,_b3,_qz1), 4*_nq, 3), _fq + 4, _gq)
_q5 = hcat(reshape(hcat(_a4,_b4,_qz0,_a1,_b1,_qz0,_a1,_b1,_qz1,_a4,_b4,_qz1), 4*_nq, 3), _fq + 5, _gq)
_FL = vcat(_q0,_q1,_q2,_q3,_q4,_q5)
_PL = hcat(reshape(hcat(_a1,_b1,_a2,_b2,_a3,_b3,_a4,_b4), 4*_nq, 2), kron(arange(_nq), _r4), _gq)
_U = _cu + col(_FL,0)
_V = _cv + col(_FL,1)
_WD = hcat(_U * _ux + _V * _vx, _U * _uy + _V * _vy, col(_FL,2), col(_FL,3), col(_FL,4))
_nw = rows(_WD)
_PU = _cu + col(_PL,0)
_PV = _cv + col(_PL,1)
_WP = hcat(_PU * _ux + _PV * _vx, _PU * _uy + _PV * _vy, col(_PL,2), col(_PL,3))
_nwp = rows(_WP)`;
const solid = (g) => `sub(compress(_WD, eq(col(_WD,4), ${g})), 0, 0, _nw, 4)`;
const plan = (g) => `sub(compress(_WP, eq(col(_WP,3), ${g})), 0, 0, _nwp, 3)`;
/** A rectangle Q row about the midpoint: u0..u1 × v0..v1, z0..z1, group. */
const rect = (u0, v0, u1, v1, z0, z1, g) => `hcat(${u0}, ${v0}, ${u1}, ${v0}, ${u1}, ${v1}, ${u0}, ${v1}, ${z0}, ${z1}, ${g})`;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CHANNEL GATE
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const gateProps = [
  P("P", "Host — segment [[x, y], [x, y]]", "text", "[[0, 0], [1, 0]]"),
  RANGE("width", "Width (own)", 0.9, 0.3, 4, 0.05),
  SELECT("fitMode", "Fit", "Fill segment", ["Fill segment", "Own width (centred)"]),
  RANGE("height", "Height", 2.1, 1, 3, 0.05),
  RANGE("panels", "Scissor panels", 8, 2, 30, 1),
  RANGE("open", "Open fraction", 0.25, 0, 0.95, 0.05),
  RANGE("stackDepth", "Lattice depth", 0.12, 0.04, 0.3, 0.01),
  RANGE("barSize", "Bar size", 0.02, 0.01, 0.05, 0.002),
  RANGE("postSize", "Post size", 0.05, 0.03, 0.12, 0.005),
  RANGE("trackDepth", "Track depth", 0.05, 0.02, 0.12, 0.005),
  SELECT("stackSide", "Stacks at", "Left", ["Left", "Right"]),
  ...TAIL("mild steel collapsible channel gate, powder-coated, floor track, scissor lattice"),
];
const gateExpr = `${SEG_FRAME}
# The closed run of lattice and the folded stack. Bars stand where the lattice is; the stack is a
# short dense run of the same bars at whichever jamb the gate folds to.
_sl = _W * open
_cl = _W - _sl
_left = stackSide == 'Left' ? 1 : 0
_u0c = _left > 0 ? (0 - _hw + _sl) : (0 - _hw)
_u1c = _left > 0 ? _hw : (_hw - _sl)
_nb = max(2, round(panels) * 2)
_a = stackDepth / 2
_bs = barSize / 2
_ps = postSize / 2
_tdh = trackDepth
_rail = 0.05
# Track along the floor, top rail, two posts, the bars.
_TRK = ${rect("0 - _hw", "0 - _tdh / 2", "_hw", "_tdh / 2", "0", "0.03", 1)}
_RAIL = ${rect("0 - _hw", "0 - _bs", "_hw", "_bs", "height - _rail", "height", 2)}
_PL1 = ${rect("0 - _hw", "0 - _ps", "0 - _hw + postSize", "_ps", "0", "height", 3)}
_PL2 = ${rect("_hw - postSize", "0 - _ps", "_hw", "_ps", "0", "height", 3)}
_BARS = zeros(0, 11)
loop i in _nb:
  _bu = _u0c + i * (_u1c - _u0c) / (_nb - 1)
  _bv = _a * cos(i * PI)
  _BARS = vcat(_BARS, ${rect("_bu - _bs", "_bv - _bs", "_bu + _bs", "_bv + _bs", "0.03", "height - _rail", 4)})
end
Q = vcat(vcat(_TRK, _RAIL), vcat(vcat(_PL1, _PL2), _BARS))
${QUAD_BLOCK}
Track3D = ${solid(1)}
Rail3D = ${solid(2)}
Posts3D = ${solid(3)}
Bars3D = ${solid(4)}
TrackPlan = ${plan(1)}
PostsPlan = ${plan(3)}
# Plan symbol: the lattice as a zigzag between the bars, where the gate is closed.
_zk = arange(_nb)
_zu = _cu + _u0c + _zk * (_u1c - _u0c) / (_nb - 1)
_zv = _cv + _a * cos(_zk * PI)
LatticePlan = hcat(_zu * _ux + _zv * _vx, _zu * _uy + _zv * _vy)
# Metrics
openingWidth = _W
clearOpening = _sl
closedRun = _cl
barCount = _nb
gateHeight = height
gateWeight = 14 * _W * height
stackLength = _sl`;
const gateOut = [
  ["s1", "Track — solid", "Track3D", "p3_track", "polyhedron", "#475569"],
  ["s2", "Top rail — solid", "Rail3D", "p3_rail", "polyhedron", "#475569"],
  ["s3", "Posts — solid", "Posts3D", "p3_posts", "polyhedron", "#334155"],
  ["s4", "Lattice bars — solid", "Bars3D", "p3_bars", "polyhedron", "#64748b"],
  ["s5", "Track — plan", "TrackPlan", "p2_track", "polygon", "#94a3b8"],
  ["s6", "Posts — plan", "PostsPlan", "p2_posts", "polygon", "#334155"],
  ["s7", "Lattice — plan", "LatticePlan", "p2_lattice", "stroke", "#334155"],
  ["s8", "Opening width (m)", "openingWidth"],
  ["s9", "Clear opening (m)", "clearOpening"],
  ["s10", "Closed run (m)", "closedRun"],
  ["s11", "Bars", "barCount"],
  ["s12", "Height (m)", "gateHeight"],
  ["s13", "Weight (kg)", "gateWeight"],
  ["s14", "Stack length (m)", "stackLength"],
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// OPENING
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const openingProps = [
  P("P", "Host — segment [[x, y], [x, y]]", "text", "[[0, 0], [1, 0]]"),
  RANGE("width", "Width (own)", 1.2, 0.3, 6, 0.05),
  SELECT("fitMode", "Fit", "Fill segment", ["Fill segment", "Own width (centred)"]),
  RANGE("wallDepth", "Wall depth", 0.23, 0.05, 0.6, 0.01),
  RANGE("lintelHeight", "Lintel height (soffit)", 2.1, 1.2, 3.5, 0.05),
  RANGE("lintelDepth", "Lintel depth", 0.15, 0.08, 0.45, 0.01),
  RANGE("sillHeight", "Sill / parapet height (0 = to floor)", 0, 0, 1.5, 0.05),
  RANGE("jambWidth", "Jamb mark width", 0.05, 0.02, 0.2, 0.005),
  ...TAIL("open verandah bay, plastered reveals, RCC lintel over, no frame"),
];
const openingExpr = `${SEG_FRAME}
_hd = wallDepth / 2
_jw = jambWidth
_hasSill = sillHeight > 0.001 ? 1 : 0
_sillZ = _hasSill > 0 ? sillHeight : 0
# Lintel over the whole opening; a parapet up to the sill if there is one; jamb marks at each reveal.
_LIN = ${rect("0 - _hw", "0 - _hd", "_hw", "_hd", "lintelHeight", "lintelHeight + lintelDepth", 1)}
_PAR = ${rect("0 - _hw", "0 - _hd", "_hw", "_hd", "0", "_sillZ", 2)}
_J1 = ${rect("0 - _hw", "0 - _hd", "0 - _hw + _jw", "_hd", "0", "lintelHeight", 3)}
_J2 = ${rect("_hw - _jw", "0 - _hd", "_hw", "_hd", "0", "lintelHeight", 3)}
Q = _hasSill > 0 ? vcat(vcat(_LIN, _PAR), vcat(_J1, _J2)) : vcat(_LIN, vcat(_J1, _J2))
${QUAD_BLOCK}
Lintel3D = ${solid(1)}
Parapet3D = ${solid(2)}
Jambs3D = ${solid(3)}
JambsPlan = ${plan(3)}
ParapetPlan = ${plan(2)}
# Plan symbol: the lintel line across the opening (dashed by the renderer's stroke style).
_l0u = _cu - _hw
_l1u = _cu + _hw
LintelPlan = vcat(hcat(_l0u * _ux + _cv * _vx, _l0u * _uy + _cv * _vy), hcat(_l1u * _ux + _cv * _vx, _l1u * _uy + _cv * _vy))
# Metrics
clearWidth = _W
clearHeight = lintelHeight - _sillZ
openArea = _W * (lintelHeight - _sillZ)
lintelVolume = _W * wallDepth * lintelDepth
parapetVolume = _W * wallDepth * _sillZ`;
const openingOut = [
  ["s1", "Lintel — solid", "Lintel3D", "p3_lintel", "polyhedron", "#94a3b8"],
  ["s2", "Parapet — solid", "Parapet3D", "p3_parapet", "polyhedron", "#cbd5e1"],
  ["s3", "Jambs — solid", "Jambs3D", "p3_jambs", "polyhedron", "#cbd5e1"],
  ["s4", "Jambs — plan", "JambsPlan", "p2_jambs", "polygon", "#64748b"],
  ["s5", "Parapet — plan", "ParapetPlan", "p2_parapet", "polygon", "#cbd5e1"],
  ["s6", "Lintel — plan", "LintelPlan", "p2_lintel", "stroke", "#94a3b8"],
  ["s7", "Clear width (m)", "clearWidth"],
  ["s8", "Clear height (m)", "clearHeight"],
  ["s9", "Open area (m²)", "openArea"],
  ["s10", "Lintel volume (m³)", "lintelVolume"],
  ["s11", "Parapet volume (m³)", "parapetVolume"],
];

// ═══════════════════════════════════════════════════════════════════════════════════════════════
function assemble({ id, title, name, icon, description, props, expr, out, layer }) {
  const edges = []; let n = 0;
  const edge = (s, sh, t, th) => edges.push({ id: `e${++n}_${s}_${sh}__${t}_${th}`, source: s, sourceHandle: sh, target: t, targetHandle: th });
  edge("geo", "val-points", "props", "valin-P");
  for (const p of props) if (p.id !== "P") edge("props", `val-${p.id}`, "math", `valin-${p.id}`);
  edge("props", "val-P", "math", "valin-P");
  const prims2 = [], prims3 = [];
  for (const [slot, label, value, prim, kind, color] of out) {
    edge("math", `val-${value}`, "out", `valin-${slot}`);
    if (!prim) continue;
    const target = kind === "polyhedron" ? "r3d" : "r2d";
    edge("out", `val-${slot}`, target, `valin-${prim}`);
    (kind === "polyhedron" ? prims3 : prims2).push({ id: prim, kind, name: label.split(" — ")[0], color, layer, show: true, ...(kind === "polyhedron" ? { x: 0, y: 0, z: 0 } : {}) });
  }
  return {
    version: 1, id, title, category: layer,
    object: { hostKind: "segment", name, units: "m", icon: { paths: icon } },
    description,
    nodes: [
      { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
      { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
      { id: "math", position: { x: -180, y: 40 }, data: { tool: "expr", params: { name: `${name} maths`, expr } } },
      { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots: out.map(([id, label]) => ({ id, label })) } } },
      { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: prims2 } } },
      { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: prims3 } } },
    ],
    edges,
  };
}

const gate = assemble({
  id: "channel-gate-with-math", title: "Channel Gate — one Math Engine, scissor lattice on a floor track",
  name: "Channel Gate", icon: ["M3 4v16", "M21 4v16", "M3 8l4 4-4 4", "M7 8l4 4-4 4", "M11 8l4 4-4 4", "M15 8l4 4-4 4"],
  layer: "Architectural", props: gateProps, expr: gateExpr, out: gateOut,
  description: `A parametric COLLAPSIBLE CHANNEL GATE on the six-node spine, SEGMENT-hosted like a door:

  Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render

DROP IT ON AN OPENING. It fills the host piece under "Fill segment" exactly as the Door does, so it goes on a pre-cut opening piece beside the Wall object and the wall shows a real gap. Where a door needs a leaf's worth of floor to swing over, a channel gate needs NONE — it folds along its own track — which is why it is the right closure in front of a staircase that fills its bay (see place-staircase-in-plan).

WHAT IT DRAWS. A floor track the width of the opening, a post at each jamb, a top rail, and the scissor lattice as a run of bars standing on the track. \`open\` is the fraction folded back: the bars of the closed run are spread evenly and the plan symbol is the zigzag between them; the stack sits at \`stackSide\`. At the defaults a 0.9 m gate is 2.1 m high, 16 bars, a quarter open.

WHAT IT REPORTS. Opening width, the clear opening at the current fold, the closed run, bar count, height and an estimated weight at 14 kg/m² — the number the fixing screws and the track have to carry.

WHAT IT DOES NOT DO. No lock box, no wheels, no wicket; the lattice is drawn as bars and a zigzag, not as the true pantograph.`,
});
const opening = assemble({
  id: "opening-with-math", title: "Opening — one Math Engine, jambs, lintel and optional parapet",
  name: "Opening", icon: ["M4 20V8a8 8 0 0 1 16 0v12", "M4 20h16"],
  layer: "Architectural", props: openingProps, expr: openingExpr, out: openingOut,
  description: `A parametric UNGLAZED OPENING on the six-node spine, SEGMENT-hosted like a door or window:

  Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render

WHAT IT IS FOR. A verandah's open front, an arch between two rooms, a servery — any gap in a wall that has a lintel over it and nothing in it. It fills its host piece under "Fill segment", so it goes on a pre-cut opening piece beside the Wall object and the masonry shows a real gap; the piece is no longer a dashed line pretending to be one.

WHAT IT DRAWS. A lintel across the opening at \`lintelHeight\`, \`lintelDepth\` deep; a jamb mark at each reveal; and, when \`sillHeight\` is above zero, a parapet across the opening up to that height — the half-wall a verandah has under its open front. In plan: the jamb marks, the parapet band if any, and the lintel as a single stroke across the gap.

WHAT IT REPORTS. Clear width and height, open area, and the lintel and parapet concrete volumes.

WHAT IT DOES NOT DO. No arch profile, no frame, no grille — those are the Window's and the Channel Gate's.`,
});

for (const [file, obj] of [["channel-gate", gate], ["opening", opening]]) {
  const out = `tools/scribbleplan/${file}.json`;
  fs.writeFileSync(out, JSON.stringify(obj, null, 1));
  console.log(`${out}  ${obj.nodes[1].data.params.props.length} params · ${obj.edges.length} edges · ${(fs.statSync(out).size / 1024).toFixed(1)} KB`);
}
