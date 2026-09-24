/** Regenerate `Objects/Structural/staircase.json` with a realistic 3D: waist slabs, landing slabs of
 *  real thickness on beams, handrails and balusters — on the same six-node spine, same host, same
 *  three configurations, same plan footprint, so every plan that already places it keeps placing it.
 *
 *  Run: node tools/scribbleplan/makeStaircase.mjs <existing staircase.json> [--out file]
 *
 *  WHAT WAS WRONG WITH THE OLD 3D. Every step was a box from the FLOOR up to its tread, and every
 *  landing a block from the floor to its top — a solid staircase-shaped mass, no soffit, no slab, no
 *  rail. A cast stair is a sloped WAIST SLAB with the steps on top of it, spanning between a floor
 *  beam and a landing beam; the landing is a slab on a beam; and nobody builds one without a rail.
 *
 *  HOW THE FLIGHT IS BUILT NOW. One polyhedron per flight, from its side PROFILE: the sawtooth of
 *  risers and treads up the top, a vertical drop at the landing end, and the soffit line back down —
 *  the pitch line through the inner corners offset by the waist thickness measured perpendicular to
 *  the slope (wv = waist·√(T²+R²)/T). The profile is extruded across the flight width: two side
 *  faces and one quad per profile edge. Every flight is the same block of maths with six numbers
 *  changed — origin, direction along, direction across, step count, base height, rail sides — so the
 *  generator writes the block once and stamps it three times. Open-riser stairs keep the old
 *  tread-only boxes, because an open stair has no waist.
 */
import fs from "node:fs";

const src = process.argv[2];
if (!src) { console.error("usage: makeStaircase.mjs <existing staircase.json> [--out file]"); process.exit(1); }
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : "tools/scribbleplan/staircase.json";
const base = JSON.parse(fs.readFileSync(src, "utf8"));
const node = (id) => base.nodes.find((n) => n.id === id);

// ── Parameters: the existing ones, then the structure and the rail ──────────────────────────────
const P = (id, name, type, value, extra = {}) => ({ id, name, type, value, options: [], ...extra });
const RANGE = (id, name, value, min, max, step) => P(id, name, "range", value, { min, max, step });
const SELECT = (id, name, value, options) => ({ id, name, type: "select", value, options });
const old = node("props").data.params.props;
const before = old.filter((p) => p.id !== "rotation");
const props = [
  ...before,
  RANGE("waist", "Waist slab thickness", 0.15, 0.08, 0.35, 0.005),
  RANGE("landingThickness", "Landing slab thickness", 0.15, 0.08, 0.35, 0.005),
  P("showBeams", "Beams under landings", "checkbox", true),
  RANGE("beamWidth", "Beam width", 0.23, 0.1, 0.6, 0.01),
  RANGE("beamDepth", "Beam depth", 0.35, 0.15, 0.9, 0.01),
  SELECT("railSide", "Handrail on", "Inner", ["Inner", "Left", "Right", "Both", "None"]),
  RANGE("railHeight", "Handrail height above nosing", 0.9, 0.6, 1.2, 0.01),
  RANGE("railSize", "Handrail section", 0.05, 0.02, 0.12, 0.005),
  RANGE("balusterSpacing", "Baluster spacing", 0.125, 0.06, 0.3, 0.005),
  RANGE("balusterSize", "Baluster section", 0.02, 0.01, 0.06, 0.002),
  RANGE("railInset", "Rail inset from flight edge", 0.04, 0, 0.15, 0.005),
  old.find((p) => p.id === "rotation"),
];

// ── The flight block, stamped per flight ────────────────────────────────────────────────────────
/** DSL for one flight. `n` steps from origin (ox, oy) going `d` = (dx, dy) along and `a` = (ax, ay)
 *  across (unit, pre-rotation), base height `z0`, `L`/`R` = 1 when that side carries a rail. Every
 *  local name is suffixed with the tag so three copies coexist; results are appended to the shared
 *  accumulators Flights3D / Rail3D / Bal3D / RailPlan and the metric sums. */
