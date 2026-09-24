/** Hydraulics parametric objects for an EPANET-style pressurised pipe network.
 *
 *  Four objects on the standard six-node spine (Geometry -> Input Properties -> Math Engine ->
 *  Output Metrics -> 2D Render + 3D Render):
 *
 *    pipe       - SEGMENT-hosted. The link. Owns diameter/roughness/minor loss and the length
 *                 override, and RE-DERIVES velocity and Hazen-Williams / Darcy-Weisbach headloss
 *                 from the discharge the solver hands back, so the object is an independent check
 *                 on the solve rather than a label printed beside it.
 *    junction   - NODE-hosted. A demand node. Draws the hydraulic grade as a rod from ground level
 *                 up to the solved head, so a pressure problem is visible in the 3D view.
 *    reservoir  - NODE-hosted. An infinite fixed-head source (EPANET [RESERVOIRS]).
 *    tank       - NODE-hosted. A storage tank (EPANET [TANKS]): bottom elevation + water level,
 *                 with volume/turnover arithmetic.
 *
 *  SOLVER RESULTS ARE INPUTS. Each object takes the quantities the Pipe Network Solver computes
 *  (`flow`, `headA`/`headB`, `head`) as ordinary parameters defaulting to 0. Writing the solve back
 *  onto the components therefore needs no new plumbing - it is a parameter write - and every metric
 *  downstream (velocity, pressure, residual headloss, turnover) follows from it.
 */
import { FRAME, FIT, ANCHOR, KERNEL, MAPW, solid, plan, box, rng, sel, chk } from "../tmp-pobj/common.mjs";

const body = (parts) => parts.filter(Boolean).join("\n");

