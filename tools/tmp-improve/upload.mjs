import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const key = "library/Designs/cropped_floorplan_after_improvement.json";
const body = readFileSync("D:/MAIN/monica_recent/tools/tmp-improve/cropped_floorplan_after_improvement.json");
if ((await listObjectsDetailed(cfg, key)).some((o) => (o.key ?? o.Key) === key)) { console.error("exists — not overwriting"); process.exit(2); }
await putObject(cfg, key, body, "application/json");
const o = (await listObjectsDetailed(cfg, key)).find((o) => (o.key ?? o.Key) === key);
console.log(o && o.size === body.length ? `ok ${key} ${o.size} bytes` : "!! mismatch");
