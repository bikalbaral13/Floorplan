import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
for (const f of ["improve.mjs", "lay-out-tiles-and-floor-finishes.md", "read-the-plan-and-brief.md"]) {
  const key = "library/Skills/Floorplan Improver/" + f, body = readFileSync("D:/MAIN/monica_recent/tools/tmp-improve/skill/" + f);
  await putObject(cfg, key, body, f.endsWith(".md") ? "text/markdown; charset=utf-8" : "text/javascript; charset=utf-8");
  const o = (await listObjectsDetailed(cfg, key)).find((x) => (x.key ?? x.Key) === key);
  console.log(o?.size === body.length ? "ok " : "!! ", key, body.length);
}