/* -- 1. PIPE ------------------------------------------------------------------------------- */
export const pipe = {
  id: "pipe-with-math",
  name: "Pipe",
  hostKind: "segment",
  category: "Hydraulics",
  title: "Pipe — one Math Engine, bore, band and the headloss re-derived from the solved flow",
  icon: ["M2 8h20", "M2 16h20", "M6 8v8", "M18 8v8"],
  props: [
    rng("diameter", "Nominal bore (mm)", 300, 15, 3000, 1),
    rng("wallThk", "Wall thickness (mm)", 6, 0.5, 100, 0.5),
    sel("formula", "Headloss formula", "Hazen-Williams", ["Hazen-Williams", "Darcy-Weisbach"]),
    rng("roughC", "Hazen-Williams C", 130, 40, 155, 1),
    rng("roughMM", "Darcy roughness (mm)", 0.05, 0.001, 10, 0.001),
    rng("minorLoss", "Minor loss sum K", 0, 0, 30, 0.05),
    sel("spanMode", "Length along host", "Fill segment", ["Fill segment", "Own length (centred)"]),
    rng("ownLength", "Own length (m)", 10, 0.1, 500, 0.1),
    rng("lengthOverride", "Hydraulic length override (m)", 0, 0, 100000, 0.1),
    rng("invert", "Axis elevation (m)", 0, -50, 200, 0.01),
    rng("flow", "Discharge from solver (L/s)", 0, -100000, 100000, 0.001),
    rng("headA", "Head at start from solver (m)", 0, -100, 5000, 0.001),
    rng("headB", "Head at end from solver (m)", 0, -100, 5000, 0.001),
  ],
  expr: body([
    "_natL = ownLength",
    FRAME, FIT,
    "# Drawn length - fill the host segment, or sit centred at its own length",
    "_fill = spanMode == 'Fill segment'",
    "_Ln = _fill ? max(0.01, _hostL - 2 * margin) : max(0.01, ownLength * _s)",
    "# Bore and outside diameter (m). The band drawn in plan is the OUTSIDE of the pipe.",
    "_di = max(0.005, diameter / 1000)",
    "_wt = max(0.0005, wallThk / 1000)",
    "_od = _di + 2 * _wt",
    "_rin = _di / 2",
    "_ro = _od / 2",
    "_bodyL = _Ln",
    "_bodyW = _od",
    ANCHOR,
    "_u0 = 0 - _Ln / 2",
    "_u1 = _Ln / 2",
    "# Bands: outside barrel, and the bore shown as a thinner centre band",
    box("_u0", "0 - _ro", "_u1", "_ro", "invert - _ro", "invert + _ro", 1).replace(/^/, "_BARREL = "),
    box("_u0", "0 - _rin", "_u1", "_rin", "invert - _rin", "invert + _rin", 2).replace(/^/, "_BORE = "),
    "Q = vcat(_BARREL, _BORE)",
    KERNEL, MAPW,
    plan("BarrelPlan", 1), plan("BorePlan", 2),
    "# 3D is a real tube, not the band's prism - a pipe is round",
    "_au = _cu + _u0",
    "_bu = _cu + _u1",
    "_pax = _au * _ux + _cv * _vx",
    "_pay = _au * _uy + _cv * _vy",
    "_pbx = _bu * _ux + _cv * _vx",
    "_pby = _bu * _uy + _cv * _vy",
    "Barrel3D = hcat(_pax, _pay, invert, _pbx, _pby, invert, _ro)",
    "Centre3D = hcat(_pax, _pay, invert, _pbx, _pby, invert, max(0.004, _ro / 8))",
    "# -- Hydraulics ------------------------------------------------------------",
    "# The HYDRAULIC length is the override when set, else the drawn length. A schematic",
    "# plan (an EPANET layout) carries true lengths as data, not as drawing distance.",
    "_Lm = lengthOverride > 0 ? lengthOverride : _Ln",
    "_area = PI * _di * _di / 4",
    "_Qm = flow / 1000",
    "_aQ = max(abs(_Qm), 1e-12)",
    "_vel = _aQ / _area",
    "_C = max(1, roughC)",
    "_hwR = 10.667 * _Lm / (pow(_C, 1.852) * pow(_di, 4.871))",
    "_hwLoss = _hwR * pow(_aQ, 1.852)",
    "# Darcy-Weisbach via Swamee-Jain, the same closure the engine solver uses",
    "_eps = max(0, roughMM) / 1000",
    "_Re = max(2000, 4 * _aQ / (PI * _di * 1.004e-6))",
    "_f = 0.25 / pow(log10(_eps / (3.7 * _di) + 5.74 / pow(_Re, 0.9)), 2)",
    "_dwLoss = 8 * _f * _Lm * _aQ * _aQ / (PI * PI * 9.81 * pow(_di, 5))",
    "_isHW = formula == 'Hazen-Williams'",
    "_friction = _isHW ? _hwLoss : _dwLoss",
    "_minor = minorLoss > 0 ? 8 * minorLoss * _aQ * _aQ / (PI * PI * 9.81 * pow(_di, 4)) : 0",
    "# -- Metrics ---------------------------------------------------------------",
    "drawnLength = _Ln",
    "hydraulicLength = _Lm",
    "boreDiameter = _di",
    "outsideDiameter = _od",
    "boreArea = _area",
    "discharge = flow",
    "velocity = _vel",
    "reynolds = _Re",
    "frictionFactor = _f",
    "frictionLoss = _friction",
    "minorLossHead = _minor",
    "headloss = _friction + _minor",
    "unitHeadloss = _Lm > 0 ? (_friction + _minor) / _Lm * 1000 : 0",
    "solverHeadloss = headA - headB",
    "headlossResidual = abs(abs(headA - headB) - (_friction + _minor))",
    "waterVolume = _area * _Lm",
    "velocityHead = _vel * _vel / (2 * 9.81)",
    "overVelocity = _vel > 3 ? 1 : 0",
  ]),
  outputs: [
    { from: "BarrelPlan", label: "Barrel — plan" },
    { from: "BorePlan", label: "Bore — plan" },
    { from: "Barrel3D", label: "Barrel — tube" },
    { from: "Centre3D", label: "Centreline — tube" },
    { from: "drawnLength", label: "Drawn length (m)" },
    { from: "hydraulicLength", label: "Hydraulic length (m)" },
    { from: "boreDiameter", label: "Bore (m)" },
    { from: "outsideDiameter", label: "Outside diameter (m)" },
    { from: "boreArea", label: "Bore area (m²)" },
    { from: "discharge", label: "Discharge (L/s)" },
    { from: "velocity", label: "Velocity (m/s)" },
    { from: "reynolds", label: "Reynolds number" },
    { from: "frictionFactor", label: "Darcy friction factor" },
    { from: "frictionLoss", label: "Friction headloss (m)" },
    { from: "minorLossHead", label: "Minor headloss (m)" },
    { from: "headloss", label: "Total headloss (m)" },
    { from: "unitHeadloss", label: "Unit headloss (m/km)" },
    { from: "solverHeadloss", label: "Solver headloss, A−B (m)" },
    { from: "headlossResidual", label: "Headloss residual (m)" },
    { from: "waterVolume", label: "Water volume (m³)" },
    { from: "velocityHead", label: "Velocity head (m)" },
    { from: "overVelocity", label: "Over 3 m/s" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_barrel", from: "BarrelPlan", kind: "polygon", name: "Barrel", color: "#0e7490", layer: "Pipe", show: true },
    { id: "p2_bore", from: "BorePlan", kind: "polygon", name: "Bore", color: "#67e8f9", layer: "Pipe", show: true },
  ],
  prims3d: [
    { id: "p3_barrel", from: "Barrel3D", kind: "tube", name: "Barrel", color: "#0e7490", layer: "Pipe", x: 0, y: 0, z: 0, show: true },
    { id: "p3_centre", from: "Centre3D", kind: "tube", name: "Centreline", color: "#a5f3fc", layer: "Pipe", x: 0, y: 0, z: 0, show: false },
  ],
  description: `A parametric PIPE — the LINK of a pressurised network — on the six-node spine.

DROP IT ON A SEGMENT. By default it fills its host ("Length along host" = Fill segment); switch to "Own length (centred)" for a spur that is shorter than the run it sits on.

THE DRAWN LENGTH AND THE HYDRAULIC LENGTH ARE DIFFERENT NUMBERS, deliberately. A network layout is a SCHEMATIC: an EPANET plan draws a 3.2 km main as a 53 mm line because the drawing is a diagram of connectivity, not a survey. So "Hydraulic length override" carries the true length as DATA and every hydraulic metric uses it; leave it at 0 and the drawn length is used instead. This is the same precedence the engine's Pipe Network Solver applies to its \`length\` role, so object and solver never disagree.

THE SOLVE COMES BACK IN AS PARAMETERS. \`Discharge from solver\`, \`Head at start\` and \`Head at end\` default to 0 and are written by the flow after the Pipe Network Solver runs. Everything hydraulic is then RE-DERIVED here from first principles — velocity from Q/A, friction from Hazen-Williams (10.667·L·Q^1.852 / C^1.852·d^4.871) or Darcy-Weisbach with Swamee-Jain, minor losses from ΣK·v²/2g. That is why \`Headloss residual\` exists: it is |H_A − H_B| minus this object's own headloss, and it should be ~0. A non-zero residual means the object's parameters and the solver's schema attributes have drifted apart.

THE BAND IS THE OUTSIDE OF THE PIPE, the inner band is the bore, and the 3D is a real tube rather than the band's prism — a pipe is round, and a rectangular prism at 300 mm reads as a duct.

DIMENSIONS AT THE DEFAULTS: 300 mm bore, 6 mm wall, C = 130, axis at 0.00 m.

WHAT THIS CANNOT DO. It is a straight pipe between two points — no bends, tees or reducers as geometry, and no pump or valve behaviour. Minor losses are a lumped ΣK, which is how EPANET models them too.`,
};

/* -- 2. JUNCTION --------------------------------------------------------------------------- */
export const junction = {
  id: "junction-with-math",
  name: "Junction",
  hostKind: "node",
  category: "Hydraulics",
  title: "Junction — demand node with the hydraulic grade drawn as a rod",
  icon: ["M12 3v18", "M7 8h10", "M12 21l-3-3", "M12 21l3-3"],
  props: [
    rng("elevation", "Ground elevation (m)", 0, -100, 3000, 0.01),
    rng("demand", "Demand (L/s)", 0, -1000, 1000, 0.001),
    rng("head", "Head from solver (m)", 0, -100, 5000, 0.001),
    rng("minPressure", "Minimum pressure required (m)", 15, 0, 200, 0.5),
    rng("markerSize", "Marker size (m)", 0.5, 0.05, 10, 0.01),
    chk("showGrade", "Draw hydraulic grade rod", true),
    rng("gradeScale", "Grade rod scale", 1, 0.01, 10, 0.01),
  ],
  expr: body([
    "_natL = markerSize",
    FRAME, FIT,
    "_ms = max(0.02, markerSize * _s)",
    "_bodyL = _ms",
    "_bodyW = _ms",
    ANCHOR,
    "_hm = _ms / 2",
    "# Marker - a square collar at ground level",
    box("0 - _hm", "0 - _hm", "_hm", "_hm", "elevation - _hm / 4", "elevation + _hm / 4", 1).replace(/^/, "_MARK = "),
    "# Hydraulic grade rod - ground level up to the solved head, scaled for legibility",
    "_press = head - elevation",
    "_rodTop = elevation + _press * max(0.01, gradeScale)",
    "_rw = _hm / 3",
    "_rz0 = min(elevation, _rodTop)",
    "_rz1 = max(elevation, _rodTop)",
    box("0 - _rw", "0 - _rw", "_rw", "_rw", "_rz0", "_rz1", 2).replace(/^/, "_RODQ = "),
    "_ROD = (showGrade > 0 && _rz1 - _rz0 > 1e-6) ? _RODQ : zeros(0, 11)",
    "Q = vcat(_MARK, _ROD)",
    KERNEL, MAPW,
    solid("Marker3D", 1), solid("Rod3D", 2),
    plan("MarkerPlan", 1),
    "# -- Metrics ---------------------------------------------------------------",
    "groundElevation = elevation",
    "nodalDemand = demand",
    "totalHead = head",
    "pressureHead = _press",
    "pressureKPa = _press * 9.81",
    "pressurePsi = _press * 1.42233",
    "pressureBar = _press * 0.0980665",
    "residualAboveMin = _press - minPressure",
    "pressureFails = _press < minPressure ? 1 : 0",
    "demandM3h = demand * 3.6",
    "hydraulicPower = abs(demand) / 1000 * 9810 * max(0, _press)",
    "markerFootprint = _ms * _ms",
  ]),
  outputs: [
    { from: "MarkerPlan", label: "Marker — plan" },
    { from: "Marker3D", label: "Marker — solid" },
    { from: "Rod3D", label: "Grade rod — solid" },
    { from: "groundElevation", label: "Ground elevation (m)" },
    { from: "nodalDemand", label: "Demand (L/s)" },
    { from: "totalHead", label: "Total head (m)" },
    { from: "pressureHead", label: "Pressure head (m)" },
    { from: "pressureKPa", label: "Pressure (kPa)" },
    { from: "pressurePsi", label: "Pressure (psi)" },
    { from: "pressureBar", label: "Pressure (bar)" },
    { from: "residualAboveMin", label: "Residual above minimum (m)" },
    { from: "pressureFails", label: "Below minimum pressure" },
    { from: "demandM3h", label: "Demand (m³/h)" },
    { from: "hydraulicPower", label: "Hydraulic power (W)" },
    { from: "markerFootprint", label: "Marker footprint (m²)" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_mark", from: "MarkerPlan", kind: "polygon", name: "Junction", color: "#1d4ed8", layer: "Junction", show: true },
  ],
  prims3d: [
    { id: "p3_mark", from: "Marker3D", kind: "polyhedron", name: "Junction", color: "#1d4ed8", layer: "Junction", x: 0, y: 0, z: 0, show: true },
    { id: "p3_rod", from: "Rod3D", kind: "polyhedron", name: "Grade rod", color: "#38bdf8", layer: "Junction", x: 0, y: 0, z: 0, show: true },
  ],
  description: `A parametric JUNCTION — the DEMAND NODE of a pressurised network — on the six-node spine.

DROP IT ON A NODE. It owns the two quantities a junction contributes to the solve (ground elevation and demand) and takes back the one the solve produces (total head).

PRESSURE IS A DERIVED NUMBER, NOT AN INPUT: pressure head = total head − ground elevation, published in m, kPa, bar and psi so the same node reads correctly to a civil engineer and to a plumbing schedule. \`Residual above minimum\` and \`Below minimum pressure\` turn that into a pass/fail against the service standard typed on the node — which is the question a distribution network is actually designed to answer.

THE GRADE ROD MAKES THE ANSWER VISIBLE. With "Draw hydraulic grade rod" on, a post rises from ground level to the solved piezometric head, so in the 3D view the hydraulic grade line reads as a row of posts whose tops should fall smoothly towards the far end of the network. A short post is a pressure problem you can see without opening a table. \`Grade rod scale\` compresses it when the head is hundreds of metres and the plan is tens.

A NEGATIVE DEMAND IS AN INFLOW, the same convention EPANET uses, and \`Hydraulic power\` uses |demand| so an injection reports the power it carries rather than a negative.

DIMENSIONS AT THE DEFAULTS: a 0.50 m collar at elevation 0.00, zero demand, 15 m minimum service pressure.

WHAT THIS CANNOT DO. No emitter (pressure-dependent) demand — the demand is fixed, as in a demand-driven EPANET run. It does not solve anything: head arrives from the Pipe Network Solver.`,
};

/* -- 3. RESERVOIR -------------------------------------------------------------------------- */
export const reservoir = {
  id: "reservoir-with-math",
  name: "Reservoir",
  hostKind: "node",
  category: "Hydraulics",
  title: "Reservoir — infinite fixed-head source, with the supply it delivers",
  icon: ["M3 8h18v10H3z", "M3 8l9-5 9 5", "M6 12h12", "M6 15h12"],
  props: [
    rng("totalHead", "Total head (m)", 100, -50, 5000, 0.01),
    rng("baseElevation", "Base elevation (m)", 0, -100, 3000, 0.01),
    rng("planSize", "Plan size (m)", 6, 0.5, 200, 0.1),
    rng("supply", "Supply from solver (L/s)", 0, -100000, 100000, 0.001),
    rng("bankThk", "Bank thickness (m)", 0.6, 0.05, 10, 0.05),
  ],
  expr: body([
    "_natL = planSize",
    FRAME, FIT,
    "_pl = max(0.2, planSize * _s)",
    "_bodyL = _pl",
    "_bodyW = _pl",
    ANCHOR,
    "_hm = _pl / 2",
    "_bt = max(0.02, bankThk * _s)",
    "_ws = max(baseElevation + 0.01, totalHead)",
    "# Water body - base up to the fixed water surface",
    box("0 - _hm", "0 - _hm", "_hm", "_hm", "baseElevation", "_ws", 1).replace(/^/, "_WATER = "),
    "# Four banks standing a little proud of the water surface",
    "_bo = _hm + _bt",
    "_bz1 = _ws + _bt",
    box("0 - _bo", "0 - _bo", "_bo", "0 - _hm", "baseElevation", "_bz1", 2).replace(/^/, "_B1 = "),
    box("0 - _bo", "_hm", "_bo", "_bo", "baseElevation", "_bz1", 2).replace(/^/, "_B2 = "),
    box("0 - _bo", "0 - _hm", "0 - _hm", "_hm", "baseElevation", "_bz1", 2).replace(/^/, "_B3 = "),
    box("_hm", "0 - _hm", "_bo", "_hm", "baseElevation", "_bz1", 2).replace(/^/, "_B4 = "),
    "_BANK = vcat(_B1, _B2, _B3, _B4)",
    "Q = vcat(_WATER, _BANK)",
    KERNEL, MAPW,
    solid("Water3D", 1), solid("Bank3D", 2),
    plan("WaterPlan", 1), plan("BankPlan", 2),
    "# -- Metrics ---------------------------------------------------------------",
    "fixedHead = _ws",
    "surfaceElevation = _ws",
    "depth = _ws - baseElevation",
    "surfaceArea = _pl * _pl",
    "supplyFlow = supply",
    "supplyM3h = supply * 3.6",
    "supplyMld = supply * 0.0864",
    // EPANET's sign, kept: a source DELIVERING to the network reports a NEGATIVE demand. So the
    // reservoir is being fed — drawing from the network — when the number is POSITIVE.
    "isDrawing = supply > 0 ? 1 : 0",
    "hydraulicPower = abs(supply) / 1000 * 9810 * max(0, _ws - baseElevation)",
    "bankFootprint = (_pl + 2 * _bt) * (_pl + 2 * _bt)",
  ]),
  outputs: [
    { from: "WaterPlan", label: "Water — plan" },
    { from: "BankPlan", label: "Bank — plan" },
    { from: "Water3D", label: "Water — solid" },
    { from: "Bank3D", label: "Bank — solid" },
    { from: "fixedHead", label: "Fixed head (m)" },
    { from: "surfaceElevation", label: "Surface elevation (m)" },
    { from: "depth", label: "Depth (m)" },
    { from: "surfaceArea", label: "Surface area (m²)" },
    { from: "supplyFlow", label: "Supply (L/s)" },
    { from: "supplyM3h", label: "Supply (m³/h)" },
    { from: "supplyMld", label: "Supply (MLD)" },
    { from: "isDrawing", label: "Drawing from network" },
    { from: "hydraulicPower", label: "Hydraulic power (W)" },
    { from: "bankFootprint", label: "Bank footprint (m²)" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_water", from: "WaterPlan", kind: "polygon", name: "Water", color: "#0ea5e9", layer: "Reservoir", show: true },
    { id: "p2_bank", from: "BankPlan", kind: "polygon", name: "Bank", color: "#475569", layer: "Reservoir", show: true },
  ],
  prims3d: [
    { id: "p3_water", from: "Water3D", kind: "polyhedron", name: "Water", color: "#0ea5e9", layer: "Reservoir", x: 0, y: 0, z: 0, show: true },
    { id: "p3_bank", from: "Bank3D", kind: "polyhedron", name: "Bank", color: "#475569", layer: "Reservoir", x: 0, y: 0, z: 0, show: true },
  ],
  description: `A parametric RESERVOIR — an INFINITE FIXED-HEAD SOURCE, EPANET's [RESERVOIRS] — on the six-node spine.

DROP IT ON A NODE. The one number that matters hydraulically is Total head: the piezometric level the network is pinned to at this point. A network with no fixed head has a singular system and cannot be solved at all, which is why the Pipe Network Solver refuses a graph without one.

TOTAL HEAD IS A LEVEL, NOT A DEPTH. It is measured in the same datum as every junction's ground elevation, so a 970 m reservoir feeding 700 m ground gives 270 m of pressure head before friction. Base elevation only says where the tank floor is drawn; raising it does not change the head, and the water body is clamped to stay at least 10 mm deep so the solid never inverts.

THE SUPPLY COMES BACK FROM THE SOLVE. EPANET reports a source's delivery as a NEGATIVE demand — flow leaving the node into the network — and this object keeps that sign: \`Drawing from network\` is 1 when the reservoir is being fed rather than supplying. \`Supply\` is republished in L/s, m³/h and MLD, because a source is sized in megalitres per day and checked in litres per second.

THE SYMBOL IS A WATER BODY IN A BANK — four walls standing one bank-thickness proud of the surface — so in plan it reads as a source rather than as another node marker.

DIMENSIONS AT THE DEFAULTS: 6.00 m square at head 100.00 m over a 0.00 m base, 0.60 m banks.

WHAT THIS CANNOT DO. The head is constant — it is a boundary condition, not a store that draws down. For a level that moves with volume, use the Tank object.`,
};

/* -- 4. TANK ------------------------------------------------------------------------------- */
export const tank = {
  id: "tank-with-math",
  name: "Tank",
  hostKind: "node",
  category: "Hydraulics",
  title: "Tank — storage with level, volume and turnover",
  icon: ["M5 7h14v13H5z", "M5 7a7 3 0 0114 0", "M5 13h14"],
  props: [
    rng("bottomElevation", "Bottom elevation (m)", 0, -100, 3000, 0.01),
    rng("initLevel", "Initial water level (m)", 3, 0, 100, 0.01),
    rng("minLevel", "Minimum level (m)", 0.5, 0, 100, 0.01),
    rng("maxLevel", "Maximum level (m)", 5, 0.1, 100, 0.01),
    rng("tankDiameter", "Diameter (m)", 12, 0.5, 100, 0.1),
    rng("netInflow", "Net inflow from solver (L/s)", 0, -100000, 100000, 0.001),
    rng("wallThk", "Wall thickness (m)", 0.25, 0.02, 3, 0.01),
  ],
  expr: body([
    "_natL = tankDiameter",
    FRAME, FIT,
    "_D = max(0.2, tankDiameter * _s)",
    "_bodyL = _D",
    "_bodyW = _D",
    ANCHOR,
    "_R = _D / 2",
    "_wt = max(0.01, wallThk * _s)",
    "_lvl = max(0, min(initLevel, maxLevel))",
    "_wz1 = bottomElevation + _lvl",
    "_shellTop = bottomElevation + max(maxLevel, _lvl) + _wt",
    "# Shell and water as tubes (a tank is round); plan as square outlines for the band",
    "_ox = _cu * _ux + _cv * _vx",
    "_oy = _cu * _uy + _cv * _vy",
    "Shell3D = hcat(_ox, _oy, bottomElevation, _ox, _oy, _shellTop, _R + _wt)",
    "Water3D = hcat(_ox, _oy, bottomElevation, _ox, _oy, max(bottomElevation + 0.001, _wz1), _R)",
    "# Plan footprint - the shell and the water as square blocks for the 2D band",
    box("0 - _R - _wt", "0 - _R - _wt", "_R + _wt", "_R + _wt", "bottomElevation", "_shellTop", 1).replace(/^/, "_SH = "),
    box("0 - _R", "0 - _R", "_R", "_R", "bottomElevation", "_wz1", 2).replace(/^/, "_WT = "),
    "Q = vcat(_SH, _WT)",
    KERNEL, MAPW,
    plan("ShellPlan", 1), plan("WaterPlan", 2),
    "# -- Metrics ---------------------------------------------------------------",
    "_area = PI * _R * _R",
    "waterLevel = _lvl",
    "waterSurfaceElevation = _wz1",
    "totalHead = _wz1",
    "planArea = _area",
    "storedVolume = _area * _lvl",
    "usableVolume = _area * max(0, maxLevel - minLevel)",
    "fullVolume = _area * maxLevel",
    "freeboard = max(0, maxLevel - _lvl)",
    "fillFraction = maxLevel > 0 ? _lvl / maxLevel : 0",
    "netInflowLps = netInflow",
    "netInflowM3h = netInflow * 3.6",
    "levelRateMh = _area > 0 ? netInflow / 1000 / _area * 3600 : 0",
    "hoursToFull = netInflow > 0 ? (_area * max(0, maxLevel - _lvl)) / (netInflow / 1000 * 3600) : 0",
    "hoursToEmpty = netInflow < 0 ? (_area * max(0, _lvl - minLevel)) / (abs(netInflow) / 1000 * 3600) : 0",
    "belowMinimum = _lvl < minLevel ? 1 : 0",
  ]),
  outputs: [
    { from: "ShellPlan", label: "Shell — plan" },
    { from: "WaterPlan", label: "Water — plan" },
    { from: "Shell3D", label: "Shell — tube" },
    { from: "Water3D", label: "Water — tube" },
    { from: "waterLevel", label: "Water level (m)" },
    { from: "waterSurfaceElevation", label: "Water surface elevation (m)" },
    { from: "totalHead", label: "Total head (m)" },
    { from: "planArea", label: "Plan area (m²)" },
    { from: "storedVolume", label: "Stored volume (m³)" },
    { from: "usableVolume", label: "Usable volume (m³)" },
    { from: "fullVolume", label: "Volume at max level (m³)" },
    { from: "freeboard", label: "Freeboard (m)" },
    { from: "fillFraction", label: "Fill fraction" },
    { from: "netInflowLps", label: "Net inflow (L/s)" },
    { from: "netInflowM3h", label: "Net inflow (m³/h)" },
    { from: "levelRateMh", label: "Level change (m/h)" },
    { from: "hoursToFull", label: "Hours to full" },
    { from: "hoursToEmpty", label: "Hours to minimum" },
    { from: "belowMinimum", label: "Below minimum level" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_shell", from: "ShellPlan", kind: "polygon", name: "Shell", color: "#334155", layer: "Tank", show: true },
    { id: "p2_water", from: "WaterPlan", kind: "polygon", name: "Water", color: "#38bdf8", layer: "Tank", show: true },
  ],
  prims3d: [
    { id: "p3_shell", from: "Shell3D", kind: "tube", name: "Shell", color: "#334155", layer: "Tank", x: 0, y: 0, z: 0, show: true },
    { id: "p3_water", from: "Water3D", kind: "tube", name: "Water", color: "#38bdf8", layer: "Tank", x: 0, y: 0, z: 0, show: true },
  ],
  description: `A parametric TANK — EPANET's [TANKS] — on the six-node spine.

DROP IT ON A NODE. A tank differs from a reservoir in exactly one way that matters: its head is not a constant you type, it is bottom elevation + water level, so it MOVES as the tank fills and empties. \`Total head\` is that sum, and it is the number a steady-state solve pins the network to when the tank is acting as the source.

THE LEVEL IS CLAMPED TO THE TANK, not merely validated: \`min(initLevel, maxLevel)\` and a floor of 0, so a level typed above the shell cannot draw water outside it or invert the solid. \`Below minimum level\` flags the operating fault instead.

VOLUMES COME FROM A CIRCULAR PLAN. Stored, usable (between min and max) and full volumes all follow from πR², so changing the diameter re-sizes the storage and the drawing together — which is the point of a parametric tank over a block with a number beside it.

TURNOVER IS THE USEFUL ANSWER. Given the net inflow the solver reports at this node, \`Level change\` is that flow over the plan area in m/h, and \`Hours to full\` / \`Hours to minimum\` say how long the current regime can continue. Each is gated on the sign of the flow, so a filling tank reports a time to full and a zero time to empty rather than a negative one.

THE SHELL AND THE WATER ARE TUBES in 3D — a tank is round — while the 2D band uses square outlines, because a grouped outline list is read EVEN-ODD and a ring drawn as two concentric circles in one row would void the shell into a hole.

DIMENSIONS AT THE DEFAULTS: 12.00 m diameter, level 3.00 m of a 5.00 m shell, 113 m² plan, 339 m³ stored, 509 m³ usable.

WHAT THIS CANNOT DO. Circular plan only, with no volume curve — a non-prismatic tank (EPANET's VolCurve) is not expressible here. The level is a parameter, not an integration: a steady-state solve reports the flow, and stepping the level over time is the caller's job.`,
};
