import { writeFileSync } from "node:fs";
import { FRAME, FIT, ANCHOR, rng, sel, chk } from "./common.mjs";
const body = (parts) => parts.filter(Boolean).join("\n");
const WORLD_ORIGIN = `_wcx = _cu * _ux + _cv * _vx
_wcy = _cu * _uy + _cv * _vy`;

export const pendant = {
  id: "pendant-with-math",
  name: "Pendant",
  category: "Architectural",
  title: "Pendant — one Math Engine, lathed shade, cord and canopy",
  icon: ["M12 3v6", "M8 9h8l-1 10H9z", "M12 3a1 1 0 100-1 1 1 0 000 1", "M10 19h4"],
  props: [
    rng("diameter", "Shade diameter", 0.0508, 0.02, 0.6, 0.002),
    rng("bodyLength", "Shade length", 0.3048, 0.05, 1.5, 0.005),
    rng("bottomHeight", "Shade bottom elevation", 1.1684, 0.2, 3.5, 0.005),
    rng("mountHeight", "Canopy / ceiling elevation", 2.9718, 1.5, 5, 0.005),
    rng("cordRadius", "Cord radius", 0.003, 0.001, 0.02, 0.0005),
    rng("canopyRadius", "Canopy radius", 0.035, 0.01, 0.12, 0.001),
    rng("canopyHeight", "Canopy height", 0.012, 0.004, 0.06, 0.001),
    sel("shade", "Shade form", "Cylinder", ["Cylinder", "Cone", "Dome"]),
    chk("openBottom", "Opal diffuser at the bottom", true),
    rng("wallThk", "Shade wall thickness", 0.0012, 0.0005, 0.01, 0.0001),
    rng("kelvin", "Colour temperature (K)", 2700, 2200, 6500, 50),
    rng("lumens", "Lamp output (lm)", 320, 50, 3000, 10),
    chk("showCord", "Show the cord", true),
  ],
  expr: body([
    "_natL = diameter",
    FRAME,
    FIT,
    "# Every length scales with the one fit scale, so the pendant stays a pendant when it is fitted to a host.",
    "_R = diameter / 2 * _s",
    "_L = bodyLength * _s",
    "_bz = bottomHeight * _s",
    "_cz = mountHeight * _s",
    "_topZ = _bz + _L",
    "_bodyL = 2 * _R",
    "_bodyW = 2 * _R",
    ANCHOR,
    WORLD_ORIGIN,
    "# The shade is ONE revolve. Cylinder, Cone and Dome are not three bodies — they are three",
    "# (top, mid) radius pairs fed to the same profile, which always closes on the axis at both",
    "# ends so the lathe is a solid rather than a surface.",
    "_isCyl = shade == 'Cylinder'",
    "_isCone = shade == 'Cone'",
    "_rTop = _isCyl ? _R : (_isCone ? _R * 0.35 : _R * 0.2)",
    "_rMid = _isCyl ? _R : (_isCone ? _R * 0.675 : _R * 0.85)",
    "_rBot = _R",
    "_prof = vcat(hcat(0, 0), hcat(0, _rTop), hcat(_L / 2, _rMid), hcat(_L, _rBot), hcat(_L, 0))",
    "# The axis runs DOWN from the top of the shade, so profile t is depth below the top.",
    "_seg = hcat(_wcx, _wcy, _topZ, _wcx, _wcy, _topZ - 1)",
    "Shade3D = mlathe(_seg, _prof, 24)",
    "# Canopy and cord are capped cylinders — a Tube row is exactly that, so neither needs a mesh.",
    "_canR = canopyRadius * _s",
    "_canH = canopyHeight * _s",
    "_canZ = _cz - _canH",
    "Canopy3D = hcat(_wcx, _wcy, _canZ, _wcx, _wcy, _cz, _canR)",
    "_cordR = cordRadius * _s",
    "_hasCord = (showCord > 0) && (_canZ > _topZ)",
    "Cord3D = _hasCord ? hcat(_wcx, _wcy, _topZ, _wcx, _wcy, _canZ, _cordR) : zeros(0, 7)",
    "# The diffuser is a thin disc inset by the shade wall, so it reads as glowing glass in the aperture.",
    "_wt = wallThk * _s",
    "_difR = max(0.001, _rBot - _wt)",
    "_difH = max(0.002, _wt * 2)",
    "Diffuser3D = openBottom > 0 ? hcat(_wcx, _wcy, _bz, _wcx, _wcy, _bz + _difH, _difR) : zeros(0, 7)",
    "# Plan symbol — the shade circle with the canopy inside it.",
    "ShadePlan = hcat(_wcx, _wcy, _R)",
    "CanopyPlan = hcat(_wcx, _wcy, _canR)",
    "# Metrics",
    "shadeDiameter = 2 * _R",
    "shadeHeight = _L",
    "bottomElevation = _bz",
    "topElevation = _topZ",
    "dropFromCeiling = _cz - _topZ",
    "cordLength = max(0, _canZ - _topZ)",
    "apertureArea = PI * _difR * _difR",
    "colourTemperature = kelvin",
    "lampOutput = lumens",
    "apertureLuminance = lumens / max(0.0001, PI * _R * _R)",
  ]),
  outputs: [
    { from: "Shade3D", label: "Shade — solid" },
    { from: "Canopy3D", label: "Canopy — tube" },
    { from: "Cord3D", label: "Cord — tube" },
    { from: "Diffuser3D", label: "Diffuser — tube" },
    { from: "ShadePlan", label: "Shade — plan" },
    { from: "CanopyPlan", label: "Canopy — plan" },
    { from: "shadeDiameter", label: "Shade diameter (m)" },
    { from: "shadeHeight", label: "Shade height (m)" },
    { from: "bottomElevation", label: "Bottom elevation (m)" },
    { from: "topElevation", label: "Top elevation (m)" },
    { from: "dropFromCeiling", label: "Drop from ceiling (m)" },
    { from: "cordLength", label: "Cord length (m)" },
    { from: "apertureArea", label: "Aperture area (m2)" },
    { from: "colourTemperature", label: "Colour temperature (K)" },
    { from: "lampOutput", label: "Lamp output (lm)" },
    { from: "apertureLuminance", label: "Aperture luminance (lm/m2)" },
    { from: "scale", label: "Fit scale" },
  ],
  prims2d: [
    { id: "p2_shade", from: "ShadePlan", kind: "circle", name: "Shade", color: "#b45309", layer: "Pendant", radius: 0.0254, show: true },
    { id: "p2_canopy", from: "CanopyPlan", kind: "circle", name: "Canopy", color: "#78716c", layer: "Pendant", radius: 0.035, show: true },
  ],
  prims3d: [
    { id: "p3_shade", from: "Shade3D", kind: "polyhedron", name: "Shade", color: "#b08d57", layer: "Pendant", x: 0, y: 0, z: 0, show: true },
    { id: "p3_canopy", from: "Canopy3D", kind: "tube", name: "Canopy", color: "#b08d57", layer: "Pendant", radius: 0.035, x: 0, y: 0, z: 0, show: true },
    { id: "p3_cord", from: "Cord3D", kind: "tube", name: "Cord", color: "#3f3f46", layer: "Pendant", radius: 0.003, x: 0, y: 0, z: 0, show: true },
    { id: "p3_diffuser", from: "Diffuser3D", kind: "tube", name: "Diffuser", color: "#fef3c7", layer: "Pendant", radius: 0.024, x: 0, y: 0, z: 0, show: true },
  ],
  description: `A parametric PENDANT on the six-node spine — Geometry → Input Properties → Math Engine → Output Metrics → 2D Render + 3D Render.

DROP IT ON A NODE over whatever the pendant hangs above. This is the fitting the master-bedroom plan asks for and the library did not have: \`light-bulb-with-math\` hangs a bare lamp on a cord, \`chandelier-with-math\` is a multi-arm statement piece, and neither draws a slim tube shade.

THE PENDANT IS POSITIONED FROM ITS BOTTOM, NOT ITS TOP. A lighting plan specifies the height of the aperture above the floor — "bottom at 3'10"" — because that is what a person standing under it sees. So \`bottomHeight\` is the anchor, \`bodyLength\` grows the shade upward from it, and the cord takes up whatever slack is left to \`mountHeight\`. Move the ceiling and the shade does not move; only the cord gets longer. That is the opposite of the usual "drop from ceiling" parameterisation and it is the one that matches how the height gets specified.

THE SHADE IS A REVOLVE, AND IT HAS TO BE. The attached-object runtime resolves only Polyhedron, Loft, Tube and Ring; a Cylinder row carries its radius in a field, so nothing the Math Engine computes could drive it. The shade is therefore \`mlathe\` over a five-point profile that closes on the axis at both ends — which is what makes it a solid rather than a surface.

THREE FORMS, ONE BODY. Cylinder, Cone and Dome are three (top, mid) radius pairs fed to that same profile. The bottom radius is always the nominal one, so the aperture — the thing that reads in a render — stays put whichever form is chosen.

CANOPY AND CORD ARE TUBES along the same axis, so neither needs a mesh, and the cord vanishes cleanly when the shade is tall enough to reach the canopy.

DIMENSIONS AT THE DEFAULTS: a 51 mm brass cylinder 305 mm long, aperture at 1.168 m, canopy at 2.972 m, 1.498 m of cord, 320 lm at 2700 K.

WHAT THIS CANNOT DO. There is no light cast, no IES distribution and no transparency — the diffuser is opaque geometry tinted warm, and the luminance figure is lumens over the aperture, a spacing sanity check rather than a photometric result. The cord is vertical: there is no swag, no cluster and no off-centre hang.`,
};

