import { putObject, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const R = "D:/MAIN/monica_recent/tools/";
const jobs = [
  ...["improve.mjs", "light-the-rooms.md", "emit-improved-canvas-json.md", "verify-the-improvement.md"].map((f) => [R + "tmp-improve/skill/" + f, "library/Skills/Floorplan Improver/" + f]),
  ...["render-a-floorplan.md", "light-and-expose.md", "verify-the-render.md"].map((f) => [R + "tmp-merge/merged/" + f, "library/Skills/Floorplan Renderer/" + f]),
  [R + "tmp-improve/cropped_floorplan_after_improvement.json", "library/Designs/cropped_floorplan_after_improvement.json"],
];
const ct = (f) => f.endsWith(".md") ? "text/markdown; charset=utf-8" : f.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "application/json";
for (const [src, key] of jobs) {
  const body = readFileSync(src);
  await putObject(cfg, key, body, ct(key));
  const o = (await listObjectsDetailed(cfg, key)).find((x) => (x.key ?? x.Key) === key);
  console.log(o?.size === body.length ? "ok " : "!! ", key, body.length);
}
