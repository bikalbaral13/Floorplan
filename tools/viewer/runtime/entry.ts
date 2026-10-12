/** Browser build of the app's object evaluator, for the R2 viewer's Web Worker.
 *
 * Exactly the path tools/bakeplan/main.ts takes (fromStandardPlan → withBakedAttachments → toStandardPlan),
 * so a live re-evaluation in the viewer matches the Phase 2 bake by construction — no second copy of the
 * engine. Input is a tiny standard plan: the one host (node + its self-loop segment, or a segment with its
 * two nodes) carrying the one attachment, plus the object definitions it references.
 */
import { withBakedAttachments } from "../../../src/floorplan/export/bakeAttachments";
import { fromStandardPlan, toStandardPlan, type StandardPlan } from "../../../src/floorplan/planFormat";
import type { FloorPlanModel } from "../../../src/floorplan/types";

export function evaluate(plan: StandardPlan, defs: Record<string, unknown>) {
  const objectLibrary: Record<string, unknown> = {};
  for (const host of [...plan.nodes, ...plan.segments, ...plan.spaces]) {
    for (const att of (host as { attachments?: { objectPath?: string; objectId: string }[] }).attachments ?? []) {
      const raw = att.objectPath ? (defs[att.objectPath] as Record<string, unknown> | undefined) : undefined;
      if (!raw) continue;
      const meta = (raw.object ?? {}) as { name?: string; symbol?: string; units?: string };
      objectLibrary[att.objectId] = raw.spine ? raw : {
        kind: "parametric-object", version: 1,
        meta: { id: att.objectId, name: String(meta.name ?? att.objectId), units: meta.units, symbol: meta.symbol },
        parameters: [], sourcePath: att.objectPath, spine: raw,
      };
    }
  }
  const { model: parsed } = fromStandardPlan(plan);
  const model = { walls: [], rooms: [], nodeMeta: {}, ...parsed, objectLibrary } as unknown as FloorPlanModel;
  const nodePositions: { stableKey: string; x: number; y: number }[] = [];
  const ends = new Map<string, { p: { x: number; y: number }; tokens: string[] }>();
  for (const w of model.walls) {
    for (const [p, tok] of [[w.start, `${w.id}:start`], [w.end, `${w.id}:end`]] as const) {
      const k = `${p.x},${p.y}`;
      const hit = ends.get(k);
      if (hit) hit.tokens.push(tok); else ends.set(k, { p, tokens: [tok] });
    }
  }
  for (const { p, tokens } of ends.values()) nodePositions.push({ stableKey: tokens.slice().sort().join("|"), x: p.x, y: p.y });
  const baked = withBakedAttachments(model, {
    pixelsPerMeter: plan.settings.pixelsPerMeter,
    nodePositions,
    resolveObjectDef: (id: string) => (objectLibrary[id] ? JSON.stringify(objectLibrary[id]) : null),
  });
  return toStandardPlan(baked, { pixelsPerMeter: plan.settings.pixelsPerMeter, northBearing: plan.settings.northbearing });
}
