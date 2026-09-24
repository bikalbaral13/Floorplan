import { readFileSync } from "node:fs";
import { runExprBody } from "@builderpluss/engine/node";
const flow = JSON.parse(readFileSync("tools/tmp-chair/out/chair.json", "utf8"));
const props = flow.nodes.find((n) => n.data.tool === "input-props").data.params.props;
const scope = { PI: Math.PI };
for (const p of props) { let v = p.value; if (typeof v === "boolean") v = v ? 1 : 0; if (typeof v === "string" && /^\s*\[/.test(v)) v = JSON.parse(v); scope[p.id] = v; }
const lines = flow.nodes.find((n) => n.data.tool === "expr").data.params.expr.split("\n");
const marks = ["_SHsec =", "_SHm =", "_SEm =", "_PPs =", "_PPt =", "_LGm = zeros", "Shell3D =", "SeatPlan =", "overallWidth ="];
let prev = 0;
for (const m of marks) {
  const i = lines.findIndex((l) => l.startsWith(m));
  const t0 = performance.now(); runExprBody(lines.slice(0, i + 1).join("\n"), { ...scope }); const t = performance.now() - t0;
  console.log(m.padEnd(16), (t).toFixed(0), "ms  (+", (t - prev).toFixed(0), ")"); prev = t;
}
