/** STEP 1a — the `surface` block, and which of the 27 existing materials gets what.
 *
 *  WHY ONE BLOCK AND NOT NINE. `material/1` already holds one flat recipe per consumer
 *  (`procedural` / `pbr` / `plan2d` / `dxf`) plus the additive `emission`. Nine new top-level keys
 *  would be nine things every consumer has to learn to ignore; one `surface` block is one, and the
 *  schema string stays `material/1` for the same reason `emission` did — consumers skip what they
 *  do not know, and bumping it would make `tools/skpir` reject the file.
 *
 *  WHAT IS IN IT, in the order it matters for a render:
 *    bevel               rounds every edge in the shader. Sharp 90 degrees catch no highlight at
 *                        all, and that is the single loudest "this is CG" signal there is.
 *    roughnessVariation  a second noise on roughness. Uniform gloss is the next loudest.
 *    normal              bump from the material's own procedural, so a tile has grout depth and a
 *                        plaster wall has tooth.
 *    grain               direction. A wood whose grain does not run along the plank reads as
 *                        smeared marble — which is exactly what the bedroom TV wall does today.
 *    sheen / subsurface / coat / anisotropy / displacement — the four surface classes that a plain
 *                        Principled cannot express: cloth, leaf, lacquer, brushed metal.
 *
 *  Every sub-key is OPTIONAL. A material states only what is true of it, and a consumer that reads
 *  none of this still gets the same result it got before.
 */

/** Bevel width by how a material is actually made, in metres. A drawn glass edge is sharp because
 *  it was cut; a plastered arris is soft because it was floated. */
const BEVEL = {
  glass: 0.0004, metal: 0.0008, paint: 0.0015, timber: 0.002, plaster: 0.003, masonry: 0.004,
};

const b = (k) => ({ width: BEVEL[k], samples: 4 });

