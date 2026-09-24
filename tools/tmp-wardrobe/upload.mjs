import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const D = "tools/tmp-wardrobe/out/";
const black = {
  schema: "material/1", category: "Metal", id: "metal.matte-black", title: "Metal — matte black powder coat",
  description: "Black powder-coated steel for bar handles, frames and brackets. Metallic 0 on purpose: the surface is the paint, not the steel. A very fine low-contrast noise and a soft coat give the satin highlight that separates a real matte black from a flat black fill, which renders as a hole in the picture.",
  procedural: { type: "noise", blenderNode: "ShaderNodeTexNoise", params: { scale: 400, detail: 2, roughness: 0.5, distortion: 0, colorA: "#1d1d1d", colorB: "#161616" } },
  pbr: { baseColor: "#1a1a1a", roughness: 0.5, metallic: 0 },
  surface: { bevel: { width: 0.0008, samples: 3 }, coat: { weight: 0.15, roughness: 0.35, ior: 1.5 }, roughnessVariation: { amount: 0.06, scale: 40 } },
  plan2d: { hatch: "none", spacing: 5, angle: 0, weight: 1, color: "#1a1a1a" },
  dxf: { pattern: "ANSI32", scale: 0.2, angle: 0 },
};
const veneer = {
  schema: "material/1", category: "Finishes", id: "wood.oak.veneer", title: "Wood — light oak veneer, vertical grain",
  description: "Crown-cut light oak on joinery fronts: wardrobe doors, drawer fronts, panelling. The library light oak is a world-space wave with heavy distortion, which on a two-metre door reads as marble. Here the bands run along X with little distortion and a fine detail layer, so on any front facing plus or minus y the grain is a tight, straight vertical figure, as a veneered door is laid up.",
  procedural: { type: "wave", blenderNode: "ShaderNodeTexWave", params: { waveType: "BANDS", bandsDirection: "X", waveProfile: "SIN", scale: 22, distortion: 2.5, detail: 4, detailScale: 3, detailRoughness: 0.6, phaseOffset: 0, colorA: "#dcc39d", colorB: "#c9a97f" } },
  pbr: { baseColor: "#d3b68e", roughness: 0.5, metallic: 0 },
  surface: { bevel: { width: 0.0015, samples: 3 }, normal: { source: "procedural", strength: 0.25, scale: 1 }, coat: { weight: 0.12, roughness: 0.3, ior: 1.5 }, roughnessVariation: { amount: 0.08, scale: 12 } },
  plan2d: { hatch: "diagonal", spacing: 5, angle: 0, weight: 1, color: "#d3b68e" },
  dxf: { pattern: "ANSI32", scale: 0.5, angle: 90 },
};
writeFileSync(D + "oak-veneer.json", JSON.stringify(veneer, null, 2));
writeFileSync(D + "matte-black.json", JSON.stringify(black, null, 2));
const put = async (key, body) => {
  await putObject(cfg, key, body, "application/json");
  const back = (await getObjectText(cfg, key, 5_000_000)).text;
  console.log(back.length === body.length ? "ok " : "!! size mismatch ", key, body.length);
};
await put("library/Materials/Metal/matte-black.json", readFileSync(D + "matte-black.json", "utf8"));
await put("library/Materials/Finishes/oak-veneer.json", readFileSync(D + "oak-veneer.json", "utf8"));
await put("library/Objects/Architectural/wardrobe.json", readFileSync(D + "wardrobe.json", "utf8"));