const flight = (t, { n, ox, oy, dx, dy, ax, ay, z0, railL, railR, fid }) => `
# ── flight ${t}: ${n} steps from (${ox}, ${oy}) along (${dx}, ${dy}), across (${ax}, ${ay}), base ${z0}
_n${t} = ${n}
_ox${t} = ${ox}
_oy${t} = ${oy}
_dx${t} = ${dx}
_dy${t} = ${dy}
_ax${t} = ${ax}
_ay${t} = ${ay}
_z0${t} = ${z0}
_rl${t} = ${railL}
_rr${t} = ${railR}
_PF${t} = hcat(0, 0)
loop i in _n${t}:
  _PF${t} = vcat(_PF${t}, vcat(hcat(i * _T, (i + 1) * _R), hcat((i + 1) * _T, (i + 1) * _R)))
end
_PF${t} = vcat(_PF${t}, vcat(hcat(_n${t} * _T, _n${t} * _R - _wv), hcat(_wv * _T / _R, 0)))
_m${t} = rows(_PF${t})
_ps${t} = col(_PF${t}, 0)
_pz${t} = col(_PF${t}, 1) + _z0${t}
_p0x${t} = _ox${t} + _dx${t} * _ps${t}
_p0y${t} = _oy${t} + _dy${t} * _ps${t}
_p1x${t} = _p0x${t} + _ax${t} * _W
_p1y${t} = _p0y${t} + _ay${t} * _W
_S0${t} = hcat(_cx + _p0x${t} * _ca - _p0y${t} * _sa, _cy + _p0x${t} * _sa + _p0y${t} * _ca, _pz${t}, fill(_m${t}, 1, ${fid}))
_S1${t} = hcat(_cx + _p1x${t} * _ca - _p1y${t} * _sa, _cy + _p1x${t} * _sa + _p1y${t} * _ca, _pz${t}, fill(_m${t}, 1, ${fid} + 1))
_Q${t} = zeros(0, 4)
loop k in (_m${t} - 1):
  _sa0 = sub(_ps${t}, k, 0, 1, 1)
  _sa1 = sub(_ps${t}, k + 1, 0, 1, 1)
  _za0 = sub(_pz${t}, k, 0, 1, 1)
  _za1 = sub(_pz${t}, k + 1, 0, 1, 1)
  _qa = hcat(_ox${t} + _dx${t} * _sa0, _oy${t} + _dy${t} * _sa0)
  _qb = hcat(_ox${t} + _dx${t} * _sa1, _oy${t} + _dy${t} * _sa1)
  _qc = _qb + hcat(_ax${t} * _W, _ay${t} * _W)
  _qd = _qa + hcat(_ax${t} * _W, _ay${t} * _W)
  _q4 = vcat(vcat(_qa, _qb), vcat(_qc, _qd))
  _qz = vcat(vcat(hcat(_za0), hcat(_za1)), vcat(hcat(_za1), hcat(_za0)))
  _qw = hcat(_cx + col(_q4, 0) * _ca - col(_q4, 1) * _sa, _cy + col(_q4, 0) * _sa + col(_q4, 1) * _ca, _qz, fill(4, 1, ${fid} + 2 + k))
  _Q${t} = vcat(_Q${t}, _qw)
end
Flights3D = (_open > 0 || _n${t} == 0) ? Flights3D : vcat(Flights3D, vcat(vcat(_S0${t}, _S1${t}), _Q${t}))
# balusters: _bpt per tread, at the rail inset on each railed side, from tread top to rail height
loop b in (_n${t} * _bpt):
  _bi = floor(b / _bpt)
  _bs = _bi * _T + (b - _bi * _bpt + 0.5) * _T / _bpt
  _bz0 = _z0${t} + (_bi + 1) * _R
  _bz1 = _bz0 + _RH
  _bl = hcat(_ox${t} + _dx${t} * _bs + _ax${t} * _ri, _oy${t} + _dy${t} * _bs + _ay${t} * _ri)
  _br = hcat(_ox${t} + _dx${t} * _bs + _ax${t} * (_W - _ri), _oy${t} + _dy${t} * _bs + _ay${t} * (_W - _ri))
  _blr = hcat(_cx + (col(_bl, 0) + _BSQ0) * _ca - (col(_bl, 1) + _BSQ1) * _sa, _cy + (col(_bl, 0) + _BSQ0) * _sa + (col(_bl, 1) + _BSQ1) * _ca)
  _brr = hcat(_cx + (col(_br, 0) + _BSQ0) * _ca - (col(_br, 1) + _BSQ1) * _sa, _cy + (col(_br, 0) + _BSQ0) * _sa + (col(_br, 1) + _BSQ1) * _ca)
  Bal3D = _rl${t} > 0 ? vcat(Bal3D, mprism(_blr, _bz0, _bz1)) : Bal3D
  Bal3D = _rr${t} > 0 ? vcat(Bal3D, mprism(_brr, _bz0, _bz1)) : Bal3D
end
balusterCount = balusterCount + _n${t} * _bpt * (_rl${t} + _rr${t})
# handrail: a sloped bar from above the first nosing to above the last, on each railed side
_h0z${t} = _z0${t} + _R + _RH
_h1z${t} = _z0${t} + _n${t} * _R + _RH
loop s in 2:
  _wside = s == 0 ? _ri : (_W - _ri)
  _on = _n${t} > 0 ? (s == 0 ? _rl${t} : _rr${t}) : 0
  _c0 = hcat(_ox${t} + _ax${t} * _wside, _oy${t} + _ay${t} * _wside)
  _c1 = hcat(_ox${t} + _dx${t} * _n${t} * _T + _ax${t} * _wside, _oy${t} + _dy${t} * _n${t} * _T + _ay${t} * _wside)
  _cw = hcat(_ax${t} * _rs, _ay${t} * _rs)
  _r8 = vcat(vcat(vcat(_c0 - _cw, _c0 + _cw), vcat(_c1 + _cw, _c1 - _cw)), vcat(vcat(_c0 - _cw, _c0 + _cw), vcat(_c1 + _cw, _c1 - _cw)))
  _r8z = vcat(vcat(hcat(_h0z${t} - _rs), hcat(_h0z${t} - _rs)), vcat(vcat(hcat(_h1z${t} - _rs), hcat(_h1z${t} - _rs)), vcat(vcat(hcat(_h0z${t} + _rs), hcat(_h0z${t} + _rs)), vcat(hcat(_h1z${t} + _rs), hcat(_h1z${t} + _rs)))))
  _r8w = hcat(_cx + col(_r8, 0) * _ca - col(_r8, 1) * _sa, _cy + col(_r8, 0) * _sa + col(_r8, 1) * _ca, _r8z)
  _fb = ${fid} + 500 + s * 6
  _F0 = hcat(vcat(vcat(row(_r8w, 0), row(_r8w, 1)), vcat(row(_r8w, 2), row(_r8w, 3))), fill(4, 1, _fb))
  _F1 = hcat(vcat(vcat(row(_r8w, 4), row(_r8w, 5)), vcat(row(_r8w, 6), row(_r8w, 7))), fill(4, 1, _fb + 1))
  _F2 = hcat(vcat(vcat(row(_r8w, 0), row(_r8w, 1)), vcat(row(_r8w, 5), row(_r8w, 4))), fill(4, 1, _fb + 2))
  _F3 = hcat(vcat(vcat(row(_r8w, 1), row(_r8w, 2)), vcat(row(_r8w, 6), row(_r8w, 5))), fill(4, 1, _fb + 3))
  _F4 = hcat(vcat(vcat(row(_r8w, 2), row(_r8w, 3)), vcat(row(_r8w, 7), row(_r8w, 6))), fill(4, 1, _fb + 4))
  _F5 = hcat(vcat(vcat(row(_r8w, 3), row(_r8w, 0)), vcat(row(_r8w, 4), row(_r8w, 7))), fill(4, 1, _fb + 5))
  Rail3D = _on > 0 ? vcat(Rail3D, vcat(vcat(vcat(_F0, _F1), vcat(_F2, _F3)), vcat(_F4, _F5))) : Rail3D
  RailPlan = _on > 0 ? vcat(RailPlan, hcat(_cx + col(_c0, 0) * _ca - col(_c0, 1) * _sa, _cy + col(_c0, 0) * _sa + col(_c0, 1) * _ca, _cx + col(_c1, 0) * _ca - col(_c1, 1) * _sa, _cy + col(_c1, 0) * _sa + col(_c1, 1) * _ca)) : RailPlan
  handrailLength = handrailLength + _on * _n${t} * _T * sqrt(1 + (_R / _T) * (_R / _T))
end
_fa${t} = _n${t} > 0 ? (_n${t} * _T * _R / 2 + _n${t} * _T * _wv - _wv * _wv * _T / (2 * _R)) : 0
flightConcrete = flightConcrete + (_open > 0 ? 0 : _fa${t} * _W)
formworkArea = formworkArea + (_open > 0 ? 0 : (2 * _fa${t} + _W * _n${t} * _T * sqrt(1 + (_R / _T) * (_R / _T)) + _W * _n${t} * _R))
`;

