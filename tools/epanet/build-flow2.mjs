/** Build `epanet-pipe-network.json` — the canvas-driven pipe-network solve, in one Math Engine.
 *
 *      Geometry ──(Canvas JSON)──▶ Math Engine (decode + GGA) ──▶ Output Metrics   (global)
 *                                        ▲          │
 *      Network settings + RUN ───────────┘          ├──▶ Set Object Param ×3  (nodes)
 *      Canvas ──(Nodes / Segments)───────────────────┴──▶ Set Object Param ×3  (segments)
 *
 *  The Math Engine's `decode` block reads the canvas payload and lifts every node's and segment's
 *  attached-object PARAMETERS into scope, so the network's elevations, demands, diameters, roughnesses
 *  and lengths are read off the drawing rather than retyped. The solve then writes its per-element
 *  results BACK onto those same objects, which is what gives each node and each segment its own output
 *  metrics: the Junction and Pipe objects re-derive pressure, velocity and headloss from what they are
 *  handed.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { exprInputs, exprOutputs } from "@builderpluss/engine/node";
import { GGA_BODY, NODE_PARAM_KEYS, SEG_PARAM_KEYS, TYPE_NAMES } from "./gga-body.mjs";

mkdirSync("tools/epanet/out-flow", { recursive: true });

const rng = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [], editable: true, showInCanvas: false, necessary: true });
const btn = (id, name) => ({ id, name, type: "button", value: 0, min: 0, max: 0, step: 1, options: [], editable: true, showInCanvas: false, necessary: true });

/** The global settings. Every one is a project-wide standard or a solver control — nothing per-element
 *  lives here, because per-element data is on the elements. */
const settings = [
  btn("run", "Run — solve & apply"),
  rng("maxIter", "Max iterations", 60, 5, 200, 1),
  rng("demandFactor", "Demand multiplier", 1, 0, 5, 0.05),
  rng("peakFactor", "Peak demand factor", 1, 0.1, 5, 0.05),
  rng("minPressureReq", "Minimum service pressure (m)", 15, 0, 200, 0.5),
  rng("maxVelocityAllowed", "Maximum allowable velocity (m/s)", 3, 0.1, 10, 0.1),
  rng("minVelocityReq", "Minimum self-cleansing velocity (m/s)", 0.3, 0, 3, 0.05),
  rng("supplyHours", "Supply hours per day", 24, 1, 24, 0.5),
  rng("perCapita", "Per-capita demand (L/person/day)", 135, 20, 500, 5),
];

const decode = {
  from: "canvasJson",
  typeNames: TYPE_NAMES,
  nodeParams: NODE_PARAM_KEYS,
  segParams: SEG_PARAM_KEYS,
};

/** The scalars that belong on the flow's own Output Metrics — the WHOLE-NETWORK answer. Per-element
 *  results are not here on purpose: they go onto the elements. */
const GLOBAL_SLOTS = [
  ["nodesRead", "Nodes read"],
  ["segmentsRead", "Segments read"],
  ["pipeCount", "Pipes"],
  ["junctionCount", "Junctions"],
  ["fixedHeadCount", "Fixed-head nodes"],
  ["isolatedNodes", "Isolated nodes"],
  ["danglingEnds", "Unresolved pipe ends"],
  ["solved", "Solved"],
  ["iterationsRun", "Iterations"],
  ["totalDemand", "Total demand (L/s)"],
  ["totalSupply", "Total supply (L/s)"],
  ["balanceError", "Mass balance error (L/s)"],
  ["maxVelocity", "Max velocity (m/s)"],
  ["minPressure", "Min pressure (m)"],
  ["maxHeadloss", "Max headloss (m)"],
  ["totalPipeLength", "Total pipe length (m)"],
  ["waterVolume", "Water in mains (m³)"],
  ["maxEnergyResidual", "Energy residual"],
  ["maxContinuityResidual", "Continuity residual (m³/s)"],
  ["peakDemand", "Peak demand (L/s)"],
  ["peakDemandM3h", "Peak demand (m³/h)"],
  ["peakDemandMld", "Peak demand (MLD)"],
  ["dailyVolume", "Volume per supply cycle (m³)"],
  ["populationServed", "Population served"],
  ["pressureMargin", "Pressure margin (m)"],
  ["pressureOk", "Pressure OK"],
  ["velocityMargin", "Velocity margin (m/s)"],
  ["velocityOk", "Velocity OK"],
  ["scouringOk", "Self-cleansing OK"],
  ["designOk", "Design OK"],
];

