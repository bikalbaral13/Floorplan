import { getObjectText, listObjects } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const pre = "library/Skills/Floorplan Improver/";
mkdirSync("D:/MAIN/monica_recent/tools/tmp-improve/skill", { recursive: true });
for (const k of await listObjects(cfg, pre)) { const key = typeof k === "string" ? k : k.key ?? k.Key;
  const { text } = await getObjectText(cfg, key, 20_000_000); writeFileSync("D:/MAIN/monica_recent/tools/tmp-improve/skill/" + key.slice(pre.length), text); console.log(key.slice(pre.length), text.length); }
