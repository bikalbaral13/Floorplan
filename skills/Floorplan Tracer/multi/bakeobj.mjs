import fs from "node:fs";
import { bake, planSlots } from "../fi/bake.mjs";
const plan = JSON.parse(fs.readFileSync("Ramanadhapuram_Villa1.json", "utf8"));
const out = {};
for (const L of plan.levels) {
  const polys = [];
  for (const n of L.nodes) for (const a of n.attachments ?? []) {
    const f = `../objs/${a.objectPath.split("/").pop()}`;
    const r = bake(f, [[0, 0]], a.params); const { drawn } = planSlots(f);
    for (const name of drawn) { const v = r[name]; if (!Array.isArray(v)) continue;
      const pts = v.filter((row) => Array.isArray(row) && row.length >= 2 && Number.isFinite(row[0])).map(([x, y]) => [n.x + x * plan.settings.pixelsPerMeter, n.y + y * plan.settings.pixelsPerMeter]);
      if (pts.length > 1) polys.push({ kind: a.objectId, pts }); }
  }
  out[L.id] = polys; console.log(L.id, polys.length, "rings");
}
fs.writeFileSync("objpolys.json", JSON.stringify(out));
