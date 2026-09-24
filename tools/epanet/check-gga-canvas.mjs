/** End-to-end check of the CANVAS-DRIVEN route: canvas JSON -> decode -> one Math Engine -> EPANET.
 *
 *  The payload is built exactly as `buildCanvasJson` writes one (nodes with `at` + objectId + params,
 *  segments with from/to + objectId + params) from the converted plan, so nothing here is hand-fed: the
 *  elevations, demands, diameters, roughnesses and lengths all arrive as PARAMETERS ON THE DRAWING and
 *  are lifted by the decoder. Then the Math Engine body runs the GGA over them, and its results — both
 *  the global metrics and the per-element assignment matrices the Set Object Param nodes consume — are
 *  compared against the official EPANET 2.2 toolkit's answer for the same network.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runExprBody } from "@builderpluss/engine/node";
import { GGA_BODY, NODE_PARAM_KEYS, SEG_PARAM_KEYS, TYPE_NAMES } from "./gga-body.mjs";

const [planPath, epanetPath] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const ref = JSON.parse(readFileSync(epanetPath, "utf8"));

mkdirSync("tools/epanet/.tmp", { recursive: true });
const entry = "tools/epanet/.tmp/entry.ts";
writeFileSync(entry, `export { decodeCanvasJson } from "../../../src/floorplan/flow/eval/evaluateFlow";\n`);
const outFile = "tools/epanet/.tmp/decode.mjs";
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: outFile, logLevel: "silent" });
const { decodeCanvasJson } = await import(pathToFileURL(process.cwd() + "/" + outFile).href);

// ── The canvas payload, as buildCanvasJson writes one ───────────────────────────────────────────
const PPM = plan.settings.pixelsPerMeter;
const r3 = (v) => Math.round(v * 1000) / 1000;
const pos = new Map(plan.nodes.map((n) => [n.id, [r3(n.x / PPM), r3(n.y / PPM)]]));
const payload = {
  units: "m", scoped: false, spaces: [],
  nodes: plan.nodes.map((n) => ({
    id: n.id, at: pos.get(n.id),
    objectId: n.attachments[0].objectId, params: n.attachments[0].params,
  })),
  segments: plan.segments.map((s) => {
    const A = pos.get(s.fromNodeId), B = pos.get(s.toNodeId);
    return {
      id: s.id, type: s.segmentType, from: A, to: B,
      lengthM: r3(Math.hypot(B[0] - A[0], B[1] - A[1])),
      thicknessM: r3(s.thickness / PPM),
      objectId: s.attachments[0].objectId, params: s.attachments[0].params,
    };
  }),
};

// ── Decode, exactly as the Math Engine's `decode` block does ────────────────────────────────────
const dec = decodeCanvasJson({
  json: JSON.stringify(payload),
  typeNames: TYPE_NAMES,
  nodeParams: NODE_PARAM_KEYS,
  segParams: SEG_PARAM_KEYS,
});
const scope = { PI: Math.PI };
for (const [k, v] of Object.entries(dec)) {
  scope[k] = typeof v === "string" ? JSON.parse(v) : v;
}
// The global settings the Input Properties node supplies, plus the run counter the button publishes.
Object.assign(scope, {
  run: 1, maxIter: 60, demandFactor: 1, peakFactor: 1,
  minPressureReq: 15, maxVelocityAllowed: 3, minVelocityReq: 0.3,
  supplyHours: 24, perCapita: 135,
});

const res0 = runExprBody(GGA_BODY, scope);
const out = res0?.scope ?? res0;

const fmt = (v, w = 11, d = 4) => Number(v).toFixed(d).padStart(w);
let bad = 0;

console.log(`decoded: ${dec.nodeCount} nodes, ${dec.segmentCount} segments, ${dec.unresolvedEnds} dangling ends`);
console.log(`read   : ${out.nodesRead} nodes (${out.junctionCount} junction, ${out.fixedHeadCount} fixed), ${out.pipeCount} pipes, ${out.isolatedNodes} isolated`);
console.log(`solve  : ${out.iterationsRun} iterations · energy residual ${Number(out.maxEnergyResidual).toExponential(2)} · continuity ${Number(out.maxContinuityResidual).toExponential(2)}\n`);

// ── Per-node heads, read back off the assignment matrix the Set Object Param node consumes ──────
const nodeIdx = new Map(plan.nodes.map((n, i) => [i, n.id]));
console.log("NodeHead assignments            Math Engine       EPANET        diff");
for (const [i, v] of out.NodeHead) {
  const id = nodeIdx.get(i);
  const exp = ref.nodes[id].head_m;
  const d = Math.abs(v - exp);
  if (d > 1e-3) bad++;
  console.log(`  node ${String(id).padStart(4)} (row ${String(i).padStart(2)})  ${fmt(v)}  ${fmt(exp)}  ${fmt(d, 10, 6)} ${d < 1e-3 ? "ok" : "OFF"}`);
}

const segIdx = new Map(plan.segments.map((s, i) => [i, s.label]));
console.log("\nSegFlow assignments (L/s)       Math Engine       EPANET        diff");
for (const [i, v] of out.SegFlow) {
  const id = segIdx.get(i);
  const exp = ref.links[id].flow_lps;
  const d = Math.abs(v - exp);
  if (d > 1e-2) bad++;
  console.log(`  pipe ${String(id).padStart(4)} (row ${String(i).padStart(2)})  ${fmt(v)}  ${fmt(exp)}  ${fmt(d, 10, 6)} ${d < 1e-2 ? "ok" : "OFF"}`);
}

// Head at each end, which is what lets the Pipe object re-derive its own headloss and report a residual.
console.log("\nSegHeadA / SegHeadB             A (m)        B (m)     |A-B|   EPANET hl   diff");
const hB = new Map(out.SegHeadB.map(([i, v]) => [i, v]));
for (const [i, vA] of out.SegHeadA) {
  const id = segIdx.get(i);
  const vB = hB.get(i);
  const exp = Math.abs(ref.links[id].headloss_m);
  const d = Math.abs(Math.abs(vA - vB) - exp);
  if (d > 5e-3) bad++;
  console.log(`  pipe ${String(id).padStart(4)}  ${fmt(vA)} ${fmt(vB)} ${fmt(Math.abs(vA - vB), 9, 4)} ${fmt(exp, 11, 4)} ${fmt(d, 9, 5)} ${d < 5e-3 ? "ok" : "OFF"}`);
}

// The reservoir's supply keeps EPANET's sign: a source DELIVERING reports a negative demand.
console.log("\nResSupply assignments (L/s)");
for (const [i, v] of out.ResSupply) {
  const id = nodeIdx.get(i);
  const exp = ref.nodes[id].demand_lps;
  const d = Math.abs(v - exp);
  if (d > 1e-2) bad++;
  console.log(`  node ${String(id).padStart(4)}  ${fmt(v)}  EPANET ${fmt(exp)}  ${fmt(d, 10, 6)} ${d < 1e-2 ? "ok" : "OFF"}`);
}

// ── Global metrics ──────────────────────────────────────────────────────────────────────────────
const globals = [
  ["totalDemand (L/s)", out.totalDemand, 69.399],
  ["totalSupply (L/s)", out.totalSupply, 69.399],
  ["maxVelocity (m/s)", out.maxVelocity, 0.423],
  ["minPressure (m)", out.minPressure, 76.515],
  ["balanceError", out.balanceError, 0],
];
console.log("\nGLOBAL METRICS                     value       EPANET        diff");
for (const [name, got, exp] of globals) {
  const d = Math.abs(got - exp);
  // balanceError is supply minus demand: it converges to the solve's own continuity residual, not to
  // zero, so it is checked at the same 0.01 L/s the per-pipe flows are.
  const tol = name === "balanceError" ? 1e-2 : 5e-3;
  if (d > tol) bad++;
  console.log(`  ${name.padEnd(20)} ${fmt(got)}  ${fmt(exp)}  ${fmt(d, 10, 6)} ${d <= tol ? "ok" : "OFF"}`);
}
console.log(`  ${"designOk".padEnd(20)} ${out.designOk}   (pressure ${out.pressureOk}, velocity ${out.velocityOk}, scouring ${out.scouringOk})`);

// ── The run gate: with run = 0 nothing must be solved ───────────────────────────────────────────
const gated = runExprBody(GGA_BODY, { ...scope, run: 0 });
const g = gated?.scope ?? gated;
const gateOk = g.iterationsRun === 0 && g.solved === 0 && Math.abs(g.maxContinuityResidual) > 1e-6;
if (!gateOk) bad++;
console.log(`\n${gateOk ? "ok  " : "FAIL"} run gate: run=0 -> ${g.iterationsRun} iterations, solved=${g.solved}, continuity residual ${Number(g.maxContinuityResidual).toExponential(2)} (unsolved, as it should be)`);

console.log(bad ? `\n${bad} check(s) FAILED` : "\nCANVAS-DRIVEN MATH ENGINE AGREES WITH EPANET.");
process.exit(bad ? 1 : 0);
