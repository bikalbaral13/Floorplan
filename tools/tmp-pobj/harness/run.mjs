import { writeFileSync } from "node:fs";
import { flow, HANDLES } from "../flow-faithful-render.mjs";
import { PPM, ROOM, SEGMENTS, NODES, SPACES, EXPECTED } from "./canvas.mjs";
import { planJson } from "./planjson.mjs";

const problems = [];
const byId = new Map(flow.nodes.map(n => [n.id, n]));

// ── structure ──
for (const e of flow.edges) {
  const s = byId.get(e.source), t = byId.get(e.target);
  if (!s || !t) { problems.push(`${e.id}: unknown endpoint`); continue; }
  const hs = HANDLES[s.data.tool], ht = HANDLES[t.data.tool];
  // A GEOMETRY edge carries no handles (both null) — it uses the node's left/right geometry ports, so it
  // is graded against `geomOut` / `geomIn` rather than against a value key.
  if (!e.sourceHandle && !e.targetHandle) {
    if (!hs.geomOut) problems.push(`${e.id}: ${s.data.tool} has no geometry output`);
    if (!ht.geomIn) problems.push(`${e.id}: ${t.data.tool} has no geometry input`);
    continue;
  }
  const sk = e.sourceHandle.slice(4), tk = e.targetHandle.slice(6);
  if (!hs.dynamicVout && !(hs.vout ?? []).includes(sk)) problems.push(`${e.id}: ${s.data.tool} publishes no val-${sk}`);
  if (!ht.dynamicVin && !(ht.vin ?? []).includes(tk)) problems.push(`${e.id}: ${t.data.tool} has no valin-${tk}`);
}
for (const n of flow.nodes) { const h = HANDLES[n.data.tool];
  if (!h.root && !h.aboveGate && !flow.edges.some(e => e.target === n.id)) problems.push(`${n.id} would never evaluate`); }
if (new Set(flow.edges.map(e => e.id)).size !== flow.edges.length) problems.push("duplicate edge id");

// A dynamic-endpoint node (Input Properties, Output) grows one endpoint per declared parameter / slot, so
// an edge naming anything else dangles silently — the exact failure `dynamicVin` cannot catch above.
const props = byId.get("props").data.params.props;
const propIds = new Set(props.map(p => p.id));
const slotIds = new Set(byId.get("out").data.params.slots.map(s => s.id));
for (const e of flow.edges) {
  // Geometry edges (no handles) address the node's left/right ports, not a parameter — graded above.
  if (!e.sourceHandle && !e.targetHandle) continue;
  if (e.target === "props" && !propIds.has(e.targetHandle.slice(6))) problems.push(`${e.id}: no parameter ${e.targetHandle.slice(6)}`);
  if (e.source === "props" && !propIds.has(e.sourceHandle.slice(4))) problems.push(`${e.id}: no parameter ${e.sourceHandle.slice(4)}`);
  if (e.target === "out" && !slotIds.has(e.targetHandle.slice(6))) problems.push(`${e.id}: no slot ${e.targetHandle.slice(6)}`);
}
for (const want of ["element", "vertices", "margin", "json"]) if (!propIds.has(want)) problems.push(`Input Properties has no "${want}" parameter`);

// The wiring this flow exists for: every per-run input arrives at the props node, and the ONE margin
// reaches BOTH consumers, so the payload that is cut and the picture that is taken frame one region.
const wiredFrom = (target, handle) => {
  const e = flow.edges.find(x => x.target === target && x.targetHandle === `valin-${handle}`);
  return e ? { node: e.source, tool: byId.get(e.source).data.tool, key: e.sourceHandle.slice(4) } : null;
};
const expectWire = (target, handle, fromNode, fromKey) => {
  const w = wiredFrom(target, handle);
  if (!w) problems.push(`${target} has no ${handle} wire`);
  else if (w.node !== fromNode || (fromKey && w.key !== fromKey)) problems.push(`${target}.${handle} comes from ${w.node}.${w.key}, not ${fromNode}.${fromKey}`);
};
expectWire("props", "element", "geom", "id");         // 1. WHICH element the run is about
expectWire("props", "vertices", "geom", "points");     // 2. the region's outline, onto the panel
expectWire("props", "json", "geom", "canvasJson");    // 3. the SAME node's other output — the payload
// The id reaches the metrics THROUGH the orchestrator, like every other per-run value in this flow.
expectWire("out", "s0", "props", "element");
expectWire("filter", "json", "props", "json");        // 3. scoping reads both off the orchestrator…
expectWire("filter", "margin", "props", "margin");
expectWire("snap", "margin", "props", "margin");      // 4. …and the SAME margin frames the photograph
expectWire("render", "image", "snap", "image");       // 5. both pictures + the scoped data
expectWire("render", "image3d", "snap", "image-3d");
expectWire("render", "prompt", "filter", "json");
// NO GEOMETRY WIRE ANYWHERE: the region is a point LIST from the Geometry node to both consumers. A
// geometry edge reappearing means the outline is being carried twice, which is the drift this removes.
if (flow.edges.some(e => !e.sourceHandle && !e.targetHandle)) problems.push("a geometry wire is back — the region travels as `points` in this flow");
expectWire("filter", "points", "props", "vertices");
expectWire("snap", "points", "props", "vertices");
for (const target of ["filter", "snap", "render"]) {
  if (flow.edges.some(e => e.source === "geom" && e.target === target)) problems.push(`${target} bypasses the orchestrator and reads the Geometry node directly`);
}
for (const n of flow.nodes) if (n.data.tool === "vertices" || n.data.tool === "polygon") problems.push(`${n.id}: ${n.data.tool} is back — the orchestrator forwards geometry, so neither is needed`);
if (byId.get("snap").data.params.scope !== "selected") problems.push("Snapshot scope is not 'selected' — its geometry input and Margin would be ignored");
if (flow.nodes.some(n => n.data.tool === "plan-json")) problems.push("a Plan JSON node is back — the Geometry node publishes the payload on val-canvasJson");
if (byId.get("render").data.params.api_key !== "") problems.push("api_key not blank");

