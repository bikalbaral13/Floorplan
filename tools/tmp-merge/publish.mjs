import { putObject, getObjectText, deleteObject, listObjects } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync, readdirSync } from "node:fs";
const D = "D:/MAIN/monica_recent/tools/tmp-merge/merged/";
const FR = "library/Skills/Floorplan Renderer/";
const J2B = "library/Skills/Json to Blender Render Ready/";
const ct = (f) => f.endsWith(".md") ? "text/markdown; charset=utf-8" : f.endsWith(".mjs") ? "text/javascript; charset=utf-8" : f.endsWith(".json") ? "application/json" : "text/x-python; charset=utf-8";
let bad = 0;
for (const f of readdirSync(D)) {
  const body = readFileSync(D + f, "utf8");
  await putObject(cfg, FR + f, body, ct(f));
  const back = (await getObjectText(cfg, FR + f, 5_000_000)).text;
  if (back.length !== body.length) bad++;
  console.log(back.length === body.length ? "ok " : "!! ", FR + f, body.length);
}
if (bad) { console.log("upload mismatches — NOT deleting anything"); process.exit(1); }
await deleteObject(cfg, FR + "bind-plan-materials.md"); console.log("deleted", FR + "bind-plan-materials.md");
const old = (await listObjects(cfg, J2B)).map((k) => typeof k === "string" ? k : k.key ?? k.Key);
for (const k of old) { await deleteObject(cfg, k); console.log("deleted", k); }
console.log("remaining in old folder:", (await listObjects(cfg, J2B)).length);
