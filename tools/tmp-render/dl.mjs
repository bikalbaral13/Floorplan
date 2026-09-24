/** Pull everything this pass edits out of R2: materials, objects, the render skill, the plan. */
import { listObjectsDetailed, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const ROOT = "tools/tmp-render";
for (const d of ["live/Materials", "live/Objects", "live/Skill", "live/Designs", "out/Materials", "out/Objects", "out/Skill", "out/Designs"]) {
  mkdirSync(`${ROOT}/${d}`, { recursive: true });
}

const pull = async (prefix, into, flat = true) => {
  const objs = (await listObjectsDetailed(cfg, prefix)).filter((o) => /\.(json|py|mjs|md)$/.test(o.key));
  for (const o of objs) {
    const rel = o.key.slice(prefix.length);
    const name = flat ? rel.replace(/\//g, "__") : rel;
    writeFileSync(`${ROOT}/live/${into}/${name}`, (await getObjectText(cfg, o.key)).text, "utf8");
  }
  console.log(`${into.padEnd(10)} ${String(objs.length).padStart(3)} files`);
  return objs.map((o) => o.key.slice(prefix.length));
};

await pull("library/Materials/", "Materials");
await pull("library/Objects/Architectural/", "Objects");
await pull("library/Skills/Json to Blender Render Ready/", "Skill");
for (const d of ["floorplan_with_bedroom.json", "floorplan_with_bedroom_render/floorplan_with_bedroom_render.json"]) {
  writeFileSync(`${ROOT}/live/Designs/${d.split("/").pop()}`, (await getObjectText(cfg, `library/Designs/${d}`)).text, "utf8");
}
console.log("Designs      2 files");
