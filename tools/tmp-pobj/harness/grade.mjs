import { PPM, ROOM, SEGMENTS, NODES, SPACES, EXPECTED } from "./canvas.mjs";
import { planJson } from "./planjson.mjs";

const CANVAS = {
  spaces: SPACES.map(s => s.poly), spaceMeta: SPACES.map(s => s.meta),
  segments: SEGMENTS.map(s => s.seg), segmentMeta: SEGMENTS.map(s => s.meta),
  nodes: NODES.map(n => [n.at]), nodeMeta: NODES.map(n => n.meta),
};

/** Grade a payload against the ground truth: everything of ours present, nothing of the neighbour's. */
function grade(res) {
  const j = JSON.parse(res.json);
  const got = new Set();
  if (j.space?.objectId) got.add(j.space.objectId);
  for (const s of j.spaces ?? []) if (s.objectId) got.add(s.objectId);
  for (const s of j.segments) if (s.objectId) got.add(s.objectId);
  for (const n of j.nodes ?? []) if (n.objectId) got.add(n.objectId);
  const missing = EXPECTED.objects.filter(o => !got.has(o));
  const ids = [...(j.segments ?? []).map(s => s.id), ...(j.nodes ?? []).map(n => n.id)].filter(Boolean);
  const intruders = EXPECTED.mustNotInclude.filter(x => ids.includes(x));
  const nodesGot = (j.nodes ?? []).map(n => n.id);
  const nodesMissing = EXPECTED.nodeIds.filter(n => !nodesGot.includes(n));
  const withSemantics = [...(j.segments ?? []), ...(j.nodes ?? []), ...(j.space ? [j.space] : [])].filter(x => x.params?.semantics).length;
  const withObject = [...(j.segments ?? []), ...(j.nodes ?? []), ...(j.space ? [j.space] : [])].filter(x => x.objectId).length;
  return { j, missing, intruders, nodesMissing, withSemantics, withObject,
           ok: !missing.length && !intruders.length && !nodesMissing.length && withSemantics === withObject };
}

console.log("tol   segs nodes objs  bytes | missing            intruders          verdict");
console.log("─".repeat(96));
let best = null;
for (const tol of [0, 0.15, 0.3, 0.5, 1.0, 1.5, 2.0, 3.0]) {
  const res = planJson(CANVAS, { ppm: PPM, scope: ROOM, edgeTolerance: tol });
  const g = grade(res);
  const verdict = g.ok ? "PASS" : (g.missing.length || g.nodesMissing.length ? "incomplete" : "over-reach");
  console.log(
    String(tol).padEnd(6) + String(res.segmentCount).padEnd(5) + String(res.nodeCount).padEnd(6) +
    String(res.objectCount).padEnd(6) + String(res.bytes).padEnd(7) + "| " +
    ([...g.missing.map(x=>x.replace("-with-math","")), ...g.nodesMissing].join(",") || "—").padEnd(19) +
    (g.intruders.join(",") || "—").padEnd(19) + verdict);
  if (g.ok && !best) best = { tol, res, g };
}
console.log("\nsmallest tolerance that passes:", best ? best.tol + " m" : "NONE");
if (best) {
  console.log("payload:", best.res.bytes, "B |", best.g.withObject, "objects, all", best.g.withSemantics, "carrying semantics");
  console.log("\nnodes as the model receives them:");
  for (const n of best.g.j.nodes) console.log("   " + n.id.padEnd(14) + "at " + JSON.stringify(n.at).padEnd(16) + (n.params?.rotation !== undefined ? "rot " + n.params.rotation + "°" : "(no rotation)"));
}
