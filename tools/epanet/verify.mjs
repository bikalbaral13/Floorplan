/** Verify BOTH solve routes against EPANET's own answer for the same network.
 *
 *   A. the engine's `solvePipeNetwork` (the Pipe Network Solver flow node) fed the converted canvas
 *      plan exactly as FloorPlanEditor's `pipeGraph` memo builds it - stable keys, wall ids,
 *      graphAttrs - so this exercises the real binding, not a hand-made graph.
 *   B. the Todini-Pilati GGA written in the Math Engine (library/Workflows/Hydrology), run through
 *      the engine's own expression interpreter on the matrices the converter emitted.
 *
 *  Ground truth is epanet_results.json, written by run_epanet.py from the official EPANET 2.2
 *  toolkit. Usage:
 *      node tools/epanet/verify.mjs <plan.json> <plan.gga.json> <epanet_results.json>
 */
import { readFileSync } from "node:fs";
import { solvePipeNetwork, runExprBody, liftScopeValue } from "@builderpluss/engine/node";

const [planPath, ggaPath, epanetPath, flowPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const gga = JSON.parse(readFileSync(ggaPath, "utf8"));
const ref = JSON.parse(readFileSync(epanetPath, "utf8"));

const fmt = (v, w = 11, d = 4) => Number(v).toFixed(d).padStart(w);

// ── The schema. Keys ARE the role names here, which keeps the plan readable; the solver only ever
// looks at `role`, so any key would do. ─────────────────────────────────────────────────────────
const schema = {
  name: "EPANET pipe network",
  node: [
    { key: "elevation", label: "Elevation", kind: "number", unit: "m", default: 0, role: "elevation" },
    { key: "demand", label: "Demand", kind: "number", unit: "L/s", default: 0, role: "demand" },
    { key: "fixedHead", label: "Fixed head (reservoir / tank)", kind: "checkbox", default: false, role: "fixedHead" },
    { key: "head", label: "Total head", kind: "number", unit: "m", default: 0, role: "head" },
  ],
  segment: [
    { key: "diameter", label: "Diameter", kind: "number", unit: "mm", default: 100, role: "diameter" },
    { key: "roughness", label: "Roughness", kind: "number", default: 130, role: "roughness" },
    { key: "minorLoss", label: "Minor loss K", kind: "number", default: 0, role: "minorLoss" },
    { key: "length", label: "Length", kind: "number", unit: "m", default: 0, role: "length" },
  ],
  results: {
    node: [
      { key: "head", label: "Head", unit: "m", decimals: 3 },
      { key: "pressure", label: "Pressure", unit: "m", decimals: 3 },
      { key: "demand", label: "Demand", unit: "L/s", decimals: 3 },
    ],
    segment: [
      { key: "discharge", label: "Discharge", unit: "L/s", decimals: 3 },
      { key: "velocity", label: "Velocity", unit: "m/s", decimals: 3 },
      { key: "headloss", label: "Headloss", unit: "m", decimals: 4 },
      { key: "unitHeadloss", label: "Unit headloss", unit: "m/km", decimals: 3 },
    ],
  },
};

// ── A. Rebuild the editor's pipeGraph from the plan file ────────────────────────────────────────
const PPM = plan.settings.pixelsPerMeter || 50;
const pos = new Map(plan.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
// Stable keys, as planFormat.ts builds them.
const ends = new Map();
for (const s of plan.segments) {
  (ends.get(s.fromNodeId) ?? ends.set(s.fromNodeId, []).get(s.fromNodeId)).push(`${s.id}:start`);
  (ends.get(s.toNodeId) ?? ends.set(s.toNodeId, []).get(s.toNodeId)).push(`${s.id}:end`);
}
const key = new Map([...ends].map(([id, t]) => [id, t.slice().sort().join("|")]));

const pipeGraph = {
  nodes: plan.nodes.map((n) => ({ id: key.get(n.id), x: n.x, y: n.y })),
  edges: plan.segments.map((s) => {
    const A = pos.get(s.fromNodeId), B = pos.get(s.toNodeId);
    return {
      id: s.id, a: key.get(s.fromNodeId), b: key.get(s.toNodeId),
      lengthM: Math.hypot(B.x - A.x, B.y - A.y) / PPM,
      widthPx: s.thickness,
    };
  }),
  attrs: { nodes: plan.graphAttrs.nodes, segments: plan.graphAttrs.segments },
  key: "verify",
};

const res = solvePipeNetwork(pipeGraph, schema, { formula: "hazen-williams", maxIter: 200, tolerance: 1e-6 });
console.log(`SOLVER: ${res.status}`);
console.log(`        totalDemand ${res.summary.totalDemand} L/s, maxVelocity ${res.summary.maxVelocity} m/s, minPressure ${res.summary.minPressure} m\n`);

let worstNode = 0, worstSeg = 0;
console.log("NODES — head (m)                        solver       EPANET        diff");
for (const n of plan.nodes) {
  const got = res.nodeResults[key.get(n.id)];
  const exp = ref.nodes[n.id];
  if (!got || !exp) { console.log(`  ${n.id}: MISSING`); worstNode = Infinity; continue; }
  const d = Math.abs(got.head - exp.head_m);
  worstNode = Math.max(worstNode, d);
  console.log(`  ${String(n.id).padStart(4)}  ${(plan.graphAttrs.nodes[key.get(n.id)].fixedHead ? "[fixed]" : "       ")}  ${fmt(got.head)}  ${fmt(exp.head_m)}  ${fmt(d, 10, 6)} ${d < 1e-3 ? "ok" : "OFF"}`);
}

console.log("\nSEGMENTS — discharge (L/s)              solver       EPANET        diff     |  velocity  diff");
for (const s of plan.segments) {
  const got = res.segmentResults[s.id];
  const epId = s.label ?? s.id.replace(/^pipe_/, "");
  const exp = ref.links[epId];
  if (!got || !exp) { console.log(`  ${s.id}: MISSING`); worstSeg = Infinity; continue; }
  // The converter writes fromNodeId/toNodeId in the .inp's own order, so signs are directly comparable.
  const d = Math.abs(got.discharge - exp.flow_lps);
  const dv = Math.abs(got.velocity - Math.abs(exp.vel_ms));
  worstSeg = Math.max(worstSeg, d);
  console.log(`  ${String(epId).padStart(4)}  ${String(exp.from + "->" + exp.to).padEnd(9)}  ${fmt(got.discharge)}  ${fmt(exp.flow_lps)}  ${fmt(d, 10, 6)} ${d < 1e-2 ? "ok " : "OFF"} | ${fmt(got.velocity, 8, 3)}  ${fmt(dv, 8, 5)}`);
}

// ── B. The Math Engine's Todini-Pilati GGA on the same network ──────────────────────────────────
console.log("\n" + "=".repeat(78));
const flowJson = JSON.parse(readFileSync(flowPath, "utf8"));
const mathNode = flowJson.nodes.find((n) => n.data.tool === "expr");
const propsNode = flowJson.nodes.find((n) => n.data.tool === "input-props");
const bodyExpr = mathNode.data.params.expr;

const scope = { PI: Math.PI };
for (const p of propsNode.data.params.props) scope[p.id] = liftScopeValue(p.value);
Object.assign(scope, {
  A12: gga.A12, A10: gga.A10, H0: gga.H0, r: gga.r, q: gga.q,
  Q: gga.Q0, H: gga.Hj0, nExp: gga.nExp, iterations: 60,
});
const out0 = runExprBody(bodyExpr, scope);
const out = out0?.scope ?? out0;

console.log(`MATH ENGINE GGA: ${gga.order.pipes.length} pipes, ${gga.order.junctions.length} junctions, n = ${gga.nExp}`);
console.log(`        final energy residual    ${Number(out.finalEnergyResidual).toExponential(3)}`);
console.log(`        final continuity residual ${Number(out.finalContinuityResidual).toExponential(3)}\n`);

let worstG = 0;
console.log("NODES — head (m)                    Math Engine       EPANET        diff");
gga.order.junctions.forEach((id, i) => {
  const got = out.Hsolved[i][0];
  const exp = ref.nodes[id].head_m;
  const d = Math.abs(got - exp);
  worstG = Math.max(worstG, d);
  console.log(`  ${String(id).padStart(4)}           ${fmt(got)}  ${fmt(exp)}  ${fmt(d, 10, 6)} ${d < 1e-3 ? "ok" : "OFF"}`);
});
console.log("\nSEGMENTS — discharge (L/s)          Math Engine       EPANET        diff");
gga.order.pipes.forEach((id, i) => {
  const got = out.Qsolved[i][0] * 1000;
  const exp = ref.links[id].flow_lps;
  const d = Math.abs(got - exp);
  worstG = Math.max(worstG, d);
  console.log(`  ${String(id).padStart(4)}           ${fmt(got)}  ${fmt(exp)}  ${fmt(d, 10, 6)} ${d < 1e-2 ? "ok" : "OFF"}`);
});

console.log("\n" + "=".repeat(78));
console.log(`Pipe Network Solver  : worst head ${worstNode.toExponential(3)} m, worst discharge ${worstSeg.toExponential(3)} L/s`);
console.log(`Math Engine GGA      : worst deviation ${worstG.toExponential(3)}`);
const pass = worstNode < 1e-3 && worstSeg < 1e-2 && worstG < 1e-2;
console.log(pass ? "\nBOTH ROUTES AGREE WITH EPANET." : "\nMISMATCH.");
process.exit(pass ? 0 : 1);
