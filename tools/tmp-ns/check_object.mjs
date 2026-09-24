/** Evaluate a six-node object's Math Engine headlessly, time it, check every mesh row, and write an OBJ.
 *
 *  node check_object.mjs <object.json> [--set k=v ...] [--obj out/chair.obj]
 *
 *  Checks: face runs contiguous and >= 3 verts, all finite, each closed solid's SIGNED VOLUME (an
 *  inside-out loft still renders, it just lights wrongly — volume is the check that catches it), and the
 *  plan rows as rings.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runExprBody } from "@builderpluss/engine/node";

const argv = process.argv.slice(2);
const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--set" && argv[i - 1] !== "--obj") ?? (console.error("usage: node check_object.mjs <object.json> [--set k=v ...] [--obj out.obj]"), process.exit(1));
const objOut = argv.includes("--obj") ? argv[argv.indexOf("--obj") + 1] : null;
const sets = {};
argv.forEach((a, i) => { if (a === "--set") { const [k, v] = argv[i + 1].split("="); sets[k] = isNaN(+v) ? (v === "true" ? 1 : v === "false" ? 0 : v) : +v; } });

const flow = JSON.parse(readFileSync(file, "utf8"));
const node = (t) => flow.nodes.find((n) => n.data.tool === t);
const props = node("input-props").data.params.props;
const scope = { PI: Math.PI };
for (const p of props) {
  let v = p.id in sets ? sets[p.id] : p.value;
  if (typeof v === "boolean") v = v ? 1 : 0;
  if (typeof v === "string" && /^\s*\[/.test(v)) v = JSON.parse(v);
  scope[p.id] = v;
}
if (sets.P) scope.P = JSON.parse(sets.P);

const t0 = performance.now();
const vals = runExprBody(node("expr").data.params.expr, scope);
const ms = performance.now() - t0;

const edges = flow.edges;
const slotName = {};
for (const e of edges) if (e.source === "math" && e.target === "out") slotName[e.targetHandle.slice(6)] = e.sourceHandle.slice(4);
const rowVal = (nodeId, rowId) => {
  const e = edges.find((x) => x.target === nodeId && x.targetHandle === `valin-${rowId}`);
  return e ? vals[slotName[e.sourceHandle.slice(4)]] : undefined;
};

const faces = (M) => {
  const out = []; let cur = []; let key = null;
  for (const r of M) { if (key !== null && r[3] !== key) { out.push(cur); cur = []; } key = r[3]; cur.push([r[0], r[1], r[2]]); }
  if (cur.length) out.push(cur);
  return out;
};
const vol = (F) => {
  let v = 0;
  for (const f of F) for (let i = 1; i + 1 < f.length; i++) {
    const [a, b, c] = [f[0], f[i], f[i + 1]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
};

let bad = 0;
console.log(`${file}  eval ${ms.toFixed(0)} ms  ${JSON.stringify(sets)}`);
const objLines = [];
let vbase = 1;
for (const row of node("render-3d").data.params.prims) {
  const M = rowVal("r3d", row.id);
  if (!Array.isArray(M) || !M.length) { console.log(`  ${row.name.padEnd(8)} (empty)`); continue; }
  const probs = [];
  if (M.some((r) => r.length !== 4 || !r.every(Number.isFinite))) probs.push("non-finite / width");
  const F = faces(M);
  const short = F.filter((f) => f.length < 3).length;
  if (short) probs.push(`${short} faces < 3 verts`);
  const ids = new Set(); let split = 0; let k = null;
  for (const r of M) { if (r[3] !== k) { if (ids.has(r[3])) split++; ids.add(r[3]); k = r[3]; } }
  if (split) probs.push(`${split} ids split into two runs`);
  const V = vol(F);
  if (V <= 0) probs.push(`signed volume ${V.toExponential(2)} (inside-out?)`);
  bad += probs.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of M) { x0 = Math.min(x0, r[0]); x1 = Math.max(x1, r[0]); y0 = Math.min(y0, r[1]); y1 = Math.max(y1, r[1]); z0 = Math.min(z0, r[2]); z1 = Math.max(z1, r[2]); }
  console.log(`  ${row.name.padEnd(8)} ${String(F.length).padStart(6)} faces  vol ${(V * 1000).toFixed(2)} L  x[${x0.toFixed(3)},${x1.toFixed(3)}] y[${y0.toFixed(3)},${y1.toFixed(3)}] z[${z0.toFixed(3)},${z1.toFixed(3)}]  ${probs.join("; ") || "ok"}`);
  objLines.push(`o ${row.name}`);
  const vs = [], fs = [];
  for (const f of F) { const idx = []; for (const p of f) { vs.push(`v ${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`); idx.push(vbase++); } fs.push(`f ${idx.join(" ")}`); }
  objLines.push(...vs, ...fs);
}
for (const row of node("render-2d").data.params.prims) {
  const M = rowVal("r2d", row.id);
  const n = Array.isArray(M) ? M.length : 0;
  const okp = n === 0 || n >= 3 && M.every((r) => r.length === 3 && r.every(Number.isFinite));
  if (!okp) bad++;
  console.log(`  plan ${row.name.padEnd(6)} ${n} pts ${n === 0 ? "(empty)" : okp ? "ok" : "BAD"}`);
}
for (const s of node("output").data.params.slots) {
  const v = vals[slotName[s.id]];
  if (typeof v === "number") console.log(`  ${s.label.padEnd(24)} ${+v.toFixed(4)}`);
}
if (objOut) { writeFileSync(objOut, objLines.join("\n")); console.log(`  wrote ${objOut}`); }
console.log(bad ? `FAIL ${bad}` : "PASS");
process.exitCode = bad ? 1 : 0;