// ── The whole expression ────────────────────────────────────────────────────────────────────────
const oldExpr = node("math").data.params.expr;
// Keep everything of the old maths up to and including the plan/step loops — its plan output is
// unchanged — but make the landings SLABS on beams instead of blocks to the floor.
const cut = oldExpr.indexOf("_nl = _isUM ? 2");
const head = oldExpr.slice(0, cut);
const tailStart = oldExpr.indexOf("_gx0 = _dir * 0.5 * _T");
const tail = oldExpr.slice(tailStart, oldExpr.indexOf("concreteVolume ="));

const expr = `${head}_LT = max(0.05, landingThickness)
_wv = max(0.05, waist) * sqrt(_T * _T + _R * _R) / _T
_RH = max(0.3, railHeight)
_rs = max(0.005, railSize) / 2
_ri = max(0, railInset)
_bpt = max(1, round(_T / max(0.03, balusterSpacing)))
_bh = max(0.005, balusterSize) / 2
_BSQ0 = vcat(vcat(hcat(0 - _bh), hcat(_bh)), vcat(hcat(_bh), hcat(0 - _bh)))
_BSQ1 = vcat(vcat(hcat(0 - _bh), hcat(0 - _bh)), vcat(hcat(_bh), hcat(_bh)))
_both = railSide == 'Both'
_none = railSide == 'None'
_left = railSide == 'Left' || (railSide == 'Inner' && !(_isU || _isUM))
_right = railSide == 'Right'
_inner = railSide == 'Inner' && (_isU || _isUM)
_rlA = (_both || _left) ? 1 : 0
_rrA = (_both || _right || _inner) ? 1 : 0
_rlB = (_both || _left || _inner) ? 1 : 0
_rrB = (_both || _right) ? 1 : 0
Flights3D = zeros(0, 4)
Rail3D = zeros(0, 4)
Bal3D = zeros(0, 4)
RailPlan = zeros(0, 4)
balusterCount = 0
handrailLength = 0
flightConcrete = 0
formworkArea = 0
${flight("A", { n: "_f1", ox: "0", oy: "0", dx: "_dir", dy: "0", ax: "0", ay: "1", z0: "0", railL: "_rlA", railR: "_rrA", fid: 0 })}
${flight("B", { n: "(_isUM ? _mid : (_isU ? _n2 : 0))", ox: "_xt", oy: "(_isUM ? _W : (_W + _G))", dx: "(_isUM ? 0 : (0 - _dir))", dy: "(_isUM ? 1 : 0)", ax: "(_isUM ? _dir : 0)", ay: "(_isUM ? 0 : 1)", z0: "(_isUM ? _pa * _R : _n1 * _R)", railL: "(_isUM ? _rrA : _rlB)", railR: "(_isUM ? _rlA : _rrB)", fid: 1000 })}
${flight("C", { n: "(_isUM ? _pb : 0)", ox: "_xt", oy: "_y2", dx: "(0 - _dir)", dy: "0", ax: "0", ay: "1", z0: "((_pa + _mid) * _R)", railL: "_rlB", railR: "_rrB", fid: 2000 })}
# ── landings: SLABS of _LT, with a beam under the outer edge when asked ──────────────────────────
_nl = _isUM ? 2 : (_isU ? 1 : (_L > 0 ? 1 : 0))
Beams3D = zeros(0, 4)
landingConcrete = 0
beamConcrete = 0
_bw = max(0.05, beamWidth)
_bd = max(0.05, beamDepth)
loop m in _nl:
  _lx0 = _isUM ? _xt : (_isU ? _xt : _dir * _N * _T)
  _lx1 = _isUM ? _xr : (_isU ? _xl : _dir * (_N * _T + _L))
  _ly0 = _isUM ? (m > 0 ? _y2 : 0) : 0
  _ly1 = _isUM ? (m > 0 ? _y3 : _W) : (_isU ? (2 * _W + _G) : _W)
  _lh1 = _isUM ? (m > 0 ? (_pa + _mid) * _R : _pa * _R) : (_isU ? _n1 * _R : _N * _R)
  _lh0 = _open > 0 ? max(0, _lh1 - _TT) : max(0, _lh1 - _LT)
  _px = _lx0 + _ux * (_lx1 - _lx0)
  _py = _ly0 + _uy * (_ly1 - _ly0)
  _ring = hcat(_cx + _px * _ca - _py * _sa, _cy + _px * _sa + _py * _ca)
  Landings = vcat(Landings, hcat(_ring, fill(4, 1, m)))
  LandMesh = vcat(LandMesh, mprism(_ring, _lh0, _lh1))
  landingConcrete = landingConcrete + abs(_lx1 - _lx0) * abs(_ly1 - _ly0) * (_lh1 - _lh0)
  _bx1 = _lx1
  _bx0 = _lx1 - _dir * (_lx1 > _lx0 ? 1 : -1) * _dir * _bw
  _bxa = min(_bx0, _bx1)
  _bxb = max(_bx0, _bx1)
  _bpx = _bxa + _ux * (_bxb - _bxa)
  _bpy = _ly0 + _uy * (_ly1 - _ly0)
  _bring = hcat(_cx + _bpx * _ca - _bpy * _sa, _cy + _bpx * _sa + _bpy * _ca)
  Beams3D = (showBeams > 0 && _open == 0) ? vcat(Beams3D, mprism(_bring, _lh0 - _bd, _lh0)) : Beams3D
  beamConcrete = beamConcrete + ((showBeams > 0 && _open == 0) ? _bw * _bd * abs(_ly1 - _ly0) : 0)
end
${tail}StepMesh = _open > 0 ? StepMesh : zeros(0, 4)
concreteVolume = flightConcrete + landingConcrete + beamConcrete + (_open > 0 ? _N * _T * _W * _TT : 0)
concreteWeight = 25 * concreteVolume
flightCount = _isUM ? 3 : (_isU ? 2 : 1)
waistThickness = max(0.05, waist)
`;