/** id -> surface block. Anything absent gets nothing, which is a statement, not an omission. */
export const SURFACES = {
  // ── Emissive. A diffuser is a sheet of acrylic: slightly soft edges, no variation (it is lit
  // from behind, so roughness noise would read as dirt).
  "emissive.diffuser": { bevel: b("paint") },
  "emissive.led.warm": { bevel: { width: 0.0006, samples: 3 } },

  // ── Fabric. No bevel — soft goods have no arris to round — but every one of them needs sheen,
  // which is the retroreflective rim a Principled has no other way to say.
  "fabric.blackout": { sheen: { weight: 0.25, roughness: 0.4, tint: "#d8cfc0" },
                       roughnessVariation: { amount: 0.05, scale: 14 } },
  "fabric.cotton": { sheen: { weight: 0.35, roughness: 0.35, tint: "#ffffff" },
                     normal: { source: "procedural", strength: 0.25, scale: 1 },
                     roughnessVariation: { amount: 0.06, scale: 30 } },
  "fabric.linen": { sheen: { weight: 0.45, roughness: 0.3, tint: "#f3ead9" },
                    normal: { source: "procedural", strength: 0.45, scale: 1 },
                    roughnessVariation: { amount: 0.08, scale: 26 } },
  // Velvet is the case sheen exists for: nearly all of what you see is the rim, not the body.
  "fabric.velvet": { sheen: { weight: 0.9, roughness: 0.12, tint: "#b9c6e8" },
                     roughnessVariation: { amount: 0.05, scale: 40 } },
  "fabric.wool": { sheen: { weight: 0.55, roughness: 0.35, tint: "#e8e4dc" },
                   normal: { source: "procedural", strength: 0.6, scale: 1 },
                   roughnessVariation: { amount: 0.1, scale: 18 } },

  // ── Finishes.
  "paint.lacquer": { bevel: b("paint"), coat: { weight: 0.55, roughness: 0.06, ior: 1.5 },
                     roughnessVariation: { amount: 0.06, scale: 12 } },
  // Marble is translucent for the first few millimetres. Without subsurface it is painted stone.
  "stone.marble": { bevel: b("masonry"), subsurface: { weight: 0.12, radius: [0.02, 0.018, 0.015], scale: 0.01 },
                    coat: { weight: 0.35, roughness: 0.05, ior: 1.5 },
                    roughnessVariation: { amount: 0.05, scale: 6 } },
  "paper.matt": { bevel: { width: 0.0003, samples: 3 },
                  subsurface: { weight: 0.35, radius: [0.004, 0.004, 0.004], scale: 0.004 },
                  normal: { source: "procedural", strength: 0.2, scale: 1 },
                  roughnessVariation: { amount: 0.07, scale: 24 } },
  "plaster.smooth": { bevel: b("plaster"), normal: { source: "procedural", strength: 0.35, scale: 1 },
                      roughnessVariation: { amount: 0.1, scale: 5 } },
  // Grout depth is displacement, not bump: at a grazing angle a bumped grout line stays flat.
  "tile.square-300": { bevel: { width: 0.001, samples: 4 }, coat: { weight: 0.6, roughness: 0.04, ior: 1.5 },
                       normal: { source: "procedural", strength: 0.8, scale: 1 },
                       displacement: { scale: 0.0015, midlevel: 0.5 },
                       roughnessVariation: { amount: 0.05, scale: 10 } },
  "wood.walnut": { bevel: b("timber"), grain: { axis: "u", rotationDeg: 0, scaleU: 1, scaleV: 0.28 },
                   normal: { source: "procedural", strength: 0.35, scale: 1 },
                   coat: { weight: 0.25, roughness: 0.12, ior: 1.5 },
                   roughnessVariation: { amount: 0.09, scale: 9 } },
  "wood.oak": { bevel: b("timber"), grain: { axis: "u", rotationDeg: 0, scaleU: 1, scaleV: 0.3 },
                normal: { source: "procedural", strength: 0.4, scale: 1 },
                coat: { weight: 0.2, roughness: 0.14, ior: 1.5 },
                roughnessVariation: { amount: 0.1, scale: 8 } },

  // ── Glazing. A pane is cut, so its edge is nearly sharp; a mirror sits in a frame and shows
  // whatever the room shows, so any roughness noise on it is visible as haze. Neither gets any.
  "glass.clear": { bevel: b("glass") },
  "glass.mirror": { bevel: b("glass") },
  "glass.screen": { bevel: { width: 0.0006, samples: 3 }, coat: { weight: 0.8, roughness: 0.03, ior: 1.5 } },

  // ── Masonry.
  "brick.running-bond": { bevel: b("masonry"), normal: { source: "procedural", strength: 1, scale: 1 },
                          displacement: { scale: 0.004, midlevel: 0.5 },
                          roughnessVariation: { amount: 0.12, scale: 7 } },
  "concrete.fair-face": { bevel: b("masonry"), normal: { source: "procedural", strength: 0.5, scale: 1 },
                          roughnessVariation: { amount: 0.13, scale: 4 } },
  "stone.random-rubble": { bevel: { width: 0.006, samples: 4 }, normal: { source: "procedural", strength: 1.2, scale: 1 },
                           displacement: { scale: 0.008, midlevel: 0.5 },
                           roughnessVariation: { amount: 0.14, scale: 5 } },

  // ── Metal. Brushed metal is anisotropic, and that is not a detail: the stretched highlight IS
  // what tells you it is brushed rather than painted grey.
  "metal.brass": { bevel: b("metal"), anisotropy: { strength: 0.55, rotationDeg: 0 },
                   grain: { axis: "u", rotationDeg: 0, scaleU: 1, scaleV: 0.06 },
                   roughnessVariation: { amount: 0.05, scale: 30 } },
  "metal.powdercoat": { bevel: b("paint"), normal: { source: "procedural", strength: 0.3, scale: 1 },
                        roughnessVariation: { amount: 0.07, scale: 22 } },
  "metal.steel-brushed": { bevel: b("metal"), anisotropy: { strength: 0.75, rotationDeg: 0 },
                           roughnessVariation: { amount: 0.04, scale: 40 } },

  // ── Organic. A leaf is thin and lit from behind as often as in front.
  "organic.bark": { bevel: { width: 0.003, samples: 4 }, normal: { source: "procedural", strength: 1.4, scale: 1 },
                    grain: { axis: "v", rotationDeg: 0, scaleU: 0.3, scaleV: 1 },
                    displacement: { scale: 0.006, midlevel: 0.5 },
                    roughnessVariation: { amount: 0.12, scale: 6 } },
  "organic.foliage": { subsurface: { weight: 0.45, radius: [0.012, 0.03, 0.008], scale: 0.01 },
                       normal: { source: "procedural", strength: 0.5, scale: 1 },
                       coat: { weight: 0.3, roughness: 0.25, ior: 1.45 },
                       roughnessVariation: { amount: 0.1, scale: 20 } },

  // ── Site.
  "grass.lawn": { subsurface: { weight: 0.3, radius: [0.008, 0.02, 0.006], scale: 0.008 },
                  normal: { source: "procedural", strength: 0.8, scale: 1 },
                  displacement: { scale: 0.01, midlevel: 0.5 },
                  roughnessVariation: { amount: 0.12, scale: 16 } },
  "gravel.20mm": { normal: { source: "procedural", strength: 1.5, scale: 1 },
                   displacement: { scale: 0.012, midlevel: 0.5 },
                   roughnessVariation: { amount: 0.15, scale: 9 } },
};
