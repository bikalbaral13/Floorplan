/** STEP 2 — `lamp/1`, and the seed lamps.
 *
 *  WHY A FILE AND NOT PROPS. `material/1` already established the shape: one flat recipe per
 *  consumer, referenced by a Library-relative path, expanded by each importer into whatever tree it
 *  wants. Photometry has exactly the same problem — a 3000 K COB is the same lamp in a downlight, a
 *  track head and a cove, and twelve downlights in a room are twelve references to one lamp, not
 *  twelve copies of twenty-two numbers. Fat props on every fixture would make a schema change ten
 *  file edits and leave nowhere for the transpiler to look.
 *
 *  WHAT A LAMP IS NOT. It is not a fitting. Nothing here has a trim, a cord or a channel — those
 *  are the object's, because they are geometry and geometry is what the six-node spine is for. A
 *  lamp carries only what the RENDERER needs and the drawing cannot show.
 *
 *  THE 683. `blender.energyWatts = lumens / 683` is the same constant `material/1` uses for
 *  `emission.luminance / 683`. That is the whole point of writing it down twice: a lit diffuser and
 *  the lamp behind it have to be reconcilable, and they can only be reconciled through one number.
 */
import { blackbodyRGB, wattsFromLumens } from "./blackbody.mjs";

/** Fill in everything that falls out of the numbers above it, so a definition states only what a
 *  datasheet states and nothing that can be derived from it. */
function lamp(d) {
  const e = d.emission;
  const lm = e.lumens ?? 0;
  const w = e.wattsElectrical ?? 0;
  const b = d.blender ?? {};
  return {
    schema: "lamp/1",
    id: d.id,
    name: d.name,
    category: d.category,
    description: d.description,
    emission: {
      sourceType: e.sourceType,              // Point | Spot | Area | Linear | Sun
      areaShape: e.areaShape ?? "",          // Square | Rectangle | Disk | Ellipse — Area and Linear only
      lumens: lm,
      lumensPerMetre: e.lumensPerMetre ?? 0, // Linear only; `lumens` is then per metre of run
      wattsElectrical: w,
      efficacy: w > 0 ? Number((lm / w).toFixed(1)) : 0,
      illuminanceLux: e.illuminanceLux ?? 0, // Sun and sky only — lumens is meaningless for them
      kelvin: e.kelvin,
      cri: e.cri ?? 90,
      duv: e.duv ?? 0,                       // + green, - magenta, off the Planckian locus
    },
    distribution: {
      profile: d.distribution.profile,       // Narrow | Medium | Wide | Wall-wash | Asymmetric | Batwing | Diffuse
      beamAngle: d.distribution.beamAngle,   // the 50 % cone, degrees
      fieldAngle: d.distribution.fieldAngle, // the 10 % cone
      beamBlend: d.distribution.beamBlend,   // 0 hard edge, 1 fully feathered
      spread: d.distribution.spread ?? 180,  // area-light spread, degrees — Blender only
      ies: { path: d.distribution.iesPath ?? "", normalise: true },
    },
    shadow: {
      lampRadius: d.shadow.lampRadius,       // -> shadow_soft_size. The soft-shadow control.
      castShadow: d.shadow.castShadow ?? true,
      maxBounces: d.shadow.maxBounces ?? 1024,
      multipleImportance: d.shadow.multipleImportance ?? true,
      diffuseFactor: d.shadow.diffuseFactor ?? 1,
      glossyFactor: d.shadow.glossyFactor ?? 1,
      transmissionFactor: d.shadow.transmissionFactor ?? 1,
      volumeFactor: d.shadow.volumeFactor ?? 1,
      visibleToCamera: d.shadow.visibleToCamera ?? false,
      isPortal: d.shadow.isPortal ?? false,
    },
    // One flat, assign-ready recipe — the same discipline as `material/1`'s `pbr` block. The colour
    // is given as a MODE plus the kelvin, because Blender walks the Planckian locus better than a
    // baked triple does; `rgb` is the fallback for consumers with no blackbody node.
    blender: {
      type: b.type,                          // POINT | SPOT | AREA | SUN
      shape: b.shape ?? "",                  // SQUARE | RECTANGLE | DISK | ELLIPSE
      energyWatts: e.illuminanceLux
        ? wattsFromLumens(e.illuminanceLux)  // SUN takes irradiance W/m^2, so lux / 683
        : wattsFromLumens(lm),
      color: { mode: "blackbody", kelvin: e.kelvin },
      rgb: blackbodyRGB(e.kelvin),
      sizeX: b.sizeX ?? 0,
      sizeY: b.sizeY ?? 0,
      radius: d.shadow.lampRadius,
      spotSizeDeg: d.distribution.fieldAngle,
      spotBlend: d.distribution.beamBlend,
      spread: d.distribution.spread ?? 180,
      angleDeg: b.angleDeg ?? 0,             // SUN only — 0.526 is the real sun's angular diameter
    },
    // The visible glow. A lit diffuser is NOT a second light: the room is lit by the lamp above,
    // and emitting from both blows the exposure. `luminanceOverride: 0` means "use the material's".
    emissive: { material: d.emissive ?? "", luminanceOverride: 0 },
  };
}

