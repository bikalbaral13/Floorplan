/** STEPS 1c, 3 and 4 — bind materials to objects, and add the camera / environment / lighting
 *  properties the render needs and the plan currently cannot say.
 *
 *  1c  MATERIAL BINDING. Every object gains two unwired text props:
 *
 *        materialPath   "Finishes/light-oak.json"      the object's default finish
 *        finishes       "Shade=Finishes/ceramic.json; Cord=Metal/brass-polished.json"
 *
 *      ONE default plus a per-row override list, because an object is not one material — a pendant
 *      is a ceramic shade on a brass cord — and a single path per object would make every fitting
 *      monochrome. The row names are the object's own 3D Render row names, which is the same key
 *      `finishes.interior.json` already matches on, so the rules file and the plan speak the same
 *      language and a plan that says nothing still gets the rules.
 *
 *      Why text and not a Material node: `FlowToolType` is a closed union and wiring 90 objects
 *      would be 90 flow surgeries. A path in a text prop reaches nothing, exactly as `material` and
 *      `semantics` already do, and the transpiler reads it.
 *
 *  3   CAMERA. Shift (the architectural control the object has never had), near clip and a minimum
 *      clearance (how view1 got a plant in the lens), depth of field, roll, per-camera resolution
 *      and exposure, and a shot list.
 *
 *  4   LIGHTING. A gobo, warm dimming, the emissive surface as its own switch, a per-fixture group
 *      gain, and scene membership — the reason every render so far is one flat value.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { validateFlow, propsOf } from "../tmp-light/validate-flow.mjs";
import { patchFlow, rng, sel, chk, txt } from "../tmp-light/patch.mjs";

const LIVE = "tools/tmp-render/live/Objects";
const OUT = "tools/tmp-render/out/Objects";

/* ── 1c: the default finish per object, read off its own `material` prose ──────────────────── */

/** file stem -> [default material path, per-row overrides]. Anything not named here still gets the
 *  two props, with the default worked out from its category, so nothing is left unbound. */
