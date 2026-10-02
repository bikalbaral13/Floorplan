/**
 * Ramanadhapuram master plan: the id-prefixed flat file → a grouped document (schemaVersion 3, see
 * docs/canvas-groups-schema.md), then back again to prove nothing moved.
 *
 *   npx tsx tools/masterplan/flat-to-grouped.mts [outFile]
 *
 * Groups: `site`, `plot-01` … `plot-19` (from the id prefixes, transforms from master_plan.json), and nested
 * groups for the units — the apartment's flats (`F0-1 · KITCHEN` → plot-19/F0-1) and the Villament's homes
 * (`… VILLA 3 …` → plot-05/villa-3). Unit groups hold their SPACES; walls stay with the plot, because a wall
 * between two flats belongs to neither.
 */
import { writeFileSync } from "node:fs";
import { groupedToMerged, mergedToGrouped, localId, type PlanGroup } from "../../src/floorplan/planGroups.ts";

type Json = Record<string, any>;
const BASE = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library/Master%20Plans/Ramanadhapuram/";
const out = process.argv[2] ?? "Ramanadhapuram_MasterPlan_grouped.json";

const flat: Json = await (await fetch(BASE + "Ramanadhapuram_MasterPlan_flat.json")).json();
const index: Json = await (await fetch(BASE + "master_plan.json")).json();
const ppm = Number(flat.settings.pixelsPerMeter) || 100;

// Leftover editor keys on levels must be empty, or the split would drop something.
for (const lv of flat.levels) for (const k of ["rooms", "furniture", "objects"]) if ((lv[k] ?? []).length) throw new Error(`level ${lv.id} has ${lv[k].length} ${k}`);

const prefixOf = (id: string) => id.split("/")[0];
const restOf = (id: string) => id.slice(id.indexOf("/") + 1);
const unitOf = (gid: string, label: unknown): string | null => {
  const s = String(label ?? "");
  if (gid === "plot-19") { const m = /^(F\d+-\d+)\s*·/.exec(s); return m ? `plot-19/${m[1]}` : null; }
  if (gid === "plot-05") { const m = /\bVILLA\s*(\d)\b/.exec(s); return m ? `plot-05/villa-${m[1]}` : null; }
  return null;
};

// ── groups table ──
const groups = new Map<string, PlanGroup>();
const site: PlanGroup = { id: "site", name: "Site", locked: true, visible: true, transform: { position: [0, 0], rotation: 0, mirror: false }, levelMap: {}, canvasLevels: [] };
groups.set("site", site);
for (const p of index.summary as Json[]) {
  const gid = `plot-${String(p.plot).padStart(2, "0")}`;
  const d = index.designs[p.design];
  groups.set(gid, {
    id: gid, name: `Plot ${p.plot} · ${p.design.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}`, design: p.design,
    transform: { position: p.position, rotation: p.rotation ?? 0, mirror: !!p.mirror },
    levelMap: {}, canvasLevels: [], visible: true, locked: false,
    source: { path: d.path, sha256: d.sha256 },
  });
}
const levelOfSite = new Map(flat.levels.map((l: Json) => [l.id, l]));
const noteLevel = (g: PlanGroup, canvasId: string, siteId: string) => {
  if (g.levelMap[canvasId]) return;
  g.levelMap[canvasId] = siteId;
  const sl: Json = levelOfSite.get(siteId);
  const names: string[] | undefined = g.design ? index.designs[g.design]?.levels : undefined;
  const k = /^L(\d+)$/.exec(canvasId);
  g.canvasLevels.push({ id: canvasId, name: (k && names?.[+k[1]]) || sl.name, elevation: sl.elevation, height: sl.height });
};
const unitGroup = (uid: string, parent: PlanGroup): PlanGroup => {
  let g = groups.get(uid);
  if (!g) {
    g = { id: uid, name: parent.id === "plot-19" ? `Flat ${uid.split("/")[1]}` : `Home ${uid.split("-").pop()}`, parent: parent.id,
      transform: { position: [0, 0], rotation: 0, mirror: false }, levelMap: {}, canvasLevels: [], visible: true, locked: false };
    groups.set(uid, g);
  }
  return g;
};

