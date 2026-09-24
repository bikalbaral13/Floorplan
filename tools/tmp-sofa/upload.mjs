import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const D = "tools/tmp-sofa/out/";
const chenille = {
  schema: "material/1", category: "Fabric", id: "fabric.chenille.grey", title: "Fabric — chenille, mid grey",
  description: "Soft crushed-pile chenille upholstery. A centimetre-scale noise gives the mottled light-and-dark patches a chenille shows where the pile lies in different directions; the silvery sheen is most of what reads as chenille rather than flat felt, which is why sheen carries more weight than the base colour here.",
  procedural: { type: "noise", blenderNode: "ShaderNodeTexNoise", params: { scale: 90, detail: 6, roughness: 0.62, distortion: 0.8, colorA: "#8a8782", colorB: "#b0aca6" } },
  pbr: { baseColor: "#9d9994", roughness: 0.9, metallic: 0, sheen: 0.6, sheenTint: "#e6e4e0" },
  surface: {
    sheen: { weight: 0.8, roughness: 0.3, tint: "#e8e8e8" },
    normal: { source: "procedural", strength: 0.6, scale: 1 },
    roughnessVariation: { amount: 0.08, scale: 30 },
  },
  plan2d: { hatch: "dots", spacing: 5, angle: 0, weight: 1, color: "#9d9994" },
  dxf: { pattern: "HOUND", scale: 0.05, angle: 0 },
};
const print = {
  schema: "material/1", category: "Fabric", id: "fabric.print.teal", title: "Fabric — abstract print, teal on cream",
  description: "Cushion-cover cotton printed with bold irregular shapes in deep teal on cream. Voronoi cells at roughly 10 cm give the blocky, hand-cut look of an abstract print; it is a stand-in for a printed textile, not a specific design, and its pbr colour is the average a glTF viewer will show.",
  procedural: { type: "voronoi", blenderNode: "ShaderNodeTexVoronoi", params: { scale: 9, detail: 0, roughness: 0.5, randomness: 1, feature: "F1", distance: "EUCLIDEAN", colorA: "#1f4a4f", colorB: "#efe9dd" } },
  pbr: { baseColor: "#879a99", roughness: 0.85, metallic: 0, sheen: 0.3, sheenTint: "#ffffff" },
  surface: {
    sheen: { weight: 0.3, roughness: 0.4, tint: "#ffffff" },
    normal: { source: "procedural", strength: 0.3, scale: 1 },
  },
  plan2d: { hatch: "dots", spacing: 5, angle: 0, weight: 1, color: "#2f5d62" },
  dxf: { pattern: "AR-SAND", scale: 0.4, angle: 0 },
};
writeFileSync(D + "chenille-grey.json", JSON.stringify(chenille, null, 2));
writeFileSync(D + "print-teal.json", JSON.stringify(print, null, 2));
const put = async (key, body) => {
  await putObject(cfg, key, body, "application/json");
  const back = (await getObjectText(cfg, key, 5_000_000)).text;
  console.log(back.length === body.length ? "ok " : "!! size mismatch ", key, body.length);
};
await put("library/Materials/Fabric/chenille-grey.json", readFileSync(D + "chenille-grey.json", "utf8"));
await put("library/Materials/Fabric/print-teal.json", readFileSync(D + "print-teal.json", "utf8"));
await put("library/Objects/Architectural/sofa.json", readFileSync(D + "sofa.json", "utf8"));
