import { readFileSync } from "node:fs";
import * as E from "@builderpluss/engine/node";
const flow = JSON.parse(readFileSync(process.argv[2] ?? "tools/tmp-chair/out/chair.json", "utf8"));
const props = flow.nodes.find((n) => n.data.tool === "input-props").data.params.props;
const scope = { PI: Math.PI };
for (const p of props) { let v = p.value; if (typeof v === "boolean") v = v ? 1 : 0; if (typeof v === "string" && /^\s*\[/.test(v)) v = JSON.parse(v); scope[p.id] = v; }
const stmts = E.parseExprStmts(flow.nodes.find((n) => n.data.tool === "expr").data.params.expr);
const rows = [];
const run = (list, depth) => { for (const s of list) {
  const t0 = performance.now();
  if (s.kind === "def") scope[s.name] = E.evalValue(s.expr, scope);
  else { const n = Math.floor(+E.evalValue(s.count, scope)); for (let k = 0; k < n; k++) { scope[s.name] = k; run(s.body, depth + 1); } }
  const t = performance.now() - t0;
  if (depth === 0) rows.push([t, s.kind === "def" ? s.name + " = " + s.expr.slice(0, 70) : "loop " + s.name]);
} };
const T0 = performance.now(); run(stmts, 0); console.log("total", (performance.now() - T0).toFixed(0), "ms");
rows.sort((a, b) => b[0] - a[0]).slice(0, 15).forEach(([t, l]) => console.log(t.toFixed(0).padStart(7), l));