export const FINISHES = {
  // Shell
  wall: ["Finishes/plaster.json", ""],
  room: ["Finishes/plaster.json", ""],
  "false-ceiling": ["Finishes/plaster.json", "Cove LED=Emissive/led-warm.json"],
  skirting: ["Finishes/paint-eggshell.json", ""],
  door: ["Finishes/paint-eggshell.json", "Handle=Metal/brass-polished.json; Frame=Finishes/paint-eggshell.json"],
  window: ["Finishes/paint-eggshell.json", "Glazing=Glazing/glass.json; Sill=Finishes/quartz.json"],
  opening: ["Finishes/plaster.json", ""],
  "fluted-panel": ["Finishes/light-oak.json", ""],
  "upholstered-panel": ["Fabric/boucle.json", "Frame=Finishes/light-oak.json"],
  beam: ["Masonry/concrete.json", ""],
  // Joinery
  wardrobe: ["Finishes/light-oak.json", "Mirror=Glazing/mirror.json; Grooves=Finishes/light-oak.json; End panels=Finishes/light-oak.json; Top filler=Finishes/paint-eggshell.json"],
  "tv-unit": ["Finishes/light-oak.json", "Pulls=Metal/brass-polished.json; Under-unit LED=Emissive/led-warm.json"],
  nightstand: ["Finishes/light-oak.json", "Pulls=Metal/brass-polished.json; Under-unit LED=Emissive/led-warm.json"],
  "chest-of-drawers": ["Finishes/light-oak.json", "Pulls=Metal/brass-polished.json"],
  cabinet: ["Finishes/light-oak.json", "Pulls=Metal/brass-polished.json"],
  "wall-cabinet": ["Finishes/light-oak.json", "Pulls=Metal/brass-polished.json"],
  shelf: ["Finishes/light-oak.json", ""],
  "kitchen-counter": ["Finishes/quartz.json", "Carcass=Finishes/light-oak.json"],
  "dressing-table": ["Finishes/light-oak.json", "Mirror=Glazing/mirror.json"],
  desk: ["Finishes/light-oak.json", ""],
  "shoe-rack": ["Finishes/light-oak.json", ""],
  "window-seat": ["Fabric/boucle.json", "Frame=Finishes/light-oak.json; Lid=Finishes/light-oak.json"],
  // Soft
  bed: ["Fabric/linen.json", "Headboard=Fabric/boucle.json; Plinth=Finishes/light-oak.json; Duvet=Fabric/cotton.json; Base=Finishes/light-oak.json"],
  "bed-materials": ["Fabric/linen.json", ""],
  sofa: ["Fabric/boucle.json", "Legs=Finishes/light-oak.json"],
  armchair: ["Fabric/boucle.json", "Legs=Finishes/light-oak.json"],
  chair: ["Finishes/light-oak.json", "Seat=Fabric/linen.json"],
  stool: ["Finishes/light-oak.json", "Seat=Fabric/linen.json"],
  rug: ["Fabric/rug-pile.json", ""],
  curtain: ["Fabric/linen.json", "Blackout layer=Fabric/blackout.json"],
  "curtain-track": ["Metal/aluminium-anodised.json", ""],
  // Fittings and fixtures
  mirror: ["Glazing/mirror.json", "Frame=Metal/brass-polished.json"],
  tv: ["Glazing/screen.json", "Bias light=Emissive/diffuser.json"],
  "wall-art": ["Finishes/paper.json", "Frame=Finishes/light-oak.json"],
  plant: ["Organic/foliage.json", "Pot=Finishes/ceramic.json"],
  "planter-box": ["Finishes/ceramic.json", "Foliage=Organic/foliage.json"],
  bathtub: ["Finishes/ceramic.json", ""],
  toilet: ["Finishes/ceramic.json", ""],
  washbasin: ["Finishes/ceramic.json", ""],
  "kitchen-sink": ["Metal/steel.json", ""],
  faucet: ["Metal/brass-polished.json", ""],
  shower: ["Glazing/glass.json", "Tray=Finishes/ceramic.json"],
  "towel-rack": ["Metal/brass-polished.json", ""],
  "toilet-paper-holder": ["Metal/brass-polished.json", ""],
  "floor-drain": ["Metal/steel.json", ""],
  "water-heater": ["Metal/powder-coat.json", ""],
  "washing-machine": ["Metal/powder-coat.json", "Door=Glazing/glass.json"],
  refrigerator: ["Metal/steel.json", ""],
  oven: ["Metal/steel.json", "Door=Glazing/glass.json"],
  stove: ["Metal/steel.json", ""],
  microwave: ["Metal/steel.json", "Door=Glazing/glass.json"],
  "exhaust-hood": ["Metal/steel.json", ""],
  "ceiling-fan": ["Metal/powder-coat.json", "Hub=Metal/brass-polished.json; Light kit=Emissive/diffuser.json"],
  // Lighting — the housing, not the light
  light: ["Metal/powder-coat.json", "Emitter=Emissive/diffuser.json; Globe=Emissive/led-warm.json"],
  downlight: ["Metal/powder-coat.json", "Lens=Emissive/diffuser.json"],
  pendant: ["Finishes/ceramic.json", "Cord=Metal/brass-polished.json; Canopy=Metal/brass-polished.json; Diffuser=Emissive/diffuser.json"],
  chandelier: ["Metal/brass-polished.json", "Candles=Emissive/led-warm.json"],
  "light-bulb": ["Glazing/glass.json", "Cap=Metal/brass-polished.json; Filament=Emissive/led-warm.json; Shade=Finishes/paper.json"],
  "floor-lamp": ["Metal/powder-coat.json", "Shade=Fabric/linen.json"],
  "outdoor-light": ["Metal/powder-coat.json", ""],
  "led-strip": ["Metal/aluminium-anodised.json", "Tape=Emissive/led-warm.json"],
  "light-panel": ["Metal/powder-coat.json", "Diffuser=Emissive/diffuser.json"],
  "cove-light": ["Finishes/paint-eggshell.json", "Tape=Emissive/led-warm.json; Lip=Finishes/plaster.json"],
  "linear-profile": ["Metal/aluminium-anodised.json", "Lens=Emissive/diffuser.json"],
  "daylight-portal": ["Glazing/glass.json", ""],
  track: ["Metal/aluminium-anodised.json", "Heads=Metal/powder-coat.json"],
  "track-head": ["Metal/powder-coat.json", ""],
  "wall-washer": ["Metal/powder-coat.json", ""],
  "lighting-layout": ["Metal/powder-coat.json", ""],
  // Site and outdoor
  road: ["Masonry/concrete.json", ""],
  plot: ["Site/grass.json", ""],
  plot_boundary: ["Masonry/stone.json", ""],
  "channel-gate": ["Metal/steel.json", ""],
  car: ["Metal/powder-coat.json", "Glazing=Glazing/glass.json"],
  bike: ["Metal/steel.json", ""],
  tessellation: ["Finishes/tile.json", ""],
};

