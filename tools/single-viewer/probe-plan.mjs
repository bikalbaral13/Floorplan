/** Headless bake of the whole plan — the same walk the viewer does, run in Node so the geometry can be
 *  checked before any of it is drawn. Mirrors bakeAttachments.ts: segment → wall midpoint anchor with the
 *  two ends as host, node → the node with one host point, space → centroid with the ring. */
import fs from "node:fs";
import path from "node:path";

const g = {};
new Function("window", "globalThis", fs.readFileSync("cache/engine.js", "utf8") + ";window.PlanEngine=PlanEngine;").call(g, g, g);
const E = g.PlanEngine;

const plan = JSON.parse(fs.readFileSync(process.argv[2] ?? "C:/Users/bikal/Downloads/floorplan_with_bedroom.json", "utf8"));
const ppm = plan.settings.pixelsPerMeter;
const lib = {};
for (const f of fs.readdirSync("cache/objects")) {
  const d = JSON.parse(fs.readFileSync(path.join("cache/objects", f), "utf8"));
  lib[d.id] = d;
}
const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
const symbolOf = (a) => lib[a.objectId]?.object?.symbol;

const forceRows = (obj) => {
  const c = JSON.parse(JSON.stringify(obj));
  for (const n of c.nodes ?? []) if (n?.data?.tool === "render-3d") for (const r of n.data.params?.prims ?? []) r.show = true;
  return c;
};

let total = 0, failed = [];
const report = [];
const bake = (att, anchor, host, label) => {
  const obj = lib[att.objectId];
  if (!obj) { failed.push([label, att.objectId, "no definition"]); return; }
  let r = E.resolveSpineObject(JSON.stringify(obj), anchor, ppm, att.params, host);
  let forced = false;
  if (!r || !r.meshes.length) {
    r = E.resolveSpineObject(JSON.stringify(forceRows(obj)), anchor, ppm, att.params, host);
    forced = true;
  }
  if (!r) { failed.push([label, att.objectId, "resolve returned null"]); return; }
  const nf = r.meshes.reduce((s, m) => s + m.faces.length, 0);
  total += nf;
  if (!r.meshes.length) failed.push([label, att.objectId, "zero meshes"]);
  report.push({ label, id: att.objectId, forced, meshes: r.meshes.map((m) => `${m.name}[${m.faces.length}]`), nf, metrics: r.outputs?.derived?.length ?? 0 });
};

for (const s of plan.segments) {
  if (!s.attachments?.length) continue;
  const a = nodeById.get(s.fromNodeId), b = nodeById.get(s.toNodeId);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const host = [a, b].map((p) => ({ x: (p.x - mid.x) / ppm, y: (p.y - mid.y) / ppm }));
  for (const att of s.attachments) bake(att, mid, host, `seg ${s.id}/${s.layer}`);
}
for (const n of plan.nodes) for (const att of n.attachments ?? []) bake(att, { x: n.x, y: n.y }, [{ x: 0, y: 0 }], `node ${n.id}`);
for (const sp of plan.spaces) {
  const ring = sp.nodeIds.map((i) => nodeById.get(i)).filter(Boolean);
  const c = E.polygonCentroid(ring);
  const host = ring.map((p) => ({ x: (p.x - c.x) / ppm, y: (p.y - c.y) / ppm }));
  for (const att of sp.attachments ?? []) bake(att, c, host, `space ${sp.id}/${sp.label}`);
}

for (const r of report) console.log(`${r.forced ? "!" : " "} ${r.label.padEnd(22)} ${r.id.padEnd(30)} ${r.meshes.join(" ")}`);
console.log(`\n${report.length} attachments, ${total} faces total`);
if (failed.length) { console.log("\nFAILURES:"); for (const f of failed) console.log("  ", f.join(" — ")); }
