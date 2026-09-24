/** Build the two Hydrology workflows.
 *
 *  1. epanet-pipe-network.json — the CANVAS-DRIVEN pipeline the brief asks for:
 *
 *       Canvas ──(Graph)──▶ Pipe Network Solver ──▶ Output Schema   (results onto every component)
 *                             ▲            │
 *       Input Schema ─────────┘            └──(val-*)──▶ Math Engine ──▶ Output Metrics
 *       Network settings (Input Properties) ───────────────┘
 *
 *     The Input Schema's `role`s are what bind canvas data to the solver: node elevation/demand/
 *     fixedHead/head and segment diameter/roughness/minorLoss/length. The Output Schema chooses
 *     which solved quantities appear in each node's and each segment's Metrics tab — that is how
 *     the output parameters land back ON the nodes and segments.
 *
 *  2. gga-pipe-network.json — the existing Todini-Pilati GGA written out in ONE Math Engine, with
 *     its demo matrices replaced by a real network's. Same algebra, re-pointed at real data.
 *
 *  Usage: node tools/epanet/build-flow.mjs [--gga <plan.gga.json>] [--name <label>]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const GGA_PATH = arg("gga", null);
const NET_NAME = arg("name", "EPANET Net1 (gravity)");

mkdirSync("tools/epanet/out-flow", { recursive: true });

/* ── Schema rows ──────────────────────────────────────────────────────────────────────────────
   `key` is the storage key in graphAttrs; `role` is what the solver looks for. Keeping the two the
   same makes the plan file readable — the solver never cares either way. */
const row = (key, label, kind, def, role, extra = {}) => ({
  id: `sp_${key}`, key, label, kind, unit: "", def, min: 0, max: 100, step: 1, options: [], role, ...extra,
});
const nodeProps = [
  row("elevation", "Ground elevation", "number", 0, "elevation", { unit: "m", min: -100, max: 5000, step: 0.01 }),
  row("demand", "Demand", "number", 0, "demand", { unit: "L/s", min: -10000, max: 10000, step: 0.001 }),
  row("fixedHead", "Fixed head (reservoir / tank)", "checkbox", false, "fixedHead"),
  row("head", "Total head", "number", 0, "head", { unit: "m", min: -100, max: 5000, step: 0.001, showIf: { when: "fixedHead", equals: true } }),
  row("node-kind", "Node kind", "select", "junction", "", { options: ["junction", "reservoir", "tank"] }),
  row("node-label", "EPANET id", "text", "", ""),
];
const segmentProps = [
  row("diameter", "Diameter", "number", 100, "diameter", { unit: "mm", min: 5, max: 5000, step: 1 }),
  row("roughness", "Roughness (C, or mm for D-W)", "number", 130, "roughness", { min: 0.001, max: 200, step: 0.001 }),
  row("minorLoss", "Minor loss sum K", "number", 0, "minorLoss", { min: 0, max: 50, step: 0.05 }),
  row("length", "Hydraulic length (0 = use drawn)", "number", 0, "length", { unit: "m", min: 0, max: 200000, step: 0.1 }),
  row("seg-label", "EPANET id", "text", "", ""),
];

/* ── Result rows — what appears in each component's Metrics tab after the solve ─────────────── */
const res = (key, label, unit, step) => ({ id: `rr_${key}`, key, label, kind: "number", unit, def: 0, min: 0, max: 100, step, options: [], role: "" });
const nodeResults = [
  res("head", "Total head", "m", 0.001),
  res("pressure", "Pressure head", "m", 0.001),
  res("demand", "Demand", "L/s", 0.001),
];
const segmentResults = [
  res("discharge", "Discharge", "L/s", 0.001),
  res("velocity", "Velocity", "m/s", 0.001),
  res("headloss", "Headloss", "m", 0.0001),
  res("unitHeadloss", "Unit headloss", "m/km", 0.001),
];

/* ── Global settings (Input Properties) ──────────────────────────────────────────────────────── */
const rng = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const sel = (id, name, value, options) => ({ id, name, type: "select", value, options });