/** When the table says nothing, the category still does. */
const BY_CATEGORY = (title = "") => {
  const t = title.toLowerCase();
  if (/light|lamp|lumin/.test(t)) return "Metal/powder-coat.json";
  if (/wood|timber|joiner|panel/.test(t)) return "Finishes/light-oak.json";
  if (/metal|steel|rail/.test(t)) return "Metal/steel.json";
  if (/glass|glaz|mirror/.test(t)) return "Glazing/glass.json";
  return "Finishes/plaster.json";
};

/* ── 3 and 4: the property packs ──────────────────────────────────────────────────────────── */

const CAMERA = {
  props: [
    // Lens shift is THE architectural camera control and the object has never had it. Two-point
    // forces the tilt to zero, which keeps verticals vertical by cropping the ceiling off; a
    // vertical shift is how a real tilt-shift lens gets the ceiling back without leaning the walls.
    rng("shiftX", "Lens shift — horizontal", 0, -1, 1, 0.005),
    rng("shiftY", "Lens shift — vertical", 0.08, -1, 1, 0.005),
    rng("clipStart", "Near clip", 0.05, 0.001, 2, 0.001),
    // The plant in view1 was 300 mm from the lens. Nothing warned, because nothing was measuring.
    rng("minClearance", "Minimum clearance ahead", 0.6, 0, 5, 0.05),
    rng("fStop", "Aperture (f/)", 5.6, 0.7, 32, 0.1),
    rng("focusDistance", "Focus distance", 0, 0, 40, 0.05),
    rng("blades", "Aperture blades", 7, 0, 16, 1),
    rng("roll", "Roll", 0, -30, 30, 0.5),
    rng("exposureEV", "Exposure offset", 0, -8, 8, 0.1),
    rng("resolutionX", "Width", 1920, 320, 8192, 16),
    rng("resolutionY", "Height", 1080, 320, 8192, 16),
    sel("panoramaType", "Panorama type", "Equirectangular", ["Equirectangular", "Fisheye equisolid", "Fisheye equidistant", "Mirror ball"]),
    rng("shotOrder", "Shot order", 1, 1, 99, 1),
    chk("shotActive", "Include in the render set", true),
  ],
  text: [txt("shotName", "Shot name", "")],
  lines: [
    "# ── Render camera ──────────────────────────────────────────────────────────────────────────",
    "# Shift is expressed the way a camera does it: a fraction of the SENSOR, not an angle. That is",
    "# what makes it composable with the focal length — change the lens and the shift still means",
    "# the same thing on the film.",
    "shiftHoriz = shiftX",
    "shiftVert = shiftY",
    "# Where the shifted frame's centre lands on a wall at the subject distance. A shift of 0.08 on",
    "# a 24 mm lens at 4 m raises the frame by about 480 mm, which is a storey band, not a nudge.",
    "shiftRiseAtSubject = shiftY * frameHeight",
    "nearClip = clipStart",
    "clearanceRequired = minClearance",
    "# A clearance smaller than the near clip cannot be enforced — the geometry is already cut away",
    "# before anything could be measured against it.",
    "clearanceUsable = minClearance >= clipStart ? 1 : 0",
    "# Depth of field. The circle of confusion for a 36 mm sensor is the usual 0.03 mm; the",
    "# hyperfocal is where an interior wants to sit, because past it everything to infinity is sharp.",
    "aperture = fStop",
    "_coc = 0.03 * sensorWidth / 36",
    "hyperfocal = (focalLength * focalLength) / max(0.001, fStop * _coc) / 1000",
    "focusUsed = focusDistance > 0 ? focusDistance : subjectDistance",
    "depthOfFieldOn = fStop < 11 ? 1 : 0",
    "# Blade count is what shapes a highlight out of focus: below about 9 the bokeh is a polygon,",
    "# and 0 means a perfectly round iris, which no real lens has.",
    "bokehBlades = max(0, round(blades))",
    "rollUsed = roll",
    "exposureOffset = exposureEV",
    "renderWidth = resolutionX",
    "renderHeight = resolutionY",
    "renderMegapixels = resolutionX * resolutionY / 1000000",
    "panoCode = panoramaType == 'Equirectangular' ? 0 : (panoramaType == 'Fisheye equisolid' ? 1 : (panoramaType == 'Fisheye equidistant' ? 2 : 3))",
    "shotIndex = shotOrder",
    "shotOn = shotActive > 0 ? 1 : 0",
  ],
  outputs: [
    { from: "shiftHoriz", label: "Lens shift X" },
    { from: "shiftVert", label: "Lens shift Y" },
    { from: "shiftRiseAtSubject", label: "Frame rise at subject (m)" },
    { from: "nearClip", label: "Near clip (m)" },
    { from: "clearanceRequired", label: "Minimum clearance (m)" },
    { from: "clearanceUsable", label: "Clearance enforceable" },
    { from: "aperture", label: "Aperture (f/)" },
    { from: "hyperfocal", label: "Hyperfocal distance (m)" },
    { from: "focusUsed", label: "Focus distance (m)" },
    { from: "depthOfFieldOn", label: "Depth of field" },
    { from: "bokehBlades", label: "Aperture blades" },
    { from: "rollUsed", label: "Roll (°)" },
    { from: "exposureOffset", label: "Exposure offset (EV)" },
    { from: "renderWidth", label: "Render width (px)" },
    { from: "renderHeight", label: "Render height (px)" },
    { from: "renderMegapixels", label: "Megapixels" },
    { from: "panoCode", label: "Panorama type" },
    { from: "shotIndex", label: "Shot order" },
    { from: "shotOn", label: "In the render set" },
  ],
};

