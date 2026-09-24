/** Learn each object's FRONT from its bake, not from its parameters.
 *  Run: node tools/scribbleplan/probe.mjs — bakes every kind at rotation 0 on its own node and prints
 *  the plan bbox, and where the TALLEST element (headboard, backrest, screen, cistern, tap) and the
 *  SMALLEST elements (handles, oven door) sit relative to the centre. Back = tallest; front = handles.
 */
import fs from "node:fs";
import { execSync } from "node:child_process";
import { settings, LAYERS, objectRef } from "./plan.mjs";
const KINDS = ["bed","wardrobe","nightstand","dressing-table","chair","table","sofa","armchair","tv-unit",
  "refrigerator","stove","kitchen-sink","toilet","washbasin","stool","shoe-rack","planter-box","curtain","water-heater","exhaust-hood","ceiling-fan"];
const nodes = [], segments = [];
KINDS.forEach((k, i) => {
  const id = `n${i}`; nodes.push({ id, x: i * 500, y: 0, layer: "0", label: k, attachments: [objectRef(`Objects/Architectural/${k}.json`, `${k}-with-math`, { rotation: 0 })] });
  segments.push({ id: `obj-${i}`, fromNodeId: id, toNodeId: id, layer: "0", thickness: 0.5, color: "#000", mode: "line", method: "center", segmentType: "wall" });
});
fs.writeFileSync("tools/scribbleplan/probe.json", JSON.stringify({ schemaVersion: 1, settings: settings("probe"), nodes, segments, spaces: [], layers: LAYERS, imageUnderlay: null }));
execSync("node tools/bakeplan/run.mjs tools/scribbleplan/probe.json --out tools/scribbleplan/probe.baked.json", { stdio: "ignore" });
const b = JSON.parse(fs.readFileSync("tools/scribbleplan/probe.baked.json", "utf8"));
const r2 = (v) => +v.toFixed(2);
for (const n of b.nodes) {
  const a = n.attachments?.[0]; if (!a?.baked) continue;
  const xs=[],ys=[]; const walk=(v)=>{ if(Array.isArray(v)){ if(v.length>=2&&typeof v[0]==='number'&&typeof v[1]==='number'){xs.push(v[0]);ys.push(v[1]);} v.forEach(walk);} else if(v&&typeof v==='object') Object.values(v).forEach(walk); };
  walk(a.baked.plan2d);
  const meshes = (a.baked.meshes ?? []).map((m) => {
    const pts = m.faces.flat(); const zs = pts.map((p) => p[2]);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const bx = Math.max(...pts.map(p=>p[0]))-Math.min(...pts.map(p=>p[0])), by = Math.max(...pts.map(p=>p[1]))-Math.min(...pts.map(p=>p[1]));
    return { name: m.name, top: Math.max(...zs), vol: bx * by * (Math.max(...zs) - Math.min(...zs)), cx, cy };
  });
  const tall = meshes.reduce((p, m) => (m.top > p.top ? m : p), meshes[0]);
  const small = meshes.filter((m) => m.vol < 0.02);
  const sc = small.length ? [small.reduce((s, m) => s + m.cx, 0) / small.length, small.reduce((s, m) => s + m.cy, 0) / small.length] : null;
  console.log(`${n.label.padEnd(15)} bbox x ${r2(Math.min(...xs))}..${r2(Math.max(...xs))} y ${r2(Math.min(...ys))}..${r2(Math.max(...ys))} | tallest "${tall.name}" @ (${r2(tall.cx)}, ${r2(tall.cy)}) top ${r2(tall.top)} | small(${small.length}) @ ${sc ? `(${r2(sc[0])}, ${r2(sc[1])})` : "-"}  [${meshes.map(m=>m.name).join(", ")}]`);
}
