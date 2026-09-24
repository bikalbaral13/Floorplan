/** Structural parametric objects for a PLANE FRAME analysis on the canvas.
 *
 *  THE CANVAS PLANE IS THE FRAME'S PLANE. A frame is drawn here in ELEVATION: canvas x is the
 *  structural X, and structural Y is UP, which is minus canvas y. So a member's in-plane depth `h`
 *  is what the 2D band shows and its breadth `b` is the thickness out of the page. Getting this the
 *  other way round would draw a 500 mm beam as a 300 mm one and, worse, bend it about the wrong axis.
 *
 *    frame-joint   — NODE-hosted. Restraints, nodal loads, and the solved displacement and reaction.
 *    frame-beam    — SEGMENT-hosted. A member. Draws its own BENDING MOMENT DIAGRAM.
 *    frame-column  — SEGMENT-hosted. The same member with a column's defaults and colour.
 *
 *  SOLVER RESULTS ARE INPUTS, exactly as in the pipe network: each object takes the quantities the
 *  analysis produces as ordinary parameters defaulting to 0, and re-derives everything else itself —
 *  stresses, utilisation, the moment diagram, the deflected position. So the flow's write-back needs
 *  no new machinery, and each element's Metrics tab is its own solved state.
 *
 *  RESTRAINTS ARE CHECKBOXES, NOT A SELECT. A select carries a string, and the canvas decoder can
 *  only lift NUMBERS off an attached object — a `support = "Pinned"` would reach the Math Engine as
 *  nothing at all. Three booleans also say strictly more: they can express a roller in either
 *  direction and a rotational restraint without translational ones.
 */
import { FRAME, FIT, ANCHOR, KERNEL, MAPW, solid, plan, box, rng, sel, chk } from "../tmp-pobj/common.mjs";

const body = (parts) => parts.filter(Boolean).join("\n");

