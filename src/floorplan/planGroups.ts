/**
 * Grouped canvas documents (schemaVersion 3) — see docs/canvas-groups-schema.md.
 *
 * A grouped document is a container of ordinary canvas JSONs, one per group, each placed on the site by a
 * transform and a level map. The editor does not edit that shape directly: on the way in the groups are
 * MERGED into one multi-level plan in site coordinates (every entity tagged with its `groupId`, every id
 * prefixed `<groupId>::` so ids from different canvases cannot collide), and on the way out the merged plan
 * is SPLIT back into canvases. Everything in between — drawing, hit-testing, room detection, 3D — is the
 * existing single-plan code, untouched.
 *
 * Pure JSON in, JSON out: no editor or DOM imports, so tools (tsx) use the same functions as the editor.
 */

type Json = Record<string, unknown>;
type XY = { x: number; y: number };

/** Where a group's canvas sits. Position in site metres; rotation in degrees, clockwise on screen. */
export interface GroupTransform {
  position: [number, number];
  rotation: number;
  mirror: boolean;
}

/** A level of a group's own canvas, kept so the canvas can be written back with its own level table. */
export interface CanvasLevelMeta {
  id: string;
  name: string;
  elevation: number;
  height: number;
}

/** A group as the editor holds it: the document's group record without its `canvas`. */
export interface PlanGroup {
  id: string;
  name: string;
  design?: string;
  /** Enclosing group. Transforms nest: this group's transform is in its PARENT's canvas frame. */
  parent?: string | null;
  transform: GroupTransform;
  /** Canvas level id → SITE level id (always the document's levels, also for nested groups). */
  levelMap: Record<string, string>;
  visible?: boolean;
  locked?: boolean;
  layerOverrides?: Record<string, { visible?: boolean; locked?: boolean }>;
  source?: { path: string; sha256?: string };
  meta?: Json;
  /** The canvas's own level table (read from the file, written back to it). Single-level canvas ⇒ one
   *  entry with id "". */
  canvasLevels: CanvasLevelMeta[];
}

export const GROUP_ID_SEP = "::";
export const IDENTITY: GroupTransform = { position: [0, 0], rotation: 0, mirror: false };

/** A grouped document on disk. The merged form the editor works with also carries a `groups` table (without
 *  canvases), so the version is what tells them apart. */
export const isGroupedPlan = (v: unknown): v is Json =>
  !!v && typeof v === "object" && (v as Json).schemaVersion === 3 && Array.isArray((v as Json).groups);

/** `plot-07::L0-s12` → `L0-s12`; an id with no group prefix is returned as-is. */
export const localId = (id: string): string => {
  const i = id.indexOf(GROUP_ID_SEP);
  return i < 0 ? id : id.slice(i + GROUP_ID_SEP.length);
};
const qualify = (gid: string, id: string) => `${gid}${GROUP_ID_SEP}${id}`;

// ── transforms ────────────────────────────────────────────────────────────────────────────────────────

