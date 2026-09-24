/** Standard plan → the `FloorPlanModel` shape `apply_model` wants.
 *
 *  A JS mirror of `fromStandardPlan` (src/floorplan/planFormat.ts) — same field moves, same
 *  `stableKeys` derivation, so what the bridge receives is what the editor would have built from
 *  the file itself. Kept here rather than imported because planFormat is TypeScript and this runs
 *  under bare node.
 */
import fs from "node:fs";

/** A node is addressed by the sorted set of segment ends meeting at it — see planFormat. */
function stableKeys(segments) {
  const ends = new Map();
  const push = (id, token) => ends.set(id, [...(ends.get(id) ?? []), token]);
  for (const s of segments) {
    push(s.fromNodeId, `${s.id}:start`);
    push(s.toNodeId, `${s.id}:end`);
  }
  return new Map([...ends].map(([id, tokens]) => [id, tokens.slice().sort().join("|")]));
}

export function toModel(plan) {
  const at = new Map((plan.nodes ?? []).map((n) => [n.id, { x: Number(n.x) || 0, y: Number(n.y) || 0 }]));
  const point = (id) => at.get(id) ?? { x: 0, y: 0 };

  const walls = (plan.segments ?? []).map(({ id, fromNodeId, toNodeId, layer, attachments, ...rest }) => ({
    thickness: 4, color: "#334155",
    ...rest,
    id, start: point(fromNodeId), end: point(toNodeId), layerId: layer ?? "0",
    ...(attachments?.length ? { attachments } : {}),
  }));

  const rooms = (plan.spaces ?? []).map(({ id, nodeIds, layer, attachments, ...rest }) => ({
    fill: "rgba(34,197,94,0.2)", stroke: "#16A34A",
    ...rest,
    id, points: (nodeIds ?? []).map(point), layerId: layer ?? "0",
    ...(attachments?.length ? { attachments } : {}),
  }));

  const keys = stableKeys(plan.segments ?? []);
  const nodeMeta = {};
  for (const n of plan.nodes ?? []) {
    const { id, x, y, layer, ...rest } = n;
    if (!Object.keys(rest).length) continue;
    const key = keys.get(id);
    if (key) nodeMeta[key] = rest;
  }

  return {
    walls,
    rooms,
    objects: [],
    furniture: [],
    layers: plan.layers ?? [],
    imageUnderlay: plan.imageUnderlay ?? null,
    pixelsPerMeter: plan.settings?.pixelsPerMeter ?? 50,
    ...(Object.keys(nodeMeta).length ? { nodeMeta } : {}),
  };
}

if (process.argv[1]?.endsWith("toModel.mjs")) {
  const src = process.argv[2] ?? "tools/scribbleplan/scribble-house.json";
  const out = process.argv[3] ?? src.replace(/\.json$/, ".model.json");
  const model = toModel(JSON.parse(fs.readFileSync(src, "utf8")));
  fs.writeFileSync(out, JSON.stringify(model));
  console.log(`${out}  ${model.walls.length} walls · ${model.rooms.length} rooms · ${Object.keys(model.nodeMeta ?? {}).length} node meta`);
}
