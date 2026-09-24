import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const D = "D:/MAIN/monica_recent/tools/tmp-plant/out/";
const leaf = {
  schema: "material/1", category: "Organic", id: "organic.leaf.glossy", title: "Leaf — glossy tropical, deep green",
  description: "Large glossy tropical leaves (bird-of-paradise, banana, philodendron). Deep green with a lighter mottle from a fine noise; the waxy cuticle is a low roughness plus a soft coat, which is what gives these leaves their long highlights; a little subsurface lets backlit leaves glow green instead of going black.",
  procedural: { type: "noise", blenderNode: "ShaderNodeTexNoise", params: { scale: 18, detail: 4, roughness: 0.55, distortion: 0.6, colorA: "#2a5226", colorB: "#3d6e32" } },
  pbr: { baseColor: "#335f2c", roughness: 0.35, metallic: 0 },
  surface: { coat: { weight: 0.3, roughness: 0.2, ior: 1.45 }, subsurface: { weight: 0.15, radius: [0.004, 0.008, 0.003], scale: 0.01 },
    normal: { source: "procedural", strength: 0.25, scale: 1 }, roughnessVariation: { amount: 0.1, scale: 20 } },
  plan2d: { hatch: "dots", spacing: 6, angle: 0, weight: 1, color: "#335f2c" },
  dxf: { pattern: "GRASS", scale: 0.3, angle: 0 },
};
const stone = {
  schema: "material/1", category: "Finishes", id: "finish.planter-stone", title: "Planter — matte speckled off-white stone",
  description: "Fibre-stone / cast-concrete planter in warm off-white. A fine voronoi speckle gives the sandy, slightly porous surface such planters have; matte, no coat.",
  procedural: { type: "voronoi", blenderNode: "ShaderNodeTexVoronoi", params: { scale: 260, detail: 2, roughness: 0.5, randomness: 1, feature: "F1", distance: "EUCLIDEAN", colorA: "#ebe6dd", colorB: "#d9d2c6" } },
  pbr: { baseColor: "#e3ddd2", roughness: 0.82, metallic: 0 },
  surface: { bevel: { width: 0.002, samples: 3 }, normal: { source: "procedural", strength: 0.35, scale: 1 }, roughnessVariation: { amount: 0.06, scale: 15 } },
  plan2d: { hatch: "dots", spacing: 5, angle: 0, weight: 1, color: "#e3ddd2" },
  dxf: { pattern: "AR-CONC", scale: 0.3, angle: 0 },
};
writeFileSync(D + "leaf-glossy.json", JSON.stringify(leaf, null, 2));
writeFileSync(D + "planter-stone.json", JSON.stringify(stone, null, 2));
for (const [src, key] of [["leaf-glossy.json", "library/Materials/Organic/leaf-glossy.json"], ["planter-stone.json", "library/Materials/Finishes/planter-stone.json"], ["plant.json", "library/Objects/Architectural/plant.json"]]) {
  const body = readFileSync(D + src);
  await putObject(cfg, key, body, "application/json");
  const o = (await listObjectsDetailed(cfg, key)).find((x) => (x.key ?? x.Key) === key);
  console.log(o?.size === body.length ? "ok " : "!! ", key, body.length);
}
