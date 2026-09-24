/** STEP 1b — the twelve materials this plan asks for by name and the library does not have.
 *
 *  Every one of these was read off the plan's own prose `material` strings, or off what the two
 *  existing renders are visibly missing. "light oak veneer" is written five times in
 *  `floorplan_with_bedroom.json` and the library has walnut and a generic oak; "ivory boucle
 *  upholstery" and "ivory ceramic pot" have nothing at all. A material that is asked for and does
 *  not exist is the reason a render comes back grey.
 */

const proc = (type, node, params) => ({ type, blenderNode: node, params });
const NONE = { type: "none", blenderNode: null, params: {} };

const mat = (d) => ({
  schema: "material/1",
  category: d.category,
  id: d.id,
  title: d.title,
  description: d.description,
  procedural: d.procedural ?? NONE,
  pbr: d.pbr,
  surface: d.surface,
  plan2d: d.plan2d,
  dxf: d.dxf,
  ...(d.emission ? { emission: d.emission } : {}),
});

export const NEW_MATERIALS = [
  mat({
    category: "Finishes", file: "light-oak", id: "wood.oak.light",
    title: "Wood — light oak veneer",
    description: "The veneer this plan names five times. Same banded wave as the other two woods at a wider scale with a pale pair, because a veneer reads by its VALUE against what is next to it, not by a different grain algorithm — and running three different algorithms would make three woods that cannot sit in one room.",
    procedural: proc("wave", "ShaderNodeTexWave", {
      waveType: "BANDS", bandsDirection: "X", waveProfile: "SIN",
      scale: 2.6, distortion: 11, detail: 3, detailScale: 1.1, detailRoughness: 0.55, phaseOffset: 0,
      colorA: "#c8a87c", colorB: "#a98761",
    }),
    pbr: { baseColor: "#bb9a70", roughness: 0.42, metallic: 0 },
    surface: {
      bevel: { width: 0.002, samples: 4 },
      grain: { axis: "u", rotationDeg: 0, scaleU: 1, scaleV: 0.3 },
      normal: { source: "procedural", strength: 0.4, scale: 1 },
      coat: { weight: 0.2, roughness: 0.14, ior: 1.5 },
      roughnessVariation: { amount: 0.1, scale: 8 },
    },
    plan2d: { hatch: "diagonal", spacing: 5, angle: 0, weight: 1, color: "#bb9a70" },
    dxf: { pattern: "WOOD2", scale: 1, angle: 0 },
  }),

  mat({
    category: "Fabric", file: "boucle", id: "fabric.boucle",
    title: "Fabric — bouclé",
    description: "Looped ivory upholstery. Voronoi at a coarse scale is the loop; the sheen is most of what you actually see, because a bouclé lit from the side is a field of little bright rims and almost no body.",
    procedural: proc("voronoi", "ShaderNodeTexVoronoi", {
      scale: 55, detail: 2, roughness: 0.6, randomness: 1, feature: "F1", distance: "EUCLIDEAN",
      colorA: "#efe7db", colorB: "#ddd2c2",
    }),
    pbr: { baseColor: "#e9e0d3", roughness: 0.95, metallic: 0, sheen: 0.5 },
    surface: {
      sheen: { weight: 0.75, roughness: 0.25, tint: "#fffaf0" },
      normal: { source: "procedural", strength: 1.1, scale: 1 },
      displacement: { scale: 0.003, midlevel: 0.5 },
      roughnessVariation: { amount: 0.08, scale: 22 },
    },
    plan2d: { hatch: "dots", spacing: 5, angle: 0, weight: 1, color: "#e9e0d3" },
    dxf: { pattern: "AR-SAND", scale: 0.4, angle: 0 },
  }),

  mat({
    category: "Finishes", file: "ceramic", id: "ceramic.glazed",
    title: "Ceramic — glazed",
    description: "A thrown pot. The body is matt and slightly uneven; everything you read as ceramic is the glaze on top of it, which is why the coat weight is high and the coat roughness is almost nothing.",
    procedural: proc("noise", "ShaderNodeTexNoise", {
      scale: 9, detail: 4, roughness: 0.5, distortion: 0.4, colorA: "#f2ece2", colorB: "#e3dbcd",
    }),
    pbr: { baseColor: "#ece5da", roughness: 0.28, metallic: 0 },
    surface: {
      bevel: { width: 0.0012, samples: 4 },
      coat: { weight: 0.85, roughness: 0.03, ior: 1.5 },
      normal: { source: "procedural", strength: 0.15, scale: 1 },
      roughnessVariation: { amount: 0.06, scale: 12 },
    },
    plan2d: { hatch: "none", spacing: 6, angle: 0, weight: 1, color: "#ece5da" },
    dxf: { pattern: "TRANS", scale: 1, angle: 0 },
  }),

  mat({
    category: "Finishes", file: "quartz", id: "stone.quartz",
    title: "Stone — engineered quartz",
    description: "A worktop. Voronoi flecks on a near-white body, no veining: engineered quartz is defined by being EVEN, and giving it marble's drama would make it marble.",
    procedural: proc("voronoi", "ShaderNodeTexVoronoi", {
      scale: 240, detail: 1, roughness: 0.4, randomness: 1, feature: "F1", distance: "EUCLIDEAN",
      colorA: "#eceae5", colorB: "#dcd8d0",
    }),
    pbr: { baseColor: "#e8e6e1", roughness: 0.22, metallic: 0 },
    surface: {
      bevel: { width: 0.0015, samples: 4 },
      coat: { weight: 0.5, roughness: 0.04, ior: 1.5 },
      roughnessVariation: { amount: 0.04, scale: 14 },
    },
    plan2d: { hatch: "dots", spacing: 8, angle: 0, weight: 1, color: "#e8e6e1" },
    dxf: { pattern: "AR-SAND", scale: 0.6, angle: 0 },
  }),

  mat({
    category: "Fabric", file: "rug-pile", id: "fabric.rug-pile",
    title: "Fabric — cut-pile rug",
    description: "A rug is not a flat wool panel — it has DEPTH, and that depth is what catches the light along one axis and swallows it along the other. Displacement plus a strong bump is the cheap version of a pile, and it is the difference between a rug and a printed rectangle.",
    procedural: proc("voronoi", "ShaderNodeTexVoronoi", {
      scale: 320, detail: 2, roughness: 0.7, randomness: 1, feature: "F1", distance: "EUCLIDEAN",
      colorA: "#cfc5b4", colorB: "#b2a795",
    }),
    pbr: { baseColor: "#c3b9a7", roughness: 0.99, metallic: 0, sheen: 0.4 },
    surface: {
      sheen: { weight: 0.6, roughness: 0.4, tint: "#efe7d8" },
      normal: { source: "procedural", strength: 1.6, scale: 1 },
      displacement: { scale: 0.006, midlevel: 0.5 },
      roughnessVariation: { amount: 0.1, scale: 30 },
    },
    plan2d: { hatch: "dots", spacing: 4, angle: 0, weight: 1, color: "#c3b9a7" },
    dxf: { pattern: "AR-SAND", scale: 0.3, angle: 0 },
  }),

  mat({
    category: "Metal", file: "brass-polished", id: "metal.brass.polished",
    title: "Metal — polished brass",
    description: "The handle and the pendant tube. The library's brass is brushed; a polished one is the same colour with the roughness taken out and the anisotropy nearly gone, and the two do not substitute for each other — a brushed handle in a render looks unfinished.",
    procedural: NONE,
    pbr: { baseColor: "#c9a441", roughness: 0.09, metallic: 1 },
    surface: {
      bevel: { width: 0.0006, samples: 4 },
      anisotropy: { strength: 0.15, rotationDeg: 0 },
      roughnessVariation: { amount: 0.03, scale: 40 },
    },
    plan2d: { hatch: "none", spacing: 6, angle: 0, weight: 1, color: "#c9a441" },
    dxf: { pattern: "TRANS", scale: 1, angle: 0 },
  }),

  mat({
    category: "Metal", file: "aluminium-anodised", id: "metal.aluminium.anodised",
    title: "Metal — anodised aluminium",
    description: "LED channels, trims, track. Anodising is an oxide layer, not a paint: the metal stays metal and the finish is a fine directional satin, which is why this is metallic 1 with anisotropy rather than a grey powder coat.",
    procedural: NONE,
    pbr: { baseColor: "#9fa4a8", roughness: 0.3, metallic: 1 },
    surface: {
      bevel: { width: 0.0005, samples: 4 },
      anisotropy: { strength: 0.6, rotationDeg: 0 },
      roughnessVariation: { amount: 0.04, scale: 45 },
    },
    plan2d: { hatch: "none", spacing: 6, angle: 0, weight: 1, color: "#9fa4a8" },
    dxf: { pattern: "TRANS", scale: 1, angle: 0 },
  }),

  mat({
    category: "Finishes", file: "paint-eggshell", id: "paint.eggshell",
    title: "Paint — eggshell on joinery",
    description: "Painted woodwork, which is NOT the same as a plastered wall even at the same colour. Paint on timber is flatter, slightly glossier and has a soft arris from the brush; plaster has tooth and a wider roughness spread. Reusing plaster for joinery is why painted doors read as drywall.",
    procedural: proc("noise", "ShaderNodeTexNoise", {
      scale: 60, detail: 3, roughness: 0.4, distortion: 0.2, colorA: "#f0ece5", colorB: "#e6e1d8",
    }),
    pbr: { baseColor: "#ebe7df", roughness: 0.38, metallic: 0 },
    surface: {
      bevel: { width: 0.0018, samples: 4 },
      coat: { weight: 0.25, roughness: 0.12, ior: 1.5 },
      normal: { source: "procedural", strength: 0.12, scale: 1 },
      roughnessVariation: { amount: 0.05, scale: 16 },
    },
    plan2d: { hatch: "none", spacing: 6, angle: 0, weight: 1, color: "#ebe7df" },
    dxf: { pattern: "TRANS", scale: 1, angle: 0 },
  }),

  mat({
    category: "Finishes", file: "leather", id: "leather.full-grain",
    title: "Leather — full grain",
    description: "Voronoi at two scales is the pebble; the thin subsurface is why leather in a rim light glows slightly at its edge instead of going black, and the low coat is the finish rather than the hide.",
    procedural: proc("voronoi", "ShaderNodeTexVoronoi", {
      scale: 420, detail: 3, roughness: 0.55, randomness: 1, feature: "F1", distance: "EUCLIDEAN",
      colorA: "#6b4a33", colorB: "#553826",
    }),
    pbr: { baseColor: "#5f4130", roughness: 0.55, metallic: 0 },
    surface: {
      bevel: { width: 0.0015, samples: 4 },
      subsurface: { weight: 0.1, radius: [0.006, 0.004, 0.003], scale: 0.004 },
      normal: { source: "procedural", strength: 0.9, scale: 1 },
      coat: { weight: 0.2, roughness: 0.3, ior: 1.45 },
      roughnessVariation: { amount: 0.12, scale: 11 },
    },
    plan2d: { hatch: "dots", spacing: 6, angle: 0, weight: 1, color: "#5f4130" },
    dxf: { pattern: "AR-SAND", scale: 0.5, angle: 0 },
  }),

  mat({
    category: "Finishes", file: "terrazzo", id: "stone.terrazzo",
    title: "Stone — terrazzo",
    description: "Chips in a binder. Voronoi cells ARE the chips, so the scale is the chip size in reverse — drop the scale and the chips grow, which is the one control a terrazzo actually has.",
    procedural: proc("voronoi", "ShaderNodeTexVoronoi", {
      scale: 38, detail: 1, roughness: 0.5, randomness: 1, feature: "F1", distance: "EUCLIDEAN",
      colorA: "#dcd8d1", colorB: "#8f8a80",
    }),
    pbr: { baseColor: "#cfcac2", roughness: 0.2, metallic: 0 },
    surface: {
      bevel: { width: 0.002, samples: 4 },
      coat: { weight: 0.55, roughness: 0.04, ior: 1.5 },
      roughnessVariation: { amount: 0.05, scale: 9 },
    },
    plan2d: { hatch: "dots", spacing: 5, angle: 0, weight: 1, color: "#cfcac2" },
    dxf: { pattern: "AR-CONC", scale: 0.8, angle: 0 },
  }),

  mat({
    category: "Organic", file: "rattan", id: "organic.rattan",
    title: "Organic — rattan weave",
    description: "A checker at a weave pitch with a strong bump. The weave is the whole material: flatten the bump and it becomes a tan-coloured board, which is what every rattan cabinet front in a bad render is.",
    procedural: proc("checker", "ShaderNodeTexChecker", {
      tileSize: 0.012, scale: 83.3, color1: "#cbab77", color2: "#a98a5c",
    }),
    pbr: { baseColor: "#bd9c6b", roughness: 0.6, metallic: 0 },
    surface: {
      bevel: { width: 0.0012, samples: 4 },
      normal: { source: "procedural", strength: 1.5, scale: 1 },
      displacement: { scale: 0.003, midlevel: 0.5 },
      roughnessVariation: { amount: 0.1, scale: 18 },
    },
    plan2d: { hatch: "diagonal", spacing: 4, angle: 45, weight: 1, color: "#bd9c6b" },
    dxf: { pattern: "NET", scale: 0.3, angle: 45 },
  }),

  mat({
    category: "Fabric", file: "felt", id: "fabric.acoustic-felt",
    title: "Fabric — acoustic felt",
    description: "PET felt panels. Almost fully rough, a fine dense fibre and a low sheen — the point of it is that it does not reflect, and a felt with a highlight on it has stopped being felt.",
    procedural: proc("noise", "ShaderNodeTexNoise", {
      scale: 180, detail: 5, roughness: 0.6, distortion: 0.8, colorA: "#767d84", colorB: "#5d646b",
    }),
    pbr: { baseColor: "#6b7278", roughness: 0.99, metallic: 0, sheen: 0.2 },
    surface: {
      sheen: { weight: 0.25, roughness: 0.5, tint: "#aab2b8" },
      normal: { source: "procedural", strength: 0.7, scale: 1 },
      roughnessVariation: { amount: 0.05, scale: 26 },
    },
    plan2d: { hatch: "dots", spacing: 5, angle: 0, weight: 1, color: "#6b7278" },
    dxf: { pattern: "AR-SAND", scale: 0.4, angle: 0 },
  }),
];

/** `Category/file.json`, the path each one lands at. */
export const FILE_OF = {
  "wood.oak.light": "Finishes/light-oak.json",
  "fabric.boucle": "Fabric/boucle.json",
  "ceramic.glazed": "Finishes/ceramic.json",
  "stone.quartz": "Finishes/quartz.json",
  "fabric.rug-pile": "Fabric/rug-pile.json",
  "metal.brass.polished": "Metal/brass-polished.json",
  "metal.aluminium.anodised": "Metal/aluminium-anodised.json",
  "paint.eggshell": "Finishes/paint-eggshell.json",
  "leather.full-grain": "Finishes/leather.json",
  "stone.terrazzo": "Finishes/terrazzo.json",
  "organic.rattan": "Organic/rattan.json",
  "fabric.acoustic-felt": "Fabric/felt.json",
};
