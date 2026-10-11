// S4 helper: snapshot the R2 object + material library into one catalog for matching.
//   node public/build-from-deck-pipeline/tools/catalog.mjs <out.json>     (repo root: needs .env)
// Objects: host kind, title, first description line, every input-props param {id, name, type, value, options}.
// Materials: id, title, category, base colour if stated.
import fs from "node:fs";
import * as r2 from "../../../tools/r2.mjs";

const out = process.argv[2];
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
const cfg = r2.r2ConfigFrom(env);

async function getJson(key) {
  const r = await r2.getObjectText(cfg, key, 30_000_000);
  try { return JSON.parse(r.text); } catch { return null; }
}

const objects = [];
for (const key of (await r2.listObjects(cfg, "library/Objects/")).filter(k => k.endsWith(".json"))) {
  const d = await getJson(key);
  if (!d?.nodes) continue;
  const props = d.nodes.flatMap(n => n.data?.tool === "input-props" ? n.data.params.props : []);
  objects.push({
    path: key.replace(/^library\//, ""), id: d.id, title: d.title ?? d.object?.name, hostKind: d.object?.hostKind,
    about: String(d.description ?? "").split("\n").find(l => l.trim() && !l.includes("six-node spine"))?.slice(0, 240) ?? "",
    params: props.filter(p => p.id !== "P").map(p => ({ id: p.id, name: p.name, type: p.type, value: p.value, ...(p.options?.length ? { options: p.options } : {}) })),
  });
}
const materials = [];
for (const key of (await r2.listObjects(cfg, "library/Materials/")).filter(k => k.endsWith(".json"))) {
  const d = await getJson(key);
  if (!d) continue;
  materials.push({ path: key.replace(/^library\//, ""), id: d.id, title: d.title ?? d.name, category: key.split("/")[2],
                   colour: d.surface?.baseColor ?? d.plan2d?.fill ?? d.color ?? null });
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), objects, materials }, null, 1));
console.log(`catalog: ${objects.length} objects, ${materials.length} materials -> ${out}`);
