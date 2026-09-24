import { writeFileSync, mkdirSync } from "node:fs";
import { exprInputs } from "@builderpluss/engine/node";
import { buildFlow } from "./common.mjs";
import * as A from "./objects-furniture.mjs";
import * as B from "./objects-storage.mjs";
import * as C from "./objects-fittings.mjs";

const ORDER = ["bed", "sofa", "chair", "table", "desk", "wardrobe", "cabinet", "shelf",
               "curtain", "ceilingFan", "chandelier", "lightBulb"];
const ALL = { ...A, ...B, ...C };
const FILE = {
  bed: "bed", sofa: "sofa", chair: "chair", table: "table", desk: "desk",
  wardrobe: "wardrobe", cabinet: "cabinet", shelf: "shelf", curtain: "curtain",
  ceilingFan: "ceiling-fan", chandelier: "chandelier", lightBulb: "light-bulb",
};

mkdirSync("out", { recursive: true });
let bad = 0;
const built = [];

for (const key of ORDER) {
  const spec = ALL[key];
  const flow = buildFlow(spec);
  const problems = [];

  const propNode = flow.nodes.find((n) => n.id === "props");
  const propIds = propNode.data.params.props.map((p) => p.id);
  const mathBody = flow.nodes.find((n) => n.id === "math").data.params.expr;

  // The Math Engine's INPUT endpoints are derived by parsing the body for free variables.
  // A prop with no matching free variable has no endpoint, so its edge would dangle;
  // a free variable with no prop is a TYPO that silently evaluates to 0.
  const inputs = exprInputs(mathBody);
  for (const p of propIds) if (!inputs.includes(p)) problems.push(`prop "${p}" is never read by the body — its wire would dangle`);
  for (const v of inputs) if (!propIds.includes(v)) problems.push(`free variable "${v}" has no matching prop — typo? it evaluates to 0`);

  // Every edge must land on a handle that exists.
  const defined = new Set();
  for (const line of String(mathBody).split("\n")) {
    const m = line.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m) defined.add(m[1]);
  }
  const slotIds = new Set(flow.nodes.find((n) => n.id === "out").data.params.slots.map((s) => s.id));
  const p2 = new Set(flow.nodes.find((n) => n.id === "r2d").data.params.prims.map((p) => p.id));
  const p3 = new Set(flow.nodes.find((n) => n.id === "r3d").data.params.prims.map((p) => p.id));
  for (const e of flow.edges) {
    if (e.source === "math" && !defined.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: math publishes no "${e.sourceHandle.slice(4)}"`);
    if (e.target === "math" && !inputs.includes(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: math has no input "${e.targetHandle.slice(6)}"`);
    if (e.target === "out" && !slotIds.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no slot ${e.targetHandle.slice(6)}`);
    if (e.source === "out" && !slotIds.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: no slot ${e.sourceHandle.slice(4)}`);
    if (e.target === "r2d" && !p2.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no 2D row ${e.targetHandle.slice(6)}`);
    if (e.target === "r3d" && !p3.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no 3D row ${e.targetHandle.slice(6)}`);
  }
  const ids = flow.edges.map((e) => e.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");

  const json = JSON.stringify(flow, null, 2);
  JSON.parse(json); // round-trips
  writeFileSync(`out/${FILE[key]}.json`, json, "utf8");
  built.push({ key, file: `${FILE[key]}.json`, bytes: json.length, props: propIds.length, outputs: spec.outputs.length, edges: flow.edges.length });

  if (problems.length) { bad++; console.log(`FAIL ${spec.name}`); problems.forEach((p) => console.log("      - " + p)); }
  else console.log(`ok   ${spec.name.padEnd(14)} ${propIds.length} props  ${spec.outputs.length} outputs  ${flow.edges.length} edges  ${(json.length / 1024).toFixed(1)} KB`);
}
console.log(`\n${built.length} built, ${bad} with problems`);
writeFileSync("out/_index.json", JSON.stringify(built, null, 2));