// ── Outputs and prims ───────────────────────────────────────────────────────────────────────────
const oldSlots = node("out").data.params.slots;              // s1..s16
const slots = [
  ...oldSlots.map((s) => (s.id === "s4" ? { ...s, label: "Treads (open) — solids" } : s)),
  { id: "s17", label: "Flights with waist — solids" },
  { id: "s18", label: "Beams — solids" },
  { id: "s19", label: "Handrails — solids" },
  { id: "s20", label: "Balusters — solids" },
  { id: "s21", label: "Handrails — plan" },
  { id: "s22", label: "Formwork area (m²)" },
  { id: "s23", label: "Handrail length (m)" },
  { id: "s24", label: "Balusters" },
  { id: "s25", label: "Concrete weight (kN)" },
  { id: "s26", label: "Flights" },
  { id: "s27", label: "Waist (m)" },
];
/** slot → math value */
const VALUE = {
  s1: "Steps", s2: "Landings", s3: "ArrowPlan", s4: "StepMesh", s5: "LandMesh", s6: "stepCount", s7: "riserHeight", s8: "treadDepth",
  s9: "totalRise", s10: "goingLength", s11: "flightWidth", s12: "pitchDeg", s13: "rule2RT", s14: "headroomOk", s15: "stairArea", s16: "concreteVolume",
  s17: "Flights3D", s18: "Beams3D", s19: "Rail3D", s20: "Bal3D", s21: "RailPlan", s22: "formworkArea", s23: "handrailLength", s24: "balusterCount",
  s25: "concreteWeight", s26: "flightCount", s27: "waistThickness",
};
const r2d = [...node("r2d").data.params.prims, { id: "p2_rail", kind: "stroke", name: "Handrails", color: "#78350f", layer: "Structural", show: true }];
const r3d = [
  ...node("r3d").data.params.prims.map((p) => (p.id === "p3_steps" ? { ...p, name: "Treads (open)" } : p)),
  { id: "p3_flights", kind: "polyhedron", name: "Flights", color: "#9ca3af", layer: "Structural", x: 0, y: 0, z: 0, show: true },
  { id: "p3_beams", kind: "polyhedron", name: "Beams", color: "#6b7280", layer: "Structural", x: 0, y: 0, z: 0, show: true },
  { id: "p3_rail", kind: "polyhedron", name: "Handrails", color: "#78350f", layer: "Structural", x: 0, y: 0, z: 0, show: true },
  { id: "p3_bal", kind: "polyhedron", name: "Balusters", color: "#1f2937", layer: "Structural", x: 0, y: 0, z: 0, show: true },
];
const PRIM = { s1: "p2_steps", s2: "p2_land", s3: "p2_arrow", s4: "p3_steps", s5: "p3_land", s17: "p3_flights", s18: "p3_beams", s19: "p3_rail", s20: "p3_bal", s21: "p2_rail" };