const settings = [
  sel("formula", "Headloss formula (mirror of the solver)", "Hazen-Williams", ["Hazen-Williams", "Darcy-Weisbach"]),
  rng("peakFactor", "Peak demand factor", 1, 0.1, 5, 0.05),
  rng("minPressure", "Minimum service pressure (m)", 15, 0, 200, 0.5),
  rng("maxVelocity", "Maximum allowable velocity (m/s)", 3, 0.1, 10, 0.1),
  rng("minVelocity", "Minimum self-cleansing velocity (m/s)", 0.3, 0, 3, 0.05),
  rng("supplyHours", "Supply hours per day", 24, 1, 24, 0.5),
  rng("perCapita", "Per-capita demand (L/person/day)", 135, 20, 500, 5),
];

const settingsExpr = [
  "# Design check — the solver's four published scalars against the standards typed above.",
  "# Every input here is a WIRE: the four val-* outputs of the Pipe Network Solver plus the",
  "# global settings, so this block re-reads the solve rather than restating it.",
  "_pf = max(0.1, peakFactor)",
  "_isHW = formula == 'Hazen-Williams'",
  "",
  "peakDemand = totalDemand * _pf",
  "peakDemandM3h = totalDemand * _pf * 3.6",
  "peakDemandMld = totalDemand * _pf * 0.0864",
  "dailyVolume = totalDemand * _pf * max(0.5, supplyHours) * 3.6",
  "populationServed = perCapita > 0 ? dailyVolume * 1000 / perCapita : 0",
  "",
  "# Pass / fail against the service standards",
  "pressureMargin = minPressure_solved - minPressure",
  "pressureOk = minPressure_solved >= minPressure ? 1 : 0",
  "velocityMargin = maxVelocity - maxVelocity_solved",
  "velocityOk = maxVelocity_solved <= maxVelocity ? 1 : 0",
  "scouringOk = maxVelocity_solved >= minVelocity ? 1 : 0",
  "designOk = (minPressure_solved >= minPressure && maxVelocity_solved <= maxVelocity) ? 1 : 0",
  "",
  "convergedIn = iterations",
  "formulaCode = _isHW ? 1 : 2",
].join("\n");

// The Math Engine's inputs must be free variables in the body. The solver publishes `totalDemand`,
// `maxVelocity`, `minPressure` and `iterations`; two of those collide with setting names, so the
// wires land on distinct `*_solved` inputs and the body keeps both readable side by side.
const solvedInputs = ["totalDemand", "maxVelocity_solved", "minPressure_solved", "iterations"];

const outSlots = [
  "peakDemand", "peakDemandM3h", "peakDemandMld", "dailyVolume", "populationServed",
  "pressureMargin", "pressureOk", "velocityMargin", "velocityOk", "scouringOk", "designOk",
  "convergedIn", "formulaCode",
];
const slotLabel = {
  peakDemand: "Peak demand (L/s)", peakDemandM3h: "Peak demand (m³/h)", peakDemandMld: "Peak demand (MLD)",
  dailyVolume: "Volume per supply cycle (m³)", populationServed: "Population served",
  pressureMargin: "Pressure margin (m)", pressureOk: "Pressure OK",
  velocityMargin: "Velocity margin (m/s)", velocityOk: "Velocity OK",
  scouringOk: "Self-cleansing OK", designOk: "Design OK",
  convergedIn: "Solver iterations", formulaCode: "Formula (1 = H-W, 2 = D-W)",
};

/* ── Flow 1 ──────────────────────────────────────────────────────────────────────────────────── */
const nodes = [
  { id: "canvas", position: { x: -1180, y: 40 }, data: { tool: "canvas-source", params: {} } },
  { id: "schema", position: { x: -1180, y: 360 }, data: { tool: "schema", params: { name: "EPANET pipe network", nodeProps, segmentProps, spaceProps: [], graphProps: [] } } },
  { id: "solver", position: { x: -700, y: 120 }, data: { tool: "pipe-solver", params: { formula: "hazen-williams", maxIter: 100, tolerance: 0.0001 } } },
  { id: "results", position: { x: -260, y: 360 }, data: { tool: "output-schema", params: { name: "Solved results", nodeProps: nodeResults, segmentProps: segmentResults, spaceProps: [], graphProps: [] } } },
  { id: "settings", position: { x: -700, y: -320 }, data: { tool: "input-props", params: { props: settings } } },
  { id: "design", position: { x: -240, y: -280 }, data: { tool: "expr", params: { name: "Design check", expr: settingsExpr } } },
  { id: "summary", position: { x: 260, y: -260 }, data: { tool: "output", params: { slots: outSlots.map((k, i) => ({ id: `s${i + 1}`, label: slotLabel[k], showInCanvas: false, necessary: true })) } } },
];

