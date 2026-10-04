/**
 * Levels (storeys) — Option B: ONE SHEET PER LEVEL, the active one swapped into the editor.
 *
 * The editor's history holds exactly one FloorPlanModel: the ACTIVE level. Every drawing tool, hit test,
 * snap and flow reads `history.state` and so only ever sees one floor — which is right for 2D editing and
 * is why nothing in the 40k-line editor had to learn about storeys. The other levels sit beside it as
 * whole models, and the 3D view stacks all of them at their elevations.
 *
 * On disk / on the wire a multi-level plan is PACKED: the active model plus a `levels` array carrying
 * every level's metadata and, for the inactive ones, their model. `packLevels` / `unpackLevels` are the
 * only two places that shape is built or read. A model with no `levels` is a single-level plan — every
 * file written before levels existed.
 */
import type { FloorPlanModel } from "./types";

export interface LevelMeta {
  id: string;
  name: string;
  /** Finished-floor level of this storey above datum, metres. */
  elevation: number;
  /** Floor-to-floor height, metres — the default elevation of the level stacked above. */
  height: number;
}

/** One entry of `FloorPlanModel.levels`: metadata, plus the level's own model when it is not the active one. */
export interface PackedLevel extends LevelMeta {
  model?: FloorPlanModel;
}

/** Model-wide registries. They describe the PROJECT, not one floor, so a level switch carries them across
 *  rather than letting each sheet drift into its own copy (an object imported on the ground floor must be
 *  resolvable on the first floor). */
export const SHARED_KEYS = ["objectLibrary", "layers", "customRoomTypes", "customSegmentTypes", "moodboards", "flowTools", "groups"] as const;

export const DEFAULT_LEVEL_HEIGHT = 3.0;

export const newLevelId = (): string => `level-${Math.random().toString(36).slice(2, 9)}`;

/** Levels sorted bottom-up — the order the tabs and the 3D stack read in. */
export const sortLevels = <T extends LevelMeta>(ls: T[]): T[] => [...ls].sort((a, b) => a.elevation - b.elevation);

/** A blank sheet for a new level: no geometry, the project-wide registries copied from `from`. */
export function emptySheet(from: FloorPlanModel): FloorPlanModel {
  const sheet: FloorPlanModel = { walls: [], rooms: [], objects: [], furniture: [], imageUnderlay: null };
  return withShared(sheet, from);
}

/** `to` with the project-wide registries taken from `from`. */
export function withShared(to: FloorPlanModel, from: FloorPlanModel): FloorPlanModel {
  const out = { ...to } as Record<string, unknown>;
  for (const k of SHARED_KEYS) {
    const v = (from as unknown as Record<string, unknown>)[k];
    if (v === undefined) delete out[k]; else out[k] = v;
  }
  return out as unknown as FloorPlanModel;
}

/** Strip packing fields from a sheet so a stored level never nests another level table. */
export const bareSheet = (m: FloorPlanModel): FloorPlanModel => {
  const { levels: _l, activeLevelId: _a, ...rest } = m;
  return rest as FloorPlanModel;
};

/** Active model + level table + the inactive sheets → one packed model (what save / export write).
 *  Returns the active model untouched when there is at most one level, so a single-storey plan is
 *  byte-identical to what it was before levels existed. */
export function packLevels(active: FloorPlanModel, activeId: string | null, meta: LevelMeta[], sheets: Record<string, FloorPlanModel>): FloorPlanModel {
  if (!activeId || meta.length < 2) return bareSheet(active);
  return {
    ...bareSheet(active),
    activeLevelId: activeId,
    levels: sortLevels(meta).map((l) => (l.id === activeId ? { ...l } : { ...l, model: bareSheet(sheets[l.id] ?? emptySheet(active)) })),
  };
}

/** Packed model → the pieces the editor holds. `null` when the model is single-level. The active level is
 *  the one named by `activeLevelId`, else the lowest; its model is the packed model's own body. */
export function unpackLevels(m: FloorPlanModel): { active: FloorPlanModel; activeId: string; meta: LevelMeta[]; sheets: Record<string, FloorPlanModel> } | null {
  const levels = m.levels;
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const meta: LevelMeta[] = sortLevels(levels.map(({ model: _m, ...l }) => ({
    id: String(l.id), name: String(l.name ?? l.id),
    elevation: Number(l.elevation) || 0, height: Number(l.height) || DEFAULT_LEVEL_HEIGHT,
  })));
  const bodyOwner = levels.find((l) => !l.model);
  const activeId = (m.activeLevelId && levels.some((l) => l.id === m.activeLevelId) ? m.activeLevelId : bodyOwner?.id) ?? meta[0].id;
  const body = bareSheet(m);
  const sheets: Record<string, FloorPlanModel> = {};
  for (const l of levels) {
    if (l.id === activeId) continue;
    sheets[l.id] = withShared(bareSheet(l.model ?? emptySheet(body)), body);
  }
  // A file whose active level DID carry its own model (another tool wrote every level the same way):
  // that model is the body, not the top-level geometry.
  const own = levels.find((l) => l.id === activeId)?.model;
  const active = own ? withShared(bareSheet(own), body) : body;
  return { active, activeId, meta, sheets };
}

/** Elevation for a level added on top of the stack. */
export function nextElevation(meta: LevelMeta[]): number {
  if (!meta.length) return 0;
  const top = sortLevels(meta)[meta.length - 1];
  return +(top.elevation + (top.height || DEFAULT_LEVEL_HEIGHT)).toFixed(3);
}

/** Default names by position: Ground, First, Second… then "Level n". */
export function defaultLevelName(index: number): string {
  const names = ["Ground", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth"];
  return index < names.length ? `${names[index]} floor` : `Level ${index}`;
}
