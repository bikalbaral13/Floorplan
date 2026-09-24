/** Slab — a SPACE-hosted floor panel that works out the load it delivers to the beams around it.
 *
 *  This is the piece between a plan and a frame analysis. A slab panel is where the load actually
 *  starts: self weight from its own thickness, finishes and an imposed load per square metre. What the
 *  frame needs is none of those — it needs kN per METRE along each supporting beam, which depends on
 *  how the panel spans and on its aspect ratio. That conversion is the whole point of this object, and
 *  its two published edge loads are meant to be typed straight into the Frame Beam's UDL.
 *
 *  ONE-WAY vs TWO-WAY IS NOT A LABEL, it is a different distribution:
 *    one-way   — the panel spans the SHORT direction only; each long edge takes w·Lx/2 and the short
 *                edges take nothing.
 *    two-way   — yield lines at 45° cut the panel into two triangles on the short edges and two
 *                trapezia on the long ones. The short edge takes w·Lx/3; the long edge takes
 *                w·Lx/2·(1 − 1/(3β²)) with β = Ly/Lx — the standard equivalent-UDL form, which tends
 *                to the one-way answer as the panel gets long, as it must.
 *
 *  THE PANEL IS DRAWN FROM ITS HOST OUTLINE, not from a bounding box: `mprism` extrudes the space's
 *  own ring, so an L-shaped or splayed panel is drawn as it is. The SPANS still come from the bounding
 *  box, because "short span" is only defined for something rectangle-ish — and that is exactly the
 *  case where the load distribution above is valid.
 */
import { FRAME, FIT, ANCHOR, rng, sel, chk } from "../tmp-pobj/common.mjs";

const body = (parts) => parts.filter(Boolean).join("\n");