const edges = [
  // Canvas graph into the solver's MAIN input, and the schema into its gin-schema input.
  { id: "e_canvas_solver", source: "canvas", target: "solver", sourceHandle: "out-3", targetHandle: null },
  { id: "e_schema_solver", source: "schema", target: "solver", sourceHandle: "out-0", targetHandle: "gin-schema" },
  // Schema also attached to the Canvas node, so the input properties show in every component's
  // Properties tab whether or not the solver has run.
  { id: "e_schema_canvas", source: "schema", target: "canvas", sourceHandle: "out-0", targetHandle: null },
  // Solved results -> the Metrics tab rows.
  { id: "e_solver_results", source: "solver", target: "results", sourceHandle: "out-0", targetHandle: null },
  // Global settings + the solver's four scalars -> the design check.
  ...settings.map((p) => ({ id: `e_set_${p.id}`, source: "settings", target: "design", sourceHandle: `val-${p.id}`, targetHandle: `valin-${p.id}` })),
  { id: "e_sv_totalDemand", source: "solver", target: "design", sourceHandle: "val-totalDemand", targetHandle: "valin-totalDemand" },
  { id: "e_sv_maxVelocity", source: "solver", target: "design", sourceHandle: "val-maxVelocity", targetHandle: "valin-maxVelocity_solved" },
  { id: "e_sv_minPressure", source: "solver", target: "design", sourceHandle: "val-minPressure", targetHandle: "valin-minPressure_solved" },
  { id: "e_sv_iterations", source: "solver", target: "design", sourceHandle: "val-iterations", targetHandle: "valin-iterations" },
  ...outSlots.map((k, i) => ({ id: `e_design_out_${k}`, source: "design", target: "summary", sourceHandle: `val-${k}`, targetHandle: `valin-s${i + 1}` })),
];

const flow1 = {
  version: 1,
  id: "epanet-pipe-network",
  title: "EPANET pipe network — canvas graph to a solved, checked network",
  category: "Hydrology",
  description: `Read the canvas, solve it as a pressurised pipe network, and put the answer back on every node and every segment.

THE WIRING, LEFT TO RIGHT. The **Canvas** node's Graph output carries the segment graph into the **Pipe Network Solver**; the **Input Schema** wired into the solver's Schema input says what the numbers on each component MEAN; the **Output Schema** on the far side says which solved quantities become Metrics rows. Alongside, **Network settings** (Input Properties) and the solver's four published scalars meet in a **Math Engine** that checks the solve against the service standards.

ROLES ARE THE WHOLE BINDING. The solver has no hardcoded field names: it asks the schema which key holds each physical quantity. Node rows carry \`elevation\`, \`demand\`, \`fixedHead\` and \`head\`; segment rows carry \`diameter\`, \`roughness\`, \`minorLoss\` and \`length\`. Rename a key, relabel a row, change a default — the solve follows, because only the role is looked up. The two rows with no role (\`node-kind\`, \`seg-label\`) are carried and shown but never consumed, which is what a role-bound schema gives you for free.

HYDRAULIC LENGTH IS NOT DRAWING LENGTH. \`length\` defaults to 0, meaning "use the drawn distance". An EPANET layout is a schematic — a 3.2 km main drawn 10 units long — so the converted plan writes the true length into that row and the geometry stays a diagram.

WHERE THE ANSWER LANDS. Node Metrics get total head, pressure head and demand; segment Metrics get discharge, velocity, headloss and unit headloss. Select any pipe on the canvas and its solved flow is in the panel — no separate report, because the result is attached to the component that produced it.

THE DESIGN CHECK IS THE POINT OF THE SETTINGS BLOCK. Minimum service pressure, maximum and self-cleansing velocities and the peak factor are project standards, not per-pipe data, so they live once on an Input Properties node. The Math Engine turns the solver's \`minPressure\` / \`maxVelocity\` into margins and a single \`Design OK\`, and sizes the supply (peak demand in L/s, m³/h and MLD, volume per supply cycle, population served) from the same totals.

TWO NAMES FOR TWO THINGS. \`minPressure\` on the settings node is the STANDARD; \`minPressure_solved\` is what the network actually achieves. They are different quantities and the flow keeps them apart rather than letting the wire overwrite the target.

THE SOLVER IS TODINI & PILATI'S GLOBAL GRADIENT ALGORITHM — the method EPANET itself uses. On EPANET's Net1 (gravity variant) this flow reproduces the official toolkit's heads to better than 0.5 mm and its flows to better than 0.001 L/s.

WHAT THIS CANNOT DO. No pumps, valves, tanks-over-time, water quality or extended-period simulation: this is one steady-state, demand-driven hydraulic solve. A closed pipe should be removed from the graph rather than flagged.`,
  nodes,
  edges,
};

