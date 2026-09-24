/** Prove the emitted Dynamic Component formulas rebuild the same geometry the Math Engine does.
 *
 *  SketchUp is not scriptable from outside a running session, so the DC engine cannot be asked. It does not
 *  need to be: the formulas are a closed little language, so evaluate them HERE, turn each part into the box
 *  SketchUp would draw, and compare against the bake — the same `resolved.meshes` the existing importer reads.
 *  A run that matches across a spread of parameter sets is the same evidence a screenshot would be, and it
 *  covers the branches (Plinth, Floating, no headboard, footboard, duvet, odd pillow counts) that one
 *  screenshot would not.
 *
 *  Usage:  node tools/skpir/verify.mjs <object.json> <object.skpir.json>
 */

import { readFileSync } from "node:fs";
import { evalFormula } from "./dceval.mjs";

const M2IN = 39.37007874015748;
const TOL = 1e-6;

// ── boxes the DC would draw, back in the object's own frame (metres, +v south) ─────────────────────
function dcBoxes(ir, values) {
  const out = new Map(); // group -> [{u0,u1,v0,v1,z0,z1}]
  for (const part of ir.parts) {
    const base = { ...values, COPY: 0 };
    if (part.hidden && evalFormula(part.hidden, base)) continue;
    const n = part.copies ? Math.max(0, Math.round(evalFormula(part.copies, base))) : 0;
    for (let c = 0; c <= n; c++) {
      const env = { ...values, COPY: c };
      const x = evalFormula(part.x, env) / M2IN, lx = evalFormula(part.lenx, env) / M2IN;
      const y = evalFormula(part.y, env) / M2IN, ly = evalFormula(part.leny, env) / M2IN;
      const z = evalFormula(part.z, env) / M2IN, lz = evalFormula(part.lenz, env) / M2IN;
      if (Math.abs(lx) < 1e-9 || Math.abs(ly) < 1e-9 || Math.abs(lz) < 1e-9) continue; // degenerate: SketchUp draws nothing
      // SketchUp y is NORTH-positive; the object frame is SOUTH-positive. Undo the flip to compare.
      const box = { u0: Math.min(x, x + lx), u1: Math.max(x, x + lx), v0: -Math.max(y, y + ly), v1: -Math.min(y, y + ly), z0: Math.min(z, z + lz), z1: Math.max(z, z + lz) };
      if (!out.has(part.group)) out.set(part.group, []);
      out.get(part.group).push(box);
    }
  }
  return out;
}

const union = (boxes) => boxes.reduce((a, b) => ({
  u0: Math.min(a.u0, b.u0), u1: Math.max(a.u1, b.u1), v0: Math.min(a.v0, b.v0),
  v1: Math.max(a.v1, b.v1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1),
}));

// ── the same object, through the real evaluator ───────────────────────────────────────────────────
async function bakedGroups(flow, overrides) {
  const { runExprBody, liftScopeValue } = await import("@builderpluss/engine/node");
  const props = flow.nodes.find((n) => n.id === "props").data.params.props;
  const body = flow.nodes.find((n) => n.id === "math").data.params.expr;
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = [[0, 0]]; scope.rotation = 0; scope.anchorDir = "Center"; scope.fitMode = "Off"; scope.margin = 0; scope.flipSide = false;
  for (const [k, v] of Object.entries(overrides)) scope[k] = liftScopeValue(v);
  // `_W` is (x, y, z, face, group) in the object frame — read the groups straight off it.
  const r = runExprBody(`${body}\nzz_W = _W`, scope);
  const W = r.zz_W;
  const out = new Map();
  for (const row of W) {
    const g = row[4];
    if (!out.has(g)) out.set(g, { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, z0: Infinity, z1: -Infinity });
    const b = out.get(g);
    b.u0 = Math.min(b.u0, row[0]); b.u1 = Math.max(b.u1, row[0]);
    b.v0 = Math.min(b.v0, row[1]); b.v1 = Math.max(b.v1, row[1]);
    b.z0 = Math.min(b.z0, row[2]); b.z1 = Math.max(b.z1, row[2]);
  }
  return out;
}

// ── run ───────────────────────────────────────────────────────────────────────────────────────────
const flow = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ir = JSON.parse(readFileSync(process.argv[3], "utf8"));
const byKey = new Map(ir.parameters.map((p) => [p.key, p]));

const CASES = [
  ["defaults", {}],
  ["king 2.0 x 1.8", { length: 2.0, width: 1.8 }],
  ["single 1.9 x 0.9", { length: 1.9, width: 0.9, pillows: 1 }],
  ["plinth base", { baseStyle: "Plinth" }],
  ["floating base", { baseStyle: "Floating" }],
  ["no headboard", { headboardStyle: "None" }],
  ["wide panel headboard", { headboardStyle: "Wide panel", headboardOverhang: 0.25 }],
  ["footboard on", { footboard: true }],
  ["duvet on", { duvet: true, duvetDrop: 0.2 }],
  ["4 pillows", { pillows: 4 }],
  ["3 pillows + duvet + footboard", { pillows: 3, duvet: true, footboard: true, headboardStyle: "Wide panel" }],
  ["tall legs, thin mattress", { legHeight: 0.25, mattressThk: 0.15, baseHeight: 0.2 }],
];

let failures = 0, compared = 0;
for (const [label, over] of CASES) {
  const values = {};
  for (const p of ir.parameters) {
    const v = over[p.key] ?? p.value;
    values[p.dc] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  const mine = dcBoxes(ir, values);
  const theirs = await bakedGroups(flow, over);
  const groups = new Set([...mine.keys(), ...theirs.keys()]);
  const bad = [];
  for (const g of groups) {
    const a = mine.has(g) ? union(mine.get(g)) : null;
    const b = theirs.get(g) ?? null;
    if (!a && !b) continue;
    if (!a || !b) { bad.push(`group ${g}: ${a ? "DC draws it, bake does not" : "bake draws it, DC does not"}`); continue; }
    compared++;
    for (const k of ["u0", "u1", "v0", "v1", "z0", "z1"]) {
      if (Math.abs(a[k] - b[k]) > TOL) bad.push(`group ${g} ${k}: DC ${a[k].toFixed(6)} vs bake ${b[k].toFixed(6)}`);
    }
  }
  if (bad.length) { failures++; console.log(`FAIL  ${label}`); bad.forEach((x) => console.log(`        ${x}`)); }
  else console.log(`ok    ${label.padEnd(30)} ${groups.size} groups match`);
}
console.log(`\n${CASES.length - failures}/${CASES.length} cases match · ${compared} group boxes compared to ${TOL} m`);
process.exit(failures ? 1 : 0);
