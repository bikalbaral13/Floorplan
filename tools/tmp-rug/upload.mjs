import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const D = "D:/MAIN/monica_recent/tools/tmp-rug/out/";
for (const [f, key] of [["rug-pile-cream.json", "library/Materials/Fabric/rug-pile-cream.json"], ["rug-pile-sage.json", "library/Materials/Fabric/rug-pile-sage.json"], ["rug-pile-tan.json", "library/Materials/Fabric/rug-pile-tan.json"], ["rug.json", "library/Objects/Architectural/rug.json"]]) {
  const body = readFileSync(D + f);
  await putObject(cfg, key, body, "application/json");
  const o = (await listObjectsDetailed(cfg, key)).find((x) => (x.key ?? x.Key) === key);
  console.log(o?.size === body.length ? "ok " : "!! ", key, body.length);
}