// ── tag every entity: groupId + `<group>::<local id>` ──
const q = (gid: string, id: string) => `${gid}::${restOf(id)}`;
const qAtts = (atts: Json[] | undefined) => atts?.map((a) => ({ ...a, id: q(prefixOf(a.id), a.id) }));
const merged: Json = { ...flat, levels: [] as Json[] };
for (const lv of flat.levels) {
  const nodes = lv.nodes.map((n: Json) => ({ ...n, id: q(prefixOf(n.id), n.id) }));
  const segments = lv.segments.map((s: Json) => {
    const gid = prefixOf(s.id), g = groups.get(gid)!;
    noteLevel(g, gid === "site" ? lv.id : s.id.split("/")[1], lv.id);
    return { ...s, id: q(gid, s.id), groupId: gid, fromNodeId: q(prefixOf(s.fromNodeId), s.fromNodeId), toNodeId: q(prefixOf(s.toNodeId), s.toNodeId), ...(s.attachments ? { attachments: qAtts(s.attachments) } : {}) };
  });
  const spaces = lv.spaces.map((s: Json) => {
    const gid = prefixOf(s.id), g = groups.get(gid)!;
    const canvasLevel = gid === "site" ? lv.id : s.id.split("/")[1];
    noteLevel(g, canvasLevel, lv.id);
    const uid = unitOf(gid, s.label);
    const owner = uid ? unitGroup(uid, g) : g;
    if (uid) noteLevel(owner, canvasLevel, lv.id);
    return { ...s, id: `${owner.id}::${restOf(s.id)}`, groupId: owner.id, nodeIds: s.nodeIds.map((n: string) => q(prefixOf(n), n)), ...(s.attachments ? { attachments: s.attachments.map((a: Json) => ({ ...a, id: `${owner.id}::${restOf(a.id)}` })) } : {}) };
  });
  const { rooms: _r, furniture: _f, objects: _o, graphAttrs: _ga, imageUnderlay: _iu, ...meta } = lv;
  merged.levels.push({ ...meta, nodes, segments, spaces });
}
merged.groups = [...groups.values()];
merged.settings = { ...flat.settings, keywords: "Ramanadhapuram master plan — grouped (schemaVersion 3): one canvas per plot, nested units; see docs/canvas-groups-schema.md" };

const doc = mergedToGrouped(merged);
const text = JSON.stringify(doc);
writeFileSync(out, text);
console.log(`wrote ${out}: ${(text.length / 1e6).toFixed(1)} MB, ${doc.groups.length} groups (${doc.groups.filter((g: Json) => g.parent).length} nested)`);

// ── verify: grouped → merged must put every entity back where the flat file had it ──
const back = groupedToMerged(JSON.parse(text));
let checked = 0, bad = 0;
const tol = 1e-6;
for (const lv of flat.levels) {
  const b = back.levels.find((l: Json) => l.id === lv.id);
  const at = new Map(lv.nodes.map((n: Json) => [n.id, n]));
  const bat = new Map(b.nodes.map((n: Json) => [n.id, n]));
  const bSeg = new Map(b.segments.map((s: Json) => [s.groupId + "|" + localId(s.id), s]));
  const bSp = new Map(b.spaces.map((s: Json) => [String(s.groupId).split("/")[0] + "|" + localId(s.id), s]));
  if (b.segments.length !== lv.segments.length || b.spaces.length !== lv.spaces.length) { bad++; console.log("count mismatch", lv.id, b.segments.length, lv.segments.length, b.spaces.length, lv.spaces.length); }
  const same = (p: Json, r: Json) => Math.abs(p.x - r.x) < tol && Math.abs(p.y - r.y) < tol;
  for (const s of lv.segments) {
    const t: Json = bSeg.get(prefixOf(s.id) + "|" + restOf(s.id)); checked++;
    if (!t || !same(at.get(s.fromNodeId), bat.get(t.fromNodeId)) || !same(at.get(s.toNodeId), bat.get(t.toNodeId))
      || JSON.stringify({ ...s, id: 0, fromNodeId: 0, toNodeId: 0, attachments: (s.attachments ?? []).map((a: Json) => restOf(a.id)) }) !== JSON.stringify({ ...t, id: 0, fromNodeId: 0, toNodeId: 0, groupId: undefined, attachments: (t.attachments ?? []).map((a: Json) => localId(a.id)) })) { if (bad++ < 3) console.log("segment differs", s.id); }
  }
  for (const s of lv.spaces) {
    const t: Json = bSp.get(prefixOf(s.id) + "|" + restOf(s.id)); checked++;
    if (!t || t.nodeIds.length !== s.nodeIds.length || s.nodeIds.some((n: string, i: number) => !same(at.get(n), bat.get(t.nodeIds[i])))) { if (bad++ < 3) console.log("space differs", s.id); }
  }
}
console.log(`round trip: ${checked} entities checked, ${bad} differ`);
if (bad) process.exit(1);
