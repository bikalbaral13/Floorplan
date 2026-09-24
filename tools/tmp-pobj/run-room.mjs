import { writeFileSync } from "node:fs";
import { runExprBody, exprInputs, liftScopeValue } from "@builderpluss/engine/node";
import { room, PALETTE } from "./object-room.mjs";

const mathBody = room.nodes.find(n => n.id === "math").data.params.expr;
const props = room.nodes.find(n => n.id === "props").data.params.props;
const problems = [];

// 1. handles resolve
const inputs = exprInputs(mathBody);
const propIds = props.map(p => p.id);
for (const v of inputs) if (!propIds.includes(v)) problems.push(`free variable "${v}" has no prop — typo, evaluates to 0`);
const defined = new Set();
for (const l of mathBody.split("\n")) { const m = l.match(/^([A-Za-z_]\w*)\s*=(?!=)/); if (m) defined.add(m[1]); }
const slotIds = new Set(room.nodes.find(n => n.id === "out").data.params.slots.map(s => s.id));
const p2 = new Set(room.nodes.find(n => n.id === "r2d").data.params.prims.map(p => p.id));
const p3 = new Set(room.nodes.find(n => n.id === "r3d").data.params.prims.map(p => p.id));
for (const e of room.edges) {
  if (e.source === "math" && !defined.has(e.sourceHandle.slice(4))) problems.push(`${e.id}: math publishes no ${e.sourceHandle.slice(4)}`);
  if (e.target === "math" && !inputs.includes(e.targetHandle.slice(6))) problems.push(`${e.id}: math has no input ${e.targetHandle.slice(6)}`);
  if (e.source === "props" && !propIds.includes(e.sourceHandle.slice(4))) problems.push(`${e.id}: no prop ${e.sourceHandle.slice(4)}`);
  if (e.target === "out" && !slotIds.has(e.targetHandle.slice(6))) problems.push(`${e.id}: no slot ${e.targetHandle.slice(6)}`);
  if (e.target === "r2d" && !p2.has(e.targetHandle.slice(6))) problems.push(`${e.id}: no 2D row ${e.targetHandle.slice(6)}`);
  if (e.target === "r3d" && !p3.has(e.targetHandle.slice(6))) problems.push(`${e.id}: no 3D row ${e.targetHandle.slice(6)}`);
}
const ids = room.edges.map(e => e.id);
if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");
// every render row must be fed by exactly one edge
for (const id of [...p2, ...p3]) {
  const n = room.edges.filter(e => e.targetHandle === `valin-${id}`).length;
  if (n !== 1) problems.push(`row ${id} fed by ${n} edges`);
}

// A wire carries a matrix as JSON TEXT — liftScopeValue lifts a string, not a raw array,
// so this is exactly what the Math Engine sees at runtime.
const run = (P, color) => runExprBody(mathBody, { PI: Math.PI, P: liftScopeValue(JSON.stringify(P)), color });

// 2. metrics against a shape with known answers: 6 x 4 rectangle
const R = [[0,0],[6,0],[6,4],[0,4]];
const r = run(R, "Grey");
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;
if (!near(r.area, 24)) problems.push(`rect area ${r.area} != 24`);
if (!near(r.perimeter, 20)) problems.push(`rect perimeter ${r.perimeter} != 20`);
if (!near(r.dimX, 6) || !near(r.dimY, 4)) problems.push(`rect dims ${r.dimX} x ${r.dimY}`);
if (!near(r.aspect, 1.5)) problems.push(`rect aspect ${r.aspect} != 1.5`);
if (!near(r.centroidX, 3) || !near(r.centroidY, 2)) problems.push(`rect centroid ${r.centroidX},${r.centroidY} != 3,2`);
console.log(`rect 6x4  area=${r.area} perim=${r.perimeter} dims=${r.dimX}x${r.dimY} aspect=${r.aspect} centroid=(${r.centroidX},${r.centroidY})`);

// 3. an L-shape: bounding box must be the box, not an edge; area by decomposition = 6*4 - 3*2 = 18
const L = [[0,0],[6,0],[6,2],[3,2],[3,4],[0,4]];
const l = run(L, "Blue");
if (!near(l.area, 18)) problems.push(`L area ${l.area} != 18`);
if (!near(l.dimX, 6) || !near(l.dimY, 4)) problems.push(`L dims ${l.dimX} x ${l.dimY} != 6 x 4`);
console.log(`L-shape   area=${l.area} perim=${l.perimeter} dims=${l.dimX}x${l.dimY} centroid=(${l.centroidX.toFixed(4)},${l.centroidY.toFixed(4)})`);

// 4. winding must not flip the sign
const rev = run([...R].reverse(), "Grey");
if (!near(rev.area, 24)) problems.push(`reversed winding area ${rev.area} != 24`);

// 5. EXACTLY ONE colour row fed, for every option and for an unrecognised one
for (const c of [...PALETTE.map(p => p.key), "Chartreuse", ""]) {
  const o = run(R, c);
  const fed2 = PALETTE.filter(p => Array.isArray(o[`Room${p.key}`]) && o[`Room${p.key}`].length > 0).map(p => p.key);
  const fed3 = PALETTE.filter(p => Array.isArray(o[`Slab${p.key}`]) && o[`Slab${p.key}`].length > 0).map(p => p.key);
  const expect = PALETTE.some(p => p.key === c) ? c : "Grey";
  const ok = fed2.length === 1 && fed2[0] === expect && fed3.length === 1 && fed3[0] === expect;
  if (!ok) problems.push(`colour "${c}": 2D fed ${JSON.stringify(fed2)}, 3D fed ${JSON.stringify(fed3)}, expected [${expect}]`);
  console.log(`colour ${(c || "(blank)").padEnd(12)} -> 2D ${JSON.stringify(fed2).padEnd(12)} 3D ${JSON.stringify(fed3)}`);
}

// 6. nothing selected: metrics zero, NO row fed, no crash
for (const empty of [[], [[0,0]], [[0,0],[1,1]]]) {
  const o = run(empty, "Blue");
  if (o.area !== 0 || o.perimeter !== 0 || o.dimX !== 0 || o.dimY !== 0) problems.push(`empty host ${JSON.stringify(empty)}: metrics not zero`);
  const fed = PALETTE.filter(p => o[`Room${p.key}`]?.length > 0);
  if (fed.length) problems.push(`empty host: ${fed.length} row(s) still fed`);
}
console.log("empty / 1-pt / 2-pt host: metrics zero, no row fed");

// 7. slab is a well-formed face list
const s = run(R, "Green").SlabGreen;
const faces = new Set(s.map(x => x[3]));
if (s.some(x => x.length !== 4 || !x.every(Number.isFinite))) problems.push("slab malformed");
console.log(`slab: ${s.length} rows, ${faces.size} faces, z ${Math.min(...s.map(x=>x[2]))}..${Math.max(...s.map(x=>x[2]))}`);

const json = JSON.stringify(room, null, 2);
JSON.parse(json);
writeFileSync("out/room.json", json, "utf8");
console.log(`\n${problems.length ? "PROBLEMS:" : "all checks passed"}`);
problems.forEach(p => console.log("  - " + p));
console.log(`room.json  ${(json.length/1024).toFixed(1)} KB  ${room.nodes.length} nodes  ${room.edges.length} edges  ${props.length} props  ${slotIds.size} metrics  ${p2.size}+${p3.size} rows`);