const RENDER_LOOK = {
  props: [
    // Exterior. The single reason the bedroom window is a white rectangle: there is nothing outside
    // it, so the sky integrates to a flat blown value and the glass has nothing to reflect.
    sel("exteriorMode", "Outside the glass", "Ground", ["None", "Ground", "Backplate", "HDRI", "Massing"]),
    rng("backplateDistance", "Backplate distance", 12, 1, 400, 0.5),
    rng("backplateHeight", "Backplate height", 8, 1, 200, 0.5),
    rng("groundAlbedo", "Ground albedo", 0.22, 0, 1, 0.01),
    rng("horizonHeight", "Horizon height", 0, -50, 50, 0.1),
    chk("filmTransparent", "Transparent film", false),
    chk("shadowCatcher", "Ground is a shadow catcher", false),
    // Sun. The renderer hardcodes the disc OFF, which is why no shot has ever had a sunbeam in it.
    chk("sunDisc", "Draw the sun disc", true),
    rng("sunDiscScale", "Sun disc size", 1, 0.1, 20, 0.1),
    rng("latitude", "Latitude", 27.7, -90, 90, 0.01),
    rng("longitude", "Longitude", 85.3, -180, 180, 0.01),
    rng("timezoneHours", "Timezone", 5.75, -12, 14, 0.25),
    rng("dayOfYear", "Day of year", 172, 1, 366, 1),
    rng("hourOfDay", "Hour of day", 15.5, 0, 24, 0.25),
    chk("sunFromDateTime", "Sun position from date and place", false),
    // Atmosphere.
    rng("volumetricDensity", "Volumetric density", 0, 0, 0.2, 0.001),
    rng("hazeStrength", "Haze", 0, 0, 1, 0.01),
    chk("causticsReflective", "Reflective caustics", false),
    chk("causticsRefractive", "Refractive caustics", false),
    // Quality.
    rng("bevelWidth", "Global bevel", 0.0015, 0, 0.02, 0.0001),
    rng("bevelSamples", "Bevel samples", 4, 2, 16, 1),
    rng("aoStrength", "Ambient occlusion", 0, 0, 1, 0.01),
    rng("aoDistance", "AO distance", 0.3, 0.01, 5, 0.01),
    rng("previewSamples", "Preview samples", 24, 4, 512, 4),
    rng("adaptiveThreshold", "Adaptive threshold", 0.01, 0.001, 0.2, 0.001),
    rng("resolutionScale", "Resolution scale (%)", 100, 10, 200, 5),
    // Post. The clipped cove in view1 is a glare problem, not an exposure problem.
    rng("glareThreshold", "Glare threshold", 1, 0.1, 20, 0.05),
    rng("glareSize", "Glare size", 7, 0, 9, 1),
    rng("whiteBalanceK", "White balance", 3200, 1800, 12000, 50),
    rng("vignette", "Vignette", 0.12, 0, 1, 0.01),
    rng("sharpen", "Sharpen", 0.2, 0, 1, 0.01),
    rng("grain", "Grain", 0.015, 0, 0.2, 0.005),
    rng("rigEfficiency", "Luminous efficiency of the rig", 0.27, 0.05, 1, 0.01),
  ],
  text: [
    txt("backplatePath", "Backplate (Library/Images/…)", ""),
    txt("lightGroupGains", "Light group gains (name=gain, …)", "key=1; cove=1; mirror=1; daylight=1; accent=1"),
    txt("renderSet", "Cameras to render (blank = all active)", ""),
  ],
  lines: [
    "# ── Environment ────────────────────────────────────────────────────────────────────────────",
    "exteriorCode = exteriorMode == 'None' ? 0 : (exteriorMode == 'Ground' ? 1 : (exteriorMode == 'Backplate' ? 2 : (exteriorMode == 'HDRI' ? 3 : 4)))",
    "backplateAt = backplateDistance",
    "backplateTall = backplateHeight",
    "groundReflectance = groundAlbedo",
    "horizonAt = horizonHeight",
    "filmClear = filmTransparent > 0 ? 1 : 0",
    "catchShadows = shadowCatcher > 0 ? 1 : 0",
    "# The sun disc is what makes a sunbeam have an EDGE. With it off the sky still lights the room",
    "# but nothing casts a hard shadow, and that is the whole difference between afternoon and fog.",
    "sunDiscOn = sunDisc > 0 ? 1 : 0",
    "sunDiscSize = sunAngularDiameter * sunDiscScale",
    "# Solar position from date, hour and place — the NOAA declination and hour angle, which is a",
    "# far better answer than a typed altitude because it cannot disagree with the date on the sheet.",
    "_decl = 23.44 * sin(2 * PI * (284 + dayOfYear) / 365) * PI / 180",
    "_solarNoon = 12 - (longitude / 15 - timezoneHours)",
    "_hourAngle = (hourOfDay - _solarNoon) * 15 * PI / 180",
    "_lat = latitude * PI / 180",
    "_sinAlt = sin(_lat) * sin(_decl) + cos(_lat) * cos(_decl) * cos(_hourAngle)",
    "computedAltitude = atan2(_sinAlt, sqrt(max(0.000001, 1 - _sinAlt * _sinAlt))) * 180 / PI",
    "_cosAz = (sin(_decl) - _sinAlt * sin(_lat)) / max(0.000001, cos(_lat) * sqrt(max(0.000001, 1 - _sinAlt * _sinAlt)))",
    "_azRaw = atan2(sqrt(max(0, 1 - _cosAz * _cosAz)), _cosAz) * 180 / PI",
    "computedAzimuth = _hourAngle > 0 ? (360 - _azRaw) : _azRaw",
    "altitudeUsed = sunFromDateTime > 0 ? computedAltitude : sunAltitude",
    "azimuthUsed = sunFromDateTime > 0 ? computedAzimuth : sunAzimuth",
    "daylightHours = hourOfDay",
    "volumetrics = volumetricDensity",
    "haze = hazeStrength",
    "causticsRefl = causticsReflective > 0 ? 1 : 0",
    "causticsRefr = causticsRefractive > 0 ? 1 : 0",
    "# A global bevel is a SHADER, not geometry: it perturbs the normal near an edge so the edge",
    "# catches a highlight. A razor-sharp 90 degrees catches none at all, and nothing else on this",
    "# list moves a render further for less.",
    "globalBevel = bevelWidth",
    "globalBevelSamples = bevelSamples",
    "aoFactor = aoStrength",
    "aoReach = aoDistance",
    "previewSampleCount = previewSamples",
    "adaptiveAt = adaptiveThreshold",
    "scalePct = resolutionScale",
    "renderedWidth = resolutionX * resolutionScale / 100",
    "renderedHeight = resolutionY * resolutionScale / 100",
    "glareAt = glareThreshold",
    "glareSpread = glareSize",
    "whiteBalance = whiteBalanceK",
    "vignetteAmount = vignette",
    "sharpenAmount = sharpen",
    "grainAmount = grain",
    "# The rig efficiency the whole exposure has been hiding. `render_plan.py` divides lumens by 184",
    "# where lamp/1 says 683: 184 IS 683 x 0.27, a broadband-white efficiency folded into a divisor.",
    "# Stated here it can be tuned once and seen; buried there it could only be guessed at.",
    "rigLumensPerWatt = 683 * rigEfficiency",
  ],
  outputs: [
    { from: "exteriorCode", label: "Outside the glass" },
    { from: "backplateAt", label: "Backplate distance (m)" },
    { from: "backplateTall", label: "Backplate height (m)" },
    { from: "groundReflectance", label: "Ground albedo" },
    { from: "horizonAt", label: "Horizon height (m)" },
    { from: "filmClear", label: "Transparent film" },
    { from: "catchShadows", label: "Shadow catcher" },
    { from: "sunDiscOn", label: "Sun disc" },
    { from: "sunDiscSize", label: "Sun disc size (°)" },
    { from: "computedAltitude", label: "Computed sun altitude (°)" },
    { from: "computedAzimuth", label: "Computed sun azimuth (°)" },
    { from: "altitudeUsed", label: "Sun altitude used (°)" },
    { from: "azimuthUsed", label: "Sun azimuth used (°)" },
    { from: "daylightHours", label: "Hour of day" },
    { from: "volumetrics", label: "Volumetric density" },
    { from: "haze", label: "Haze" },
    { from: "causticsRefl", label: "Reflective caustics" },
    { from: "causticsRefr", label: "Refractive caustics" },
    { from: "globalBevel", label: "Global bevel (m)" },
    { from: "globalBevelSamples", label: "Bevel samples" },
    { from: "aoFactor", label: "Ambient occlusion" },
    { from: "aoReach", label: "AO distance (m)" },
    { from: "previewSampleCount", label: "Preview samples" },
    { from: "adaptiveAt", label: "Adaptive threshold" },
    { from: "scalePct", label: "Resolution scale (%)" },
    { from: "renderedWidth", label: "Rendered width (px)" },
    { from: "renderedHeight", label: "Rendered height (px)" },
    { from: "glareAt", label: "Glare threshold" },
    { from: "glareSpread", label: "Glare size" },
    { from: "whiteBalance", label: "White balance (K)" },
    { from: "vignetteAmount", label: "Vignette" },
    { from: "sharpenAmount", label: "Sharpen" },
    { from: "grainAmount", label: "Grain" },
    { from: "rigLumensPerWatt", label: "Rig lm/W" },
  ],
};

