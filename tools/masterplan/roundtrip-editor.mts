/**
 * The editor's own load → save path on a grouped document, without the browser:
 * groupedToMerged → fromStandardPlan (what Import does) → toStandardPlan (what Save / Export does) — the
 * result must be a grouped document again with every entity where it was.
 *   npx tsx tools/masterplan/roundtrip-editor.mts <grouped.json>
 */
import { readFileSync } from "node:fs";
import { groupedToMerged, localId } from "../../src/floorplan/planGroups.ts";
import { fromStandardPlan, toStandardPlan } from "../../src/floorplan/planFormat.ts";

type Json = Record<string, any>;
/** Key order is not data: the writer emits fixed fields first. */
/** An empty `attachments: []` is omitted by the writer (as for every plan) — absent and empty are equal. */
const canon = (v: any): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().filter((k) => !(k === "attachments" && Array.isArray(x[k]) && !x[k].length)).map((k) => [k, x[k]])) : x));
const doc: Json = JSON.parse(readFileSync(process.argv[2], "utf8"));
const merged = groupedToMerged(doc);
const { model, frame } = fromStandardPlan(merged as any);
const saved: Json = toStandardPlan(model as any, frame) as any;
console.log("saved schemaVersion", saved.schemaVersion, "groups", saved.groups?.length, "levels", saved.levels?.map((l: Json) => l.id).join(" "));

// Compare every group's canvas, entity by entity (nodes are renumbered on save, so compare positions).
let checked = 0, bad = 0;
const pos = (c: Json, lvl: Json) => new Map(lvl.nodes.map((n: Json) => [n.id, n]));
for (const g of doc.groups as Json[]) {
  const h = saved.groups.find((x: Json) => x.id === g.id);
  if (!h) { bad++; console.log("missing group", g.id); continue; }
  for (const k of ["name", "design", "parent", "locked"]) if (canon(g[k]) !== canon(h[k])) { bad++; console.log("group field", g.id, k, g[k], h[k]); }
  if (canon(g.transform) !== canon(h.transform) || canon(g.levelMap) !== canon(h.levelMap)) { bad++; console.log("placement differs", g.id); }
  const L = (c: Json) => (c.levels?.length ? c.levels : [c]);
  for (const a of L(g.canvas)) {
    const b = L(h.canvas).find((x: Json) => (x.id ?? "") === (a.id ?? ""));
    if (!b) { bad++; console.log("missing canvas level", g.id, a.id); continue; }
    const na = pos(g.canvas, a), nb = pos(h.canvas, b);
    const near = (p: Json, q: Json) => p && q && Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6;
    const segB = new Map(b.segments.map((s: Json) => [s.id, s]));
    for (const s of a.segments) {
      const t: Json = segB.get(s.id); checked++;
      const strip = (x: Json) => ({ ...x, fromNodeId: 0, toNodeId: 0 });
      if (!t || !near(na.get(s.fromNodeId), nb.get(t.fromNodeId)) || !near(na.get(s.toNodeId), nb.get(t.toNodeId)) || canon(strip(s)) !== canon(strip(t))) { if (bad++ < 5) console.log("segment", g.id, s.id, t ? "differs" : "missing"); }
    }
    const spB = new Map(b.spaces.map((s: Json) => [s.id, s]));
    for (const s of a.spaces) {
      const t: Json = spB.get(s.id); checked++;
      if (!t || s.nodeIds.some((n: string, i: number) => !near(na.get(n), nb.get(t.nodeIds[i]))) || canon({ ...s, nodeIds: 0 }) !== canon({ ...t, nodeIds: 0 })) { if (bad++ < 5) console.log("space", g.id, s.id, t ? "differs" : "missing"); }
    }
    if (b.segments.length !== a.segments.length || b.spaces.length !== a.spaces.length) { bad++; console.log("count", g.id, a.id, a.segments.length, b.segments.length, a.spaces.length, b.spaces.length); }
  }
}
console.log(`editor load → save: ${checked} entities checked, ${bad} differences`);
process.exit(bad ? 1 : 0);
