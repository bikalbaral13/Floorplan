import { readFileSync, readdirSync } from "node:fs";
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
const HOSTS = { node: [[0,0]], segment: [[0,0],[4,0]], space: [[0,0],[3.962,0],[3.962,3.734],[0,3.734]] };
const NEW = ["false-ceiling","led-strip","downlight","upholstered-panel","fluted-panel","window-seat","skirting","wall-art","curtain-track","beam"];
for (const f of NEW) {
  const j = JSON.parse(readFileSync(`out-bedroom/${f}.json`, "utf8"));
  const props = j.nodes.find(n=>n.data.tool==="input-props").data.params.props;
  const math = j.nodes.find(n=>n.data.tool==="expr");
  const out = j.nodes.find(n=>n.data.tool==="output");
  const scope = { PI: Math.PI };
  for (const p of props) scope[p.id] = liftScopeValue(p.value);
  scope.P = HOSTS[j.object.hostKind] ?? HOSTS.node;
  const r = runExprBody(math.data.params.expr, scope); const o = r?.scope ?? r;
  const nameOf = new Map();
  for (const e of j.edges) if (e.source === math.id && e.target === out.id) nameOf.set(e.targetHandle.slice(6), e.sourceHandle.slice(4));
  const lab = new Map(out.data.params.slots.map(s=>[s.id,s.label]));
  const nums = [];
  for (const [sid, l] of lab) { const v = o[nameOf.get(sid)]; if (typeof v === "number") nums.push(`${l}=${+v.toFixed(3)}`); }
  console.log(`— ${f}\n   ${nums.join("  ")}`);
}
