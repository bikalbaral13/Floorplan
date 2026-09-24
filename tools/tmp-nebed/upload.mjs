import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const D = "tools/tmp-nebed/skill/";
const files = ["export-room-blend-glb-skp.md","render-a-floorplan.md","inspect-the-blend.md","floorplan-renderer-scripts.md",
  "enrich_plan.mjs","export_room.py","dump_for_skp.py","write_skp.py","verify_skp.py","preview.py","ne_bedroom_pass.py","ne_soft_goods.py"];
const ct = (f) => f.endsWith(".md") ? "text/markdown; charset=utf-8" : f.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "text/x-python; charset=utf-8";
const put = async (key, body, type) => {
  await putObject(cfg, key, body, type);
  const back = (await getObjectText(cfg, key, 5_000_000)).text;
  console.log(back.length === body.length ? "ok " : "!! size mismatch ", key, body.length);
};
for (const f of files) await put(`library/Skills/Floorplan Renderer/${f}`, readFileSync(D + f, "utf8"), ct(f));
await put("library/Skills/Json to Blender Render Ready/enrich_plan.mjs", readFileSync(D + "enrich_plan.mjs", "utf8"), ct("x.mjs"));
