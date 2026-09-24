import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const D = "tools/tmp-chair/out/";
// cream faux leather, derived from the full-grain leather recipe
const m = JSON.parse(readFileSync(D + "leather.json", "utf8"));
Object.assign(m, {
  id: "leather.faux.cream", title: "Leather — faux, cream",
  description: "Cream PU faux leather for upholstered dining chairs. Same two-scale voronoi pebble as full grain but finer and shallower (a coated fabric, not a hide), lighter coat and a touch more sheen, so the quilting and piping read by their highlights.",
});
m.procedural.params = { ...m.procedural.params, scale: 520, colorA: "#e9dfcf", colorB: "#dcd0bd" };
m.pbr = { baseColor: "#e3d8c6", roughness: 0.45, metallic: 0 };
m.surface.normal.strength = 0.5;
m.surface.coat = { weight: 0.28, roughness: 0.25, ior: 1.45 };
m.surface.subsurface.weight = 0.06;
m.plan2d.color = "#e3d8c6";
writeFileSync(D + "leather-cream.json", JSON.stringify(m, null, 2));
const put = async (key, body) => {
  await putObject(cfg, key, body, "application/json");
  const back = (await getObjectText(cfg, key, 5_000_000)).text;
  console.log(back.length === body.length ? "ok " : "!! size mismatch ", key, body.length);
};
await put("library/Materials/Finishes/leather-cream.json", readFileSync(D + "leather-cream.json", "utf8"));
await put("library/Objects/Architectural/chair.json", readFileSync(D + "chair.json", "utf8"));