/* ── The member — one spec, two objects ──────────────────────────────────────────────────────── */
const member = ({ id, name, title, icon, category, colour, barColour, defB, defH, defUdl, kindCode, kindWord, description }) => ({
  id, name, title, icon, category,
  hostKind: "segment",
  props: [
    rng("E", "Young's modulus (GPa)", 25, 1, 400, 0.5),
    rng("b", "Breadth, out of plane (mm)", defB, 20, 3000, 5),
    rng("h", "Depth, in plane (mm)", defH, 20, 3000, 5),
    rng("fy", "Allowable bending stress (MPa)", 12, 0.5, 600, 0.5),
    rng("density", "Density (kN/m³)", 25, 0, 100, 0.5),
    chk("selfWeight", "Include self weight", false),
    rng("udl", "Transverse UDL (kN/m, down)", defUdl, -500, 500, 0.5),
    chk("releaseStart", "Moment release at start", false),
    chk("releaseEnd", "Moment release at end", false),
    sel("spanMode", "Length along host", "Fill segment", ["Fill segment", "Own length (centred)"]),
    rng("ownLength", "Own length (m)", 4, 0.1, 100, 0.05),
    rng("N1", "Axial at start from solver (kN)", 0, -100000, 100000, 0.001),
    rng("V1", "Shear at start from solver (kN)", 0, -100000, 100000, 0.001),
    rng("M1", "Moment at start from solver (kNm)", 0, -100000, 100000, 0.001),
    rng("N2", "Axial at end from solver (kN)", 0, -100000, 100000, 0.001),
    rng("V2", "Shear at end from solver (kN)", 0, -100000, 100000, 0.001),
    rng("M2", "Moment at end from solver (kNm)", 0, -100000, 100000, 0.001),
    rng("u1", "Axial displacement at start (mm)", 0, -100000, 100000, 0.0001),
    rng("v1", "Transverse displacement at start (mm)", 0, -100000, 100000, 0.0001),
    rng("r1", "Rotation at start (mrad)", 0, -100000, 100000, 0.0001),
    rng("u2", "Axial displacement at end (mm)", 0, -100000, 100000, 0.0001),
    rng("v2", "Transverse displacement at end (mm)", 0, -100000, 100000, 0.0001),
    rng("r2", "Rotation at end (mrad)", 0, -100000, 100000, 0.0001),
    sel("diagram", "Diagram", "Bending moment", ["None", "Bending moment", "Shear force", "Axial force", "Deflected shape"]),
    rng("bmdScale", "Moment scale (m per kNm)", 0.01, 0.0001, 1, 0.0001),
    rng("sfdScale", "Shear scale (m per kN)", 0.01, 0.0001, 1, 0.0001),
    rng("axialScale", "Axial scale (m per kN)", 0.005, 0.0001, 1, 0.0001),
    rng("defScale", "Deflection scale", 200, 1, 20000, 1),
  ],
  expr: body([
    "_natL = ownLength",
    FRAME, FIT,
    "_fill = spanMode == 'Fill segment'",
    "_Ln = _fill ? max(0.01, _hostL - 2 * margin) : max(0.01, ownLength * _s)",
    "# Section. `h` is the IN-PLANE depth — the canvas is the frame's plane — so the 2D band is h wide",
    "# and the 3D extrusion is b thick. Bending is about the axis that h governs.",
    "_bm = max(0.02, b / 1000)",
    "_hm = max(0.02, h / 1000)",
    "_bodyL = _Ln",
    "_bodyW = _hm",
    ANCHOR,
    "_u0 = 0 - _Ln / 2",
    "_u1 = _Ln / 2",
    box("_u0", "0 - _hm / 2", "_u1", "_hm / 2", "0 - _bm / 2", "_bm / 2", 1).replace(/^/, "_SHAFT = "),
    "Q = _SHAFT",
    KERNEL, MAPW,
    plan("ShaftPlan", 1), solid("Shaft3D", 1),
    "# The member's two ends in world coordinates — the baseline the moment diagram is drawn from.",
    "_au = _cu + _u0",
    "_bu = _cu + _u1",
    "_max = _au * _ux + _cv * _vx",
    "_may = _au * _uy + _cv * _vy",
    "_mbx = _bu * _ux + _cv * _vx",
    "_mby = _bu * _uy + _cv * _vy",
    "# Direction cosines in STRUCTURAL axes (Y up = minus canvas y) — the same resolution the analysis",
    "# applies, so an inclined member's share of gravity is identical in the drawing and in the solve.",
    "_dxc = _mbx - _max",
    "_dyc = _mby - _may",
    "_Lc = max(1e-9, sqrt(_dxc * _dxc + _dyc * _dyc))",
    "_csLoc = _dxc / _Lc",
    "_snLoc = 0 - _dyc / _Lc",
    "# ── Section properties ────────────────────────────────────────────────────────",
    "_A = _bm * _hm",
    "_I = _bm * pow(_hm, 3) / 12",
    "_Z = _I / (_hm / 2)",
    "_Ekn = E * 1e6",
    "_selfw = selfWeight > 0 ? _A * density : 0",
    "_w = udl + _selfw",
    "# ── Internal forces along the span ────────────────────────────────────────────",
    "# M(x) from the solved end actions and the span load. The end actions are the LOCAL member",
    "# forces the analysis wrote back; sagging is positive, which is why M1 enters negated.",
    "_ns = 21",
    "_t = arange(_ns) / (_ns - 1)",
    "_x = _t * _Ln",
    "_Mx = 0 - M1 + V1 * _x - _w * _x * _x / 2",
    "_Vx = V1 - _w * _x",
    "# M(x) is a PARABOLA, so its peak has a closed form — sampling alone lands near it but not on it",
    "# (21 stations on the benchmark beam read 68.57 kNm against a true 68.73). The stationary point",
    "# x* = V1/w is evaluated exactly and clamped to the span, then taken alongside the sampled values.",
    "_xs = abs(_w) > 1e-9 ? V1 / _w : 0",
    "_xc = max(0, min(_Ln, _xs))",
    "_Mc = 0 - M1 + V1 * _xc - _w * _xc * _xc / 2",
    "_Mabs = max(max(abs(_Mx)), abs(_Mc))",
    "_Vabs = max(abs(_Vx))",
    "# ── Axial force along the span. A gravity UDL on an INCLINED member has an axial component, so",
    "# N(x) is not constant in general; on a level beam or a plumb column the second term vanishes.",
    "_qa = 0 - _w * _snLoc",
    "_Nx = 0 - N1 + _qa * _x",
    "_Nabs = max(abs(_Nx))",
    "# ── The deflected shape, from the LOCAL end displacements the analysis wrote back. Hermite",
    "# interpolation gives the shape a member with no span load takes; the fixed-fixed particular",
    "# solution w·x²(L−x)²/24EI adds the sag between the nodes, which is the part a straight line",
    "# between joints misses entirely and the part an engineer is looking for.",
    "_xi = _t",
    "_H1 = 1 - 3 * _xi * _xi + 2 * _xi * _xi * _xi",
    "_H2 = _Ln * (_xi - 2 * _xi * _xi + _xi * _xi * _xi)",
    "_H3 = 3 * _xi * _xi - 2 * _xi * _xi * _xi",
    "_H4 = _Ln * (_xi * _xi * _xi - _xi * _xi)",
    "_qt = 0 - _w * _csLoc",
    "_EIkn = _Ekn * _I",
    "_vp = _EIkn > 0 ? _qt * _x * _x * (_Ln - _x) * (_Ln - _x) / (24 * _EIkn) : 0",
    "_vloc = _H1 * v1 / 1000 + _H2 * r1 / 1000 + _H3 * v2 / 1000 + _H4 * r2 / 1000 + _vp",
    "_uloc = (u1 + (u2 - u1) * _xi) / 1000",
    "_vmid = max(abs(_vloc))",
    "# ── Plotting axes. `_nv` is the ANALYSIS local +y in canvas coordinates: structural Y is up and",
    "# canvas y is down, so the perpendicular the frame block hands us is its negative. The deflected",
    "# shape and the shear must use the physical axis (a sagging beam has to sag DOWN the page); the",
    "# moment diagram deliberately uses the opposite, so sagging plots on the tension face.",
    "_nvx = 0 - _vx",
    "_nvy = 0 - _vy",
    "_ring = ones(_ns, 1)",
    "_axx = _max + _t * (_mbx - _max)",
    "_axy = _may + _t * (_mby - _may)",
    "_scM = max(0.0001, bmdScale)",
    "_scV = max(0.0001, sfdScale)",
    "_scN = max(0.0001, axialScale)",
    "_scD = max(1, defScale)",
    "_MDX = _axx + _vx * _Mx * _scM",
    "_MDY = _axy + _vy * _Mx * _scM",
    "_VDX = _axx + _nvx * _Vx * _scV",
    "_VDY = _axy + _nvy * _Vx * _scV",
    "_NDX = _axx + _nvx * _Nx * _scN",
    "_NDY = _axy + _nvy * _Nx * _scN",
    "# The deflected shape is a LINE, not an area: it is where the member went, not a quantity",
    "# plotted against it, so it is not closed back to the axis.",
    "_DFX = _axx + (_nvx * _vloc + _ux * _uloc) * _scD",
    "_DFY = _axy + (_nvy * _vloc + _uy * _uloc) * _scD",
    "_isM = diagram == 'Bending moment'",
    "_isV = diagram == 'Shear force'",
    "_isN = diagram == 'Axial force'",
    "_isD = diagram == 'Deflected shape'",
    "_curveX = _isM ? _MDX : (_isV ? _VDX : (_isN ? _NDX : _DFX))",
    "_curveY = _isM ? _MDY : (_isV ? _VDY : (_isN ? _NDY : _DFY))",
    "# An area diagram closes back along the member axis; the deflected shape does not.",
    "_AREA = vcat(hcat(_max, _may, 1), hcat(_curveX, _curveY, _ring), hcat(_mbx, _mby, 1))",
    "_LINE = hcat(_curveX, _curveY, _ring)",
    "_any = _isM || _isV || _isN || _isD",
    "Diagram = _any ? (_isD ? _LINE : _AREA) : zeros(0, 3)",
    "# ── Metrics ───────────────────────────────────────────────────────────────────",
    "memberLength = _Ln",
    "sectionArea = _A",
    "secondMoment = _I",
    "sectionModulus = _Z",
    "axialStiffness = _Ekn * _A",
    "flexuralStiffness = _Ekn * _I",
    "selfWeightUdl = _selfw",
    "totalUdl = _w",
    "totalSpanLoad = _w * _Ln",
    "axialTension = 0 - N1",
    "axialCompression = N1",
    "shearStart = V1",
    "shearEnd = V2",
    "momentStart = M1",
    "momentEnd = M2",
    "axialEndTension = 0 - N2",
    "releasedStart = releaseStart > 0 ? 1 : 0",
    "releasedEnd = releaseEnd > 0 ? 1 : 0",
    "maxMoment = _Mabs",
    "maxShear = _Vabs",
    "bendingStress = _Z > 0 ? _Mabs / _Z / 1000 : 0",
    "axialStress = _A > 0 ? abs(N1) / _A / 1000 : 0",
    "combinedStress = (_Z > 0 ? _Mabs / _Z / 1000 : 0) + (_A > 0 ? abs(N1) / _A / 1000 : 0)",
    "utilisation = fy > 0 ? ((_Z > 0 ? _Mabs / _Z / 1000 : 0) + (_A > 0 ? abs(N1) / _A / 1000 : 0)) / fy : 0",
    "overStressed = fy > 0 && ((_Z > 0 ? _Mabs / _Z / 1000 : 0) + (_A > 0 ? abs(N1) / _A / 1000 : 0)) > fy ? 1 : 0",
    "maxAxialAlongSpan = _Nabs",
    "maxLocalDeflection = _vmid * 1000",
    "spanOverDeflection = _vmid > 1e-9 ? _Ln / _vmid : 0",
    "axialDisplacement = u2 - u1",
    "chordRotation = _Ln > 0 ? (v2 - v1) / 1000 / _Ln * 1000 : 0",
    "diagramCode = _isM ? 1 : (_isV ? 2 : (_isN ? 3 : (_isD ? 4 : 0)))",
    "spanDepth = _hm > 0 ? _Ln / _hm : 0",
    "concreteVolume = _A * _Ln",
    `memberKind = ${kindCode}`,
  ]),
  outputs: [
    { from: "ShaftPlan", label: `${kindWord} — plan` },
    { from: "Shaft3D", label: `${kindWord} — solid` },
    { from: "Diagram", label: "Diagram (selected)" },
    { from: "memberLength", label: "Length (m)" },
    { from: "sectionArea", label: "Section area (m²)" },
    { from: "secondMoment", label: "Second moment I (m⁴)" },
    { from: "sectionModulus", label: "Section modulus Z (m³)" },
    { from: "axialStiffness", label: "EA (kN)" },
    { from: "flexuralStiffness", label: "EI (kNm²)" },
    { from: "selfWeightUdl", label: "Self weight (kN/m)" },
    { from: "totalUdl", label: "Total UDL (kN/m)" },
    { from: "totalSpanLoad", label: "Total span load (kN)" },
    { from: "axialTension", label: "Axial, tension + (kN)" },
    { from: "axialCompression", label: "Axial, compression + (kN)" },
    { from: "shearStart", label: "Shear at start (kN)" },
    { from: "shearEnd", label: "Shear at end (kN)" },
    { from: "momentStart", label: "Moment at start (kNm)" },
    { from: "momentEnd", label: "Moment at end (kNm)" },
    { from: "axialEndTension", label: "Axial at end, tension + (kN)" },
    { from: "releasedStart", label: "Moment released at start" },
    { from: "releasedEnd", label: "Moment released at end" },
    { from: "maxMoment", label: "Max moment (kNm)" },
    { from: "maxShear", label: "Max shear (kN)" },
    { from: "bendingStress", label: "Bending stress (MPa)" },
    { from: "axialStress", label: "Axial stress (MPa)" },
    { from: "combinedStress", label: "Combined stress (MPa)" },
    { from: "utilisation", label: "Utilisation" },
    { from: "overStressed", label: "Over stressed" },
    { from: "maxAxialAlongSpan", label: "Max axial along span (kN)" },
    { from: "maxLocalDeflection", label: "Max deflection from chord (mm)" },
    { from: "spanOverDeflection", label: "Span / deflection" },
    { from: "axialDisplacement", label: "Axial shortening (mm)" },
    { from: "chordRotation", label: "Chord rotation (mrad)" },
    { from: "diagramCode", label: "Diagram (1 M, 2 V, 3 N, 4 deflection)" },
    { from: "spanDepth", label: "Span / depth" },
    { from: "concreteVolume", label: "Volume (m³)" },
    { from: "memberKind", label: "Member kind (1 beam, 2 column)" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_shaft", from: "ShaftPlan", kind: "polygon", name: kindWord, color: colour, layer: kindWord, show: true },
    { id: "p2_diag", from: "Diagram", kind: "polygon", name: "Diagram", color: barColour, layer: "Analysis", show: true, fillMode: "outlined" },
  ],
  prims3d: [
    { id: "p3_shaft", from: "Shaft3D", kind: "polyhedron", name: kindWord, color: colour, layer: kindWord, x: 0, y: 0, z: 0, show: true },
  ],
  description,
});

export const frameBeam = member({
  id: "frame-beam-with-math",
  name: "Frame Beam",
  title: "Frame Beam — a plane-frame member that draws its own moment diagram",
  icon: ["M3 9h18v6H3z", "M3 9V6", "M21 9V6"],
  category: "Structural",
  colour: "#b45309",
  barColour: "#f97316",
  defB: 300, defH: 500, defUdl: 20,
  kindCode: 1, kindWord: "Beam",
  description: `A BEAM as a PLANE-FRAME MEMBER — the analysis counterpart of the Architectural Beam, which is a geometry object and stays one.

THE CANVAS IS THE FRAME'S PLANE. Draw the frame in elevation: canvas x is structural X and structural Y is UP (minus canvas y). So \`Depth, in plane\` is what the 2D band shows and what the member bends about, and \`Breadth, out of plane\` is its thickness on the page. Swapping them would draw a 500 mm beam 300 mm deep AND bend it about the wrong axis, which is the more expensive half of the mistake.

IT DRAWS ITS OWN BENDING MOMENT DIAGRAM. Given the end actions the analysis writes back and the UDL it already knows, M(x) = −M₁ + V₁x − wx²/2 is sampled along the span and drawn as ONE closed ring: start point, the curve, end point. The edge that closes the ring back to the start is the member axis itself, so the diagram reads as an area against the member rather than as a floating outline. \`Moment diagram scale\` is in metres per kNm — it is a drawing, so its size is a drawing decision.

MAX MOMENT IS SAMPLED, NOT ASSUMED. Taking max(|M₁|, |M₂|) is right for a member with no span load and wrong the moment there is one: a beam under UDL has its peak away from both ends. Twenty-one stations along the span find it wherever it is, and the same sampling gives max shear.

SELF WEIGHT IS OPT-IN AND ADDS TO THE UDL, so the diagram, the metrics and the analysis all see one load. A member whose self weight is switched on reports it separately as well, because a check of the load path wants to know which part was assumed.

UTILISATION IS COMBINED STRESS over the allowable: bending M/Z plus axial N/A, both in MPa. Crude by design — it is a sizing sanity check on a linear elastic analysis, not a code check, and no code factors are applied anywhere.

DIMENSIONS AT THE DEFAULTS: 300 × 500 mm, E = 25 GPa, 20 kN/m, allowable 12 MPa.

WHAT THIS CANNOT DO. Prismatic and straight; no haunches, no cracked-section stiffness, no torsion (the analysis is planar). It does not analyse anything — the end actions arrive from the flow.`,
});

export const frameColumn = member({
  id: "frame-column-with-math",
  name: "Frame Column",
  title: "Frame Column — a plane-frame member, drawn in the frame's plane",
  icon: ["M9 3h6v18H9z", "M9 3H6", "M9 21H6"],
  category: "Structural",
  colour: "#0f766e",
  barColour: "#14b8a6",
  defB: 300, defH: 300, defUdl: 0,
  kindCode: 2, kindWord: "Column",
  description: `A COLUMN as a PLANE-FRAME MEMBER — a SEGMENT between two joints, not the node-hosted Structural Column, which is a plan symbol with a reinforcement cage and stays one.

WHY A SEGMENT. In a plane frame a column is a member with two ends, a length and a bending stiffness; it is only a point in PLAN. Drawing the frame in elevation makes the column a segment like any other, which is what lets one analysis treat beams and columns identically — they differ here in their defaults, their colour and a kind code, and in nothing else.

Everything the Frame Beam does, this does: the same member stiffness, the same end actions from the analysis, the same sampled M(x) drawn as a moment diagram against the member axis, the same combined-stress utilisation. A column's transverse UDL defaults to 0 because a column is not usually span-loaded — set it for wind on the face.

AXIAL IS THE NUMBER TO WATCH HERE, and it is published both ways round: \`Axial, tension +\` and \`Axial, compression +\` are the same force under the two conventions people actually use, so neither reading has to be inferred from a minus sign.

DIMENSIONS AT THE DEFAULTS: 300 × 300 mm, E = 25 GPa, no span load, allowable 12 MPa.

WHAT THIS CANNOT DO. No buckling check — slenderness and effective length are not evaluated. Second-order effects are an ANALYSIS option (P-Δ), not a member check, and this object reports what the analysis gives it.`,
});

/* ── The joint ───────────────────────────────────────────────────────────────────────────────── */
export const frameJoint = {
  id: "frame-joint-with-math",
  name: "Frame Joint",
  title: "Frame Joint — restraints, nodal loads, and the solved displacement and reaction",
  hostKind: "node",
  category: "Structural",
  icon: ["M12 3v12", "M5 15h14", "M5 15l-2 4", "M12 15l-2 4", "M19 15l-2 4"],
  props: [
    chk("fixX", "Restrain X", false),
    chk("fixY", "Restrain Y", false),
    chk("fixR", "Restrain rotation", false),
    rng("Fx", "Load Fx (kN, +right)", 0, -100000, 100000, 0.1),
    rng("Fy", "Load Fy (kN, +up)", 0, -100000, 100000, 0.1),
    rng("Mz", "Moment Mz (kNm)", 0, -100000, 100000, 0.1),
    rng("markerSize", "Marker size (m)", 0.3, 0.02, 5, 0.01),
    rng("ux", "Displacement X from solver (mm)", 0, -100000, 100000, 0.0001),
    rng("uy", "Displacement Y from solver (mm)", 0, -100000, 100000, 0.0001),
    rng("rotZ", "Rotation from solver (mrad)", 0, -100000, 100000, 0.0001),
    rng("Rx", "Reaction X from solver (kN)", 0, -100000, 100000, 0.001),
    rng("Ry", "Reaction Y from solver (kN)", 0, -100000, 100000, 0.001),
    rng("Rz", "Reaction moment from solver (kNm)", 0, -100000, 100000, 0.001),
    rng("dispScale", "Deflection scale", 200, 1, 20000, 1),
    rng("height", "Height above base from solver (m)", 0, -1000, 1000, 0.001),
  ],
  expr: body([
    "_natL = markerSize",
    FRAME, FIT,
    "_ms = max(0.02, markerSize * _s)",
    "_bodyL = _ms",
    "_bodyW = _ms",
    ANCHOR,
    "_q = _ms / 2",
    "# The joint marker, always drawn.",
    box("0 - _q", "0 - _q", "_q", "_q", "0", "_ms / 3", 1).replace(/^/, "_MARK = "),
    "# The support symbol GROWS with what is restrained, so the drawing says which support it is:",
    "# a bearing plate under a vertical restraint, cheeks for a horizontal one, a fixity block for",
    "# a rotational one. A free joint gets none of it and reads as a bare connection.",
    "_anyT = max(fixX, fixY)",
    box("0 - 2 * _q", "_q", "2 * _q", "_q + _q / 2", "0", "_ms / 3", 2).replace(/^/, "_PLATE = "),
    "_SUPP = _anyT > 0 ? _PLATE : zeros(0, 11)",
    box("0 - 2 * _q", "_q + _q / 2", "0 - 1.4 * _q", "2 * _q", "0", "_ms / 3", 3).replace(/^/, "_CH1 = "),
    box("1.4 * _q", "_q + _q / 2", "2 * _q", "2 * _q", "0", "_ms / 3", 3).replace(/^/, "_CH2 = "),
    "_CHEEK = fixX > 0 ? vcat(_CH1, _CH2) : zeros(0, 11)",
    box("0 - 1.2 * _q", "0 - 1.2 * _q", "1.2 * _q", "1.2 * _q", "_ms / 3", "_ms / 1.5", 4).replace(/^/, "_FIXB = "),
    "_FIX = fixR > 0 ? _FIXB : zeros(0, 11)",
    "Q = vcat(_MARK, _SUPP, _CHEEK, _FIX)",
    KERNEL, MAPW,
    plan("MarkerPlan", 1), plan("PlatePlan", 2), plan("CheekPlan", 3), plan("FixityPlan", 4),
    solid("Marker3D", 1),
    "# The DEFLECTED position, as a line from where the joint is to where it went. Structural Y is UP,",
    "# so a downward displacement (negative uy) must move DOWN the page: canvas y increases.",
    "_ox = _cu * _ux + _cv * _vx",
    "_oy = _cu * _uy + _cv * _vy",
    "_dsc = max(1, dispScale)",
    "_dx = ux / 1000 * _dsc",
    "_dy = 0 - uy / 1000 * _dsc",
    "_dr = max(0.004, _ms / 6)",
    "Deflection = hcat(_ox, _oy, 0, _ox + _dx, _oy + _dy, 0, _dr)",
    "# ── Metrics ───────────────────────────────────────────────────────────────────",
    "_res = sqrt(ux * ux + uy * uy)",
    "_rr = sqrt(Rx * Rx + Ry * Ry)",
    "restraintCount = fixX + fixY + fixR",
    "isSupport = (fixX + fixY + fixR) > 0 ? 1 : 0",
    "isFixed = (fixX > 0 && fixY > 0 && fixR > 0) ? 1 : 0",
    "isPinned = (fixX > 0 && fixY > 0 && fixR < 1) ? 1 : 0",
    "isRoller = ((fixX + fixY) == 1) ? 1 : 0",
    "dispX = ux",
    "dispY = uy",
    "dispResultant = _res",
    "jointRotation = rotZ",
    "reactionX = Rx",
    "reactionY = Ry",
    "reactionMoment = Rz",
    "reactionResultant = _rr",
    "appliedFx = Fx",
    "appliedFy = Fy",
    "appliedMz = Mz",
    "appliedResultant = sqrt(Fx * Fx + Fy * Fy)",
    "deflectionScale = _dsc",
    "heightAboveBase = height",
    "# A sway check is made on the RATIO, not the millimetres: h/500 means nothing without h.",
    "driftRatio = height > 1e-6 ? abs(ux) / 1000 / height : 0",
    "driftIndex = (height > 1e-6 && abs(ux) > 1e-9) ? height / (abs(ux) / 1000) : 0",
  ]),
  outputs: [
    { from: "MarkerPlan", label: "Joint — plan" },
    { from: "PlatePlan", label: "Bearing plate — plan" },
    { from: "CheekPlan", label: "Cheeks — plan" },
    { from: "FixityPlan", label: "Fixity block — plan" },
    { from: "Marker3D", label: "Joint — solid" },
    { from: "Deflection", label: "Deflection — tube" },
    { from: "restraintCount", label: "Restraints" },
    { from: "isSupport", label: "Is a support" },
    { from: "isFixed", label: "Fixed" },
    { from: "isPinned", label: "Pinned" },
    { from: "isRoller", label: "Roller" },
    { from: "dispX", label: "Displacement X (mm)" },
    { from: "dispY", label: "Displacement Y (mm)" },
    { from: "dispResultant", label: "Displacement resultant (mm)" },
    { from: "jointRotation", label: "Rotation (mrad)" },
    { from: "reactionX", label: "Reaction X (kN)" },
    { from: "reactionY", label: "Reaction Y (kN)" },
    { from: "reactionMoment", label: "Reaction moment (kNm)" },
    { from: "reactionResultant", label: "Reaction resultant (kN)" },
    { from: "appliedFx", label: "Applied Fx (kN)" },
    { from: "appliedFy", label: "Applied Fy (kN)" },
    { from: "appliedMz", label: "Applied Mz (kNm)" },
    { from: "appliedResultant", label: "Applied load resultant (kN)" },
    { from: "deflectionScale", label: "Deflection scale" },
    { from: "heightAboveBase", label: "Height above base (m)" },
    { from: "driftRatio", label: "Drift ratio" },
    { from: "driftIndex", label: "Drift = height / n" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_mark", from: "MarkerPlan", kind: "polygon", name: "Joint", color: "#1e293b", layer: "Joint", show: true },
    { id: "p2_plate", from: "PlatePlan", kind: "polygon", name: "Bearing plate", color: "#475569", layer: "Joint", show: true },
    { id: "p2_cheek", from: "CheekPlan", kind: "polygon", name: "Cheeks", color: "#475569", layer: "Joint", show: true },
    { id: "p2_fix", from: "FixityPlan", kind: "polygon", name: "Fixity block", color: "#64748b", layer: "Joint", show: true },
  ],
  prims3d: [
    { id: "p3_mark", from: "Marker3D", kind: "polyhedron", name: "Joint", color: "#1e293b", layer: "Joint", x: 0, y: 0, z: 0, show: true },
    { id: "p3_def", from: "Deflection", kind: "tube", name: "Deflection", color: "#dc2626", layer: "Joint", x: 0, y: 0, z: 0, show: true },
  ],
  description: `A JOINT of a plane frame — what the members meet at, what holds the structure up, and where a point load is applied.

RESTRAINTS ARE THREE CHECKBOXES, not a support type. The decoder can only lift NUMBERS off an attached object, so a \`support = "Pinned"\` string would reach the analysis as nothing at all. Three booleans also say strictly MORE than a list of named supports: a roller in either direction, a rotational restraint without translational ones, a guided support — each is just a combination, and none needs a new option.

  none          a free joint — a connection, not a support
  X + Y         pinned
  X + Y + R     fixed
  one of X / Y  a roller on the other axis

THE SYMBOL GROWS WITH THE RESTRAINT. A bearing plate appears under a translational restraint, cheeks either side of it when X is held, a fixity block on top when rotation is held. So the drawing states the support condition instead of the Properties tab being the only place it exists.

SIGN CONVENTION, STATED ONCE: structural Y is UP, which is MINUS canvas y. \`Fy\` positive is upward, so gravity load is negative. The deflection line honours this — a negative \`uy\` moves DOWN the page — and it is drawn at \`Deflection scale\` because a 5 mm sway on a 6 m frame is invisible at true scale, which is why every analysis package exaggerates it.

A REACTION IS ONLY MEANINGFUL AT A RESTRAINT. An unrestrained joint has none, and the analysis writes 0 there; \`Is a support\` is what tells the two cases apart rather than a zero that could also be a balanced joint.

DIMENSIONS AT THE DEFAULTS: a 0.30 m marker, free, unloaded, deflections drawn ×200.

WHAT THIS CANNOT DO. No prescribed (settlement) displacements, no spring supports, no skew restraint — the restrained directions are the global axes.`,
};
