/** Regenerate `Objects/Structural/column.json` with its reinforcement: main bars on the perimeter
 *  inside the cover, closed stirrups at a set pitch — the outer tie round all the bars and, when
 *  there are eight, the inner diamond tie through the mid-side bars — and the concrete drawn at low
 *  opacity so the cage reads through it. Same spine, same host, same plan symbol footprint.
 *
 *  Run: node tools/scribbleplan/makeColumn.mjs <existing column.json> [--out file]
 *
 *  THE CAGE. Bar centres sit `cover + stirrupDia + barDia/2` in from each face. For a rectangular
 *  section the bars are spaced equally along the perimeter of that inner rectangle starting at a
 *  corner — so four bars are the corners, eight are corners plus mid-sides, twelve add the thirds —
 *  and for a circular section they sit on the inner circle. Each stirrup level is a set of thin
 *  boxes along the tie lines (four sides; plus four diagonals for the diamond; twelve chords for a
 *  circular tie) at `stirrupSpacing` from base + cover to top − cover. The cage is one loop over
 *  (levels × boxes) with the box geometry looked up from a table, because the engine has no nested
 *  loops and no functions.
 */
import fs from "node:fs";

const src = process.argv[2];
if (!src) { console.error("usage: makeColumn.mjs <existing column.json> [--out file]"); process.exit(1); }
const outIdx = process.argv.indexOf("--out");
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : "tools/scribbleplan/column.json";
const base = JSON.parse(fs.readFileSync(src, "utf8"));
const node = (id) => base.nodes.find((n) => n.id === id);

const P = (id, name, type, value, extra = {}) => ({ id, name, type, value, options: [], ...extra });
const RANGE = (id, name, value, min, max, step) => P(id, name, "range", value, { min, max, step });
const old = node("props").data.params.props;
const props = [
  ...old.filter((p) => p.id !== "rotation"),
  P("showRebar", "Show reinforcement", "checkbox", true),
  RANGE("mainBars", "Main bars", 8, 4, 16, 2),
  RANGE("barDia", "Main bar diameter", 0.016, 0.008, 0.04, 0.002),
  RANGE("stirrupDia", "Stirrup diameter", 0.008, 0.006, 0.016, 0.001),
  RANGE("stirrupSpacing", "Stirrup spacing", 0.127, 0.05, 0.3, 0.001),
  RANGE("cover", "Clear cover", 0.04, 0.02, 0.075, 0.005),
  old.find((p) => p.id === "rotation"),
];

