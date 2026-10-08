// Evaluate a built object at its defaults (optionally on a given host) and dump its 3D rows -> JSON for preview.
//   node public/build-from-deck-pipeline/objects/dump.mjs <object.json> <out.json> ['[[x,y],...]'] ['{"param":value}']
import { readFileSync, writeFileSync } from "node:fs";
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
const [file, out, host, over] = process.argv.slice(2);
const f = JSON.parse(readFileSync(file, "utf8"));
const props = f.nodes.find((n) => n.data.tool === "input-props").data.params.props;
const body = f.nodes.find((n) => n.data.tool === "expr").data.params.expr;
const ov = over ? JSON.parse(over) : {};
const scope = { PI: Math.PI };
for (const p of props) scope[p.id] = liftScopeValue(ov[p.id] ?? p.value);
scope.P = host ? JSON.parse(host) : ({ node: [[0, 0]], segment: [[0, 0], [4, 0]], space: [[0, 0], [5, 0], [5, 4], [0, 4]] })[f.object.hostKind];
const res = runExprBody(body, scope); const sc = res?.scope ?? res;
const slots = f.nodes.find((n) => n.data.tool === "output").data.params.slots;
const r3 = f.nodes.find((n) => n.data.tool === "render-3d").data.params.prims;
const rows = [];
for (const p of r3) {
  const e = f.edges.find((e) => e.target === "r3d" && e.targetHandle === `valin-${p.id}`);
  const slot = e.sourceHandle.slice(4);
  const e2 = f.edges.find((e) => e.target === "out" && e.targetHandle === `valin-${slot}`);
  rows.push({ name: p.name, kind: p.kind, color: p.color, data: sc[e2.sourceHandle.slice(4)] });
}
writeFileSync(out, JSON.stringify(rows));
