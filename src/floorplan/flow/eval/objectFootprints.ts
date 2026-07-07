/** Parametric-object footprints for the Place Object (Along Boundary) node.
 *
 *  The node's entries historically hard-coded every dimension (kind + length/breadth/height). Entries can
 *  now reference a PARAMETRIC OBJECT from the live library instead (`objectId`, e.g. "sofa.v2"): the
 *  object's plan bbox / mesh height are MEASURED from its own geometry (default params) and fill any
 *  dimension the entry doesn't override, so the boundary solver sizes the footprint from the real object
 *  and the commit drops the actual .pobj attachment — no numbers to copy by hand.
 *
 *  The library itself lives in editor state (history.state.objectLibrary); a module-level registry keeps
 *  this reachable from the pure eval/compile paths WITHOUT threading it through evaluateFlow's already
 *  long signature — the host (FloorPlanEditor) mirrors the library in via `setFlowObjectLibrary` on every
 *  state change. This module may import parametricObject (which imports evalNodes), so it must never be
 *  imported FROM evalNodes/flowTypes — callers are evaluateFlow / compileFlow / the editor & UI layers. */
import type { ParametricObjectFile } from "../../types";
import { evalParametricGeometry, evalParametricPrisms } from "./parametricObject";

let currentLibrary: Record<string, ParametricObjectFile> = {};

/** Host bridge: mirror the editor's live object library (call on every objectLibrary change). */
export const setFlowObjectLibrary = (lib: Record<string, ParametricObjectFile> | undefined): void => {
  currentLibrary = lib ?? {};
};
export const getFlowObjectLibrary = (): Record<string, ParametricObjectFile> => currentLibrary;

/** Resolve an object reference the way the agent bridge does: exact id first, then meta.name (case-
 *  insensitive). Only node-hosted objects make sense along a boundary, but the lookup stays permissive —
 *  the caller decides what to list in dropdowns/catalogs. */
export const findLibraryObject = (idOrName: string): ParametricObjectFile | undefined => {
  const lib = currentLibrary;
  if (lib[idOrName]) return lib[idOrName];
  const lower = idOrName.trim().toLowerCase();
  return Object.values(lib).find((o) => o.meta.name.toLowerCase() === lower || o.meta.id.toLowerCase() === lower);
};

export interface ParametricFootprint {
  /** Plan extent along x at rotation 0 (m) — runs along the boundary edge when placed. */
  lengthM: number;
  /** Plan extent along y at rotation 0 (m) — the depth into the space. */
  breadthM: number;
  /** Peak 3D height over the object's mesh prisms (m); 0.5 fallback for flat/2D-only objects. */
  heightM: number;
  /** Plan bbox CENTRE in object-local metres — the offset from the object's anchor to its footprint
   *  centre (many objects don't draw centred on their anchor). The placement runner subtracts this
   *  (rotated) so the rendered object lands exactly on the solved footprint. */
  offsetXM: number;
  offsetYM: number;
}

/** Measure cache — keyed by canonical object id, invalidated when the library entry's identity changes
 *  (re-import replaces the file object). */
const measureCache = new Map<string, { file: ParametricObjectFile; m: ParametricFootprint }>();

/** Measure a parametric object's plan footprint + height by EVALUATING its geometry at default params
 *  (rotation 0, ppm 1 so pixels ≡ metres). Returns null when the object is unknown or degenerate. */
