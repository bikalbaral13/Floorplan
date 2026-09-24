import { listObjectsDetailed, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("tools/tmp-nebed/mats", { recursive: true });
const objs = await listObjectsDetailed(cfg, "library/Materials/");
const out = {};
for (const o of objs) if (o.key.endsWith(".json")) {
  const k = o.key.replace("library/", "");
  out[k] = JSON.parse((await getObjectText(cfg, o.key)).text);
}
writeFileSync("tools/tmp-nebed/mats/all.json", JSON.stringify(out));
console.log(Object.keys(out).join("\n"));
