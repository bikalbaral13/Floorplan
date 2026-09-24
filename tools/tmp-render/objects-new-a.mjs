/** STEP 5, part A — the six objects whose absence reads as "computer-generated" before anything
 *  else does: the switches, the sockets, the cornice, the shadow gap, the grille and the pelmet.
 *
 *  None of these is interesting. That is the point. A room with no switch plate and no socket is a
 *  showroom photograph of a set, and a viewer registers it long before they could name why.
 */
import { FRAME, FIT, ANCHOR, KERNEL, MAPW, solid, plan, tubes, box } from "../tmp-pobj/common.mjs";
import { rng, sel, chk, txt } from "../tmp-light/patch.mjs";

const body = (parts) => parts.filter(Boolean).join("\n");
const WORLD_ORIGIN = `_wcx = _cu * _ux + _cv * _vx
_wcy = _cu * _uy + _cv * _vy`;

const FINISH = (v) => sel("finish", "Finish", v, ["Matt white", "Brushed steel", "Brass", "Matt black", "Light oak"]);
const FINISH_CODE = "finishCode = finish == 'Matt white' ? 0 : (finish == 'Brushed steel' ? 1 : (finish == 'Brass' ? 2 : (finish == 'Matt black' ? 3 : 4)))";

/* ── SWITCH PLATE ──────────────────────────────────────────────────────────────────────────── */
export const switchPlate = {
  id: "switch-plate-with-math", file: "switch-plate", name: "Switch Plate",
  hostKind: "node", category: "Architectural",
  title: "Switch Plate — the thing whose absence you notice without noticing",
  icon: ["M6 4h12v16H6z", "M10 9h4v6h-4z"],
  show: ["Gangs", "Rocker pitch (m)"],
  props: [
    rng("gangs", "Gangs", 2, 1, 6, 1),
    rng("plateHeight", "Plate height", 0.086, 0.06, 0.2, 0.001),
    rng("gangWidth", "Width per gang", 0.086, 0.04, 0.12, 0.001),
    rng("plateDepth", "Plate proud of the wall", 0.008, 0.001, 0.03, 0.0005),
    rng("rockerWidth", "Rocker width", 0.03, 0.012, 0.08, 0.001),
    rng("rockerHeight", "Rocker height", 0.05, 0.02, 0.14, 0.001),
    rng("rockerProud", "Rocker proud of the plate", 0.004, 0, 0.02, 0.0005),
    rng("mountHeight", "Centre height", 1.15, 0.2, 2.2, 0.01),
    FINISH("Matt white"),
  ],
  expr: body([
    "_natL = gangWidth * gangs",
    FRAME, FIT,
    "_n = max(1, round(gangs))",
    "_gw = gangWidth * _s",
    "_pw = _gw * _n",
    "_ph = plateHeight * _s",
    "_pd = plateDepth * _s",
    "_bodyL = _pw",
    "_bodyW = _pd",
    ANCHOR, WORLD_ORIGIN,
    "_mz = mountHeight * _s",
    "# A plate sits ON the wall, so v runs out of it: the wall face is the back of the plate.",
    "_v0 = 0 - _pd / 2",
    "_v1 = _pd / 2",
    `_PLATE = ${box("0 - _pw / 2", "_v0", "_pw / 2", "_v1", "_mz - _ph / 2", "_mz + _ph / 2", 1)}`,
    "_k = arange(_n)",
    "_cu0 = 0 - _pw / 2 + (_k + 0.5) * _gw",
    "_rw = min(rockerWidth * _s, _gw * 0.8) / 2",
    "_rh = min(rockerHeight * _s, _ph * 0.8) / 2",
    "_rp = rockerProud * _s",
    "_one = ones(_n, 1)",
    "_ROCK = hcat(_cu0 - _rw, _v1 * _one, _cu0 + _rw, _v1 * _one, _cu0 + _rw, (_v1 + _rp) * _one, _cu0 - _rw, (_v1 + _rp) * _one, (_mz - _rh) * _one, (_mz + _rh) * _one, 2 * _one)",
    "Q = vcat(_PLATE, _ROCK)",
    KERNEL, MAPW,
    solid("Plate3D", 1), solid("Rockers3D", 2),
    plan("PlatePlan", 1),
    "gangsUsed = _n",
    "rockerPitch = _gw",
    "plateWidth = _pw",
    "plateTall = _ph",
    "centreHeight = _mz",
    "topOfPlate = _mz + _ph / 2",
    "proudOfWall = _pd + _rp",
    FINISH_CODE,
  ]),
  outputs: [
    { from: "Plate3D", label: "Plate — solid" }, { from: "Rockers3D", label: "Rockers — solid" },
    { from: "PlatePlan", label: "Plate — plan" },
    { from: "gangsUsed", label: "Gangs" }, { from: "rockerPitch", label: "Rocker pitch (m)" },
    { from: "plateWidth", label: "Plate width (m)" }, { from: "plateTall", label: "Plate height (m)" },
    { from: "centreHeight", label: "Centre height (m)" }, { from: "topOfPlate", label: "Top of plate (m)" },
    { from: "proudOfWall", label: "Proud of the wall (m)" }, { from: "finishCode", label: "Finish" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [{ id: "p2_plate", from: "PlatePlan", kind: "polygon", name: "Plate", color: "#e7e5e4", layer: "Electrical", show: true }],
  prims3d: [
    { id: "p3_plate", from: "Plate3D", kind: "polyhedron", name: "Plate", color: "#f5f5f4", layer: "Electrical", x: 0, y: 0, z: 0, show: true },
    { id: "p3_rock", from: "Rockers3D", kind: "polyhedron", name: "Rockers", color: "#fafaf9", layer: "Electrical", x: 0, y: 0, z: 0, show: true },
  ],
  text: [txt("materialPath", "Material (Library/Materials/…)", "Finishes/paint-eggshell.json"),
         txt("finishes", "Per-row finishes (Row=path; …)", "Rockers=Finishes/paint-eggshell.json"),
         txt("material", "Material", "matt white moulded plate, soft-edge rockers"),
         txt("semantics", "Semantics", "ordinary wall switch at handle height, unremarkable")],
  description: `A parametric SWITCH PLATE on the six-node spine.

DROP IT ON A NODE on a wall, at handle height.

IT IS NOT INTERESTING AND THAT IS THE POINT. A room with no switch plate is a set, not a room, and a viewer registers that long before they could name it. The same is true of the socket, the grille and the shadow gap: the whole of part A exists to remove a signal, not to add one.

GANGS DRIVE THE WIDTH, not the other way round. A 2-gang plate is two 86 mm modules, so \`rocker pitch\` is the gang width and the rockers land on it by construction — there is no separate spacing to get wrong.

DIMENSIONS AT THE DEFAULTS: a 2-gang 172 x 86 mm plate at 1.15 m, 8 mm proud, rockers 4 mm proud of that.`,
};

/* ── SOCKET OUTLET ─────────────────────────────────────────────────────────────────────────── */
export const socketOutlet = {
  id: "socket-outlet-with-math", file: "socket-outlet", name: "Socket Outlet",
  hostKind: "node", category: "Architectural",
  title: "Socket Outlet — plate, apertures and whether it is switched",
  icon: ["M4 7h16v10H4z", "M9 11h.01", "M15 11h.01", "M12 14h.01"],
  show: ["Outlets", "Centre height (m)"],
  props: [
    rng("outlets", "Outlets", 2, 1, 4, 1),
    rng("plateHeight", "Plate height", 0.086, 0.06, 0.2, 0.001),
    rng("outletWidth", "Width per outlet", 0.073, 0.04, 0.12, 0.001),
    rng("plateDepth", "Plate proud of the wall", 0.01, 0.001, 0.04, 0.0005),
    rng("apertureDia", "Aperture", 0.026, 0.01, 0.06, 0.001),
    rng("mountHeight", "Centre height", 0.3, 0.05, 1.6, 0.01),
    chk("switched", "Switched", true),
    chk("usb", "USB module", false),
    FINISH("Matt white"),
  ],
  expr: body([
    "_natL = outletWidth * outlets",
    FRAME, FIT,
    "_n = max(1, round(outlets))",
    "_ow = outletWidth * _s",
    "_pw = _ow * _n",
    "_ph = plateHeight * _s",
    "_pd = plateDepth * _s",
    "_bodyL = _pw",
    "_bodyW = _pd",
    ANCHOR, WORLD_ORIGIN,
    "_mz = mountHeight * _s",
    "_v0 = 0 - _pd / 2",
    "_v1 = _pd / 2",
    `_PLATE = ${box("0 - _pw / 2", "_v0", "_pw / 2", "_v1", "_mz - _ph / 2", "_mz + _ph / 2", 1)}`,
    "# The apertures are drawn as a shallow RECESS, not a hole. There is no boolean here, and a dark",
    "# set-back face reads as a socket at every distance a socket is ever seen from.",
    "_k = arange(_n)",
    "_cu0 = 0 - _pw / 2 + (_k + 0.5) * _ow",
    "_ad = min(apertureDia * _s, _ow * 0.5) / 2",
    "_one = ones(_n, 1)",
    "_APER = hcat(_cu0 - _ad, (_v1 - _pd * 0.45) * _one, _cu0 + _ad, (_v1 - _pd * 0.45) * _one, _cu0 + _ad, _v1 * _one, _cu0 - _ad, _v1 * _one, (_mz - _ad) * _one, (_mz + _ad) * _one, 2 * _one)",
    "_sw = switched > 0 ? 1 : 0",
    "_rw = _ow * 0.16",
    "_rh = _ph * 0.22",
    "_SWr = hcat(_cu0 - _rw, _v1 * _one, _cu0 + _rw, _v1 * _one, _cu0 + _rw, (_v1 + 0.003 * _s) * _one, _cu0 - _rw, (_v1 + 0.003 * _s) * _one, (_mz + _ph / 2 - _rh - 0.006 * _s) * _one, (_mz + _ph / 2 - 0.006 * _s) * _one, 3 * _one)",
    "_SW = _sw > 0 ? _SWr : zeros(0, 11)",
    "Q = vcat(_PLATE, _APER, _SW)",
    KERNEL, MAPW,
    solid("Plate3D", 1), solid("Apertures3D", 2), solid("Switches3D", 3),
    plan("PlatePlan", 1),
    "outletsUsed = _n",
    "plateWidth = _pw",
    "centreHeight = _mz",
    "isSwitched = _sw",
    "hasUsb = usb > 0 ? 1 : 0",
    "proudOfWall = _pd",
    FINISH_CODE,
  ]),
  outputs: [
    { from: "Plate3D", label: "Plate — solid" }, { from: "Apertures3D", label: "Apertures — solid" },
    { from: "Switches3D", label: "Switches — solid" }, { from: "PlatePlan", label: "Plate — plan" },
    { from: "outletsUsed", label: "Outlets" }, { from: "plateWidth", label: "Plate width (m)" },
    { from: "centreHeight", label: "Centre height (m)" }, { from: "isSwitched", label: "Switched" },
    { from: "hasUsb", label: "USB module" }, { from: "proudOfWall", label: "Proud of the wall (m)" },
    { from: "finishCode", label: "Finish" }, { from: "scale", label: "Fit scale" },
  ],
  prims2d: [{ id: "p2_plate", from: "PlatePlan", kind: "polygon", name: "Plate", color: "#e7e5e4", layer: "Electrical", show: true }],
  prims3d: [
    { id: "p3_plate", from: "Plate3D", kind: "polyhedron", name: "Plate", color: "#f5f5f4", layer: "Electrical", x: 0, y: 0, z: 0, show: true },
    { id: "p3_aper", from: "Apertures3D", kind: "polyhedron", name: "Apertures", color: "#3f3f46", layer: "Electrical", x: 0, y: 0, z: 0, show: true },
    { id: "p3_sw", from: "Switches3D", kind: "polyhedron", name: "Switches", color: "#fafaf9", layer: "Electrical", x: 0, y: 0, z: 0, show: true },
  ],
  text: [txt("materialPath", "Material (Library/Materials/…)", "Finishes/paint-eggshell.json"),
         txt("finishes", "Per-row finishes (Row=path; …)", "Apertures=Metal/powder-coat.json"),
         txt("material", "Material", "matt white moulded plate, dark apertures"),
         txt("semantics", "Semantics", "skirting-level power outlet, ordinary, unremarkable")],
  description: `A parametric SOCKET OUTLET on the six-node spine.

DROP IT ON A NODE on a wall, near the skirting.

THE APERTURES ARE A RECESS, NOT A HOLE. There is no boolean on this spine, and a dark face set back by half the plate depth reads as a socket at every distance a socket is ever seen from — which is to say, never close.

DIMENSIONS AT THE DEFAULTS: a twin 146 x 86 mm plate at 300 mm, switched, 10 mm proud.`,
};

/* ── CORNICE ───────────────────────────────────────────────────────────────────────────────── */
export const cornice = {
  id: "cornice-with-math", file: "cornice", name: "Cornice",
  hostKind: "segment", category: "Architectural",
  title: "Cornice — the wall-to-ceiling junction, stepped, with its own girth",
  icon: ["M3 6h18", "M3 6v4", "M6 10h15", "M6 10v3", "M9 13h12"],
  show: ["Developed girth (m)", "Steps"],
  props: [
    rng("length", "Run length", 3, 0.1, 30, 0.01),
    sel("profile", "Profile", "Stepped", ["Square", "Stepped", "Cove", "Shadow"]),
    rng("projection", "Projection from the wall", 0.06, 0.01, 0.4, 0.005),
    rng("drop", "Drop below the ceiling", 0.08, 0.01, 0.6, 0.005),
    rng("steps", "Steps", 2, 1, 5, 1),
    rng("ceilingHeight", "Ceiling soffit", 2.9, 2, 8, 0.01),
  ],
  expr: body([
    "_natL = length",
    FRAME, FIT,
    "_Ln = length * _s",
    "_pj = projection * _s",
    "_dr = drop * _s",
    "_cz = ceilingHeight * _s",
    "_bodyL = _Ln",
    "_bodyW = _pj",
    ANCHOR, WORLD_ORIGIN,
    "_vWall = 0 - _pj / 2",
    "_isSq = profile == 'Square'",
    "_isShadow = profile == 'Shadow'",
    "# A cornice is a STAIRCASE turned on its side: each step comes a little further off the wall and",
    "# a little further down. Square is that with one step; Cove is the same steps read as an",
    "# approximated curve, because a quad kernel cannot draw an arc and pretending otherwise would",
    "# put a faceted quarter-round in the model and call it a cove.",
    "_ns = _isSq ? 1 : max(1, round(steps))",
    "_k = arange(_ns)",
    "_one = ones(_ns, 1)",
    "_fu = (_k + 1) / _ns",
    "_fd = _isShadow ? (_k * 0 + 1) : _fu",
    "_sv1 = _vWall + _pj * _fu",
    "_sz0 = _cz - _dr * _fd",
    "_STEP = hcat(0 - _Ln / 2 * _one, _vWall * _one, _Ln / 2 * _one, _vWall * _one, _Ln / 2 * _one, _sv1, 0 - _Ln / 2 * _one, _sv1, _sz0, _cz * _one, 1 * _one)",
    "Q = _STEP",
    KERNEL, MAPW,
    solid("Cornice3D", 1),
    plan("CornicePlan", 1),
    "runLength = _Ln",
    "stepsUsed = _ns",
    "projectionUsed = _pj",
    "dropUsed = _dr",
    "ceilingLevel = _cz",
    "bottomOfCornice = _cz - _dr",
    "# Developed girth: unroll the profile and this is how wide a strip of paint or plaster it takes.",
    "# A cornice is quoted in metres run but bought in girth, and the two differ by a factor of the",
    "# profile — which is exactly the number a schedule cannot work out from the plan.",
    "girth = _pj + _dr + (_ns > 1 ? (_pj + _dr) * (_ns - 1) / _ns : 0)",
    "paintArea = girth * _Ln",
    "profileCode = profile == 'Square' ? 0 : (profile == 'Stepped' ? 1 : (profile == 'Cove' ? 2 : 3))",
  ]),
  outputs: [
    { from: "Cornice3D", label: "Cornice — solid" }, { from: "CornicePlan", label: "Cornice — plan" },
    { from: "runLength", label: "Run length (m)" }, { from: "stepsUsed", label: "Steps" },
    { from: "projectionUsed", label: "Projection (m)" }, { from: "dropUsed", label: "Drop (m)" },
    { from: "ceilingLevel", label: "Ceiling level (m)" }, { from: "bottomOfCornice", label: "Bottom of cornice (m)" },
    { from: "girth", label: "Developed girth (m)" }, { from: "paintArea", label: "Paint area (m²)" },
    { from: "profileCode", label: "Profile" }, { from: "scale", label: "Fit scale" },
  ],
  prims2d: [{ id: "p2_corn", from: "CornicePlan", kind: "polygon", name: "Cornice", color: "#e7e5e4", layer: "Architectural", show: true }],
  prims3d: [{ id: "p3_corn", from: "Cornice3D", kind: "polyhedron", name: "Cornice", color: "#f5f5f4", layer: "Architectural", x: 0, y: 0, z: 0, show: true }],
  text: [txt("materialPath", "Material (Library/Materials/…)", "Finishes/plaster.json"),
         txt("finishes", "Per-row finishes (Row=path; …)", ""),
         txt("material", "Material", "plaster cornice, painted to match the ceiling"),
         txt("semantics", "Semantics", "crisp modern stepped cornice, shallow, painted white")],
  description: `A parametric CORNICE on the six-node spine.

DROP IT ON A SEGMENT — a wall. It closes the wall-to-ceiling junction, which in every render so far has been a bare arris where two flat planes meet at exactly 90 degrees.

A CORNICE IS A STAIRCASE ON ITS SIDE. Each step comes further off the wall and further down, so one parameterisation covers Square (one step), Stepped (n) and Cove (n read as an approximated curve). It does NOT draw an arc: a quad kernel cannot, and a faceted quarter-round called a cove would be a lie in the model.

DEVELOPED GIRTH IS THE NUMBER A SCHEDULE CANNOT WORK OUT. A cornice is quoted in metres run and bought in girth, and the two differ by the profile.

DIMENSIONS AT THE DEFAULTS: a 3 m run, 60 mm projection, 80 mm drop, two steps under a 2.9 m ceiling.`,
};

/* ── SHADOW GAP ────────────────────────────────────────────────────────────────────────────── */
export const shadowGap = {
  id: "shadow-gap-with-math", file: "shadow-gap", name: "Shadow Gap",
  hostKind: "segment", category: "Architectural",
  title: "Shadow Gap — a recessed reveal, which is a LINE of dark and nothing else",
  icon: ["M3 8h18", "M3 12h18", "M3 8v4", "M21 8v4"],
  show: ["Run length (m)", "Reveal depth (m)"],
  props: [
    rng("length", "Run length", 3, 0.1, 30, 0.01),
    rng("gapHeight", "Gap height", 0.012, 0.004, 0.06, 0.001),
    rng("gapDepth", "Reveal depth", 0.018, 0.004, 0.08, 0.001),
    sel("position", "Position", "Wall base", ["Wall base", "Wall head", "Free"]),
    rng("level", "Level (Free)", 1.2, 0, 8, 0.01),
    rng("ceilingHeight", "Ceiling soffit", 2.9, 2, 8, 0.01),
  ],
  expr: body([
    "_natL = length",
    FRAME, FIT,
    "_Ln = length * _s",
    "_gh = gapHeight * _s",
    "_gd = gapDepth * _s",
    "_cz = ceilingHeight * _s",
    "_bodyL = _Ln",
    "_bodyW = _gd",
    ANCHOR, WORLD_ORIGIN,
    "_isBase = position == 'Wall base'",
    "_isHead = position == 'Wall head'",
    "_z0 = _isBase ? 0 : (_isHead ? (_cz - _gh) : (level * _s))",
    "# The gap is drawn as a box SET BACK into the wall, not as a subtraction. What a shadow gap",
    "# actually is, optically, is a surface the light cannot reach — and a recessed dark face is that",
    "# surface. Cutting a hole would need a boolean this spine does not have, and would look the same.",
    "_vBack = 0 - _gd / 2",
    "_vFront = _vBack + _gd",
    `_GAP = ${box("0 - _Ln / 2", "_vBack", "_Ln / 2", "_vFront", "_z0", "_z0 + _gh", 1)}`,
    "Q = _GAP",
    KERNEL, MAPW,
    solid("Gap3D", 1),
    plan("GapPlan", 1),
    "runLength = _Ln",
    "gapHeightUsed = _gh",
    "revealDepth = _gd",
    "gapBottom = _z0",
    "gapTop = _z0 + _gh",
    "positionCode = _isBase ? 0 : (_isHead ? 1 : 2)",
    "# How deep the shadow reads. A gap wider than it is deep is a groove with light in it; the",
    "# ratio is the whole design, and under about 1 it stops being a shadow gap.",
    "depthRatio = _gh > 0.0001 ? (_gd / _gh) : 0",
    "readsAsShadow = _gd >= _gh ? 1 : 0",
  ]),
  outputs: [
    { from: "Gap3D", label: "Gap — solid" }, { from: "GapPlan", label: "Gap — plan" },
    { from: "runLength", label: "Run length (m)" }, { from: "gapHeightUsed", label: "Gap height (m)" },
    { from: "revealDepth", label: "Reveal depth (m)" }, { from: "gapBottom", label: "Gap bottom (m)" },
    { from: "gapTop", label: "Gap top (m)" }, { from: "positionCode", label: "Position" },
    { from: "depthRatio", label: "Depth / height" }, { from: "readsAsShadow", label: "Reads as a shadow" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [{ id: "p2_gap", from: "GapPlan", kind: "polygon", name: "Shadow gap", color: "#44403c", layer: "Architectural", show: true }],
  prims3d: [{ id: "p3_gap", from: "Gap3D", kind: "polyhedron", name: "Shadow gap", color: "#292524", layer: "Architectural", x: 0, y: 0, z: 0, show: true }],
  text: [txt("materialPath", "Material (Library/Materials/…)", "Finishes/paint-eggshell.json"),
         txt("finishes", "Per-row finishes (Row=path; …)", ""),
         txt("material", "Material", "painted reveal, matt black inside"),
         txt("semantics", "Semantics", "crisp recessed shadow line where wall meets floor")],
  description: `A parametric SHADOW GAP on the six-node spine.

DROP IT ON A SEGMENT. It is the modern alternative to a skirting: a recessed line where the wall stops short of the floor.

IT IS DRAWN AS A RECESS, NOT A CUT. What a shadow gap IS, optically, is a surface the light cannot reach — and a dark face set back into the wall is exactly that surface. A boolean would look identical and this spine has none.

DEPTH OVER HEIGHT IS THE DESIGN. Deeper than it is tall and it reads black; shallower and it is a groove with light in it, which is a detail that failed. \`readsAsShadow\` says which you have.

DIMENSIONS AT THE DEFAULTS: a 3 m run, 12 mm tall, 18 mm deep at the wall base — a ratio of 1.5.`,
};

/* ── AC GRILLE ─────────────────────────────────────────────────────────────────────────────── */
export const acGrille = {
  id: "ac-grille-with-math", file: "ac-grille", name: "AC Grille",
  hostKind: "node", category: "Architectural",
  title: "AC Grille — a linear slot or a square diffuser, with its free area",
  icon: ["M4 8h16v8H4z", "M7 8v8", "M10 8v8", "M13 8v8", "M16 8v8"],
  show: ["Blades", "Free area (m²)"],
  props: [
    sel("grilleType", "Type", "Linear slot", ["Linear slot", "Square diffuser", "Return air"]),
    rng("grilleLength", "Length", 0.9, 0.15, 3, 0.01),
    rng("grilleWidth", "Width", 0.12, 0.05, 0.9, 0.005),
    rng("frameWidth", "Frame", 0.018, 0.005, 0.06, 0.001),
    rng("frameDepth", "Frame depth", 0.02, 0.005, 0.1, 0.001),
    rng("blades", "Blades", 9, 2, 60, 1),
    rng("bladeThk", "Blade thickness", 0.004, 0.001, 0.02, 0.0005),
    rng("ceilingHeight", "Ceiling soffit", 2.9, 2, 8, 0.01),
  ],
  expr: body([
    "_natL = grilleLength",
    FRAME, FIT,
    "_gl = grilleLength * _s",
    "_isSq = grilleType == 'Square diffuser'",
    "_gw = _isSq ? _gl : (grilleWidth * _s)",
    "_fw = min(frameWidth * _s, min(_gl, _gw) / 4)",
    "_fd = frameDepth * _s",
    "_cz = ceilingHeight * _s",
    "_bodyL = _gl",
    "_bodyW = _gw",
    ANCHOR, WORLD_ORIGIN,
    "# The frame is four bars, not a ring with a hole: there is no boolean, and four bars ARE a frame.",
    `_F1 = ${box("0 - _gl / 2", "0 - _gw / 2", "_gl / 2", "0 - _gw / 2 + _fw", "_cz - _fd", "_cz", 1)}`,
    `_F2 = ${box("0 - _gl / 2", "_gw / 2 - _fw", "_gl / 2", "_gw / 2", "_cz - _fd", "_cz", 1)}`,
    `_F3 = ${box("0 - _gl / 2", "0 - _gw / 2 + _fw", "0 - _gl / 2 + _fw", "_gw / 2 - _fw", "_cz - _fd", "_cz", 1)}`,
    `_F4 = ${box("_gl / 2 - _fw", "0 - _gw / 2 + _fw", "_gl / 2", "_gw / 2 - _fw", "_cz - _fd", "_cz", 1)}`,
    "_nb = max(2, round(blades))",
    "_k = arange(_nb)",
    "_one = ones(_nb, 1)",
    "_inner = _gl - 2 * _fw",
    "_pitch = _inner / _nb",
    "_bt = min(bladeThk * _s, _pitch * 0.8)",
    "_bu = 0 - _gl / 2 + _fw + (_k + 0.5) * _pitch",
    "# The blades are stepped in z rather than rotated: the quad kernel sweeps a plan quad straight",
    "# up, so a tilted louvre is not expressible. Read from below — which is the only way a ceiling",
    "# grille is ever read — a stagger and a true tilt are indistinguishable.",
    "_stagger = _fd * 0.35",
    "_bz0 = _cz - _fd - _stagger * (_k - _nb / 2) / max(1, _nb)",
    "_BL = hcat(_bu - _bt / 2, (0 - _gw / 2 + _fw) * _one, _bu + _bt / 2, (0 - _gw / 2 + _fw) * _one, _bu + _bt / 2, (_gw / 2 - _fw) * _one, _bu - _bt / 2, (_gw / 2 - _fw) * _one, _bz0, (_bz0 + _fd * 0.6), 2 * _one)",
    "Q = vcat(_F1, _F2, _F3, _F4, _BL)",
    KERNEL, MAPW,
    solid("Frame3D", 1), solid("Blades3D", 2),
    plan("FramePlan", 1),
    "bladesUsed = _nb",
    "bladePitch = _pitch",
    "grilleLengthUsed = _gl",
    "grilleWidthUsed = _gw",
    "faceArea = _gl * _gw",
    "# Free area: what is left once the frame and the blades have taken their share. It is the only",
    "# number an air-side engineer asks a grille for, and it falls straight out of the geometry.",
    "freeArea = max(0, (_gl - 2 * _fw) * (_gw - 2 * _fw) - _nb * _bt * (_gw - 2 * _fw))",
    "freeAreaRatio = faceArea > 0.0001 ? (freeArea / faceArea) : 0",
    "ceilingLevel = _cz",
    "dropBelowSoffit = _fd",
    "typeCode = grilleType == 'Linear slot' ? 0 : (grilleType == 'Square diffuser' ? 1 : 2)",
  ]),
  outputs: [
    { from: "Frame3D", label: "Frame — solid" }, { from: "Blades3D", label: "Blades — solid" },
    { from: "FramePlan", label: "Frame — plan" },
    { from: "bladesUsed", label: "Blades" }, { from: "bladePitch", label: "Blade pitch (m)" },
    { from: "grilleLengthUsed", label: "Length (m)" }, { from: "grilleWidthUsed", label: "Width (m)" },
    { from: "faceArea", label: "Face area (m²)" }, { from: "freeArea", label: "Free area (m²)" },
    { from: "freeAreaRatio", label: "Free area ratio" }, { from: "ceilingLevel", label: "Ceiling level (m)" },
    { from: "dropBelowSoffit", label: "Drop below soffit (m)" }, { from: "typeCode", label: "Type" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [{ id: "p2_frame", from: "FramePlan", kind: "polygon", name: "Grille", color: "#d6d3d1", layer: "MEP", show: true }],
  prims3d: [
    { id: "p3_frame", from: "Frame3D", kind: "polyhedron", name: "Frame", color: "#e7e5e4", layer: "MEP", x: 0, y: 0, z: 0, show: true },
    { id: "p3_blades", from: "Blades3D", kind: "polyhedron", name: "Blades", color: "#a8a29e", layer: "MEP", x: 0, y: 0, z: 0, show: true },
  ],
  text: [txt("materialPath", "Material (Library/Materials/…)", "Metal/aluminium-anodised.json"),
         txt("finishes", "Per-row finishes (Row=path; …)", "Blades=Metal/powder-coat.json"),
         txt("material", "Material", "extruded aluminium frame, powder-coated blades"),
         txt("semantics", "Semantics", "discreet linear ceiling slot, matched to the ceiling")],
  description: `A parametric AC GRILLE on the six-node spine.

DROP IT ON A NODE in the ceiling. Every real room has one and no render so far has had one.

THE BLADES ARE STEPPED IN Z, NOT ROTATED. The quad kernel sweeps a plan quad straight up, so a tilted louvre is not expressible on this spine. Read from below — the only way a ceiling grille is ever read — a stagger and a true tilt are indistinguishable, and pretending to a tilt the geometry does not have would be worse than saying so.

FREE AREA IS THE ONE NUMBER AN AIR-SIDE ENGINEER ASKS FOR, and it falls straight out of the frame and the blade count.

DIMENSIONS AT THE DEFAULTS: a 900 x 120 mm linear slot, 9 blades at 96 mm, 0.108 m² face and about 0.07 m² free.`,
};

/* ── CURTAIN PELMET ────────────────────────────────────────────────────────────────────────── */
export const curtainPelmet = {
  id: "curtain-pelmet-with-math", file: "curtain-pelmet", name: "Curtain Pelmet",
  hostKind: "segment", category: "Architectural",
  title: "Curtain Pelmet — the box that hides the track, and can hide a strip too",
  icon: ["M3 5h18v5H3z", "M5 10v9", "M19 10v9", "M8 10v3", "M16 10v3"],
  show: ["Run length (m)", "Clear opening (m)"],
  props: [
    rng("length", "Run length", 2.4, 0.3, 20, 0.01),
    rng("faceDrop", "Face drop", 0.18, 0.05, 0.6, 0.005),
    rng("pelmetDepth", "Depth from the wall", 0.14, 0.05, 0.6, 0.005),
    rng("boardThk", "Board thickness", 0.018, 0.006, 0.04, 0.001),
    rng("ceilingHeight", "Ceiling soffit", 2.9, 2, 8, 0.01),
    rng("headClearance", "Drop below the ceiling", 0, 0, 1, 0.005),
    chk("returnEnds", "Return ends", true),
    chk("closedTop", "Closed top", false),
    chk("ledLip", "Conceal a strip behind the face", true),
  ],
  expr: body([
    "_natL = length",
    FRAME, FIT,
    "_Ln = length * _s",
    "_fd = faceDrop * _s",
    "_pd = pelmetDepth * _s",
    "_bt = min(boardThk * _s, _pd / 3)",
    "_cz = ceilingHeight * _s - headClearance * _s",
    "_bodyL = _Ln",
    "_bodyW = _pd",
    ANCHOR, WORLD_ORIGIN,
    "_vWall = 0 - _pd / 2",
    "_vFace = _pd / 2",
    "_z0 = _cz - _fd",
    `_FACE = ${box("0 - _Ln / 2", "_vFace - _bt", "_Ln / 2", "_vFace", "_z0", "_cz", 1)}`,
    `_E1 = ${box("0 - _Ln / 2", "_vWall", "0 - _Ln / 2 + _bt", "_vFace", "_z0", "_cz", 2)}`,
    `_E2 = ${box("_Ln / 2 - _bt", "_vWall", "_Ln / 2", "_vFace", "_z0", "_cz", 2)}`,
    "_ENDS = returnEnds > 0 ? vcat(_E1, _E2) : zeros(0, 11)",
    `_TOPr = ${box("0 - _Ln / 2", "_vWall", "_Ln / 2", "_vFace", "_cz - _bt", "_cz", 3)}`,
    "_TOP = closedTop > 0 ? _TOPr : zeros(0, 11)",
    "# A pelmet that conceals a track will conceal a strip for free, and a strip behind the face",
    "# washing the curtain is the single best thing that can happen to a curtain in a render — it is",
    "# the difference between fabric and a flat grey slab.",
    "_lw = 0.012 * _s",
    `_LEDr = ${box("0 - _Ln / 2 + _bt", "_vFace - _bt - _lw", "_Ln / 2 - _bt", "_vFace - _bt", "_z0 + 0.01 * _s", "_z0 + 0.01 * _s + 0.004 * _s", 4)}`,
    "_LED = ledLip > 0 ? _LEDr : zeros(0, 11)",
    "Q = vcat(_FACE, _ENDS, _TOP, _LED)",
    KERNEL, MAPW,
    solid("Face3D", 1), solid("Ends3D", 2), solid("Top3D", 3), solid("Strip3D", 4),
    plan("PelmetPlan", 1),
    "runLength = _Ln",
    "faceDropUsed = _fd",
    "depthUsed = _pd",
    "pelmetTop = _cz",
    "pelmetBottom = _z0",
    "# What the curtain actually has to fit through once the boards are in.",
    "clearOpening = max(0, _pd - _bt - (returnEnds > 0 ? 0 : 0))",
    "clearLength = max(0, _Ln - (returnEnds > 0 ? 2 * _bt : 0))",
    "concealsStrip = ledLip > 0 ? 1 : 0",
    "boardArea = (_Ln * _fd) + (returnEnds > 0 ? 2 * _pd * _fd : 0) + (closedTop > 0 ? _Ln * _pd : 0)",
  ]),
  outputs: [
    { from: "Face3D", label: "Face — solid" }, { from: "Ends3D", label: "Returns — solid" },
    { from: "Top3D", label: "Top — solid" }, { from: "Strip3D", label: "Concealed strip — solid" },
    { from: "PelmetPlan", label: "Pelmet — plan" },
    { from: "runLength", label: "Run length (m)" }, { from: "faceDropUsed", label: "Face drop (m)" },
    { from: "depthUsed", label: "Depth (m)" }, { from: "pelmetTop", label: "Top (m)" },
    { from: "pelmetBottom", label: "Bottom (m)" }, { from: "clearOpening", label: "Clear opening (m)" },
    { from: "clearLength", label: "Clear length (m)" }, { from: "concealsStrip", label: "Conceals a strip" },
    { from: "boardArea", label: "Board area (m²)" }, { from: "scale", label: "Fit scale" },
  ],
  prims2d: [{ id: "p2_pel", from: "PelmetPlan", kind: "polygon", name: "Pelmet", color: "#e7e5e4", layer: "Architectural", show: true }],
  prims3d: [
    { id: "p3_face", from: "Face3D", kind: "polyhedron", name: "Face", color: "#f5f5f4", layer: "Architectural", x: 0, y: 0, z: 0, show: true },
    { id: "p3_ends", from: "Ends3D", kind: "polyhedron", name: "Returns", color: "#e7e5e4", layer: "Architectural", x: 0, y: 0, z: 0, show: true },
    { id: "p3_top", from: "Top3D", kind: "polyhedron", name: "Top", color: "#e7e5e4", layer: "Architectural", x: 0, y: 0, z: 0, show: true },
    { id: "p3_strip", from: "Strip3D", kind: "polyhedron", name: "Concealed strip", color: "#fde68a", layer: "Lighting", x: 0, y: 0, z: 0, show: true },
  ],
  text: [txt("materialPath", "Material (Library/Materials/…)", "Finishes/paint-eggshell.json"),
         txt("finishes", "Per-row finishes (Row=path; …)", "Concealed strip=Emissive/led-warm.json"),
         txt("material", "Material", "painted MDF pelmet, anodised channel behind the face"),
         txt("semantics", "Semantics", "concealed curtain track with a warm wash down the fabric")],
  description: `A parametric CURTAIN PELMET on the six-node spine.

DROP IT ON A SEGMENT above a window. It hides the track — and, if you let it, a strip as well.

A PELMET THAT HIDES A TRACK HIDES A STRIP FOR FREE. A strip behind the face washing down the curtain is the single best thing that can happen to a curtain in a render: it is the difference between fabric and a flat grey slab, and it costs one board and 12 mm of tape.

DIMENSIONS AT THE DEFAULTS: a 2.4 m run, 180 mm face, 140 mm deep under a 2.9 m ceiling, with returns and a concealed strip.`,
};