export const measureParametricObject = (idOrName: string): ParametricFootprint | null => {
  const file = findLibraryObject(idOrName);
  if (!file) return null;
  const cached = measureCache.get(file.meta.id);
  if (cached && cached.file === file) return cached.m;
  try {
    const defText = JSON.stringify(file);
    // Resolver lets composed objects (`ref` rules) measure their children too.
    const resolve = (id: string): string | null => (currentLibrary[id] ? JSON.stringify(currentLibrary[id]) : null);
    // Zero the reserved placement params: the measurement must be the RAW footprint — wallOffset is
    // realised by the boundary solver's setback (and zeroed on the committed attachment), clearance
    // lifts only the 3D mesh per instance.
    const raw = { rotation: 0, wallOffset: 0, clearance: 0 };
    const g = evalParametricGeometry(defText, { x: 0, y: 0 }, 1, raw, undefined, resolve);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of [...g.fill, ...g.lines]) {
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
    if (!Number.isFinite(minX) || maxX - minX < 1e-6 || maxY - minY < 1e-6) return null;
    let heightM = 0;
    for (const pr of evalParametricPrisms(defText, { x: 0, y: 0 }, 1, raw, undefined, resolve)) {
      if (pr.yTop > heightM) heightM = pr.yTop;
    }
    const m: ParametricFootprint = {
      lengthM: Math.max(0.05, maxX - minX),
      breadthM: Math.max(0.05, maxY - minY),
      heightM: heightM > 0.01 ? heightM : 0.5,
      offsetXM: (minX + maxX) / 2,
      offsetYM: (minY + maxY) / 2,
    };
    measureCache.set(file.meta.id, { file, m });
    return m;
  } catch {
    return null;
  }
};

/** Preview-symbol kind for a parametric entry — the live Flow preview draws the shared 2D object symbols
 *  by `kind`, so a pobj entry borrows the closest one (the COMMIT places the real parametric object). */
const KNOWN_SYMBOL_KINDS = new Set([
  "bed", "table", "chair", "sofa", "desk", "wardrobe", "bookshelf", "bench",
  "piano", "tv-unit", "fridge", "toilet", "bathtub", "guitar", "whiteboard", "flute", "clock", "mirror",
]);
export const symbolKindForObject = (file: ParametricObjectFile): string => {
  const slug = file.meta.name.trim().toLowerCase().replace(/\s+/g, "-");
  if (KNOWN_SYMBOL_KINDS.has(slug)) return slug;
  const idHead = file.meta.id.split(".")[0]?.toLowerCase() ?? "";
  if (KNOWN_SYMBOL_KINDS.has(idHead)) return idHead;
  return "table";
};

/** Resolve every `objectId` entry in a Place Object node's raw params: dimensions the entry doesn't
 *  explicitly set are filled from the MEASURED object footprint, `kind` gets a preview-symbol fallback,
 *  and the objectId is canonicalised to the library id (name lookups included). Entries without an
 *  objectId (or with an unknown one) pass through untouched — the hard-coded path still works. Call this
 *  BEFORE placeObjectEntries' coercion (which would bake defaults into missing dims). */
export const resolvePlaceObjectParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const raw = params.objects;
  if (!Array.isArray(raw)) return params;
  let changed = false;
  const objects = raw.map((o) => {
    const src = (o ?? {}) as Record<string, unknown>;
    const idOrName = typeof src.objectId === "string" ? src.objectId.trim() : "";
    if (!idOrName) return src;
    const file = findLibraryObject(idOrName);
    const m = file ? measureParametricObject(file.meta.id) : null;
    if (!file || !m) return src;
    changed = true;
    const out: Record<string, unknown> = { ...src, objectId: file.meta.id };
    if (!(Number(src.length) > 0)) out.length = +m.lengthM.toFixed(3);
    if (!(Number(src.breadth) > 0)) out.breadth = +m.breadthM.toFixed(3);
    if (!(Number(src.height) > 0)) out.height = +m.heightM.toFixed(3);
    if (typeof src.kind !== "string" || !src.kind) out.kind = symbolKindForObject(file);
    // The object's own placement params seed the solver when the entry doesn't set them: `wallOffset`
    // becomes the boundary setback (offset from the wall in plan), `clearance` the floor lift in 3D.
    const paramDefault = (key: string): number | undefined => {
      const p = file.parameters.find((pp) => pp.key === key);
      return typeof p?.default === "number" ? p.default : undefined;
    };
    if (src.setback == null) {
      const d = paramDefault("wallOffset");
      if (d != null && d > 0) out.setback = d;
    }
    if (src.clearance == null) {
      const d = paramDefault("clearance");
      if (d != null && d > 0) out.clearance = d;
    }
    return out;
  });
  return changed ? { ...params, objects } : params;
};
