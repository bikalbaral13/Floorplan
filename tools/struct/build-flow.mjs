/** Build `frame-analysis.json` — the canvas-driven plane-frame analysis, in one Math Engine.
 *
 *      Geometry ──(Canvas JSON)──▶ Math Engine (decode + direct stiffness) ──▶ Output Metrics
 *                                        ▲          │
 *      Settings + ALGORITHM + RUN ───────┘          ├──▶ Set Object Param ×6  (joints)
 *      Canvas ──(Nodes / Segments)───────────────────┴──▶ Set Object Param ×6  (members)
 *
 *  The same shape as the pipe-network flow, and deliberately so: read the drawing, solve it, write the
 *  answer back onto the elements that produced it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { exprInputs, exprOutputs } from "@builderpluss/engine/node";
import { FRAME_BODY, NODE_PARAM_KEYS, SEG_PARAM_KEYS, TYPE_NAMES, ANALYSES, DIAGRAMS } from "./frame-body.mjs";

mkdirSync("tools/struct/out-flow", { recursive: true });

const rng = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [], editable: true, showInCanvas: false, necessary: true });
const sel = (id, name, value, options) => ({ id, name, type: "select", value, options, min: 0, max: 0, step: 1, editable: true, showInCanvas: false, necessary: true });
const btn = (id, name) => ({ id, name, type: "button", value: 0, min: 0, max: 0, step: 1, options: [], editable: true, showInCanvas: false, necessary: true });

const settings = [
  btn("run", "Run — analyse & apply"),
  sel("analysis", "Analysis method", ANALYSES[0], ANALYSES),
  sel("diagram", "Diagram on every member", DIAGRAMS[1], DIAGRAMS),
  rng("pdeltaIters", "P-Delta passes", 8, 1, 20, 1),
  rng("loadFactor", "Load factor", 1, 0, 5, 0.05),
  rng("stiffnessFactor", "Stiffness modifier (cracked section)", 1, 0.05, 1, 0.05),
  rng("deflectionLimit", "Deflection limit (span / n)", 250, 50, 1000, 10),
  rng("driftLimit", "Drift limit (height / n)", 500, 100, 2000, 10),
];

const decode = { from: "canvasJson", typeNames: TYPE_NAMES, nodeParams: NODE_PARAM_KEYS, segParams: SEG_PARAM_KEYS };

const GLOBAL_SLOTS = [
  ["nodesRead", "Nodes read"],
  ["segmentsRead", "Segments read"],
  ["memberCount", "Members"],
  ["beamCount", "Beams"],
  ["columnCount", "Columns"],
  ["supportCount", "Supports"],
  ["totalDofs", "Total DOF"],
  ["freeDofs", "Free DOF"],
  ["restrainedDofs", "Restrained DOF"],
  ["isolatedNodes", "Isolated nodes"],
  ["danglingEnds", "Unresolved member ends"],
  ["analysisCode", "Method (1 frame, 2 truss, 3 P-Δ)"],
  ["solved", "Solved"],
  ["iterationsRun", "Passes"],
  ["totalMemberLength", "Total member length (m)"],
  ["structureWeight", "Self weight included (kN)"],
  ["totalSpanLoad", "Total span load (kN)"],
  ["appliedFx", "Applied Fx (kN)"],
  ["appliedFy", "Applied Fy (kN)"],
  ["reactionFx", "Reaction Fx (kN)"],
  ["reactionFy", "Reaction Fy (kN)"],
  ["equilibriumX", "Horizontal equilibrium error (kN)"],
  ["equilibriumY", "Vertical equilibrium error (kN)"],
  ["verticalCheck", "Vertical residual (kN)"],
  ["maxDispX", "Max displacement X (mm)"],
  ["maxDispY", "Max displacement Y (mm)"],
  ["maxDisplacement", "Max displacement (mm)"],
  ["maxRotation", "Max rotation (mrad)"],
  ["maxAxialTension", "Max axial tension (kN)"],
  ["maxAxialCompression", "Max axial compression (kN)"],
  ["maxShear", "Max shear (kN)"],
  ["maxEndMoment", "Max end moment (kNm)"],
  ["maxReaction", "Max reaction (kN)"],
  ["strainEnergy", "Strain energy (kNm)"],
  ["allowableDeflection", "Allowable deflection (mm)"],
  ["deflectionOk", "Deflection OK"],
  ["storeyDrift", "Drift (mm)"],
  ["allowableDrift", "Allowable drift (mm)"],
  ["driftOk", "Drift OK"],
  ["topSway", "Top sway (mm)"],
  ["swayIndex", "Sway = height / n"],
  ["swayRatio", "Sway ratio"],
  ["baseShear", "Base shear (kN)"],
  ["overturningMoment", "Overturning moment (kNm)"],
  ["equilibriumOk", "Equilibrium OK"],
  ["analysisOk", "Analysis OK"],
];

const WRITERS = [
  ["w_ux", "node", "ux", "JointUx", "Joint — displacement X"],
  ["w_uy", "node", "uy", "JointUy", "Joint — displacement Y"],
  ["w_rot", "node", "rotZ", "JointRot", "Joint — rotation"],
  ["w_rx", "node", "Rx", "JointRx", "Joint — reaction X"],
  ["w_ry", "node", "Ry", "JointRy", "Joint — reaction Y"],
  ["w_rz", "node", "Rz", "JointRz", "Joint — reaction moment"],
  ["w_n1", "segment", "N1", "MemN1", "Member — axial at start"],
  ["w_v1", "segment", "V1", "MemV1", "Member — shear at start"],
  ["w_m1", "segment", "M1", "MemM1", "Member — moment at start"],
  ["w_n2", "segment", "N2", "MemN2", "Member — axial at end"],
  ["w_v2", "segment", "V2", "MemV2", "Member — shear at end"],
  ["w_m2", "segment", "M2", "MemM2", "Member — moment at end"],
  ["w_h", "node", "height", "JointHeight", "Joint — height above base"],
  ["w_du1", "segment", "u1", "MemDu1", "Member — axial disp at start"],
  ["w_dv1", "segment", "v1", "MemDv1", "Member — transverse disp at start"],
  ["w_dr1", "segment", "r1", "MemDr1", "Member — rotation at start"],
  ["w_du2", "segment", "u2", "MemDu2", "Member — axial disp at end"],
  ["w_dv2", "segment", "v2", "MemDv2", "Member — transverse disp at end"],
  ["w_dr2", "segment", "r2", "MemDr2", "Member — rotation at end"],
  // The only writer with a VALUE MAP: the Math Engine can put a number on a wire and nothing else,
  // so the diagram choice travels as a code and is mapped back to the member's own select here.
  ["w_diag", "segment", "diagram", "MemDiagram", "Member — diagram", DIAGRAMS.join(",")],
];

const nodes = [
  { id: "geo", position: { x: -1240, y: -40 }, data: { tool: "source", params: { grabFromSelection: false, id: "", nodeLabel: "Geometry" } } },
  { id: "canvas", position: { x: -1240, y: 320 }, data: { tool: "canvas-source", params: {} } },
  { id: "settings", position: { x: -1240, y: -520 }, data: { tool: "input-props", params: { props: settings } } },
  { id: "solve", position: { x: -720, y: -200 }, data: { tool: "expr", params: { name: "Plane frame — direct stiffness", expr: FRAME_BODY, decode: JSON.stringify(decode, null, 1), encode: "" } } },
  { id: "summary", position: { x: -120, y: -560 }, data: { tool: "output", params: { slots: GLOBAL_SLOTS.map(([, label], i) => ({ id: `s${i + 1}`, label, showInCanvas: false, necessary: true })) } } },
  ...WRITERS.map(([id, host, paramKey, , label, valueMap], i) => ({
    id, position: { x: -120, y: 140 + i * 140 },
    data: { tool: "set-object-param", params: { host, paramKey, valueMap: valueMap ?? "", template: "", nodeLabel: label } },
  })),
];

const edges = [
  { id: "e_geo_solve", source: "geo", target: "solve", sourceHandle: "val-canvasJson", targetHandle: "valin-canvasJson" },
  ...settings.map((p) => ({ id: `e_set_${p.id}`, source: "settings", target: "solve", sourceHandle: `val-${p.id}`, targetHandle: `valin-${p.id}` })),
  ...GLOBAL_SLOTS.map(([name], i) => ({ id: `e_out_${name}`, source: "solve", target: "summary", sourceHandle: `val-${name}`, targetHandle: `valin-s${i + 1}` })),
  ...WRITERS.flatMap(([id, host, , matrix]) => [
    { id: `e_bundle_${id}`, source: "canvas", target: id, sourceHandle: host === "node" ? "out-1" : "out-2", targetHandle: null },
    { id: `e_vals_${id}`, source: "solve", target: id, sourceHandle: `val-${matrix}`, targetHandle: "valin-values" },
  ]),
];

const flow = {
  version: 1,
  id: "frame-analysis",
  title: "Plane frame analysis — direct stiffness, three methods, in one Math Engine",
  category: "Structural",
  description: `Draw a frame in elevation, press RUN, and read the analysis off the members and joints themselves.

THE STRUCTURE IS THE DRAWING. The **Geometry** node's Canvas JSON goes into the **Math Engine**'s \`decode\` block, which publishes the topology and the PARAMETERS off every attached object: a joint's restraints and nodal loads, a member's E, breadth, depth, span load and end releases. Change a section on a beam and the next run analyses the new frame, because the beam is where that number lives.

THE CANVAS PLANE IS THE FRAME'S PLANE. Canvas x is structural X; structural Y is UP, which is minus canvas y. That negation happens once, at the top of the body, and nothing downstream repeats it — which is why a joint's \`Fy\` is positive upwards and gravity is negative.

THREE METHODS, ONE ASSEMBLY — the \`Analysis method\` setting picks between them, and they are not three solvers:
  • **Plane frame (first-order)** — the full 6×6 member stiffness, axial and bending.
  • **Plane truss (axial only)** — the SAME assembly with the flexural terms switched off and every rotational freedom restrained. A truss is a frame with no bending stiffness and no rotational DOF, so it needs two scalars, not a second code path. Note that a portal frame is a MECHANISM when pin-jointed: an unbraced rectangle has no truss solution, and a solver that returns one for it is wrong.
  • **Plane frame (P-Δ)** — first-order, then the geometric stiffness Kg built from the axial forces just found, re-solved, repeated for \`P-Delta passes\`. Second-order effects come from iterating the same assembly. On the benchmark portal it amplifies sway from 5.499 mm to 5.535 mm — small, real, and exactly what the reference package reports.

CONSTRAINTS BY ROW REPLACEMENT, not renumbering. A restrained DOF's row becomes an identity row and its column is cleared from the rest — algebraically the same system as deleting it, without the free-DOF numbering map that the expression language has no cheap way to build. A node no member reaches, and any DOF left with no stiffness at all, is pinned the same way: a zero on the diagonal is a singular matrix, and it would take every number in the model with it rather than failing loudly.

MOMENT RELEASES BY GATED STATIC CONDENSATION — local DOF 2, then DOF 5 from the already-condensed matrix, which is the correct sequential form for a member released at both ends. A member with no release runs the identical arithmetic multiplied by zero, so there is one path through the code regardless.

WHERE THE ANSWER LANDS. Six writers put displacements, rotations and reactions on each **Joint**, and six put the end actions on each **Member**. Those objects then do their own work: a Joint turns its displacement into a deflected position drawn on the canvas and checks its reaction; a Member samples M(x) = −M₁ + V₁x − wx²/2 along the span, DRAWS ITS OWN BENDING MOMENT DIAGRAM, and reports max moment, max shear, combined stress and utilisation. Select a beam and its Metrics tab is its own solved state.

THE FLOW'S OWN METRICS ARE THE WHOLE-STRUCTURE ANSWER: model size and DOF counts, applied load against reactions with the equilibrium error between them, peak displacement, rotation, axial, shear, moment and reaction, strain energy, and pass/fail on deflection and drift against the limits on the settings node. \`Equilibrium OK\` is the audit that matters — every applied force must come back out through the supports.

VERIFIED against PyNite (an independent, validated open-source frame FEA) on two benchmarks: a fixed-base portal with a UDL and a lateral load, and a triangulated simple truss. All three methods reproduce its displacements, reactions and member end actions to better than 0.001 mm and 0.005 kN, with zero equilibrium residual. SAP2000 / ETABS were not available to check against directly. See tools/struct/check-frame.mjs.

WHAT THIS CANNOT DO. Plane frames only — no out-of-plane action, no torsion, no plates. Linear elastic and small-displacement apart from the P-Δ geometric term; no buckling check, no plastic hinges, no dynamics, no load combinations (one load case, scaled by \`Load factor\`), no code checks. The stiffness modifier is a blunt multiplier on I for cracked sections, not a section analysis.`,
  nodes,
  edges,
};

// ── Validation ────────────────────────────────────────────────────────────────
const problems = [];
const ins = exprInputs(FRAME_BODY);
const outs = new Set(exprOutputs(FRAME_BODY));
const DECODED = new Set(["a", "b", "thickness", "length", "types", "spaces", "areas", "nodes", "nodeTypes",
  "segNodes", "nodeVals", "nodeHas", "segVals", "segHas", "segmentCount", "spaceCount", "nodeCount", "unresolvedEnds"]);
const settingIds = new Set(settings.map((p) => p.id));
for (const v of ins) if (!DECODED.has(v) && !settingIds.has(v)) problems.push(`free variable "${v}" is neither decoded nor a setting — it would evaluate to 0`);
for (const p of settings) if (!ins.includes(p.id)) problems.push(`setting "${p.id}" is never read by the body — its wire would dangle`);
for (const [name] of GLOBAL_SLOTS) if (!outs.has(name)) problems.push(`output slot "${name}" is not published by the body`);
for (const [, , , matrix] of WRITERS) if (!outs.has(matrix)) problems.push(`writer matrix "${matrix}" is not published by the body`);
const ids = edges.map((e) => e.id);
if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");
const nodeIds = new Set(nodes.map((n) => n.id));
for (const e of edges) {
  if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) problems.push(`edge ${e.id}: unknown endpoint`);
  if (e.source === "solve" && e.sourceHandle.startsWith("val-") && !outs.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: body publishes no "${e.sourceHandle.slice(4)}"`);
}
// A body line that spans several source lines is TRUNCATED by the parser rather than rejected, and the
// result is a silently wrong matrix. Nothing but a balance check catches it.
FRAME_BODY.split("\n").forEach((ln, i) => {
  const t = ln.trim();
  if (!t || t.startsWith("#")) return;
  const open = (t.match(/\(/g) ?? []).length, close = (t.match(/\)/g) ?? []).length;
  if (open !== close) problems.push(`body line ${i + 1} has unbalanced brackets — a multi-line call is truncated: ${t.slice(0, 60)}`);
});

const json = JSON.stringify(flow, null, 2) + "\n";
JSON.parse(json);
writeFileSync("tools/struct/out-flow/frame-analysis.json", json, "utf8");

if (problems.length) {
  console.log("FAIL frame-analysis.json");
  for (const p of problems) console.log(`      - ${p}`);
  process.exit(1);
}
console.log(`ok   frame-analysis.json  ${nodes.length} nodes, ${edges.length} edges, ${GLOBAL_SLOTS.length} global metrics, ${WRITERS.length} writers, ${json.length} B`);
console.log(`     body: ${FRAME_BODY.split("\n").length} lines, ${ins.length} inputs (${ins.filter((v) => DECODED.has(v)).length} decoded, ${ins.filter((v) => settingIds.has(v)).length} wired), ${outs.size} published names`);