export const LAMPS = [
  lamp({
    id: "cob-spot-3000k",
    name: "COB spot 3000 K 650 lm",
    category: "LED",
    description: "The recessed-downlight lamp. A 12 mm COB die, which is small enough to throw a hard-edged shadow — that crispness is the look, and it is `lampRadius`, not the beam angle.",
    emission: { sourceType: "Spot", lumens: 650, wattsElectrical: 7.5, kelvin: 3000, cri: 90 },
    distribution: { profile: "Medium", beamAngle: 36, fieldAngle: 60, beamBlend: 0.25 },
    shadow: { lampRadius: 0.012 },
    blender: { type: "SPOT" },
    emissive: "Materials/Emissive/led-warm.json",
  }),
  lamp({
    id: "tape-warm-2700k",
    name: "LED tape 2700 K 900 lm/m",
    category: "LED",
    description: "Concealed tape behind a diffuser. Output is PER METRE, so a fixture multiplies by its own run length; `lumens` repeats it so a consumer that ignores linear lamps still gets a number.",
    emission: { sourceType: "Linear", areaShape: "Rectangle", lumens: 900, lumensPerMetre: 900, wattsElectrical: 10, kelvin: 2700, cri: 90 },
    distribution: { profile: "Diffuse", beamAngle: 120, fieldAngle: 180, beamBlend: 1, spread: 180 },
    shadow: { lampRadius: 0.006, visibleToCamera: false },
    blender: { type: "AREA", shape: "RECTANGLE", sizeX: 1, sizeY: 0.012 },
    emissive: "Materials/Emissive/led-warm.json",
  }),
  lamp({
    id: "tape-neutral-4000k",
    name: "LED tape 4000 K 1400 lm/m",
    category: "LED",
    description: "The cooler, brighter tape — mirror halos and task coves, where 2700 K reads yellow against a white basin.",
    emission: { sourceType: "Linear", areaShape: "Rectangle", lumens: 1400, lumensPerMetre: 1400, wattsElectrical: 14.5, kelvin: 4000, cri: 95 },
    distribution: { profile: "Diffuse", beamAngle: 120, fieldAngle: 180, beamBlend: 1, spread: 180 },
    shadow: { lampRadius: 0.006 },
    blender: { type: "AREA", shape: "RECTANGLE", sizeX: 1, sizeY: 0.012 },
    emissive: "Materials/Emissive/diffuser.json",
  }),
  lamp({
    id: "panel-4000k",
    name: "LED panel 4000 K 3600 lm",
    category: "LED",
    description: "A 600 x 600 flat panel, and the generic soft source — the mirror halo and the daylight-looking fill are both this lamp at different sizes. A big emitter with a big `sizeX` is what makes a shadow soft.",
    emission: { sourceType: "Area", areaShape: "Rectangle", lumens: 3600, wattsElectrical: 32, kelvin: 4000, cri: 90 },
    distribution: { profile: "Diffuse", beamAngle: 120, fieldAngle: 180, beamBlend: 1, spread: 180 },
    shadow: { lampRadius: 0.3 },
    blender: { type: "AREA", shape: "RECTANGLE", sizeX: 0.6, sizeY: 0.6 },
    emissive: "Materials/Emissive/diffuser.json",
  }),
  lamp({
    id: "gu10-spot-3000k",
    name: "GU10 spot 3000 K 400 lm",
    category: "LED",
    description: "The track-head and adjustable-gimbal lamp. Narrower and dimmer than the COB, because a track head is an accent and not the ambient layer.",
    emission: { sourceType: "Spot", lumens: 400, wattsElectrical: 4.8, kelvin: 3000, cri: 92 },
    distribution: { profile: "Narrow", beamAngle: 24, fieldAngle: 40, beamBlend: 0.2 },
    shadow: { lampRadius: 0.018 },
    blender: { type: "SPOT" },
    emissive: "Materials/Emissive/led-warm.json",
  }),
  lamp({
    id: "e27-globe-2700k",
    name: "E27 globe 2700 K 806 lm",
    category: "LED",
    description: "The bare bulb — pendants, chandeliers, the exposed-filament look. A 30 mm envelope: soft enough to be forgiving, small enough to still read as a point.",
    emission: { sourceType: "Point", lumens: 806, wattsElectrical: 8.5, kelvin: 2700, cri: 90 },
    distribution: { profile: "Wide", beamAngle: 300, fieldAngle: 360, beamBlend: 1 },
    shadow: { lampRadius: 0.03, visibleToCamera: true },
    blender: { type: "POINT" },
    emissive: "Materials/Emissive/led-warm.json",
  }),
  lamp({
    id: "linear-darklight-3000k",
    name: "Linear darklight 3000 K 1100 lm/m",
    category: "LED",
    description: "A trimless plaster-in run with a deep-set optic. `Asymmetric` and a 60 degree field is the whole difference from tape — it cuts off rather than washing, which is why it can face a seating position.",
    emission: { sourceType: "Linear", areaShape: "Rectangle", lumens: 1100, lumensPerMetre: 1100, wattsElectrical: 11, kelvin: 3000, cri: 95 },
    distribution: { profile: "Asymmetric", beamAngle: 40, fieldAngle: 60, beamBlend: 0.35, spread: 90 },
    shadow: { lampRadius: 0.008 },
    blender: { type: "AREA", shape: "RECTANGLE", sizeX: 1, sizeY: 0.022 },
    emissive: "Materials/Emissive/diffuser.json",
  }),
  lamp({
    id: "sky-overcast-6500k",
    name: "Overcast sky 6500 K 10 000 lx",
    category: "Daylight",
    description: "What a window is on a grey day: a big, even, cool area source at the glazing. Stated in LUX, not lumens — a sky has no output, it has an illuminance, and a portal's lumens depend on how big the hole is.",
    emission: { sourceType: "Area", areaShape: "Rectangle", lumens: 0, wattsElectrical: 0, illuminanceLux: 10000, kelvin: 6500, cri: 100 },
    distribution: { profile: "Diffuse", beamAngle: 180, fieldAngle: 180, beamBlend: 1, spread: 180 },
    shadow: { lampRadius: 0.5, isPortal: true, visibleToCamera: true },
    blender: { type: "AREA", shape: "RECTANGLE", sizeX: 1, sizeY: 1 },
    emissive: "Materials/Emissive/diffuser.json",
  }),
  lamp({
    id: "sun-clear-noon",
    name: "Clear sun, noon 5500 K 100 000 lx",
    category: "Daylight",
    description: "The only lamp here with an angular diameter instead of a size. 0.526 degrees is the real sun's, and it is the reason a sunbeam edge is nearly sharp but not quite — widen it and the scene goes hazy.",
    emission: { sourceType: "Sun", lumens: 0, wattsElectrical: 0, illuminanceLux: 100000, kelvin: 5500, cri: 100 },
    distribution: { profile: "Narrow", beamAngle: 0.526, fieldAngle: 0.526, beamBlend: 0 },
    shadow: { lampRadius: 0, visibleToCamera: false },
    blender: { type: "SUN", angleDeg: 0.526 },
    emissive: "",
  }),
];