/** Canvas px → enclosing frame px (both at `ppm`). Mirror x, rotate, then offset by the position. */
function applyOne(p: XY, t: GroupTransform, ppm: number): XY {
  let x = t.mirror ? -p.x : p.x, y = p.y;
  if (t.rotation) {
    const a = (t.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return { x: x + t.position[0] * ppm, y: y + t.position[1] * ppm };
}
function invertOne(p: XY, t: GroupTransform, ppm: number): XY {
  let x = p.x - t.position[0] * ppm, y = p.y - t.position[1] * ppm;
  if (t.rotation) {
    const a = (-t.rotation * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return { x: t.mirror ? -x : x, y };
}

/** Root-first chain of transforms from the site down to `gid`. */
function chain(gid: string, byId: Map<string, PlanGroup>): GroupTransform[] {
  const out: GroupTransform[] = [];
  const seen = new Set<string>();
  for (let g = byId.get(gid); g && !seen.has(g.id); g = g.parent ? byId.get(g.parent) : undefined) {
    seen.add(g.id);
    out.unshift(g.transform ?? IDENTITY);
  }
  return out;
}
export function groupToSite(p: XY, gid: string, byId: Map<string, PlanGroup>, ppm: number): XY {
  const ts = chain(gid, byId);
  let q = p;
  for (let i = ts.length - 1; i >= 0; i--) q = applyOne(q, ts[i], ppm);
  return q;
}
export function siteToGroup(p: XY, gid: string, byId: Map<string, PlanGroup>, ppm: number): XY {
  let q = p;
  for (const t of chain(gid, byId)) q = invertOne(q, t, ppm);
  return q;
}

// ── document (v3) → merged multi-level plan (v2) ─────────────────────────────────────────────────────

/** The canvas's levels as [meta, geometry] pairs; a single-level canvas is one level with id "". */
function canvasLevels(canvas: Json): { meta: CanvasLevelMeta; geom: Json }[] {
  const lv = canvas.levels as Json[] | undefined;
  if (Array.isArray(lv) && lv.length) {
    return lv.map((l) => ({
      meta: { id: String(l.id), name: String(l.name ?? l.id), elevation: Number(l.elevation) || 0, height: Number(l.height) || 3 },
      geom: l,
    }));
  }
  return [{ meta: { id: "", name: "", elevation: 0, height: 3 }, geom: canvas }];
}

const qualifyAttachments = (gid: string, atts: unknown) =>
  Array.isArray(atts) ? atts.map((a: Json) => (a && typeof a.id === "string" ? { ...a, id: qualify(gid, a.id) } : a)) : atts;

/**
 * Grouped document → one multi-level standard plan in site coordinates, ready for `fromStandardPlan`.
 * Groups with a `source` and no inline `canvas` need their canvas supplied in `sources` (path → canvas
 * JSON); a group whose canvas is missing contributes no geometry but keeps its record.
 */
export function groupedToMerged(doc: Json, sources: Record<string, Json> = {}): Json {
  const settings = (doc.settings ?? {}) as Json;
  const ppm = Number(settings.pixelsPerMeter) || 100;
  const siteLevels = ((doc.levels as Json[]) ?? []).map((l) => ({ id: String(l.id), name: String(l.name ?? l.id), elevation: Number(l.elevation) || 0, height: Number(l.height) || 3 }));
  const ground = siteLevels.find((l) => l.elevation === 0)?.id ?? siteLevels[0]?.id ?? "G";
  const out = new Map<string, { nodes: Json[]; segments: Json[]; spaces: Json[] }>();
  for (const l of siteLevels) out.set(l.id, { nodes: [], segments: [], spaces: [] });

  const groups: PlanGroup[] = [];
  const raw = (doc.groups as Json[]) ?? [];
  for (const g of raw) {
    const canvas = (g.canvas as Json | undefined) ?? (g.source ? sources[String((g.source as Json).path)] : undefined);
    const levels = canvas ? canvasLevels(canvas) : [];
    const { canvas: _c, ...rec } = g;
    groups.push({
      ...(rec as unknown as PlanGroup),
      id: String(g.id),
      name: String(g.name ?? g.id),
      transform: (g.transform as GroupTransform) ?? IDENTITY,
      levelMap: (g.levelMap as Record<string, string>) ?? Object.fromEntries(levels.map((l) => [l.meta.id, l.meta.id === "" ? ground : l.meta.id])),
      canvasLevels: levels.map((l) => l.meta),
    });
  }
  const byId = new Map(groups.map((g) => [g.id, g]));

  raw.forEach((g, gi) => {
    const grp = groups[gi];
    const canvas = (g.canvas as Json | undefined) ?? (g.source ? sources[String((g.source as Json).path)] : undefined);
    if (!canvas) return;
    const cppm = Number((canvas.settings as Json | undefined)?.pixelsPerMeter) || ppm;
    const k = ppm / cppm;
    for (const { meta, geom } of canvasLevels(canvas)) {
      const site = grp.levelMap[meta.id];
      let bucket = site ? out.get(site) : undefined;
      if (!bucket && site) { bucket = { nodes: [], segments: [], spaces: [] }; out.set(site, bucket); siteLevels.push({ id: site, name: site, elevation: meta.elevation, height: meta.height }); }
      if (!bucket) continue;
      for (const n of (geom.nodes as Json[]) ?? []) {
        const p = groupToSite({ x: (Number(n.x) || 0) * k, y: (Number(n.y) || 0) * k }, grp.id, byId, ppm);
        bucket.nodes.push({ ...n, id: qualify(grp.id, String(n.id)), x: p.x, y: p.y });
      }
      for (const s of (geom.segments as Json[]) ?? []) {
        bucket.segments.push({
          ...s, id: qualify(grp.id, String(s.id)), groupId: grp.id,
          fromNodeId: qualify(grp.id, String(s.fromNodeId)), toNodeId: qualify(grp.id, String(s.toNodeId)),
          ...(s.attachments ? { attachments: qualifyAttachments(grp.id, s.attachments) } : {}),
        });
      }
      for (const sp of (geom.spaces as Json[]) ?? []) {
        bucket.spaces.push({
          ...sp, id: qualify(grp.id, String(sp.id)), groupId: grp.id,
          nodeIds: ((sp.nodeIds as string[]) ?? []).map((id) => qualify(grp.id, id)),
          ...(sp.attachments ? { attachments: qualifyAttachments(grp.id, sp.attachments) } : {}),
        });
      }
    }
  });

  const { groups: _g, levels: _l, schemaVersion: _v, kind: _k, ...project } = doc;
  return {
    ...project,
    schemaVersion: 2,
    settings,
    nodes: [], segments: [], spaces: [],
    moodboards: doc.moodboards ?? [],
    layers: doc.layers ?? [],
    imageUnderlay: null,
    activeLevelId: doc.activeLevelId ?? ground,
    levels: siteLevels.sort((a, b) => a.elevation - b.elevation).map((l) => ({ ...l, ...out.get(l.id)! })),
    groups,
  };
}

// ── merged multi-level plan (v2, groupId-tagged) → document (v3) ─────────────────────────────────────

/** The id of the catch-all group entities without a `groupId` are written into. */
export const UNGROUPED = "ungrouped";

const unqualifyAttachments = (atts: unknown) =>
  Array.isArray(atts) ? atts.map((a: Json) => (a && typeof a.id === "string" ? { ...a, id: localId(a.id) } : a)) : atts;

/**
 * Merged plan (as `toStandardPlan` writes it, with `groups` and `groupId` on entities) → grouped document.
 * Each group's canvas gets the entities tagged with it, moved back into its own frame, under its own
 * level ids, with the `<groupId>::` prefixes removed. Nodes are copied into every canvas that uses them.
 */
export function mergedToGrouped(plan: Json): Json {
  const settings = (plan.settings ?? {}) as Json;
  const ppm = Number(settings.pixelsPerMeter) || 100;
  const groups = [...((plan.groups as PlanGroup[]) ?? [])];
  const multi = Array.isArray(plan.levels) && (plan.levels as Json[]).length > 0;
  const siteLevels: Json[] = multi ? (plan.levels as Json[]) : [{ id: "G", name: "Ground", elevation: 0, height: 3, nodes: plan.nodes, segments: plan.segments, spaces: plan.spaces }];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const ensure = (gid: string): PlanGroup => {
    let g = byId.get(gid);
    if (!g) {
      g = { id: gid, name: gid === UNGROUPED ? "Ungrouped" : gid, transform: IDENTITY, levelMap: {}, canvasLevels: [] };
      groups.push(g);
      byId.set(gid, g);
    }
    return g;
  };

  // group → canvas level id → geometry
  const canvases = new Map<string, Map<string, { nodes: Map<string, Json>; segments: Json[]; spaces: Json[] }>>();
  for (const lv of siteLevels) {
    const siteId = String(lv.id);
    const nodeAt = new Map(((lv.nodes as Json[]) ?? []).map((n) => [String(n.id), n]));
    const slot = (gid: string) => {
      const g = ensure(gid);
      let canvasLevel = Object.keys(g.levelMap).find((k) => g.levelMap[k] === siteId);
      if (canvasLevel === undefined) {
        canvasLevel = siteId;
        g.levelMap[canvasLevel] = siteId;
        const sl = siteLevels.find((l) => l.id === siteId)!;
        if (!g.canvasLevels.some((c) => c.id === canvasLevel)) g.canvasLevels.push({ id: canvasLevel, name: String(sl.name ?? siteId), elevation: Number(sl.elevation) || 0, height: Number(sl.height) || 3 });
      }
      let per = canvases.get(gid);
      if (!per) { per = new Map(); canvases.set(gid, per); }
      let b = per.get(canvasLevel);
      if (!b) { b = { nodes: new Map(), segments: [], spaces: [] }; per.set(canvasLevel, b); }
      return b;
    };
    const takeNode = (b: { nodes: Map<string, Json> }, gid: string, nid: string) => {
      const lid = localId(nid);
      if (b.nodes.has(lid)) return lid;
      const n = nodeAt.get(nid);
      const p = siteToGroup({ x: Number(n?.x) || 0, y: Number(n?.y) || 0 }, gid, byId, ppm);
      b.nodes.set(lid, { ...(n ?? {}), id: lid, x: p.x, y: p.y });
      return lid;
    };
    for (const s of (lv.segments as Json[]) ?? []) {
      const gid = typeof s.groupId === "string" ? s.groupId : UNGROUPED;
      const b = slot(gid);
      const { groupId: _g, ...rest } = s;
      b.segments.push({
        ...rest, id: localId(String(s.id)),
        fromNodeId: takeNode(b, gid, String(s.fromNodeId)), toNodeId: takeNode(b, gid, String(s.toNodeId)),
        ...(s.attachments ? { attachments: unqualifyAttachments(s.attachments) } : {}),
      });
    }
    for (const sp of (lv.spaces as Json[]) ?? []) {
      const gid = typeof sp.groupId === "string" ? sp.groupId : UNGROUPED;
      const b = slot(gid);
      const { groupId: _g, ...rest } = sp;
      b.spaces.push({
        ...rest, id: localId(String(sp.id)),
        nodeIds: ((sp.nodeIds as string[]) ?? []).map((nid) => takeNode(b, gid, nid)),
        ...(sp.attachments ? { attachments: unqualifyAttachments(sp.attachments) } : {}),
      });
    }
  }

  const docGroups = groups.map((g) => {
    const per = canvases.get(g.id);
    const { canvasLevels: cl, ...rec } = g;
    const levelGeom = (id: string) => {
      const b = per?.get(id);
      return { nodes: b ? [...b.nodes.values()] : [], segments: b?.segments ?? [], spaces: b?.spaces ?? [] };
    };
    const canvasSettings = { ...settings };
    const single = cl.length === 1 && cl[0].id === "";
    const canvas = single
      ? { schemaVersion: 1, settings: canvasSettings, ...levelGeom(""), moodboards: [], layers: [], imageUnderlay: null }
      : {
          schemaVersion: 2, settings: canvasSettings, nodes: [], segments: [], spaces: [], moodboards: [], layers: [], imageUnderlay: null,
          activeLevelId: cl[0]?.id,
          levels: [...cl].sort((a, b) => a.elevation - b.elevation).map((l) => ({ ...l, ...levelGeom(l.id) })),
        };
    // A `source` group whose canvas is the library file stays a reference only if nothing was edited — the
    // editor cannot tell, so the document always carries the canvas; `source` remains as provenance.
    return { ...rec, canvas };
  });

  const { groups: _g, levels: _l, nodes: _n, segments: _s, spaces: _sp, imageUnderlay: _iu, activeLevelId, ...project } = plan;
  return {
    ...project,
    schemaVersion: 3,
    kind: "grouped",
    settings,
    layers: plan.layers ?? [],
    levels: siteLevels.map((l) => ({ id: l.id, name: l.name, elevation: l.elevation, height: l.height })),
    activeLevelId,
    moodboards: plan.moodboards ?? [],
    groups: docGroups,
  };
}

/** Parent-first order with depth, for panels and the "outermost group" rule. */
export function groupDepth(gid: string, byId: Map<string, PlanGroup>): number {
  let d = 0;
  const seen = new Set<string>();
  for (let g = byId.get(gid); g?.parent && !seen.has(g.id); g = byId.get(g.parent)) { seen.add(g.id); d++; }
  return d;
}

/** `gid`'s ancestor (or itself) that is a direct child of `scope` (null = the top level). */
export function ancestorAt(gid: string, scope: string | null, byId: Map<string, PlanGroup>): string | null {
  const path: string[] = [];
  const seen = new Set<string>();
  for (let g = byId.get(gid); g && !seen.has(g.id); g = g.parent ? byId.get(g.parent) : undefined) { seen.add(g.id); path.unshift(g.id); }
  if (scope === null) return path[0] ?? null;
  const i = path.indexOf(scope);
  return i >= 0 && i + 1 < path.length ? path[i + 1] : null;
}
