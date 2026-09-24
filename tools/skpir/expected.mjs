/** Emit the geometry the Math Engine produces, per group, for a spread of parameter sets — the ground
 *  truth the Blender test compares against. Same `_W` read the verifier uses, so the two targets are
 *  checked against one source of truth rather than against each other.
 *
 *  Usage:  node tools/skpir/expected.mjs <object.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";

const flow = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = process.argv[3];

const CASES = [
  ["defaults", {}],
  ["king 2.0 x 1.8", { length: 2.0, width: 1.8 }],
  ["single", { length: 1.9, width: 0.9, pillows: 1 }],
  ["plinth base", { baseStyle: "Plinth" }],
  ["floating base", { baseStyle: "Floating" }],
  ["no headboard", { headboardStyle: "None" }],
  ["wide panel", { headboardStyle: "Wide panel", headboardOverhang: 0.25 }],
  ["footboard on", { footboard: true }],
  ["duvet on", { duvet: true, duvetDrop: 0.2 }],
  ["4 pillows", { pillows: 4 }],
  ["tall legs", { legHeight: 0.25, mattressThk: 0.15, baseHeight: 0.2 }],
];

const { runExprBody, liftScopeValue } = await import("@builderpluss/engine/node");
const props = flow.nodes.find((n) => n.id === "props").data.params.props;
const body = flow.nodes.find((n) => n.id === "math").data.params.expr;

const cases = [];
for (const [label, over] of CASES) {
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = [[0, 0]]; scope.rotation = 0; scope.anchorDir = "Center"; scope.fitMode = "Off"; scope.margin = 0; scope.flipSide = false;
  for (const [k, v] of Object.entries(over)) scope[k] = liftScopeValue(v);
  const W = runExprBody(`${body}\nzz_W = _W`, scope).zz_W;
  const groups = {};
  for (const r of W) {
    const g = r[4];
    const b = groups[g] ?? (groups[g] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
    b[0] = Math.min(b[0], r[0]); b[1] = Math.max(b[1], r[0]);
    b[2] = Math.min(b[2], r[1]); b[3] = Math.max(b[3], r[1]);
    b[4] = Math.min(b[4], r[2]); b[5] = Math.max(b[5], r[2]);
  }
  cases.push({ label, overrides: over, groups });
}
writeFileSync(out, JSON.stringify({ object: flow.id, cases }, null, 1));
console.log(`${cases.length} cases -> ${out}`);