const oldExpr = node("math").data.params.expr;
const expr = `${oldExpr}
# ── Reinforcement ────────────────────────────────────────────────────────────────────────────────
_show = showRebar > 0 ? 1 : 0
_bn = max(4, min(16, round(mainBars)))
_bd = max(0.006, barDia)
_sd = max(0.004, stirrupDia)
_ss = max(0.05, stirrupSpacing)
_cv = max(0.015, cover)
_off = _cv + _sd + _bd / 2
_hx = max(0.01, _L / 2 - _off)
_hy = max(0.01, _B / 2 - _off)
_rb = max(0.01, _R - _off)
_per = 4 * (_hx + _hy)
# main bar centres in the section's own frame, then to world
_BC = zeros(0, 2)
loop i in _bn:
  _t = i * _per / _bn
  _u = _t < 2 * _hx ? (0 - _hx + _t) : (_t < 2 * _hx + 2 * _hy ? _hx : (_t < 4 * _hx + 2 * _hy ? (_hx - (_t - 2 * _hx - 2 * _hy)) : (0 - _hx)))
  _v = _t < 2 * _hx ? (0 - _hy) : (_t < 2 * _hx + 2 * _hy ? (0 - _hy + (_t - 2 * _hx)) : (_t < 4 * _hx + 2 * _hy ? _hy : (_hy - (_t - 4 * _hx - 2 * _hy))))
  _uc = _rb * cos(i / _bn * 2 * PI)
  _vc = _rb * sin(i / _bn * 2 * PI)
  _bu = _isC ? _uc : _u
  _bv = _isC ? _vc : _v
  _BC = vcat(_BC, hcat(_bu, _bv))
end
_ok = arange(8)
_oth = _ok / 8 * 2 * PI
_BR = hcat(_bd / 2 * cos(_oth), _bd / 2 * sin(_oth))
Bars3D = zeros(0, 4)
BarsPlan = zeros(0, 3)
loop i in _bn:
  _bu = sub(_BC, i, 0, 1, 1)
  _bv = sub(_BC, i, 1, 1, 1)
  _rx = _bu + col(_BR, 0)
  _ry = _bv + col(_BR, 1)
  _ring = hcat(_cx + _rx * _ca - _ry * _sa, _cy + _rx * _sa + _ry * _ca)
  Bars3D = _show > 0 ? vcat(Bars3D, mprism(_ring, _b + _cv, _b + _H)) : Bars3D
  BarsPlan = _show > 0 ? vcat(BarsPlan, hcat(_ring, fill(8, 1, i))) : BarsPlan
end
# tie segments as a table [px, py, qx, qy] in the section frame: 4 outer sides, the diamond when
# there are 8+ bars in a rectangle, or 12 chords for a circular tie
_TR = vcat(vcat(hcat(0 - _hx, 0 - _hy, _hx, 0 - _hy), hcat(_hx, 0 - _hy, _hx, _hy)), vcat(hcat(_hx, _hy, 0 - _hx, _hy), hcat(0 - _hx, _hy, 0 - _hx, 0 - _hy)))
_TD = vcat(vcat(hcat(0, 0 - _hy, _hx, 0), hcat(_hx, 0, 0, _hy)), vcat(hcat(0, _hy, 0 - _hx, 0), hcat(0 - _hx, 0, 0, 0 - _hy)))
_ck = arange(12)
_ct0 = _ck / 12 * 2 * PI
_ct1 = (_ck + 1) / 12 * 2 * PI
_TC = hcat(_rb * cos(_ct0), _rb * sin(_ct0), _rb * cos(_ct1), _rb * sin(_ct1))
_hasD = (_bn >= 8 && !_isC) ? 1 : 0
_TT = _isC ? _TC : (_hasD > 0 ? vcat(_TR, _TD) : _TR)
_nb = rows(_TT)
_nst = max(1, floor((_H - 2 * _cv) / _ss) + 1)
Stirrups3D = zeros(0, 4)
loop q in (_nst * _nb):
  _lvl = floor(q / _nb)
  _kk = q - _lvl * _nb
  _zc = _b + _cv + _lvl * _ss
  _px = sub(_TT, _kk, 0, 1, 1)
  _py = sub(_TT, _kk, 1, 1, 1)
  _qx = sub(_TT, _kk, 2, 1, 1)
  _qy = sub(_TT, _kk, 3, 1, 1)
  _dl = max(1e-6, sqrt((_qx - _px) * (_qx - _px) + (_qy - _py) * (_qy - _py)))
  _nx = 0 - (_qy - _py) / _dl * _sd / 2
  _ny = (_qx - _px) / _dl * _sd / 2
  _s4 = vcat(vcat(hcat(_px + _nx, _py + _ny), hcat(_qx + _nx, _qy + _ny)), vcat(hcat(_qx - _nx, _qy - _ny), hcat(_px - _nx, _py - _ny)))
  _sw = hcat(_cx + col(_s4, 0) * _ca - col(_s4, 1) * _sa, _cy + col(_s4, 0) * _sa + col(_s4, 1) * _ca)
  Stirrups3D = _show > 0 ? vcat(Stirrups3D, mprism(_sw, _zc - _sd / 2, _zc + _sd / 2)) : Stirrups3D
end
# ties in plan, as strokes
_tw = hcat(_cx + col(_TT, 0) * _ca - col(_TT, 1) * _sa, _cy + col(_TT, 0) * _sa + col(_TT, 1) * _ca, _cx + col(_TT, 2) * _ca - col(_TT, 3) * _sa, _cy + col(_TT, 2) * _sa + col(_TT, 3) * _ca)
TiePlan = _show > 0 ? _tw : zeros(0, 4)
# steel
_bdmm = _bd * 1000
_sdmm = _sd * 1000
_kgm = 0.006165 * _bdmm * _bdmm
_kgs = 0.006165 * _sdmm * _sdmm
mainBarCount = _bn
mainBarDiaMm = _bdmm
stirrupCount = _nst
stirrupPitch = _ss
_tieLen = _isC ? (2 * PI * _rb) : (2 * (2 * _hx + 2 * _hy) + (_hasD > 0 ? 4 * sqrt(_hx * _hx + _hy * _hy) : 0))
_hook = 2 * max(0.075, 10 * _sd)
mainSteelKg = _bn * (_H - _cv) * _kgm
stirrupSteelKg = _nst * (_tieLen + _hook) * _kgs
steelKg = mainSteelKg + stirrupSteelKg
_As = _bn * PI * _bd * _bd / 4
steelRatioPct = 100 * _As / max(sectionArea, 1e-6)
coverOut = _cv
`;