// ── the payload the render will actually receive ──
// Filter by Space tests a space by its centroid, a segment by its midpoint and a node by its point,
// keeping anything within `margin` of the region's boundary — the same three rules planJson applies for
// its own scope, so the simulation below grades the real catchment with the region + margin this flow
// declares, rather than with a tolerance typed on a node that no longer does the scoping.
const CANVAS = { spaces: SPACES.map(s=>s.poly), spaceMeta: SPACES.map(s=>s.meta),
  segments: SEGMENTS.map(s=>s.seg), segmentMeta: SEGMENTS.map(s=>s.meta),
  nodes: NODES.map(n=>[n.at]), nodeMeta: NODES.map(n=>n.meta) };
const margin = props.find(p => p.id === "margin").value;
// The region is the SELECTION now — the harness bedroom — forwarded through the orchestrator. The
// "Vertices" parameter only mirrors it for the panel, so it is graded as a readout, not as the source.
const region = ROOM;
const shown = JSON.parse(props.find(p => p.id === "vertices").value);
if (shown.length !== ROOM.length) problems.push("the Vertices parameter's fallback is not the harness room — the panel would show a different outline before the wire lands");
const pj = planJson(CANVAS, { ppm: PPM, scope: region, edgeTolerance: margin });
const j = JSON.parse(pj.json);
const ids = [...j.segments.map(s=>s.id), ...j.nodes.map(n=>n.id)].filter(Boolean);
for (const bad of EXPECTED.mustNotInclude) if (ids.includes(bad)) problems.push(`catchment pulled in ${bad}`);
for (const want of EXPECTED.nodeIds) if (!j.nodes.some(n=>n.id===want)) problems.push(`missing ${want}`);
for (const n of j.nodes) { if(!Array.isArray(n.at)) problems.push(`${n.id} has no position`);
  if(!n.params?.semantics) problems.push(`${n.id} has no semantics`); }

// ── the system prompt must carry every standing instruction, since nothing else does now ──
const sys = byId.get("render").data.params.systemPrompt;
const RULES = [
  [/\+y is DOWN/i,                                        "the axis convention"],
  [/space\.boundary`? is the room's outline|take the room's extent/i, "how to read the frame from the JSON"],
  [/ORIENTATION OF THE SPACE DOES NOT CHANGE/i,           "rule 1: orientation"],
  [/do not rotate the plan|mirror or flip/i,              "rule 1: no rotate/mirror"],
  [/PLACEMENT OF EVERY OBJECT, DOOR AND WINDOW DOES NOT CHANGE/i, "rule 2: placement"],
  [/Never move, rotate, resize, add, remove/i,            "rule 2: no edits"],
  [/STRICTLY FROM ITS OWN `semantics`/i,                  "rule 3: semantics binding"],
  [/do not average them into one house style/i,           "rule 3: per-object materials"],
  [/TWO IMAGES SHOW THE SAME REGION/i,                    "how to read the plan against the top view"],
  [/STYLE, unless the data says otherwise/i,              "the style direction"],
];
for (const [re, name] of RULES) if (!re.test(sys)) problems.push(`system prompt is missing ${name}`);

console.log(`nodes ${flow.nodes.length}, edges ${flow.edges.length}`);
console.log(`margin ${margin} m -> ${pj.segmentCount} segments, ${pj.nodeCount} nodes, ${pj.objectCount} objects`);
console.log(`what Render receives: plan + top view + a ${pj.bytes} B JSON prompt + a ${sys.length} B system prompt`);
console.log(`every node: position ✓ semantics ✓ | all ${RULES.length} standing instructions present ✓`);
writeFileSync("out/_composed_prompt.txt", "=== SYSTEM PROMPT ===\n\n" + sys + "\n\n=== PROMPT (the scoped canvas JSON) ===\n\n" + pj.json, "utf8");
const json = JSON.stringify(flow, null, 2); JSON.parse(json);
writeFileSync("out/Faithful_Space_Render.json", json, "utf8");
console.log(`\n${problems.length ? "PROBLEMS:\n  "+problems.join("\n  ") : "all checks passed"}`);
console.log(`${(json.length/1024).toFixed(1)} KB`);
