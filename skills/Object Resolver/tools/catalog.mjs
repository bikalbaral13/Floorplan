// S4 helper: snapshot the R2 object + material library into one catalog for matching.
//   node tools/catalog.mjs <out.json>     (needs R2_* in .env here or in a parent folder, or in the environment)
// Objects: host kind, title, first description line, every input-props param {id, name, type, value, options}.
// Materials: id, title, category, base colour if stated.
import fs from "node:fs";
import * as r2 from "../lib/r2.mjs";

const out = process.argv[2];
const env = r2.loadEnv();
const cfg = r2.r2ConfigFrom(env);

async function getJson(key) {
  const r = await r2.getObjectText(cfg, key, 30_000_000);
  try { return JSON.parse(r.text); } catch { return null; }
}

const progress = (pct, msg) => console.log("@@progress " + JSON.stringify({ pct: Math.round(pct), msg }));
const objects = [];
const objKeys = (await r2.listObjects(cfg, "library/Objects/")).filter(k => k.endsWith(".json"));
for (const [i, key] of objKeys.entries()) {
  if (i % 10 === 0) progress(80 * i / objKeys.length, `Reading library objects: ${i} of ${objKeys.length}`);
  const d = await getJson(key);
  // object/2 (Python) objects: parameters [{key, label, kind, default, options}] instead of an input-props node
  if (d?.version === 2 && d?.python) {
    objects.push({ path: key.replace(/^library\//, ""), id: d.meta?.id ?? key.split("/").pop().replace(/\.json$/, ""), title: d.meta?.name ?? d.title, hostKind: d.hostKind ?? "node", runtime: "python",
      about: String(d.description ?? "").slice(0, 240),
      params: (d.parameters ?? []).map((p) => ({ id: p.key, name: p.label ?? p.key, type: p.kind ?? "number", value: p.default ?? null, ...(p.options?.length ? { options: p.options } : {}) })) });
    continue;
  }
  if (!d?.nodes) continue;
  const props = d.nodes.flatMap(n => n.data?.tool === "input-props" ? n.data.params.props : []);
  objects.push({
    path: key.replace(/^library\//, ""), id: d.id, title: d.title ?? d.object?.name, hostKind: d.object?.hostKind,
    about: String(d.description ?? "").split("\n").find(l => l.trim() && !l.includes("six-node spine"))?.slice(0, 240) ?? "",
    params: props.filter(p => p.id !== "P").map(p => ({ id: p.id, name: p.name, type: p.type, value: p.value, ...(p.options?.length ? { options: p.options } : {}) })),
  });
}
progress(80, `Reading library materials`);
const materials = [];
for (const key of (await r2.listObjects(cfg, "library/Materials/")).filter(k => k.endsWith(".json"))) {
  const d = await getJson(key);
  if (!d) continue;
  materials.push({ path: key.replace(/^library\//, ""), id: d.id, title: d.title ?? d.name, category: key.split("/")[2],
                   colour: d.surface?.baseColor ?? d.plan2d?.fill ?? d.color ?? null });
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), objects, materials }, null, 1));
console.log(`catalog: ${objects.length} objects, ${materials.length} materials -> ${out}`);