export const slab = {
  id: "slab-with-math",
  name: "Slab",
  hostKind: "space",
  category: "Structural",
  title: "Slab — a floor panel that computes the UDL it hands to its beams",
  icon: ["M3 7h18v10H3z", "M3 7l3-3h18l-3 3", "M21 7v10l-3 3"],
  props: [
    rng("thickness", "Thickness (mm)", 150, 50, 1000, 5),
    rng("density", "Concrete density (kN/m³)", 25, 10, 40, 0.5),
    rng("finishes", "Finishes and services (kN/m²)", 1.5, 0, 20, 0.1),
    rng("imposed", "Imposed load (kN/m²)", 3, 0, 50, 0.25),
    sel("spanning", "Spanning", "Two-way", ["Two-way", "One-way"]),
    sel("combination", "Load combination", "1.0 D + 1.0 L (service)", ["1.0 D + 1.0 L (service)", "1.5 D + 1.5 L", "1.2 D + 1.6 L"]),
    rng("spanDepthLimit", "Span / depth limit", 30, 10, 60, 1),
    rng("steelRate", "Reinforcement rate (kg/m³)", 90, 0, 400, 5),
    chk("showPanel", "Draw the panel", true),
    rng("levelZ", "Top of slab (m)", 0, -50, 300, 0.01),
  ],
  expr: body([
    "_natL = 1",
    FRAME, FIT,
    "_bodyL = _hostL",
    "_bodyW = _hostW",
    ANCHOR,
    "# SPANS from the host's bounding box. 'Short span' only means something for a rectangle-ish panel,",
    "# which is the same condition under which the load distribution below is valid.",
    "_Lx = min(_hostL, _hostW)",
    "_Ly = max(_hostL, _hostW)",
    "_beta = _Lx > 1e-6 ? _Ly / _Lx : 1",
    "_t = max(0.02, thickness / 1000)",
    "# ── Loads per square metre ────────────────────────────────────────────────────",
    "_self = _t * density",
    "_dead = _self + finishes",
    "_live = imposed",
    "_isU1 = combination == '1.5 D + 1.5 L'",
    "_isU2 = combination == '1.2 D + 1.6 L'",
    "_gD = _isU1 ? 1.5 : (_isU2 ? 1.2 : 1)",
    "_gL = _isU1 ? 1.5 : (_isU2 ? 1.6 : 1)",
    "_w = _gD * _dead + _gL * _live",
    "# ── Distribution to the supporting beams ──────────────────────────────────────",
    "# One-way: the panel spans the short direction, so each LONG edge carries half of it and the",
    "# short edges carry nothing. Two-way: 45° yield lines give a triangle on each short edge and a",
    "# trapezium on each long one; the trapezoidal form tends to w·Lx/2 as the panel lengthens, which",
    "# is the one-way answer — the two cases meet, they do not jump.",
    "_oneWay = spanning == 'One-way'",
    "# TRIBUTARY loads — the ones that BALANCE. 45° yield lines give each short edge a triangle of",
    "# area Lx²/4 and each long edge a trapezium of area (2Ly−Lx)Lx/4; the four add to Lx·Ly exactly.",
    "_trLong = _oneWay ? _w * _Lx / 2 : _w * _Lx * (2 * _Ly - _Lx) / (4 * _Ly)",
    "_trShort = _oneWay ? 0 : _w * _Lx / 4",
    "# MOMENT-EQUIVALENT UDLs — the textbook w·Lx/2·(1−1/3β²) and w·Lx/3. These are equivalent for",
    "# the BENDING MOMENT they produce in the supporting beam, NOT for total load: integrated round the",
    "# perimeter they do not come to w·Lx·Ly, and treating them as if they did is a classic way to lose",
    "# load off a floor. Both pairs are published, each labelled for what it is.",
    "_eqLong = _oneWay ? _w * _Lx / 2 : _w * _Lx / 2 * (1 - 1 / (3 * _beta * _beta))",
    "_eqShort = _oneWay ? 0 : _w * _Lx / 3",
    "_wLong = _trLong",
    "_wShort = _trShort",
    "# ── The panel itself, from the host outline rather than a box ─────────────────",
    "_nP = rows(P)",
    "_grp = ones(_nP, 1)",
    "_ringPlan = hcat(col(P, 0), col(P, 1), _grp)",
    "Panel = showPanel > 0 ? _ringPlan : zeros(0, 3)",
    "_z1 = levelZ",
    "_z0 = levelZ - _t",
    "_SOL = mprism(P, _z0, _z1)",
    "Slab3D = showPanel > 0 ? _SOL : zeros(0, 4)",
    "# ── Metrics ───────────────────────────────────────────────────────────────────",
    "# TRUE panel area by the shoelace formula — the host outline may not be a rectangle, and the",
    "# quantities should follow the shape that is actually there. The load DISTRIBUTION above is a",
    "# rectangular idealisation, so it is checked against the rectangle it assumes, and the gap between",
    "# the two is reported rather than hidden.",
    "_Pn = shift(P, -1)",
    "_cross = col(P, 0) * col(_Pn, 1) - col(_Pn, 0) * col(P, 1)",
    "_trueA = abs(sum(_cross)) / 2",
    "_rectA = _Lx * _Ly",
    "_area = _trueA > 1e-9 ? _trueA : _rectA",
    "panelArea = _area",
    "rectangularArea = _rectA",
    "shapeDeviation = _rectA > 1e-9 ? abs(_area - _rectA) / _rectA : 0",
    "shortSpan = _Lx",
    "longSpan = _Ly",
    "aspectRatio = _beta",
    "slabThickness = _t",
    "selfWeight = _self",
    "deadLoad = _dead",
    "imposedLoad = _live",
    "designLoad = _w",
    "deadFactor = _gD",
    "liveFactor = _gL",
    "totalPanelLoad = _w * _area",
    "loadToLongBeam = _wLong",
    "loadToShortBeam = _wShort",
    "equivalentUdlLong = _eqLong",
    "equivalentUdlShort = _eqShort",
    "reactionCheck = abs(2 * _trLong * _Ly + 2 * _trShort * _Lx - _w * _rectA)",
    "equivalentLoadGap = abs(2 * _eqLong * _Ly + 2 * _eqShort * _Lx - _w * _rectA)",
    "spanDepth = _t > 0 ? _Lx / _t : 0",
    "spanDepthOk = (_t > 0 && _Lx / _t <= spanDepthLimit) ? 1 : 0",
    "isTwoWay = _oneWay ? 0 : 1",
    "concreteVolume = _area * _t",
    "steelMass = _area * _t * steelRate",
    "formworkArea = _area",
    "topOfSlab = levelZ",
    "soffitLevel = _z0",
  ]),
  outputs: [
    { from: "Panel", label: "Panel — plan" },
    { from: "Slab3D", label: "Slab — solid" },
    { from: "panelArea", label: "Panel area (m²)" },
    { from: "shortSpan", label: "Short span Lx (m)" },
    { from: "longSpan", label: "Long span Ly (m)" },
    { from: "aspectRatio", label: "Aspect ratio Ly/Lx" },
    { from: "slabThickness", label: "Thickness (m)" },
    { from: "selfWeight", label: "Self weight (kN/m²)" },
    { from: "deadLoad", label: "Total dead (kN/m²)" },
    { from: "imposedLoad", label: "Imposed (kN/m²)" },
    { from: "deadFactor", label: "Dead factor" },
    { from: "liveFactor", label: "Live factor" },
    { from: "designLoad", label: "Design load (kN/m²)" },
    { from: "totalPanelLoad", label: "Total panel load (kN)" },
    { from: "loadToLongBeam", label: "UDL to long beam (kN/m)" },
    { from: "loadToShortBeam", label: "UDL to short beam (kN/m)" },
    { from: "equivalentUdlLong", label: "Moment-equivalent UDL, long (kN/m)" },
    { from: "equivalentUdlShort", label: "Moment-equivalent UDL, short (kN/m)" },
    { from: "reactionCheck", label: "Load balance error (kN)" },
    { from: "equivalentLoadGap", label: "Equivalent-UDL load gap (kN)" },
    { from: "rectangularArea", label: "Rectangular area (m²)" },
    { from: "shapeDeviation", label: "Shape deviation from rectangle" },
    { from: "spanDepth", label: "Span / depth" },
    { from: "spanDepthOk", label: "Span / depth OK" },
    { from: "isTwoWay", label: "Two-way" },
    { from: "concreteVolume", label: "Concrete volume (m³)" },
    { from: "steelMass", label: "Reinforcement (kg)" },
    { from: "formworkArea", label: "Formwork area (m²)" },
    { from: "topOfSlab", label: "Top of slab (m)" },
    { from: "soffitLevel", label: "Soffit level (m)" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_panel", from: "Panel", kind: "polygon", name: "Slab panel", color: "#94a3b8", layer: "Slab", show: true, fillMode: "outlined" },
  ],
  prims3d: [
    { id: "p3_slab", from: "Slab3D", kind: "polyhedron", name: "Slab", color: "#cbd5e1", layer: "Slab", x: 0, y: 0, z: 0, show: true },
  ],
  description: `A SLAB PANEL that works out the load it hands to the beams around it — the piece between a floor plan and a frame analysis.

DROP IT ON A SPACE. The panel is drawn from the space's OWN outline (\`mprism\` extrudes the ring), so an L-shaped or splayed bay is drawn as it is rather than as its bounding box. The SPANS are taken from the bounding box, because "short span" is only defined for something rectangle-ish — which is the same condition under which the load distribution below is valid.

THE POINT OF IT IS THE CONVERSION. Load starts on a slab in kN per SQUARE metre — self weight from the thickness, finishes, imposed. A frame needs kN per METRE along a beam. \`UDL to long beam\` and \`UDL to short beam\` are that number, and they are meant to be typed straight into a Frame Beam's UDL.

ONE-WAY AND TWO-WAY ARE DIFFERENT DISTRIBUTIONS, not a label:
  • **One-way** — the panel spans the short direction. Each LONG edge carries w·Lx/2; the short edges carry nothing.
  • **Two-way** — 45° yield lines cut the panel into a triangle on each short edge and a trapezium on each long one. Short edge: w·Lx/3. Long edge: w·Lx/2·(1 − 1/3β²), β = Ly/Lx.

TWO PAIRS OF NUMBERS, BECAUSE THEY ARE NOT THE SAME THING. \`UDL to long/short beam\` are the TRIBUTARY loads — each short edge takes a triangle of area Lx²/4, each long edge a trapezium of (2Ly−Lx)Lx/4, and the four add to Lx·Ly exactly. \`Load balance error\` proves it and is 0.

\`Moment-equivalent UDL\` is the textbook w·Lx/2·(1−1/3β²) and w·Lx/3. Those are equivalent for the BENDING MOMENT they produce in the supporting beam, NOT for total load: integrated round the perimeter they do not come to w·Lx·Ly, and \`Equivalent-UDL load gap\` reports by how much. Using them to check a column load is a classic way to lose load off a floor, which is why both pairs are published and each is labelled for what it is.

THE LOAD FACTORS ARE EXPLICIT. Service (1.0/1.0) is the default because deflection and the beam UDLs an engineer sanity-checks are service quantities; the two ultimate combinations are there for when the frame is being sized. Whichever is chosen, \`Dead factor\` and \`Live factor\` are published, so a number downstream can always be traced to the combination it came from.

DIMENSIONS AT THE DEFAULTS: 150 mm, 3.75 kN/m² self weight, 1.5 finishes, 3.0 imposed → 8.25 kN/m² at service.

WHAT THIS CANNOT DO. No bending analysis of the slab itself — no moment coefficients, no reinforcement design, no punching shear, no deflection calculation; \`Span / depth\` is the only sizing check and it is a rule of thumb. Openings are not deducted. The reinforcement figure is a rate per cubic metre for early quantities, not a schedule.`,
};