/** The six writers. Each names ONE parameter on ONE kind of host, and takes the matching assignment
 *  matrix — which the Math Engine already restricted to the elements that own that parameter. */
const WRITERS = [
  ["w_head", "node", "head", "NodeHead", "Junction — total head"],
  ["w_supply", "node", "supply", "ResSupply", "Reservoir — supply"],
  ["w_inflow", "node", "netInflow", "TankInflow", "Tank — net inflow"],
  ["w_flow", "segment", "flow", "SegFlow", "Pipe — discharge"],
  ["w_ha", "segment", "headA", "SegHeadA", "Pipe — head at start"],
  ["w_hb", "segment", "headB", "SegHeadB", "Pipe — head at end"],
];

const nodes = [
  { id: "geo", position: { x: -1240, y: -40 }, data: { tool: "source", params: { grabFromSelection: false, id: "", nodeLabel: "Geometry" } } },
  { id: "canvas", position: { x: -1240, y: 300 }, data: { tool: "canvas-source", params: {} } },
  { id: "settings", position: { x: -1240, y: -520 }, data: { tool: "input-props", params: { props: settings } } },
  { id: "solve", position: { x: -720, y: -200 }, data: { tool: "expr", params: { name: "Pipe network — Todini-Pilati GGA", expr: GGA_BODY, decode: JSON.stringify(decode, null, 1), encode: "" } } },
  { id: "summary", position: { x: -120, y: -520 }, data: { tool: "output", params: { slots: GLOBAL_SLOTS.map(([, label], i) => ({ id: `s${i + 1}`, label, showInCanvas: false, necessary: true })) } } },
  ...WRITERS.map(([id, host, paramKey, , label], i) => ({
    id,
    position: { x: -120, y: 120 + i * 150 },
    data: { tool: "set-object-param", params: { host, paramKey, valueMap: "", template: "", nodeLabel: label } },
  })),
];

const edges = [
  // The canvas payload into the Math Engine's decode block.
  { id: "e_geo_solve", source: "geo", target: "solve", sourceHandle: "val-canvasJson", targetHandle: "valin-canvasJson" },
  // Global settings — one wire per parameter, including the run counter the button publishes.
  ...settings.map((p) => ({ id: `e_set_${p.id}`, source: "settings", target: "solve", sourceHandle: `val-${p.id}`, targetHandle: `valin-${p.id}` })),
  // Global metrics.
  ...GLOBAL_SLOTS.map(([name], i) => ({ id: `e_out_${name}`, source: "solve", target: "summary", sourceHandle: `val-${name}`, targetHandle: `valin-s${i + 1}` })),
  // The writers: the canvas bundle they address (Nodes = out-1, Segments = out-2) and the assignments.
  ...WRITERS.flatMap(([id, host, , matrix]) => [
    { id: `e_bundle_${id}`, source: "canvas", target: id, sourceHandle: host === "node" ? "out-1" : "out-2", targetHandle: null },
    { id: `e_vals_${id}`, source: "solve", target: id, sourceHandle: `val-${matrix}`, targetHandle: "valin-values" },
  ]),
];