/** Step 4, on every fixture that carries the lamp block. */
const LAMP_EXTRA = (defaultScene) => ({
  props: [
    rng("lightGroupGain", "Light group gain", 1, 0, 8, 0.05),
    // A warm-dim lamp drops its colour temperature as it dims. Linear dimming at a fixed kelvin is
    // why dimmed CG goes grey instead of going golden.
    rng("dimToKelvin", "Warm dim floor", 0, 0, 4000, 50),
    chk("showEmissiveSurface", "Draw the lit surface", true),
  ],
  text: [
    txt("goboPath", "Gobo (Library/Photometry/gobo/…)", ""),
    txt("sceneMembership", "Lighting scenes", defaultScene),
  ],
  lines: [
    "# ── Scene and group ────────────────────────────────────────────────────────────────────────",
    "lampGain = lightGroupGain",
    "lampGrouped = lampDimmed * lightGroupGain",
    "# Warm dim. A tungsten lamp at 10 % is not a dim white lamp, it is an orange one, and every",
    "# incandescent-alike LED is sold on reproducing exactly that. Interpolating the colour with the",
    "# dim level is the whole trick; leaving it fixed is why dimmed renders look like dusk indoors.",
    "lampKelvinDimmed = dimToKelvin > 0 ? (dimToKelvin + (kelvin - dimToKelvin) * _lbDim) : kelvin",
    "lampSurfaceShown = showEmissiveSurface > 0 ? 1 : 0",
  ],
  outputs: [
    { from: "lampGain", label: "Group gain" },
    { from: "lampGrouped", label: "Output after gain (lm)" },
    { from: "lampKelvinDimmed", label: "Colour temperature dimmed (K)" },
    { from: "lampSurfaceShown", label: "Lit surface drawn" },
  ],
});

