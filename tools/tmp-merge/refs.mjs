import { getObjectText, listObjects } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
const keys = (await listObjects(cfg, "library/Skills/")).map((k) => typeof k === "string" ? k : k.key ?? k.Key);
for (const key of keys) {
  if (!/\.(md|mjs|py|json|html)$/.test(key) || key.includes("/Json to Blender Render Ready/")) continue;
  const { text } = await getObjectText(cfg, key, 5_000_000);
  const n = (text.match(/Json to Blender Render Ready|json-to-blender-render-ready|JSON to Blender|bake-and-assign-materials|build-the-blender-scene|verify-the-scene|material-library/gi) || []).length;
  if (n) console.log(n, key);
}
