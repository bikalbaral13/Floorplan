import { getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { writeFileSync, readFileSync } from "node:fs";
const plan = JSON.parse(readFileSync("D:/MAIN/monica_recent/tools/tmp-improve/cropped_floorplan_after_improvement.json", "utf8"));
const paths = new Set();
for (const x of [...plan.nodes, ...plan.segments, ...plan.spaces]) for (const a of x.attachments ?? []) if (a.objectPath) paths.add(a.objectPath);
for (const p of paths) { const { text } = await getObjectText(cfg, "library/" + p, 20_000_000); writeFileSync("D:/MAIN/monica_recent/tools/tmp-improve/" + p.split("/").pop(), text); }
console.log("objects", paths.size);
