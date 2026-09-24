import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const key = "library/Objects/Architectural/tv-unit.json", body = readFileSync("D:/MAIN/monica_recent/tools/tmp-tv/out/tv-unit.json");
await putObject(cfg, key, body, "application/json");
const o = (await listObjectsDetailed(cfg, key)).find((x) => (x.key ?? x.Key) === key);
console.log(o?.size === body.length ? "ok " : "!! ", key, body.length);