const flow = {
  version: 1,
  id: "epanet-pipe-network",
  title: "EPANET pipe network — the canvas solved in one Math Engine",
  category: "Hydrology",
  description: `Read the drawing, solve it as a pressurised pipe network, and write the answer back onto every node and every segment. Press RUN.

THE NETWORK IS THE DRAWING. Nothing about it is typed into this flow. The **Geometry** node's Canvas JSON goes into the **Math Engine**'s \`decode\` block, which publishes the topology (\`nodes\`, \`segNodes\`), the classification (\`nodeTypes\`, \`types\`) and — the part that makes this possible — the PARAMETERS off each element's attached object: a junction's elevation and demand, a pipe's diameter, roughness, minor loss and hydraulic length. Change a diameter on a pipe and the next run solves the new network, because the pipe is where that number lives.

ONE MATH ENGINE, NOT A SOLVER NODE. The whole Todini-Pilati Global Gradient Algorithm — the method EPANET itself uses — is the body of this node, and it is readable: the incidence matrix, the linearised headloss, the Newton step, the flow update. The algebra is assembled with MASKS rather than index maps. The classical GGA eliminates the fixed-head nodes and solves an nn×nn junction system, which needs a junction-numbering map the expression language has no cheap way to write; here the system is built over all N nodes and the pinned rows are replaced by identity rows, which is the same system without the renumbering. A node no live pipe touches is pinned the same way, so one stray segment cannot turn every head into NaN.

RUN IS A REAL BUTTON, and it is the reason the solve is affordable. A flow re-evaluates on every keystroke; a 60-iteration dense solve on every slider drag is not something to do quietly in the background. The button publishes a counter, the body gates its iteration count on that counter (\`run > 0 ? maxIter : 0\`), and until it is pressed the node reads the canvas and does no work. Pressing it solves AND commits — every Set Object Param node in the graph is applied as one undoable edit each, after the re-evaluation has landed. Every press is a new counter value, so pressing again genuinely re-runs.

THE RESULTS GO ON THE ELEMENTS, NOT IN A REPORT. Six writers put the solve where it belongs: total head onto each Junction, supply onto each Reservoir, net inflow onto each Tank, and discharge plus both end heads onto each Pipe. Those objects then do their own arithmetic — a Junction turns head into pressure in m, kPa, bar and psi and checks it against its service minimum; a Pipe turns discharge into velocity, Reynolds number and a Hazen-Williams headloss it derives ITSELF, and publishes \`Headloss residual\`, which is |H_A − H_B| minus its own answer and should be ~0. Select a pipe and its Metrics tab is its own solved state.

Each assignment matrix is restricted to the elements that own the parameter — a junction has no \`supply\` and a reservoir no \`head\` — so no writer ever touches an object that has no such field.

THE FLOW'S OWN METRICS ARE THE WHOLE-NETWORK ANSWER: total demand and supply and the mass-balance error between them, worst velocity, worst pressure, total pipe length, water in the mains, the energy and continuity residuals that say whether the solve actually converged, and the design check — peak demand in L/s, m³/h and MLD, population served, and pass/fail against the service standards on the settings node.

VERIFIED. On EPANET's own Net1 (gravity variant) this flow reproduces the official EPANET 2.2 toolkit's heads to better than 0.1 mm and its flows to better than 0.002 L/s, reading the network entirely from the canvas. See tools/epanet/check-gga-canvas.mjs.

WHAT THIS CANNOT DO. No pumps, valves, extended-period simulation or water quality: one steady-state, demand-driven solve, Hazen-Williams. A closed pipe should be removed from the graph rather than flagged. A segment with no Pipe object attached is carried in the graph but excluded from the solve, and a node no pipe reaches reports its own elevation.`,
  nodes,
  edges,
};

// ── Validation ────────────────────────────────────────────────────────────────
const problems = [];
const ins = exprInputs(GGA_BODY);
const outs = new Set(exprOutputs(GGA_BODY));
// Names the decode block seeds into scope — free variables that need NO wire.
const DECODED = new Set(["a", "b", "thickness", "length", "types", "spaces", "areas", "nodes", "nodeTypes",
  "segNodes", "nodeVals", "nodeHas", "segVals", "segHas", "segmentCount", "spaceCount", "nodeCount", "unresolvedEnds"]);
const settingIds = new Set(settings.map((p) => p.id));
for (const v of ins) {
  if (!DECODED.has(v) && !settingIds.has(v)) problems.push(`free variable "${v}" is neither decoded nor a setting — it would evaluate to 0`);
}
for (const p of settings) {
  if (!ins.includes(p.id)) problems.push(`setting "${p.id}" is never read by the body — its wire would dangle`);
}
for (const [name] of GLOBAL_SLOTS) if (!outs.has(name)) problems.push(`output slot "${name}" is not published by the body`);
for (const [, , , matrix] of WRITERS) if (!outs.has(matrix)) problems.push(`writer matrix "${matrix}" is not published by the body`);
const ids = edges.map((e) => e.id);
if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");
const nodeIds = new Set(nodes.map((n) => n.id));
for (const e of edges) {
  if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) problems.push(`edge ${e.id}: unknown endpoint`);
  if (e.source === "solve" && e.sourceHandle.startsWith("val-") && !outs.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: body publishes no "${e.sourceHandle.slice(4)}"`);
}

const json = JSON.stringify(flow, null, 2) + "\n";
JSON.parse(json);
writeFileSync("tools/epanet/out-flow/epanet-pipe-network.json", json, "utf8");

if (problems.length) {
  console.log("FAIL epanet-pipe-network.json");
  for (const p of problems) console.log(`      - ${p}`);
  process.exit(1);
}
console.log(`ok   epanet-pipe-network.json  ${nodes.length} nodes, ${edges.length} edges, ${GLOBAL_SLOTS.length} global metrics, ${WRITERS.length} writers, ${json.length} B`);
console.log(`     body: ${GGA_BODY.split("\n").length} lines, ${ins.length} inputs (${ins.filter((v) => DECODED.has(v)).length} decoded, ${ins.filter((v) => settingIds.has(v)).length} wired), ${outs.size} published names`);
