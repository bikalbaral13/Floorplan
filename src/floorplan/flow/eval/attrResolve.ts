/**
 * Single source of truth for resolving a component's parameter value across the canvas → graph → schema
 * → processing-node pipeline, plus the central registry of `role` strings.
 *
 * Every schema-driven Building/Display node resolves a value the SAME way, in one place:
 *   1. the component's OWN per-element value in `graphAttrs[id][paramKey]` (written by the Properties-tab
 *      params panel / SchemaPropsBlock),  →
 *   2. the attached Schema's value for a matching `role` (graphAttrs[id][def.key], def found by role),  →
 *   3. the processing node's param (the global fallback).
 *
 * Before this module each processor inlined its own `rStr/rNum/rBool` closures (copy-paste, drift risk);
 * now they bind (defs, attrs, id) once and call these.
 */
import type { GraphAttrValue, GraphPropDef } from "../../types";

type Attrs = Record<string, Record<string, GraphAttrValue>>;

const numOf = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : d));
const boolOf = (v: unknown): boolean => v === true || v === 1 || v === "true" || v === "1";

/** Resolve the def matching any of `roles` (by role first, then by key). */
export const findDef = (defs: GraphPropDef[] | undefined, roles: readonly string[]): GraphPropDef | undefined => {
  if (!defs) return undefined;
  for (const r of roles) { const byRole = defs.find((d) => d.role === r); if (byRole) return byRole; }
  for (const r of roles) { const byKey = defs.find((d) => d.key === r); if (byKey) return byKey; }
  return undefined;
};

// ── Schema readers: the attached Schema's value for `roles` by component id. Read under the canonical
//    storage key (def.role ?? def.key) so values written by the role-keyed editors are seen. ────────────
export const readNum = (defs: GraphPropDef[] | undefined, attrs: Attrs, id: string, roles: readonly string[], fallback: number): number => {
  const def = findDef(defs, roles);
  return def ? numOf(attrs[id]?.[def.role ?? def.key] ?? def.default, fallback) : fallback;
};
export const readStr = (defs: GraphPropDef[] | undefined, attrs: Attrs, id: string, roles: readonly string[], fallback: string): string => {
  const def = findDef(defs, roles);
  if (!def) return fallback;
  const v = attrs[id]?.[def.role ?? def.key] ?? def.default;
  return v == null ? fallback : String(v);
};
export const readBool = (defs: GraphPropDef[] | undefined, attrs: Attrs, id: string, roles: readonly string[], fallback: boolean): boolean => {
  const def = findDef(defs, roles);
  if (!def) return fallback;
  const v = attrs[id]?.[def.role ?? def.key] ?? def.default;
  return v == null ? fallback : boolOf(v);
};

// ── Full resolvers: per-element override → schema default → fallback ──────────────────────────────────
// The per-element override is read by the CANONICAL role (the storage key both editors now write under),
// falling back to the legacy `paramKey` (older data written under the processor's field key). This means
// editing a value in EITHER the Schema block or the Flow-params panel lands under the same role key, so
// they no longer desync. `id` may be null (input geometry matched no canvas component) → fallback only.
const pick = (attrs: Attrs, id: string | null, paramKey: string, roles: readonly string[]): GraphAttrValue | undefined => {
  if (!id) return undefined;
  const a = attrs[id];
  if (!a) return undefined;
  for (const r of roles) { if (a[r] != null) return a[r]; }   // canonical role-keyed value (preferred)
  return a[paramKey];                                          // legacy field-key value (back-compat)
};
export const resolveStr = (defs: GraphPropDef[] | undefined, attrs: Attrs, id: string | null, paramKey: string, roles: readonly string[], fallback: string): string => {
  const v = pick(attrs, id, paramKey, roles);
  if (v != null) return String(v);
  const def = findDef(defs, roles);
  return def?.default != null ? String(def.default) : fallback;
};
export const resolveNum = (defs: GraphPropDef[] | undefined, attrs: Attrs, id: string | null, paramKey: string, roles: readonly string[], fallback: number): number => {
  const v = pick(attrs, id, paramKey, roles);
  if (v != null && Number.isFinite(Number(v))) return Number(v);
  const def = findDef(defs, roles);
  return def?.default != null && Number.isFinite(Number(def.default)) ? Number(def.default) : fallback;
};
export const resolveBool = (defs: GraphPropDef[] | undefined, attrs: Attrs, id: string | null, paramKey: string, roles: readonly string[], fallback: boolean): boolean => {
  const v = pick(attrs, id, paramKey, roles);
  if (v != null) return boolOf(v);
  const def = findDef(defs, roles);
  return def?.default != null ? boolOf(def.default) : fallback;
};

/**
 * Central role registry — every schema role (+ its key fallbacks) used by the Building/Display nodes,
 * named once here instead of being retyped as string literals in each processor. The first entry is the
 * canonical role; later entries are key-name fallbacks for schemas authored without explicit roles.
 */
export const ROLES = {
  // segment discriminator + wall display
  segType: ["seg-type"],
  wallThickness: ["wall-thickness", "thickness"],
  // Display Segment's buffered ribbon width is in METRES (vs Wall Builder's mm), so it gets its own role
  // to avoid a unit collision on "wall-thickness". No generic "thickness" fallback for the same reason.
  bufferThickness: ["buffer-thickness"],
  wallJustification: ["wall-justification", "justification"],
  wallHeight: ["wall-height", "height"],
  // Per-wall dimension toggles (Wall Builder draws the inner / outer face dimension when on).
  showOuterDim: ["show-outer-dim"],
  showInnerDim: ["show-inner-dim"],
  wallColor: ["wall-color", "color"],
  wallLineStyle: ["wall-linestyle", "line-style"],
  showDirection: ["show-direction"],
  hatch: ["hatch"],
  hatchStyle: ["hatch-style"],
  hatchSpacing: ["hatch-spacing"],
  hatchAngle: ["hatch-angle"],
  // door
  doorShape: ["door-shape"],
  doorThickness: ["door-thickness", "thickness"],
  doorHinge: ["door-hinge"],
  doorPlacement: ["door-placement"],
  doorColor: ["door-color", "color"],
  // window
  windowShape: ["window-shape"],
  windowThickness: ["window-thickness", "thickness"],
  windowPanes: ["window-panes", "panes"],
  windowColor: ["window-color", "color"],
  // node discriminator + object
  nodeType: ["node-type"],
  objectKind: ["object-kind"],
  objWidth: ["obj-width", "width"],
  objHeight: ["obj-height", "height"],
  objRotation: ["obj-rotation", "rotation"],
  objAnchor: ["obj-anchor", "anchor"],
  // node marker display
  nodeShape: ["node-shape"],
  nodeStyle: ["node-style"],
  nodeColor: ["node-color", "color"],
  nodeSize: ["node-size"],
  nodeHatch: ["node-hatch"],
  nodeHatchStyle: ["node-hatch-style"],
  nodeHatchSpacing: ["node-hatch-spacing"],
  nodeHatchAngle: ["node-hatch-angle"],
} as const;
