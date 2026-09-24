import { getObjectText, listObjects } from "./r2.mjs";
import { cfg } from "./tmp-r2/ls.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
for (const [dir, pre] of [["fr", "library/Skills/Floorplan Renderer/"], ["j2b", "library/Skills/Json to Blender Render Ready/"]]) {
  mkdirSync(`D:/MAIN/monica_recent/tools/tmp-merge/${dir}`, { recursive: true });
  const keys = await listObjects(cfg, pre);
  for (const k of keys) { const key = typeof k === "string" ? k : k.key ?? k.Key; const { text } = await getObjectText(cfg, key, 5_000_000); writeFileSync(`D:/MAIN/monica_recent/tools/tmp-merge/${dir}/${key.slice(pre.length)}`, text); }
}
