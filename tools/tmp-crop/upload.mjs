import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const key = "library/Images/cropped_floorplan.png";
const body = readFileSync("D:/MAIN/monica_recent/tools/tmp-crop/cropped_floorplan.png");
const existing = (await listObjectsDetailed(cfg, key)).map((o) => o.key ?? o.Key);
if (existing.includes(key)) { console.error("exists already — not overwriting:", key); process.exit(2); }
await putObject(cfg, key, body, "image/png");
const after = await listObjectsDetailed(cfg, key);
console.log(JSON.stringify(after), "local", body.length);