const edges = []; let n = 0;
const edge = (s, sh, t, th) => edges.push({ id: `e${++n}_${s}_${sh}__${t}_${th}`, source: s, sourceHandle: sh, target: t, targetHandle: th });
const geoEdge = base.edges.find((e) => e.target === "props");
edge(geoEdge.source, geoEdge.sourceHandle, "props", "valin-P");
for (const p of props) if (p.id !== "P") edge("props", `val-${p.id}`, "math", `valin-${p.id}`);
edge("props", "val-P", "math", "valin-P");
for (const s of slots) {
  edge("math", `val-${VALUE[s.id]}`, "out", `valin-${s.id}`);
  const prim = PRIM[s.id];
  if (prim) edge("out", `val-${s.id}`, prim.startsWith("p2") ? "r2d" : "r3d", `valin-${prim}`);
}

node("props").data.params.props = props;
node("math").data.params.expr = expr;
node("out").data.params.slots = slots;
node("r2d").data.params.prims = r2d;
node("r3d").data.params.prims = r3d;
base.edges = edges;
base.title = "Staircase — one Math Engine, waist slabs on beams, handrails and balusters";
base.description = `A parametric STAIRCASE on the six-node spine:

  Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render

DROP IT ON A NODE. Three configurations — Straight, U-shape (dog-leg with a landing at the far end), U-shape (mid landing) — set out from the host point along \`direction\`: first tread at the anchor, landing at the far end. The plan footprint is unchanged from the earlier version, so every plan that already places this object keeps placing it exactly.

THE 3D IS A CAST STAIR, NOT A STAIRCASE-SHAPED BLOCK. Each flight is a WAIST SLAB with the steps on it: one polyhedron from the flight's side profile — the sawtooth of risers and treads, a drop at the landing end, and the soffit back down along the pitch line offset by the waist thickness measured perpendicular to the slope — extruded across the flight width. Each landing is a slab of its own thickness on a BEAM along its outer edge, not a block down to the floor. A HANDRAIL runs above the nosing line on the side you choose (Inner = the well side of a dog-leg, the left of a straight flight) with square BALUSTERS on every tread at the spacing you set. Open-riser stairs keep tread-only boxes, because an open stair has no waist.

WHAT IT REPORTS. Riser, tread, total rise, going, pitch, the 2R + T comfort rule; concrete volume as flights + landings + beams; formwork area (soffits, risers, and both sides of every flight — what the shuttering is priced on); concrete weight at 25 kN/m³; handrail length along the slope; baluster count; flight count and waist. At the defaults (14 risers, 280 tread, 1.0 m wide, 150 waist): 1.7 m³ of concrete, 42 kN.

WHAT IT DOES NOT DO. The soffit is one plane per flight; there is no kite winder, no nosing overhang, no top or bottom newel post, and the mid-landing configuration has rails on its flights but not across its landings. It does not cut the slab it lands on.`;

fs.writeFileSync(OUT, JSON.stringify(base, null, 1));
console.log(`${OUT}  ${props.length} params · ${slots.length} outputs · ${edges.length} edges · ${expr.split("\n").length} expr lines · ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
