import { listObjectsDetailed, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
const R = "tools/tmp-nebed";
const pull = async (prefix, into) => {
  const objs = await listObjectsDetailed(cfg, prefix);
  mkdirSync(`${R}/${into}`, { recursive: true });
  for (const o of objs) {
    if (!/\.(json|py|mjs|md|html)$/.test(o.key)) { console.log("skip", o.key, o.size); continue; }
    const rel = o.key.slice(prefix.length).replace(/\//g, "__");
    const t = (await getObjectText(cfg, o.key, 60_000_000)).text;
    writeFileSync(`${R}/${into}/${rel}`, t, "utf8");
    console.log(into, rel, t.length);
  }
};
await pull("library/Skills/Floorplan Renderer/", "skill");
await pull("library/Skills/Json to Blender Render Ready/", "j2b");
const d = await getObjectText(cfg, "library/Designs/floorplan_with_bedroom_after_improvement.json", 60_000_000);
writeFileSync(`${R}/plan.json`, d.text, "utf8"); console.log("plan", d.text.length);