const oldSlots = node("out").data.params.slots;               // s1..s12
const slots = [
  ...oldSlots,
  { id: "s13", label: "Main bars — solids" },
  { id: "s14", label: "Stirrups — solids" },
  { id: "s15", label: "Main bars — plan" },
  { id: "s16", label: "Ties — plan" },
  { id: "s17", label: "Main bars" },
  { id: "s18", label: "Main bar Ø (mm)" },
  { id: "s19", label: "Stirrups" },
  { id: "s20", label: "Stirrup pitch (m)" },
  { id: "s21", label: "Main steel (kg)" },
  { id: "s22", label: "Stirrup steel (kg)" },
  { id: "s23", label: "Steel total (kg)" },
  { id: "s24", label: "Steel ratio (%)" },
  { id: "s25", label: "Clear cover (m)" },
];
const VALUE = {
  s1: "SectionPlan", s2: "AxisPlan", s3: "ColumnMesh", s4: "sectionArea", s5: "perimeter", s6: "volume", s7: "formworkArea",
  s8: "selfWeightkN", s9: "columnHeight", s10: "topElevation", s11: "leastDim", s12: "slenderness",
  s13: "Bars3D", s14: "Stirrups3D", s15: "BarsPlan", s16: "TiePlan", s17: "mainBarCount", s18: "mainBarDiaMm", s19: "stirrupCount",
  s20: "stirrupPitch", s21: "mainSteelKg", s22: "stirrupSteelKg", s23: "steelKg", s24: "steelRatioPct", s25: "coverOut",
};
const r2d = [
  ...node("r2d").data.params.prims,
  { id: "p2_bars", kind: "polygon", name: "Main bars", color: "#7c2d12", layer: "Structure", lineStyle: "solid", fillMode: "filled", show: true },
  { id: "p2_ties", kind: "stroke", name: "Ties", color: "#b45309", layer: "Structure", lineStyle: "solid", width: 0.008, show: true },
];
const r3d = [
  ...node("r3d").data.params.prims.map((p) => (p.id === "p3_column" ? { ...p, opacity: 0.35 } : p)),
  { id: "p3_bars", kind: "polyhedron", name: "Main bars", color: "#7c2d12", layer: "Structure", opacity: 1, displayType: "solid", showEdges: false, x: 0, y: 0, z: 0, show: true },
  { id: "p3_stirrups", kind: "polyhedron", name: "Stirrups", color: "#b45309", layer: "Structure", opacity: 1, displayType: "solid", showEdges: false, x: 0, y: 0, z: 0, show: true },
];
const PRIM = { s1: "p2_section", s2: "p2_axis", s3: "p3_column", s13: "p3_bars", s14: "p3_stirrups", s15: "p2_bars", s16: "p2_ties" };

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
base.title = "Column — one Math Engine, section, shaft and reinforcement cage";
base.description = `A parametric COLUMN on the six-node spine:

  Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render

DROP IT ON A NODE and the shaft stands there. ONE SECTION, EXTRUDED — four corners or a polygon of \`Sides\`, a unit ring scaled by the dimensions and turned by \`Rotation\` — swept by \`mprism\` from the base to the top.

THE CAGE. The concrete is drawn at 35 % opacity so the reinforcement inside it reads: \`mainBars\` bars of \`barDia\` (8 × 16 mm by default) on the perimeter, their centres cover + stirrup + half a bar in from each face — four bars are the corners, eight are corners and mid-sides, twelve add the thirds; on a circular section they sit on the inner circle. Closed STIRRUPS of \`stirrupDia\` at \`stirrupSpacing\` (8 mm at 127 mm — five inches — by default) from base + cover to top − cover: the outer tie round every bar and, with eight or more bars in a rectangle, the inner DIAMOND tie through the four mid-side bars, which is the arrangement that holds a mid-side bar against buckling. The plan symbol shows the bars as dots and both ties as lines inside the hatched section.

WHAT IT REPORTS. Section area, perimeter, concrete volume, formwork area, self-weight, slenderness — and the steel: bar count and size, stirrup count and pitch, main steel and stirrup steel by mass (0.006165·d² kg/m, hooks at 10d each end), the total, and the steel ratio As/Ag. At the defaults a 400 × 400 × 3 m column carries 37 kg of 16 mm and 19 kg of 8 mm ties (the diamond doubles the tie length), 1.0 % steel.

WHAT IT DOES NOT DO. No lap lengths, no starter bars into the footing, no bend radii — the ties are straight thin boxes meeting at the bar lines. It does not carve the wall it sits in. Circular columns are polygonised at \`Sides\`; their tie is twelve chords.`;

fs.writeFileSync(OUT, JSON.stringify(base, null, 1));
console.log(`${OUT}  ${props.length} params · ${slots.length} outputs · ${edges.length} edges · ${expr.split("\n").length} expr lines · ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
