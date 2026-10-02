/**
 * Placed designs on a master plan, drawn as the buildings themselves rather than only their footprints.
 *
 * A site plan's plot / footprint spaces carry a `designInstance` naming a design file and where its (0,0)
 * sits in site metres (see types.ts `DesignInstance`). Many plots share one design (Villa 5 sits on five), so
 * each design is fetched, parsed and turned into canvas paths ONCE, and every plot that uses it draws those
 * same paths under its own transform — the cost of a master plan is its number of distinct designs, not its
 * number of plots. The drawing is read-only; editing a building is still Open design.
 */
import { computeMiteredWallPolygons, splitWallsAtIntersections } from "@builderpluss/engine";
import { fetchDesignText } from "./designLiveSync";
import { fromStandardPlan, isStandardPlan, type StandardPlan } from "./planFormat";
import type { DesignInstance, FloorPlanModel, Point, Room, Wall } from "./types";

/** One design level as ready-to-stroke paths, in the DESIGN's own pixels. */
export interface DesignLevelPaths {
  rooms: Path2D;
  walls: Path2D;
  doors: Path2D;
  windows: Path2D;
}

export interface DesignPaths {
  /** The design's own px per metre — its pixels are scaled to the site's through this. */
  ppm: number;
  levels: Record<string, DesignLevelPaths>;
}

const ring = (path: Path2D, pts: Point[]) => {
  if (pts.length < 2) return;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
};

const OPENING_TYPES = new Set(["door", "window", "opening"]);

/** What a segment is, read from the object attached to it — in a designed plan the wall is a thin line
 *  segment carrying a Wall object whose `thickness` (metres) is the real one, and doors / windows are
 *  objects on their own segments. A segment typed door / window / opening counts too (traced plans). */
function segmentKind(w: Wall): { kind: "wall" | "door" | "window" | null; thicknessM?: number } {
  const names = (w.attachments ?? []).map((a) => `${a.objectId ?? ""} ${a.objectPath ?? ""}`);
  // An opening segment carries a Wall object as well (the wall it sits in), so the opening wins.
  if (names.some((n) => /window/.test(n))) return { kind: "window" };
  if (names.some((n) => /door|opening/.test(n))) return { kind: "door" };
  const wallAtt = (w.attachments ?? []).find((a) => /(^|[/ ])wall(-with-math|\.json)/.test(`${a.objectId ?? ""} ${a.objectPath ?? ""}`));
  if (wallAtt) {
    const t = Number(wallAtt.params?.thickness);
    return { kind: "wall", thicknessM: Number.isFinite(t) && t > 0 ? t : undefined };
  }
  if (w.segmentType === "window") return { kind: "window" };
  if (OPENING_TYPES.has(w.segmentType ?? "")) return { kind: "door" };
  if (w.segmentType == null || w.segmentType === "wall") return { kind: "wall" };
  return { kind: null };
}

function levelPaths(model: Partial<FloorPlanModel>, ppm: number): DesignLevelPaths {
  const out: DesignLevelPaths = { rooms: new Path2D(), walls: new Path2D(), doors: new Path2D(), windows: new Path2D() };
  for (const r of (model.rooms ?? []) as Room[]) if (r.points?.length >= 3) ring(out.rooms, r.points);
  // Walls get their mitered band at the object's thickness; openings a line along their span; anything else
  // (skirting, cornice, furniture, annotation) is left out — at site scale it is noise, and the design itself
  // is one click away.
  const solid: Wall[] = [];
  const segs = splitWallsAtIntersections((model.walls ?? []) as Wall[]).map((w) => ({ w, k: segmentKind(w) }));
  // A designed level whose walls are Wall objects keeps its bare "wall" segments as construction lines
  // (the trace they were drawn over) — drawing those too would double every wall.
  const hasWallObjects = segs.some(({ k }) => k.kind === "wall" && k.thicknessM);
  for (const { w, k } of segs) {
    if (k.kind === "wall" && hasWallObjects && !k.thicknessM) continue;
    if (k.kind === "wall") {
      const thickness = k.thicknessM ? k.thicknessM * ppm : Math.max(w.thickness ?? 0, 0.1 * ppm);
      solid.push({ ...w, thickness, mode: "fill", segmentType: "wall" } as Wall);
    } else if (k.kind) {
      const p = k.kind === "window" ? out.windows : out.doors;
      p.moveTo(w.start.x, w.start.y);
      p.lineTo(w.end.x, w.end.y);
    }
  }
  for (const poly of computeMiteredWallPolygons(solid).values()) ring(out.walls, poly);
  return out;
}

function parseDesign(text: string): DesignPaths | null {
  const parsed: unknown = JSON.parse(text);
  if (!isStandardPlan(parsed)) return null;
  const plan = parsed as StandardPlan;
  const ppm = Number(plan.settings?.pixelsPerMeter) || 100;
  const { model } = fromStandardPlan(plan);
  const levels: Record<string, DesignLevelPaths> = {};
  if (model.levels?.length) {
    for (const l of model.levels) levels[l.id] = levelPaths(l.model ?? model, ppm);
  } else {
    levels[""] = levelPaths(model, ppm);
  }
  return { ppm, levels };
}

/** path → paths, shared by every plot and every editor render. A failed fetch is cached as null so a missing
 *  design does not refetch on each render; a reload of the page retries. */
const designCache = new Map<string, Promise<DesignPaths | null>>();

export function loadDesignPaths(relPath: string): Promise<DesignPaths | null> {
  let p = designCache.get(relPath);
  if (!p) {
    p = fetchDesignText(relPath).then((t) => {
      if (!t) return null;
      try { return parseDesign(t); } catch (err) { console.warn("designInstances: could not read", relPath, err); return null; }
    });
    designCache.set(relPath, p);
  }
  return p;
}

/** The distinct placements on a sheet. A plot space and its footprint carry the same instance, so they are
 *  collapsed by design + transform. */
export function uniqueInstances(rooms: readonly Room[]): DesignInstance[] {
  const seen = new Map<string, DesignInstance>();
  for (const r of rooms) {
    const d = r.designInstance;
    if (!d?.path || !Array.isArray(d.position)) continue;
    const k = `${d.path}|${d.position[0]}|${d.position[1]}|${d.rotation ?? 0}|${d.mirror ? 1 : 0}`;
    if (!seen.has(k)) seen.set(k, d);
  }
  return [...seen.values()];
}

/** The design level that lands on site level `siteLevelId`: the one the instance's `levelMap` sends there.
 *  With no map (or a single-level site, `siteLevelId` null) the design's ground — its first level. */
export function designLevelFor(inst: DesignInstance, paths: DesignPaths, siteLevelId: string | null): DesignLevelPaths | null {
  const ids = Object.keys(paths.levels);
  if (inst.levelMap && siteLevelId) {
    const id = Object.keys(inst.levelMap).find((k) => inst.levelMap![k] === siteLevelId);
    return id ? paths.levels[id] ?? null : null;
  }
  return paths.levels[ids[0]] ?? null;
}

/** Canvas transform for one placement: design px → site px. Mirror flips x first, then rotation (the order
 *  the DesignInstance field docs give), then the design scale, then the position. */
export function applyInstanceTransform(ctx: CanvasRenderingContext2D, inst: DesignInstance, designPpm: number, sitePpm: number) {
  ctx.translate(inst.position[0] * sitePpm, inst.position[1] * sitePpm);
  if (inst.rotation) ctx.rotate((inst.rotation * Math.PI) / 180);
  const k = sitePpm / designPpm;
  ctx.scale(inst.mirror ? -k : k, k);
}