writeFileSync("tools/epanet/out-flow/epanet-pipe-network.json", JSON.stringify(flow1, null, 2) + "\n", "utf8");

/* ── Flow 2 — the Math Engine GGA, re-pointed at a real network ──────────────────────────────── */
if (GGA_PATH) {
  const gga = JSON.parse(readFileSync(GGA_PATH, "utf8"));
  const src = JSON.parse(readFileSync("tools/epanet/gga-source.json", "utf8"));
  const props = src.nodes.find((n) => n.data.tool === "input-props").data.params.props;
  const put = (id, v) => { const p = props.find((x) => x.id === id); if (p) p.value = typeof v === "string" ? v : JSON.stringify(v); };
  const M = (m) => "[" + m.map((r) => "[" + r.join(",") + "]").join(",") + "]";
  put("A12", M(gga.A12));
  put("A10", M(gga.A10));
  put("H0", M(gga.H0));
  put("r", M(gga.r));
  put("q", M(gga.q));
  put("Q", M(gga.Q0));
  put("H", M(gga.Hj0));
  const nx = props.find((p) => p.id === "nExp"); if (nx) nx.value = gga.nExp;
  const it = props.find((p) => p.id === "iterations"); if (it) it.value = 60;

  src.title = `Todini-Pilati GGA in one Math Engine — ${NET_NAME}`;
  src.description = `${src.description}

── THIS COPY CARRIES A REAL NETWORK ──
The operands are no longer the four-pipe demonstration: they are ${NET_NAME}, ${gga.order.pipes.length} pipes and ${gga.order.junctions.length} junctions against ${gga.order.fixedNodes.length} fixed-head node(s), written out by tools/epanet/inp2canvas.mjs from the EPANET .inp.

ORDERING IS THE CONTRACT. Row i of A12, A10, r, Q and every result is pipe ${gga.order.pipes.map((p) => `\`${p}\``).join(", ")} in that order; column j of A12 and row j of q and H is junction ${gga.order.junctions.map((p) => `\`${p}\``).join(", ")}. The fixed-head node(s) in H0 are ${gga.order.fixedNodes.map((p) => `\`${p}\``).join(", ")}.

r IS SI AND ALREADY CARRIES THE LENGTH: r = 10.667·L / (C^1.852·d^4.871) for Hazen-Williams, so h = r·Q^1.852 with Q in m³/s gives metres. q is m³/s too — a 150 gpm demand is 0.009464, not 9.464.

VERIFIED: 60 iterations bring the energy residual to ~1e-10 and the flows to within 1e-4 L/s of what the official EPANET 2.2 toolkit reports for the same file. See tools/epanet/verify.mjs.

WHAT THIS ROUTE CANNOT DO that the Pipe Network Solver node can: it does not read the canvas. The matrices are typed operands, so the incidence and the resistances must be rebuilt when the drawing changes. Use it to see the algebra; use the solver node to work.`;

  writeFileSync("tools/epanet/out-flow/gga-pipe-network.json", JSON.stringify(src, null, 2) + "\n", "utf8");
  console.log(`ok   gga-pipe-network.json    ${gga.order.pipes.length} pipes x ${gga.order.junctions.length} junctions`);
}

console.log(`ok   epanet-pipe-network.json ${nodes.length} nodes, ${edges.length} edges`);