/** Which fixtures get the step-4 pack, and the scene they belong to by default. */
const LAMP_OBJECTS = {
  light: "Photo, Bright", downlight: "Bright, Photo", pendant: "Bright, Relax, Photo",
  chandelier: "Bright, Photo", "light-bulb": "Relax", "floor-lamp": "Relax, Photo",
  "outdoor-light": "Night", "led-strip": "Relax, Night, Photo", mirror: "Bright",
  "false-ceiling": "Relax, Night, Photo", "light-panel": "Bright", "cove-light": "Relax, Night, Photo",
  "linear-profile": "Bright, Photo", "track-head": "Photo, Bright", "wall-washer": "Photo, Relax",
  "lighting-layout": "Bright",
};

/* ── run ──────────────────────────────────────────────────────────────────────────────────── */

const SKIP = /^(detect_|ink-coverage|plot_boundary|BOQ)/;

// Importable: the FINISHES table is the plan builder's source of truth too, so the run has to sit
// behind a guard or importing this module would re-patch 80 objects as a side effect.
const RUN = String(process.argv[1]).endsWith("patch-objects.mjs");
mkdirSync(OUT, { recursive: true });
let bad = 0, n = 0;
const rows = [];
if (RUN) {

for (const f of readdirSync(LIVE).sort()) {
  const stem = f.replace(/\.json$/, "");
  if (SKIP.test(stem)) continue;
  const src = readFileSync(`${LIVE}/${f}`, "utf8");
  let flow = JSON.parse(src);
  const before = validateFlow(JSON.parse(src));
  const have = new Set(propsOf(flow).map((p) => p.id));

  const [def, over] = FINISHES[stem] ?? [BY_CATEGORY(flow.title), ""];
  const packs = [];
  if (!have.has("materialPath")) {
    packs.push({ text: [txt("materialPath", "Material (Library/Materials/…)", def),
                        txt("finishes", "Per-row finishes (Row=path; …)", over)] });
  }
  if (stem === "camera") packs.push(CAMERA);
  if (stem === "render-look") packs.push(RENDER_LOOK);
  if (LAMP_OBJECTS[stem] && have.has("dimLevel")) packs.push(LAMP_EXTRA(LAMP_OBJECTS[stem]));

  if (!packs.length) continue;
  let problems = [];
  try {
    for (const p of packs) flow = patchFlow(flow, p);
    const after = validateFlow(flow);
    problems = after.problems.filter((p) => !before.problems.includes(p));
    const drift = Object.keys(before.metrics).filter((k) => !Object.is(before.metrics[k], after.metrics[k]));
    if (drift.length) problems.push(`metrics MOVED: ${drift.slice(0, 3).map((k) => `${k} ${before.metrics[k]} -> ${after.metrics[k]}`).join(", ")}`);
  } catch (err) { problems = [err.message]; }

  if (problems.length) { bad++; console.log(`FAIL ${stem}`); problems.slice(0, 6).forEach((p) => console.log("      - " + p)); continue; }
  writeFileSync(`${OUT}/${f}`, JSON.stringify(flow, null, 2) + "\n", "utf8");
  n++;
  const tags = [packs.length > 1 || !have.has("materialPath") ? "mat" : "", stem === "camera" ? "CAMERA" : "",
                stem === "render-look" ? "ENV" : "", LAMP_OBJECTS[stem] && have.has("dimLevel") ? "lamp+" : ""].filter(Boolean);
  rows.push(`ok   ${stem.padEnd(20)} ${String(propsOf(flow).length).padStart(2)}p  ${tags.join(" ").padEnd(12)} ${def}${over ? "  + " + over.split(";").length + " rows" : ""}`);
}

}

if (RUN) {
  rows.forEach((r) => console.log(r));
  console.log(`\n${n} objects patched, ${bad} with problems`);
  process.exit(bad ? 1 : 0);
}
