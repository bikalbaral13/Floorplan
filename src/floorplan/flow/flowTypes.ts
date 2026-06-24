/** Node-graph ("Flow") model for composing the stepwise space tools (Inset, Split,
 *  Optimise Rectangle, …) into a no-code pipeline. A flow compiles to the same recipe
 *  JSON the rest of the app already executes via `applyRecipeJson`, so the graph is just
 *  a visual editor over the existing operations engine. */

import { CONDITION_METRIC_OPTIONS, CONDITION_OP_OPTIONS } from "./conditional";

/** Parse a Split "ratios" entry (string "1, 2, 1" / "1:2:1", or an array) into positive numbers.
 *  In ratio mode the entries also drive the piece count, so the ratios input is the single source
 *  of truth for both sizing and how many pieces (and output handles) the Split produces. */
export const parseSplitRatios = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof v === "string") return v.split(/[\s,:]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return [];
};

/** Parse a list of finite numbers from a string ("1, 0.5, 0.5, 2") or array. Unlike parseSplitRatios,
 *  0 is allowed (a zero setback = no inset on that edge). Used by the Inset node's per-edge setbacks. */
export const parseNumberList = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n));
  if (typeof v === "string") return v.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  return [];
};

/** Parse the Dimension node's selected-edge list (0-based indices, e.g. "0, 2, 3" or an array) → a sorted
 *  unique list of non-negative integers. Used by the Edgewise mode to pick which edges to dimension. */
export const parseDimEdges = (v: unknown): number[] => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : [];
  const set = new Set<number>();
  for (const x of raw) { const n = Number(x); if (Number.isInteger(n) && n >= 0) set.add(n); }
  return [...set].sort((a, b) => a - b);
};
export const serializeDimEdges = (idx: number[]): string => [...new Set(idx)].sort((a, b) => a - b).join(", ");

export type FlowToolType = "source" | "space-creator" | "graph-source" | "segment-source" | "node-source" | "canvas-source" | "separate" | "buffer" | "bloom" | "pull" | "transform" | "show-direction" | "densify" | "inset" | "split" | "optimise-rect" | "skeleton" | "place-object" | "bsp" | "voronoi" | "conditional" | "param-manip" | "bounding-shape" | "convex-hull" | "convex-decomp" | "smoothing" | "contour" | "floor-massing" | "mitered-join" | "graph-smooth" | "graph-metrics" | "graph-to-spaces" | "graph-to-grid" | "grid-source" | "grid-field" | "cellular-automaton" | "laplace-solver" | "fill-depressions" | "flow-direction" | "flow-accumulation" | "watershed" | "morphology" | "grid-distance" | "grid-threshold" | "marching-squares" | "dimension" | "area-dimension" | "longest-branch" | "graph-reduce" | "voronoi-bloom" | "spring-layout" | "pipe-solver" | "schema" | "output-schema" | "segment-split" | "image" | "vectorise" | "object-detection" | "mesh" | "circle-packing" | "treemap" | "rect-pack" | "point" | "visibility" | "render" | "bua" | "math" | "random" | "output" | "space-geometry" | "input-props" | "merge" | "file-upload" | "text" | "analyse" | "generate" | "hatching" | "display-segment" | "display-node" | "frame-builder" | "wall-builder" | "segment-to-door" | "segment-to-window" | "node-to-object" | "node-to-staircase" | "node-to-footing" | "footing" | "footing-to-plan" | "footing-to-elevation" | "footing-to-3d-mesh" | "mesh-to-3d" | "staircase" | "staircase-to-plan" | "staircase-to-left-elevation" | "staircase-to-right-elevation" | "staircase-to-front-elevation" | "staircase-to-back-elevation" | "staircase-to-3d-mesh" | "schema-to-drawing" | "schema-to-layers" | "floorplan-to-front-elevation" | "floorplan-to-back-elevation" | "floorplan-to-left-elevation" | "floorplan-to-right-elevation" | "views-layout" | "segment-to-3d" | "space-to-3d" | "param-object" | "param-grab" | "param-render" | "param-render-3d" | "layout-gen";

/** A user-defined adjustable parameter on the Input Properties node. Each one renders a control
 *  (slider / options / checkbox / textbox) and exposes its current value as a `val-<id>` output. */
export type InputPropType = "range" | "select" | "checkbox" | "text";
export interface InputProp {
  id: string;
  name: string;
  type: InputPropType;
  value: string | number | boolean;
  /** range only */
  min: number;
  max: number;
  step: number;
  /** select only */
  options: string[];
}

/** Normalise an Input Properties node's params into its parameter list. */
export const inputProps = (params: Record<string, unknown>): InputProp[] => {
  const raw = params.props;
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const type = (["range", "select", "checkbox", "text"].includes(o.type as string) ? o.type : "range") as InputPropType;
    const value: string | number | boolean =
      type === "checkbox" ? o.value === true
      : type === "range" ? (Number(o.value) || 0)
      : typeof o.value === "string" ? o.value : String(o.value ?? "");
    return {
      id: typeof o.id === "string" && o.id ? o.id : `p${i + 1}`,
      name: typeof o.name === "string" ? o.name : "",
      type,
      value,
      min: Number.isFinite(Number(o.min)) ? Number(o.min) : 0,
      max: Number.isFinite(Number(o.max)) ? Number(o.max) : 10,
      step: Number(o.step) || 1,
      options: Array.isArray(o.options) ? o.options.map(String) : [],
    };
  });
};

// ── Schema node (general component-property schemas) ─────────────────────────
/** One parameter row in a Schema-node section — a {@link GraphPropDef} plus a stable editor id.
 *  The Schema node holds four lists of these (Node / Segment / Space / Graph Schema); wiring its
 *  output into a Graph or Space node attaches the matching properties to those canvas components. */
export interface SchemaPropEntry {
  id: string;
  /** Storage key for the attribute value. Blank → derived from the label (slug). */
  key: string;
  label: string;
  kind: "number" | "select" | "checkbox" | "text" | "color";
  unit: string;
  /** Default value (applies until the user edits the component's own value). */
  def: number | string | boolean;
  min: number;
  max: number;
  step: number;
  options: string[];
  /** Optional solver binding (e.g. "demand", "diameter") — consumed by solver nodes. */
  role: string;
  /** Optional type-driven visibility (e.g. show door fields only when the "type" prop === "door"). */
  showIf?: import("../types").GraphPropDef["showIf"];
  /** Per-option SVG icons for a "select" entry: option value → SVG data URL. Used to give each segment /
   *  node TYPE (wall / door / window / furniture kind …) a custom icon (e.g. in the drawing toolbars). */
  optionIcons?: Record<string, string>;
}

/** The four Schema-node sections, in display order. `param` is the params key holding the list. */
export const SCHEMA_SECTIONS = [
  { param: "nodeProps", title: "Node Schema" },
  { param: "segmentProps", title: "Segment Schema" },
  { param: "spaceProps", title: "Space Schema" },
  { param: "graphProps", title: "Graph Schema" },
  { param: "informationProps", title: "Information Schema" },
  // Canvas-wide settings (not per-element) — e.g. Ortho. Surfaced in the Properties tab when nothing
  // is selected; the editor reads them via `schemaNodeToSchemas().settings`.
  { param: "settingsProps", title: "Settings" },
] as const;
export type SchemaSectionParam = (typeof SCHEMA_SECTIONS)[number]["param"];

/** Normalise one Schema-node section's params entry into its row list. */
export const schemaEntries = (params: Record<string, unknown>, param: SchemaSectionParam): SchemaPropEntry[] => {
  const raw = params[param];
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const kind = (["number", "select", "checkbox", "text", "color"].includes(o.kind as string) ? o.kind : "number") as SchemaPropEntry["kind"];
    const def: string | number | boolean =
      kind === "checkbox" ? o.def === true
      : kind === "number" ? (Number(o.def) || 0)
      : typeof o.def === "string" ? o.def : String(o.def ?? "");
    // Conditional visibility (type-driven schemas) — passed through verbatim when well-formed.
    const siRaw = o.showIf as Record<string, unknown> | undefined;
    const showIf = siRaw && typeof siRaw.when === "string"
      ? {
          when: siRaw.when,
          ...(siRaw.equals !== undefined ? { equals: siRaw.equals as string | number | boolean } : {}),
          ...(Array.isArray(siRaw.in) ? { in: siRaw.in as (string | number | boolean)[] } : {}),
        }
      : undefined;
    return {
      id: typeof o.id === "string" && o.id ? o.id : `${param}_${i + 1}`,
      key: typeof o.key === "string" ? o.key : "",
      label: typeof o.label === "string" ? o.label : "",
      kind,
      unit: typeof o.unit === "string" ? o.unit : "",
      def,
      min: Number.isFinite(Number(o.min)) ? Number(o.min) : 0,
      max: Number.isFinite(Number(o.max)) ? Number(o.max) : 100,
      step: Number(o.step) || 1,
      options: Array.isArray(o.options) ? o.options.map(String) : [],
      role: typeof o.role === "string" ? o.role : "",
      ...(showIf ? { showIf } : {}),
      // Per-option SVG icons (value → data URL); keep only string entries.
      ...(o.optionIcons && typeof o.optionIcons === "object"
        ? { optionIcons: Object.fromEntries(Object.entries(o.optionIcons as Record<string, unknown>).filter(([, v]) => typeof v === "string" && v)) as Record<string, string> }
        : {}),
    };
  });
};

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Display label for a select option value: "wall" → "Wall", "open-space" → "Open Space". The stored
 *  value stays as-is (logic keys off it) — only the visible label is title-cased. */
const optLabel = (s: string): string => s.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/** Convert one Schema-node section into Properties-tab definitions ({@link GraphPropDef}s). */
const sectionToDefs = (entries: SchemaPropEntry[]): import("../types").GraphPropDef[] =>
  entries
    .filter((e) => e.label.trim() || e.key.trim())
    .map((e) => ({
      key: e.key.trim() || slug(e.label) || e.id,
      label: e.label.trim() || e.key.trim(),
      kind: e.kind,
      unit: e.unit.trim() || undefined,
      default: e.def,
      min: e.kind === "number" ? e.min : undefined,
      max: e.kind === "number" ? e.max : undefined,
      step: e.kind === "number" ? e.step : undefined,
      options: e.kind === "select" ? e.options.map((v) => ({ value: v, label: optLabel(v) })) : undefined,
      role: e.role.trim() || undefined,
      showIf: e.showIf,
    }));

/** Convert one Output-Schema section into Metrics-tab result rows. Decimals derive from the row's
 *  step when it's fractional (0.01 → 2 decimals); otherwise a safe default of 3. */
const sectionToResultDefs = (entries: SchemaPropEntry[]): import("../types").GraphResultDef[] =>
  entries
    .filter((e) => e.label.trim() || e.key.trim())
    .map((e) => ({
      key: e.key.trim() || slug(e.label) || e.id,
      label: e.label.trim() || e.key.trim(),
      unit: e.unit.trim() || undefined,
      decimals: e.step > 0 && e.step < 1 ? Math.min(6, Math.max(0, Math.round(-Math.log10(e.step)))) : 3,
    }));

/** All four sections of an Output Schema node as Metrics-tab result rows. */
export const schemaNodeToResultDefs = (params: Record<string, unknown>): {
  name?: string;
  node: import("../types").GraphResultDef[];
  segment: import("../types").GraphResultDef[];
  space: import("../types").GraphResultDef[];
  graph: import("../types").GraphResultDef[];
  information: import("../types").GraphResultDef[];
} => ({
  name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined,
  node: sectionToResultDefs(schemaEntries(params, "nodeProps")),
  segment: sectionToResultDefs(schemaEntries(params, "segmentProps")),
  space: sectionToResultDefs(schemaEntries(params, "spaceProps")),
  graph: sectionToResultDefs(schemaEntries(params, "graphProps")),
  information: sectionToResultDefs(schemaEntries(params, "informationProps")),
});

/** All four sections of a Schema node as Properties-tab definitions. */
export const schemaNodeToSchemas = (params: Record<string, unknown>): {
  name?: string;
  node: import("../types").GraphPropDef[];
  segment: import("../types").GraphPropDef[];
  space: import("../types").GraphPropDef[];
  graph: import("../types").GraphPropDef[];
  information: import("../types").GraphPropDef[];
  settings: import("../types").GraphPropDef[];
} => ({
  name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined,
  node: sectionToDefs(schemaEntries(params, "nodeProps")),
  segment: sectionToDefs(schemaEntries(params, "segmentProps")),
  space: sectionToDefs(schemaEntries(params, "spaceProps")),
  graph: sectionToDefs(schemaEntries(params, "graphProps")),
  information: sectionToDefs(schemaEntries(params, "informationProps")),
  settings: sectionToDefs(schemaEntries(params, "settingsProps")),
});

/** One named metric slot on the Output node. Each slot exposes a value-input endpoint (`valin-<id>`)
 *  you wire a node's `val-*` output into; `label` is the user-entered display name. */
export interface OutputSlot { id: string; label: string; }

/** Read an Output node's slots from its params (defaults to one empty slot). */
export const outputSlots = (params: Record<string, unknown>): OutputSlot[] => {
  const raw = params.slots;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { id: typeof o.id === "string" && o.id ? o.id : `s${i + 1}`, label: typeof o.label === "string" ? o.label : "" };
    });
  }
  return [{ id: "s1", label: "" }];
};

/** One furniture/fixture footprint placed along a Space's boundary by the Place Object node. The node
 *  stores an ARRAY of these under `params.objects` so a single node can lay out many objects at once
 *  (mirrors the Place Object Along Boundary block in the Space tools). */
export interface PlaceObjectEntry {
  kind: string;
  /** Length along the boundary edge (m). */
  length: number;
  /** Breadth / depth into the space (m). */
  breadth: number;
  /** Slider position 0–100, mapped to fractional arc-length around the perimeter. */
  position: number;
  /** Inward setback from the wall (m). */
  setback: number;
  /** Height of the object (m) — drives the extruded 3D primitive in 2D-Symbol placement mode. */
  height: number;
  /** Clearance above the floor (m) — lifts wall-hung objects (mirror, tv-unit, …) off the ground. */
  clearance: number;
  /** Locked objects keep their position when the layout seed is re-rolled, and act as anchors during
   *  overlap-avoidance (placed first). Unlocked objects get a seed-randomised position. */
  locked?: boolean;
}

/** Deterministic PRNG (mulberry32) — shared with the Space tool's Place Object Along Boundary seed so
 *  a given seed yields the same layout in both. */
export const placeObjectRng = (s: number): (() => number) => {
  let t = s >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

/** Position (0–100) for each object at a given layout seed: unlocked objects get a deterministic
 *  pseudo-random position along the perimeter; locked objects keep their current position. Mirrors the
 *  Space tool's positionsForSeed. */
export const placeObjectPositionsForSeed = (entries: PlaceObjectEntry[], seed: number): number[] => {
  const rng = placeObjectRng(Math.max(1, Math.round(seed)));
  return entries.map((o) => (o.locked ? o.position : rng() * 100));
};

export const PLACE_OBJECT_DEFAULT_ENTRY: PlaceObjectEntry = { kind: "bed", length: 2, breadth: 1.6, position: 25, setback: 0, height: 0.5, clearance: 0 };

/** Optimise Rectangle "Random" mode: a deterministic per-space draw of {optimise-tilt on/off, axis tilt
 *  0–360°, rectangle count 1–3, union forced on}, keyed on (seed, space index). Shared by the live eval
 *  and the commit compiler so both produce the same packing. */
export const randomOptimiseRectParams = (seed: number, i: number): { reference: "custom"; optimiseAxisTilt: boolean; axisAngle: number; count: number; union: true } => {
  const rng = placeObjectRng(Math.max(1, Math.round(seed)) * 1000 + i + 1);
  rng(); // warm up so adjacent (seed, index) decorrelate
  return {
    reference: "custom",
    optimiseAxisTilt: rng() < 0.5,
    axisAngle: rng() * 360,
    count: 1 + Math.floor(rng() * 3), // 1..3
    union: true,
  };
};

/** Object kinds the Place Object node can place. Mirrors the Space tool's Place Object Along Boundary
 *  catalog (and the recipe engine's ALLOWED_KINDS) so every kind links to a 2D symbol + 3D primitive. */
export const PLACE_OBJECT_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "bed", label: "Bed" },
  { value: "table", label: "Table" },
  { value: "chair", label: "Chair" },
  { value: "sofa", label: "Sofa" },
  { value: "desk", label: "Desk" },
  { value: "wardrobe", label: "Wardrobe" },
  { value: "bookshelf", label: "Bookshelf" },
  { value: "bench", label: "Bench" },
  { value: "piano", label: "Piano" },
  { value: "tv-unit", label: "TV Unit" },
  { value: "fridge", label: "Fridge" },
  { value: "toilet", label: "Toilet" },
  { value: "bathtub", label: "Bathtub" },
  { value: "guitar", label: "Guitar" },
  { value: "whiteboard", label: "Whiteboard" },
  { value: "flute", label: "Flute" },
  { value: "clock", label: "Clock" },
  { value: "mirror", label: "Mirror" },
];

/** Normalize a Place Object node's params into its objects array. Handles the current multi-object
 *  shape (`params.objects`) and is back-compatible with the original single-object node that stored
 *  flat `{kind,length,breadth,position,setback}` params (older saved flows / AI output). An explicit
 *  empty array is preserved (node places nothing); a missing array falls back to one default object. */
export const placeObjectEntries = (params: Record<string, unknown>): PlaceObjectEntry[] => {
  const coerce = (src: Record<string, unknown>): PlaceObjectEntry => {
    const e: PlaceObjectEntry = {
      kind: typeof src.kind === "string" ? src.kind : PLACE_OBJECT_DEFAULT_ENTRY.kind,
      length: Number(src.length) || PLACE_OBJECT_DEFAULT_ENTRY.length,
      breadth: Number(src.breadth) || PLACE_OBJECT_DEFAULT_ENTRY.breadth,
      position: Number.isFinite(Number(src.position)) ? Number(src.position) : PLACE_OBJECT_DEFAULT_ENTRY.position,
      setback: Number.isFinite(Number(src.setback)) ? Number(src.setback) : PLACE_OBJECT_DEFAULT_ENTRY.setback,
      height: Number(src.height) || PLACE_OBJECT_DEFAULT_ENTRY.height,
      clearance: Number.isFinite(Number(src.clearance)) ? Number(src.clearance) : PLACE_OBJECT_DEFAULT_ENTRY.clearance,
    };
    if (src.locked === true) e.locked = true;
    return e;
  };
  const raw = params.objects;
  if (Array.isArray(raw)) return raw.map((o) => coerce((o ?? {}) as Record<string, unknown>));
  // Back-compat: an older single-object node stored its params flat.
  if (params.kind != null || params.length != null || params.breadth != null) return [coerce(params)];
  return [{ ...PLACE_OBJECT_DEFAULT_ENTRY }];
};

/** One editable parameter exposed on a node. The `key` is written verbatim into the op's
 *  `params`, so these map 1:1 to the keys `applyRecipeJson`'s tool handlers read. */
export interface ParamField {
  key: string;
  label: string;
  kind: "number" | "range" | "select" | "checkbox" | "text" | "textarea" | "color";
  /** Canonical role this field maps to. When set, the per-element Properties-tab params panel stores the
   *  value in graphAttrs under this ROLE (the same key the Schema block + processors use) instead of the
   *  field key — so editing here and in the Schema block no longer desync. */
  role?: string;
  options?: { value: string; label: string }[];
  /** For a `select`: read its options at render time from this params key (an array of {value,label})
   *  instead of the static `options` — e.g. the Loop node's parameter dropdown, populated by the host
   *  from the node wired into its params input. */
  optionsFromParam?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Unit suffix shown next to a range/number value (e.g. "m", "°"). */
  unit?: string;
  /** Render a text field as a password input (e.g. an API key). */
  secret?: boolean;
  /** Placeholder for text / textarea inputs. */
  placeholder?: string;
  /** Only render this field when the predicate (over the node's params) holds. */
  showIf?: (params: Record<string, unknown>) => boolean;
  /** Expose this param's own value as a scalar `val-<key>` output endpoint aligned to its row
   *  (pass-through). Checkbox → 1 | 0; text → its leading parsed number. */
  output?: boolean;
}

export interface FlowToolDef {
  type: FlowToolType;
  label: string;
  /** Accent colour for the node header. */
  color: string;
  /** Whether the node has an input handle (consumes upstream rooms) / output handle. */
  hasInput: boolean;
  hasOutput: boolean;
  /** Renders a "params" OUTPUT endpoint (violet, id `pout`) that advertises this node's parameters — a
   *  Loop node wired from it can introspect them. */
  exposesParams?: boolean;
  /** Renders a "params" INPUT endpoint (violet, id `pin`) that receives a node's parameters (Loop node). */
  acceptsParams?: boolean;
  /** Number of output handles for this node given its params. Omitted → (hasOutput ? 1 : 0).
   *  Split returns N (one handle per piece) so a single piece can be wired onward. */
  outputCount?: (params: Record<string, unknown>) => number;
  /** Optional labels for the output handles (index-aligned). Omitted → "P1", "P2", … is used.
   *  The Conditional node uses ["T", "F"] to mark its True / False routes. */
  outputLabels?: string[];
  /** Extra SCALAR output endpoints (values, not polygons) — e.g. Inset's "area". Rendered as amber
   *  handles (id `val-<key>`) below the geometry outputs; the live value is shown on the node and
   *  baked under params._values for the badge. When `alignField` is set, the endpoint instead sits on
   *  that existing field's row (no separate readout row) — e.g. Massing's "floors" on the "n" slider. */
  valueOutputs?: { key: string; label: string; unit?: string; alignField?: string }[];
  /** SCALAR input endpoints (amber target handles, id `valin-<key>`) — when wired from another node's
   *  value output, the incoming number OVERRIDES the param named `key` (e.g. Massing's `n` floors). */
  valueInputs?: { key: string; label: string }[];
  /** Extra GEOMETRY input endpoints (emerald target handles, id `gin-<key>`) beyond the main input —
   *  e.g. Mitered Join's "boundary" Space used to clip the ribbon. Polygons wired here are read via
   *  their handle id, separate from the main graph/polygon input. */
  geomInputs?: { key: string; label: string }[];
  /** Default params (already in op-param shape — compiled verbatim into `params`). */
  defaultParams: Record<string, unknown>;
  fields: ParamField[];
  /** One-line description shown in the palette + node. */
  hint: string;
}

/** Default Metrics-tab result rows for the Frame Builder, used when no Output Schema node overrides
 *  them. Keys match the result keys {@link computeFrame} writes per component. */
export const FRAME_DEFAULT_RESULTS: { node: import("../types").GraphResultDef[]; segment: import("../types").GraphResultDef[] } = {
  node: [
    { key: "columnWidth", label: "Column width", unit: "mm", decimals: 0 },
    { key: "columnHeight", label: "Column height", unit: "mm", decimals: 0 },
    { key: "columnArea", label: "Column area", unit: "m²", decimals: 3 },
  ],
  segment: [
    { key: "beamWidth", label: "Beam width", unit: "mm", decimals: 0 },
    { key: "beamLength", label: "Beam length", unit: "m", decimals: 3 },
    { key: "beamArea", label: "Beam area", unit: "m²", decimals: 3 },
  ],
};

export const FLOW_TOOLS: Record<FlowToolType, FlowToolDef> = {
  source: {
    type: "source",
    label: "Space",
    color: "#0f172a",
    // Input endpoint accepts a Schema node (attaches Space Schema properties to the referenced
    // space(s)); the node itself remains a pipeline ROOT — geometry comes from the canvas, never
    // from the wire, so the eval ignores any incoming geometry.
    hasInput: true,
    hasOutput: true,
    // Pipeline input. `id` identifies the source Space; when `grabFromSelection` is on, the host keeps
    // `id` synced to the space currently selected on the canvas (and feeds that space's geometry).
    defaultParams: { id: "", grabFromSelection: true },
    fields: [
      { key: "grabFromSelection", label: "Grab ID from selection", kind: "checkbox" },
      // Editable Space id. Read-only-ish while grabbing (the host overwrites it from the selection);
      // hide the input in that mode and show the grabbed id as a readout instead.
      { key: "id", label: "ID", kind: "text", placeholder: "space id", showIf: (p) => !p.grabFromSelection },
    ],
    hint: "Pipeline input — a Space on the canvas (by id, or the current selection).",
  },
  "space-creator": {
    type: "space-creator",
    label: "Space Creator",
    color: "#0f766e",
    // Generator (no geometry input): synthesises a parametric polygon — shape + dimensions + rotation +
    // regular/irregular. Acts as a pipeline root like the Space node, but draws geometry from scratch
    // (centred near the current selection). Irregular jitter is seeded → stable; "Re-roll" bumps the seed.
    hasInput: false,
    hasOutput: true,
    defaultParams: { shape: "rectangle", n: 5, radius: 3, width: 4, height: 3, rotation: 0, regularity: "regular", irregularity: 0.3, seed: 1, offsetX: 0, offsetY: 0 },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "rectangle", label: "Rectangle" },
          { value: "polygon", label: "Regular polygon" },
          { value: "circle", label: "Circle" },
          { value: "lshape", label: "L-shape" },
        ],
      },
      { key: "n", label: "Segments (n)", kind: "range", min: 3, max: 40, step: 1, showIf: (p) => p.shape === "polygon" },
      { key: "radius", label: "Radius", kind: "range", min: 0.5, max: 50, step: 0.5, unit: "m", showIf: (p) => p.shape === "polygon" || p.shape === "circle" },
      { key: "width", label: "Width", kind: "range", min: 0.5, max: 100, step: 0.5, unit: "m", showIf: (p) => p.shape === "rectangle" || p.shape === "lshape" },
      { key: "height", label: "Height", kind: "range", min: 0.5, max: 100, step: 0.5, unit: "m", showIf: (p) => p.shape === "rectangle" || p.shape === "lshape" },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      {
        key: "regularity",
        label: "Regularity",
        kind: "select",
        options: [
          { value: "regular", label: "Regular" },
          { value: "irregular", label: "Irregular" },
        ],
      },
      { key: "irregularity", label: "Irregularity", kind: "range", min: 0, max: 1, step: 0.02, showIf: (p) => p.regularity === "irregular" },
      { key: "seed", label: "Seed", kind: "number", min: 1, step: 1, showIf: (p) => p.regularity === "irregular" },
      { key: "offsetX", label: "Offset X", kind: "number", step: 0.5, unit: "m" },
      { key: "offsetY", label: "Offset Y", kind: "number", step: 0.5, unit: "m" },
    ],
    hint: "Draw a parametric space — rectangle / regular polygon / circle / L-shape, regular or irregular.",
  },
  densify: {
    type: "densify",
    label: "Resample",
    color: "#16a34a",
    hasInput: true,
    hasOutput: true,
    // Multi-space resampler: ADD vertices (Densify by length / per-edge → feeds Voronoi seeds, Skeleton,
    // Smoothing) or REDUCE them (Remove collinear = inverse of densify; Douglas-Peucker = shape-preserving
    // low-poly by tolerance; Visvalingam = reduce to a target vertex count; Keep-every-Nth = crude). One
    // output handle per input space; the host bakes the live count into `inputCount`. The active param is
    // wireable.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.inputCount) || 1))),
    valueInputs: [
      { key: "maxLength", label: "Max segment length" },
      { key: "count", label: "Points / edge" },
      { key: "rdpTol", label: "Tolerance" },
      { key: "targetVertices", label: "Target vertices" },
      { key: "stride", label: "Keep every Nth" },
    ],
    defaultParams: { mode: "length", maxLength: 5, count: 2, collinearTol: 1, rdpTol: 1, targetVertices: 8, stride: 2, outputMode: "perCell" },
    fields: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "length", label: "Densify · by max length" },
          { value: "count", label: "Densify · points / edge" },
          { value: "collinear", label: "Simplify · remove collinear" },
          { value: "rdp", label: "Simplify · Douglas-Peucker" },
          { value: "visvalingam", label: "Simplify · target vertices" },
          { value: "stride", label: "Reduce · keep every Nth" },
        ],
      },
      { key: "maxLength", label: "Max segment length", kind: "range", min: 0.2, max: 50, step: 0.2, unit: "m", showIf: (p) => p.mode === "length" },
      { key: "count", label: "Points / edge", kind: "range", min: 1, max: 20, step: 1, showIf: (p) => p.mode === "count" },
      { key: "collinearTol", label: "Angle tolerance", kind: "range", min: 0, max: 30, step: 0.5, unit: "°", showIf: (p) => p.mode === "collinear" },
      { key: "rdpTol", label: "Tolerance", kind: "range", min: 0.05, max: 20, step: 0.05, unit: "m", showIf: (p) => p.mode === "rdp" },
      { key: "targetVertices", label: "Target vertices", kind: "range", min: 3, max: 60, step: 1, showIf: (p) => p.mode === "visvalingam" },
      { key: "stride", label: "Keep every Nth", kind: "range", min: 2, max: 10, step: 1, showIf: (p) => p.mode === "stride" },
      // One handle per resampled space, or a single bundle handle. Only meaningful with several inputs.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per space (one each)" },
          { value: "single", label: "Single (all spaces)" },
        ],
        showIf: (p) => Math.round(Number(p.inputCount) || 1) > 1,
      },
    ],
    hint: "Resample a space: Densify (add vertices → feeds Voronoi/Skeleton) or Simplify (remove collinear / Douglas-Peucker / target count) to low-poly.",
  },
  inset: {
    type: "inset",
    label: "Inset",
    color: "#0369a1",
    hasInput: true,
    hasOutput: true,
    // Multi-space: insets EVERY connected space, emitting one output handle (out-i) per input space.
    // The live input count isn't knowable from params alone (it depends on how many edges feed this
    // node), so the host bakes it into `inputCount`; this drives both the handle count and the
    // compiled `produces` list. 1 input → 1 output (unchanged single-space behaviour).
    // "Outputs": per-space handles, or a single bundle handle carrying every inset space.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.inputCount) || 1))),
    // Second output endpoint: the inset area (m²) — total across every inset space.
    valueOutputs: [{ key: "area", label: "Area", unit: "m²" }],
    // Scalar inputs (numbers): a wired value overrides the matching offset param. Each aligns to its
    // own field row; hidden rows (the mode the field doesn't apply to) fall back to a default position.
    valueInputs: [
      { key: "uniformSetback", label: "Offset" },
      { key: "front", label: "Front offset" },
      { key: "remaining", label: "Remaining offset" },
      { key: "frontEdgeIndex", label: "Edge index" },
    ],
    // Mirrors the Inset Polygon block's parameters (Equal / Front & Remaining / Per-edge). Deduct
    // Area is intentionally omitted.
    defaultParams: {
      mode: "equal",
      uniformSetback: 1,
      inside: true,
      front: 0,
      remaining: 0,
      frontEdgeMode: "longest",
      frontEdgeIndex: 0,
      setbacks: "1, 0.5, 0.5",
      outputMode: "perCell",
    },
    fields: [
      { key: "inside", label: "Inside", kind: "checkbox" },
      // "Outputs": one handle per inset space, or a single bundle handle carrying all of them. Only
      // meaningful with several input spaces; a single space is one output either way.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per space (one each)" },
          { value: "single", label: "Single (all spaces)" },
        ],
        showIf: (p) => Math.round(Number(p.inputCount) || 1) > 1,
      },
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "equal", label: "Equal" },
          { value: "front-remaining", label: "Front & Remaining" },
          { value: "variable", label: "Per-edge" },
        ],
      },
      {
        key: "uniformSetback",
        label: "Offset",
        kind: "range",
        min: 0,
        max: 5,
        step: 0.05,
        unit: "m",
        showIf: (p) => p.mode === "equal",
      },
      {
        key: "front",
        label: "Front offset",
        kind: "range",
        min: 0,
        max: 5,
        step: 0.05,
        unit: "m",
        showIf: (p) => p.mode === "front-remaining",
      },
      {
        key: "remaining",
        label: "Remaining offset",
        kind: "range",
        min: 0,
        max: 5,
        step: 0.05,
        unit: "m",
        showIf: (p) => p.mode === "front-remaining",
      },
      // Which edge counts as "front": auto (longest edge ≈ street-facing) or an explicit index.
      {
        key: "frontEdgeMode",
        label: "Front edge",
        kind: "select",
        options: [
          { value: "longest", label: "Longest (auto)" },
          { value: "index", label: "By edge index" },
        ],
        showIf: (p) => p.mode === "front-remaining",
      },
      { key: "frontEdgeIndex", label: "Edge index", kind: "range", min: 0, max: 19, step: 1, showIf: (p) => p.mode === "front-remaining" && p.frontEdgeMode === "index" },
      // Per-edge setbacks (metres), one per polygon edge. Short lists pad with 0 (no inset on the rest).
      { key: "setbacks", label: "Setbacks (per edge)", kind: "text", placeholder: "1, 0.5, 0.5, 2", showIf: (p) => p.mode === "variable" },
    ],
    hint: "Offset the boundary inward → an Inset Area space. Takes multiple spaces (one output per input). Equal / Front&Remaining / Per-edge.",
  },
  "optimise-rect": {
    type: "optimise-rect",
    label: "Optimise Rectangle",
    color: "#7c3aed",
    hasInput: true,
    hasOutput: true,
    // Multi-space: packs EVERY connected space, emitting one output handle (out-i) per placed rectangle
    // (across all input spaces). The live count isn't knowable from params alone, so the host bakes it
    // into `inputCount`. "Outputs": per-rectangle handles, or a single bundle handle carrying them all.
    // 1 input space + 1 rectangle → 1 output (unchanged single-space behaviour).
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.inputCount) || 1))),
    // Second output endpoint: total packed rectangle area (m²) — sum of all placed rects / union.
    valueOutputs: [{ key: "area", label: "Area", unit: "m²" }],
    // Scalar inputs: a wired value overrides the matching param. axisAngle / count take the number
    // directly; optimiseAxisTilt is a boolean, driven as 0 (off) | non-0 (on).
    valueInputs: [
      { key: "axisAngle", label: "Axis tilt" },
      { key: "count", label: "Rectangles (n)" },
      { key: "optimiseAxisTilt", label: "Optimise axis tilt" },
    ],
    // Mirrors the Optimise Rectangle block (recipe-supported params). Per-edge reference and
    // the layout-variations modal aren't exposed on the node.
    defaultParams: {
      shape: "rectangle",
      reference: "none",
      referenceEdge: 0,
      axisAngle: 0,
      minNotch: 0,
      minThickness: 0,
      steps: 3,
      count: 1,
      gap: 0,
      union: false,
      optimiseAxisTilt: false,
      shrinkEnabled: false,
      targetArea: 50,
      shrinkAngle: 0,
      shrinkSlide: 0,
      optimiseShrinkEnabled: false,
      exactArea: false,
      outputMode: "perCell",
      random: false,
      seed: 1,
    },
    fields: [
      // "Outputs": one handle per placed rectangle, or a single bundle handle carrying them all. Only
      // meaningful with several input spaces / rectangles; a single result is one output either way.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per rect (one each)" },
          { value: "single", label: "Single (all)" },
        ],
        showIf: (p) => Math.round(Number(p.inputCount) || 1) > 1,
      },
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "rectangle", label: "Rectangle" },
          { value: "square", label: "Square" },
          { value: "hexagon", label: "Hexagon" },
          { value: "lshape", label: "L-shape (inscribed)" },
          { value: "tshape", label: "T-shape (inscribed)" },
          { value: "zshape", label: "Z-shape (inscribed)" },
          { value: "ishape", label: "I-shape (inscribed)" },
          { value: "cshape", label: "C-shape (inscribed)" },
          { value: "stepped", label: "Stepped (inscribed)" },
          { value: "cross", label: "Cross (inscribed)" },
        ],
      },
      // Random: per space, auto-pick optimise-tilt on/off, an axis tilt 0–360°, rectangle count 1–3, and
      // force Union on — a stable seeded draw (re-roll bumps the seed). Hides the controls it drives.
      { key: "random", label: "Random", kind: "checkbox" },
      { key: "seed", label: "Seed", kind: "number", min: 1, step: 1, showIf: (p) => Boolean(p.random) },
      {
        key: "reference",
        label: "Reference",
        kind: "select",
        options: [
          { value: "none", label: "None (any-angle)" },
          { value: "custom", label: "Custom angle" },
          { value: "by-edge", label: "By edge" },
        ],
        showIf: (p) => !p.random && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross",
      },
      { key: "referenceEdge", label: "Edge index", kind: "range", min: 0, max: 19, step: 1, showIf: (p) => !p.random && p.reference === "by-edge" && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      // Optimise axis tilt: auto-pick the Custom angle that maximises the packed area (sweeps tilt).
      { key: "optimiseAxisTilt", label: "Optimise axis tilt", kind: "checkbox", showIf: (p) => !p.random && p.reference === "custom" && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      // Axis tilt: absolute angle for Custom; an offset on the edge angle for By edge; the inscribed
      // L/T/Z-shape's tilt for those shapes. Hidden for Custom when "Optimise axis tilt" is on.
      { key: "axisAngle", label: "Axis tilt", kind: "range", min: 0, max: 180, step: 0.5, unit: "°", showIf: (p) => !p.random && (p.shape === "lshape" || p.shape === "tshape" || p.shape === "zshape" || p.shape === "ishape" || p.shape === "cshape" || p.shape === "stepped" || p.shape === "cross" || (p.reference === "custom" && !p.optimiseAxisTilt) || p.reference === "by-edge") },
      // Stepped only: number of staircase steps cut from a corner (1 = an L-shape).
      { key: "steps", label: "Steps", kind: "range", min: 1, max: 10, step: 1, showIf: (p) => p.shape === "stepped" },
      // Inscribed shapes only: the cut-out (notch / mouth / step / corner) must be at least this on
      // every side, else the shape is treated as too-shallow to be a real one and no result is produced.
      // For Stepped this is the minimum tread & riser; for Cross it's each corner notch. 0 = no minimum.
      { key: "minNotch", label: "Min notch length", kind: "range", min: 0, max: 20, step: 0.1, unit: "m", showIf: (p) => p.shape === "lshape" || p.shape === "tshape" || p.shape === "zshape" || p.shape === "ishape" || p.shape === "cshape" || p.shape === "stepped" || p.shape === "cross" },
      // Inscribed shapes only: minimum thickness of every limb — the L's arms, the T's bar & stem,
      // the Z's blocks & connector, the I's bars & stem, the C's arms & spine, the Stepped's solid
      // margins, the Cross's two bars — so a protruding part can't come out too thin. 0 = no minimum.
      { key: "minThickness", label: "Min part thickness", kind: "range", min: 0, max: 20, step: 0.1, unit: "m", showIf: (p) => p.shape === "lshape" || p.shape === "tshape" || p.shape === "zshape" || p.shape === "ishape" || p.shape === "cshape" || p.shape === "stepped" || p.shape === "cross" },
      { key: "count", label: "Rectangles (n)", kind: "range", min: 1, max: 20, step: 1, showIf: (p) => !p.random && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      // Minimum spacing between placed rectangles — only meaningful with n ≥ 2. Each placed rect is
      // inflated by this gap before it blocks the next, so consecutive rects stay at least `gap` apart.
      { key: "gap", label: "Gap", kind: "range", min: 0, max: 20, step: 0.1, unit: "m", showIf: (p) => !p.random && Number(p.count) > 1 && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "union", label: "Union", kind: "checkbox", showIf: (p) => !p.random && Number(p.count) > 1 && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "shrinkEnabled", label: "Shrink to target", kind: "checkbox", showIf: (p) => p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "targetArea", label: "Target area", kind: "range", min: 0, max: 500, step: 0.5, unit: "m²", showIf: (p) => Boolean(p.shrinkEnabled) && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "shrinkAngle", label: "Shrink angle", kind: "range", min: 0, max: 360, step: 1, unit: "°", showIf: (p) => Boolean(p.shrinkEnabled) && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "optimiseShrinkEnabled", label: "Optimise shrink", kind: "checkbox", showIf: (p) => Boolean(p.shrinkEnabled) && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "shrinkSlide", label: "Shrink slide", kind: "range", min: 0, max: 100, step: 0.1, unit: "%", showIf: (p) => Boolean(p.shrinkEnabled) && !p.optimiseShrinkEnabled && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
      { key: "exactArea", label: "Exact area", kind: "checkbox", showIf: (p) => Boolean(p.shrinkEnabled) && p.shape !== "lshape" && p.shape !== "tshape" && p.shape !== "zshape" && p.shape !== "ishape" && p.shape !== "cshape" && p.shape !== "stepped" && p.shape !== "cross" },
    ],
    hint: "Fit the largest rectangle(s) inside the input space.",
  },
  split: {
    type: "split",
    label: "Split",
    color: "#0d9488",
    hasInput: true,
    hasOutput: true,
    // Output handles. With ONE input space: one handle per piece (Strip → 3; Ratio → one per ratio entry;
    // else `count`). With SEVERAL input spaces: one handle per input space, each bundling that space's
    // pieces — the host bakes the live handle count into `handleCount`. "single" mode → one bundle handle.
    outputCount: (p) => {
      if (p.outputMode === "single") return 1;
      const baked = Number(p.handleCount);
      if (Number.isFinite(baked) && baked >= 1) return Math.min(40, Math.round(baked));
      if (p.type === "strip") return 3;
      if (p.type === "normal" && p.mode === "ratio") {
        const n = parseSplitRatios(p.ratios).length;
        if (n >= 1) return Math.max(1, Math.min(12, n));
      }
      return Math.max(1, Math.min(12, Math.round(Number(p.count) || 2)));
    },
    // Scalar inputs: `angle` takes the wired number directly; `target` (first piece area, m²) drives the
    // target-sizing split; `ratios` is a text list, so a wired number is coerced to its string form (and
    // not echoed back to the text box). The `target` endpoint only appears in Target-area sizing mode
    // (its field's showIf gates the handle too).
    valueInputs: [
      { key: "ratios", label: "Ratios" },
      { key: "angle", label: "Angle" },
      { key: "target", label: "First piece area" },
    ],
    // Mirrors the Splitting Actions block: Equal / Target area / Ratio sizing. (Grid + per-piece
    // Length arrays aren't exposed.) Principal Axes slices across the long (major) axis.
    defaultParams: {
      type: "normal",
      mode: "equal",
      count: 2,
      angle: 0,
      target: 20,
      ratios: "1, 2, 1",
      splitAlongMinorPrincipalAxis: false,
      stripLength: 1,
      stripPosition: 50,
      principalMethod: "pca",
      outputMode: "perCell",
    },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "normal", label: "Normal" },
          { value: "strip", label: "Strip" },
          { value: "principal", label: "Principal Axes" },
        ],
      },
      // Output style: separate per-piece handles, or a single bundle handle carrying every piece.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per piece (one each)" },
          { value: "single", label: "Single (all pieces)" },
        ],
      },
      { key: "count", label: "Pieces", kind: "range", min: 2, max: 12, step: 1, showIf: (p) => (p.type === "normal" && p.mode !== "ratio") || p.type === "principal" },
      {
        key: "principalMethod",
        label: "Method",
        kind: "select",
        options: [
          { value: "pca", label: "PCA (moments)" },
          { value: "obb", label: "Min-area OBB" },
          { value: "skeleton", label: "Straight Skeleton" },
        ],
        showIf: (p) => p.type === "principal",
      },
      {
        key: "mode",
        label: "Sizing",
        kind: "select",
        options: [
          { value: "equal", label: "Equal (area)" },
          { value: "target", label: "Target area" },
          { value: "ratio", label: "Ratio" },
        ],
        showIf: (p) => p.type === "normal",
      },
      { key: "target", label: "First piece area", kind: "range", min: 1, max: 200, step: 1, unit: "m²", showIf: (p) => p.type === "normal" && p.mode === "target" },
      // Ratio sizing: relative weights, one per piece. The entry count = number of pieces.
      { key: "ratios", label: "Ratios", kind: "text", placeholder: "1, 2, 1", showIf: (p) => p.type === "normal" && p.mode === "ratio" },
      {
        key: "splitAlongMinorPrincipalAxis",
        label: "Along minor axis",
        kind: "checkbox",
        showIf: (p) => p.type === "normal",
      },
      { key: "angle", label: "Angle", kind: "range", min: 0, max: 360, step: 1, unit: "°", showIf: (p) => p.type !== "principal" && !p.splitAlongMinorPrincipalAxis },
      { key: "stripLength", label: "Strip length", kind: "range", min: 0.1, max: 20, step: 0.05, unit: "m", showIf: (p) => p.type === "strip" },
      { key: "stripPosition", label: "Strip position", kind: "range", min: 0, max: 100, step: 1, unit: "%", showIf: (p) => p.type === "strip" },
    ],
    hint: "Cut the input space into N partitions on the Partitions layer.",
  },
  skeleton: {
    type: "skeleton",
    label: "Skeleton",
    color: "#0891b2",
    hasInput: true,
    hasOutput: true,
    // Multi-space: computes the medial axis of EVERY input space. Output handles are GROUPED like BSP —
    // one input → one handle per skeleton segment; several inputs → one handle per INPUT SPACE (each
    // bundling that space's segments); "single" output mode → one bundle handle for everything. The host
    // bakes the live handle count into `handleCount`.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.handleCount) || 1))),
    // Mirrors the Skeleton block (recipe-supported params; `simplify` isn't replayed by the engine).
    defaultParams: {
      type: "straight-skeleton",
      samples: 8,
      level: 1,
      reduceLevel: 0,
      pruneEnds: true,
      joinToBoundary: false,
      longestBranch: false,
      makePath: false,
      pathWidth: 1,
      emit: "regions",
      outputMode: "perCell",
    },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "sampled-voronoi", label: "Sampled Voronoi" },
          { value: "segment-sweepline", label: "Sweepline (segments)" },
          { value: "straight-skeleton", label: "Straight Skeleton" },
        ],
      },
      // What to emit: the closed face polygons (spaces, default — insettable) or the raw medial-axis lines.
      {
        key: "emit",
        label: "Emit",
        kind: "select",
        options: [
          { value: "regions", label: "Regions (spaces)" },
          { value: "branches", label: "Branches (lines)" },
        ],
      },
      // Output style: per-region / per-input-space handles, or a single bundle handle.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
      { key: "samples", label: "Samples", kind: "range", min: 2, max: 20, step: 1, showIf: (p) => p.type !== "straight-skeleton" },
      { key: "level", label: "Level", kind: "range", min: 1, max: 4, step: 1, showIf: (p) => p.type === "straight-skeleton" },
      // Midpoint segment reduction: 0 = off; each level halves interior detail (anchored at junctions/tips).
      { key: "reduceLevel", label: "Reduce segments", kind: "range", min: 0, max: 5, step: 1, showIf: (p) => p.type === "straight-skeleton" },
      { key: "pruneEnds", label: "Prune ends", kind: "checkbox", showIf: (p) => p.type === "straight-skeleton" },
      // Continue each pruned branch tip out to the polygon boundary (red completion segments).
      { key: "joinToBoundary", label: "Join to boundary", kind: "checkbox", showIf: (p) => p.type === "straight-skeleton" && Boolean(p.pruneEnds) },
      { key: "longestBranch", label: "Longest branch", kind: "checkbox", showIf: (p) => p.type === "straight-skeleton" && Boolean(p.pruneEnds) },
      { key: "makePath", label: "Make path", kind: "checkbox", showIf: (p) => p.type === "straight-skeleton" },
      { key: "pathWidth", label: "Path width", kind: "range", min: 0, max: 50, step: 0.1, unit: "m", showIf: (p) => p.type === "straight-skeleton" && Boolean(p.makePath) },
    ],
    hint: "Medial axis of the space → closed Regions (spaces, default) or Branches (lines). Prune+Join reduces the region count.",
  },
  "place-object": {
    type: "place-object",
    label: "Place Object",
    color: "#db2777",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Place Object Along Boundary block. The node holds an ARRAY of objects (params.objects)
    // so one node can lay out many at once; placement honours corner end-strips + pairwise non-overlap
    // (shared computePerimeterPlacement). Each object's length runs along the boundary edge; breadth +
    // setback push into the space from the wall. The `fields` below are the PER-OBJECT editor template —
    // the renderers special-case this node to repeat them per object row rather than reading flat params.
    defaultParams: { objects: [{ ...PLACE_OBJECT_DEFAULT_ENTRY }], seed: 1 },
    fields: [
      { key: "kind", label: "Type", kind: "select", options: PLACE_OBJECT_KIND_OPTIONS },
      { key: "length", label: "Length", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "breadth", label: "Breadth", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "position", label: "Position", kind: "range", min: 0, max: 100, step: 0.5, unit: "%" },
      { key: "setback", label: "Setback", kind: "range", min: 0, max: 5, step: 0.05, unit: "m" },
      { key: "height", label: "Height", kind: "range", min: 0.05, max: 3, step: 0.05, unit: "m" },
      { key: "clearance", label: "Clearance", kind: "range", min: 0, max: 3, step: 0.05, unit: "m" },
    ],
    hint: "Place one or more object footprints along the input space's boundary.",
  },
  bsp: {
    type: "bsp",
    label: "BSP",
    color: "#c026d3",
    hasInput: true,
    hasOutput: true,
    // One output handle per seed/cell. Seeds are auto-distributed along the longer axis (matches
    // the engine), so increasing Seeds adds cells; each cell has its own output (like Split).
    // Output handles. ONE input space → one handle per cell (Seeds). SEVERAL input spaces → one handle
    // per input space, each bundling that space's cells (host bakes the count into `handleCount`).
    // "single" mode → one bundle handle carrying every cell.
    outputCount: (p) => {
      if (p.outputMode === "single") return 1;
      const baked = Number(p.handleCount);
      if (Number.isFinite(baked) && baked >= 1) return Math.min(40, Math.round(baked));
      return Math.max(1, Math.min(30, Math.round(Number(p.seeds) || 2)));
    },
    valueInputs: [
      { key: "tiltAngle", label: "Tilt" },
      { key: "maxRatio", label: "Max aspect" },
    ],
    defaultParams: { seeds: 3, tiltAngle: 0, balance: "equal", weights: "", layout: "strip", maxRatio: 0, useConnection: false, connections: "", outputMode: "perCell", showOuterOpenings: false, outerOpeningWidth: 1.0, showInnerOpenings: false, innerOpeningWidth: 0.9 },
    fields: [
      { key: "seeds", label: "Cells", kind: "range", min: 1, max: 30, step: 1 },
      { key: "tiltAngle", label: "Tilt", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      // Area balance: cuts are solved on the CLIPPED area (the part inside the boundary), so equal
      // really means equal m² — even on L/T/concave spaces. Weighted uses the ratio list below.
      {
        key: "balance",
        label: "Balance",
        kind: "select",
        options: [
          { value: "equal", label: "Equal area" },
          { value: "weighted", label: "Weighted (ratios)" },
        ],
      },
      // Relative area weights, one per cell (comma ratio list). Short/missing entries → 1.
      { key: "weights", label: "Weights", kind: "text", placeholder: "1, 2, 1", showIf: (p) => p.balance === "weighted" },
      // Layout strategy: "Slicing" = classic recursive BSP halving; "Squarified" = treemap rows
      // that keep every cell's aspect ratio as close to 1 as the weights allow.
      {
        key: "layout",
        label: "Layout",
        kind: "select",
        options: [
          { value: "strip", label: "Slicing (BSP)" },
          { value: "squarify", label: "Squarified (treemap)" },
        ],
      },
      // Soft aspect target for slicing mode: each split picks the cut axis predicted to keep cells
      // under this long/short ratio. 0 = off (always cut the longer side). Squarify ignores it.
      { key: "maxRatio", label: "Max aspect", kind: "range", min: 0, max: 6, step: 0.1, showIf: (p) => p.layout !== "squarify" },
      // Adjacency: tick pairs in the matrix (rendered on the node) to require those cells to share
      // a wall. The slicing tree bipartitions to keep ticked pairs together (min-cut), then a
      // relabelling pass + deterministic multi-start maximise satisfied pairs.
      { key: "useConnection", label: "Use adjacency", kind: "checkbox" },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all cells)" },
        ],
      },
      // Preview-only openings: draw the partition with a "no line" gap so rooms read as connected.
      // OUTER = one opening per cell on its longest boundary (perimeter) edge — an exterior door per
      // room. INNER = an opening on each shared edge between two cells. Display geometry only — the
      // threaded cells are unchanged.
      { key: "showOuterOpenings", label: "Show outer openings", kind: "checkbox" },
      { key: "outerOpeningWidth", label: "Outer opening width", kind: "range", min: 0.3, max: 3, step: 0.05, unit: "m", showIf: (p) => Boolean(p.showOuterOpenings) },
      { key: "showInnerOpenings", label: "Show inner openings", kind: "checkbox" },
      { key: "innerOpeningWidth", label: "Inner opening width", kind: "range", min: 0.3, max: 3, step: 0.05, unit: "m", showIf: (p) => Boolean(p.showInnerOpenings) },
    ],
    hint: "Binary-space-partition the input space into one cell per seed. Equal/weighted shares are measured on the clipped area (inside the boundary). Squarified layout keeps cells near-square; the adjacency matrix forces ticked pairs to share a wall.",
  },
  voronoi: {
    type: "voronoi",
    label: "Voronoi",
    color: "#2563eb",
    hasInput: true,
    hasOutput: true,
    // Seeds ARE the input space's vertices → exactly one cell per vertex. Two output styles:
    //  • "perCell" (default) — one output handle per cell (out-0, out-1, … like Split / BSP). The vertex
    //    count isn't known from params alone, so the host bakes it into `vertexCount`.
    //  • "single" — ONE handle carrying ALL cells as a bundle, so a single connection feeds a multi-space
    //    node (e.g. Inset) which then processes every cell.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(2, Math.min(40, Math.round(Number(p.vertexCount) || 2))),
    // Scalar input: a wired number overrides the random-seed count (only used when 'Use vertices' is off).
    valueInputs: [{ key: "seeds", label: "Seeds" }],
    defaultParams: { metric: "euclidean", relax: false, outputMode: "perCell", useVertices: true, seeds: 8, rectilinear: false },
    fields: [
      {
        key: "metric",
        label: "Type",
        kind: "select",
        options: [
          { value: "euclidean", label: "Euclidean" },
          { value: "manhattan", label: "Manhattan" },
          { value: "chebyshev", label: "Chebyshev" },
        ],
      },
      // Seed source: the polygon's vertices (one cell per vertex), or `seeds` random interior points.
      { key: "useVertices", label: "Use vertices as seeds", kind: "checkbox" },
      { key: "seeds", label: "Seeds", kind: "range", min: 2, max: 40, step: 1, showIf: (p) => p.useVertices === false },
      // Output style: separate per-cell handles, or a single bundle handle carrying every cell.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all cells)" },
        ],
      },
      { key: "relax", label: "Relax seeds", kind: "checkbox" },
      // Rectilinear: BSP-like axis-aligned (staircase) cells via grid CVT, oriented to the principal axis;
      // handles concave shapes. Manhattan/Chebyshev metric → blockier cells.
      { key: "rectilinear", label: "Rectilinear (grid)", kind: "checkbox" },
    ],
    hint: "Voronoi-partition the space — one cell per vertex, or per random seed (uncheck 'Use vertices'). Rectilinear = BSP-like axis-aligned cells (concave-safe). Relax = Lloyd/CVT.",
  },
  conditional: {
    type: "conditional",
    label: "Conditional",
    color: "#b45309",
    // Pure value comparator: takes two numbers on its value inputs (A, B), tests A <op> B, and outputs the
    // boolean verdict on `val-result` (1 = True, 0 = False). No geometry input or output.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "a", label: "Value (A)" }, { key: "value", label: "Compare (B)" }],
    valueOutputs: [{ key: "result", label: "True / False" }],
    defaultParams: { op: "gt", value: 30, a: 0 },
    fields: [
      { key: "a", label: "Value (A)", kind: "number", step: 0.5 },
      { key: "op", label: "Condition", kind: "select", options: CONDITION_OP_OPTIONS },
      { key: "value", label: "Compare (B)", kind: "number", step: 0.5 },
    ],
    hint: "Compare two values: A <op> B → True / False. Wire numbers into A and B; outputs the boolean.",
  },
  "param-manip": {
    type: "param-manip",
    label: "Parameter Manipulator",
    color: "#7c3aed",
    // Feedback controller: drives a target node's numeric value-input (wire Value → a node's param) and
    // steps that value each iteration — Increase (+Δ) / Decrease (−Δ) / Random (seeded) — until the wired
    // Conditional's test is met (wire the Conditional's Met output → Signal). The evaluator detects the
    // Manipulator→target→Conditional→Manipulator cycle and iterates it (bounded), so the target settles on
    // the value that satisfies the condition.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "signal", label: "Signal" }],
    valueOutputs: [{ key: "result", label: "Value" }],
    // Sweeps the driven value from Start toward End by Delta — Increment (up) or Decrement (down) — and
    // settles on the first value whose result meets the wired Conditional's test.
    defaultParams: { mode: "increment", delta: 0.5, start: 0, end: 20, value: 1 },
    fields: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "increment", label: "Increment (+Δ)" },
          { value: "decrement", label: "Decrement (−Δ)" },
          { value: "exact", label: "Exact Value" },
        ],
      },
      // Exact Value: drive the target with this fixed value (no sweep / condition).
      { key: "value", label: "Value", kind: "number", step: 0.1, showIf: (p) => p.mode === "exact" },
      { key: "delta", label: "Delta", kind: "number", step: 0.1, showIf: (p) => p.mode !== "exact" },
      { key: "start", label: "Start", kind: "number", step: 0.1, showIf: (p) => p.mode !== "exact" },
      { key: "end", label: "End", kind: "number", step: 0.1, showIf: (p) => p.mode !== "exact" },
    ],
    hint: "Feedback controller — drives a node's value-input, sweeping it from Start to End by Delta (Increment / Decrement) until a wired Conditional's test is met. Wire Value → a node's param, and a Conditional's Met → Signal.",
  },
  "bounding-shape": {
    type: "bounding-shape",
    label: "Bounding Shapes",
    color: "#059669",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Bounding Shapes block: minimum-enclosing Circle (Welzl), Ellipse (Khachiyan), or
    // regular n-gon (sides / angle / optimise orientation). Circle & ellipse take no parameters.
    defaultParams: { shape: "ngon", sides: 6, angle: 0, optimize: false },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "circle", label: "Circumcircle" },
          { value: "ellipse", label: "Min. ellipse" },
          { value: "ngon", label: "Regular n-gon" },
        ],
      },
      { key: "sides", label: "Sides (n)", kind: "range", min: 3, max: 12, step: 1, showIf: (p) => p.shape === "ngon" },
      // Orientation is meaningful only for the n-gon, and only when not auto-optimising.
      { key: "angle", label: "Angle", kind: "range", min: 0, max: 360, step: 0.5, unit: "°", showIf: (p) => p.shape === "ngon" && !p.optimize },
      { key: "optimize", label: "Optimise orientation", kind: "checkbox", showIf: (p) => p.shape === "ngon" },
    ],
    hint: "Fit the minimum enclosing circle / ellipse / regular n-gon around the input space.",
  },
  "convex-hull": {
    type: "convex-hull",
    label: "Convex Hull",
    color: "#0369a1",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Convex Hull block — the smallest convex polygon containing every vertex. No params.
    defaultParams: {},
    fields: [],
    hint: "Wrap the input space in its convex hull (smallest enclosing convex polygon).",
  },
  "convex-decomp": {
    type: "convex-decomp",
    label: "Convex Decomposition",
    color: "#6d28d9",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Convex Decomposition block — split a concave space into convex pieces by one of
    // four methods. Tolerance only applies to ACD. One output handle PER convex piece (like Split /
    // BSP): the piece count isn't known from params (it depends on the polygon), so the host bakes the
    // live count into `pieceCount`, which drives both the handle count and the compiled produces list.
    // "Outputs": per-piece handles, or a single bundle handle carrying every piece.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.pieceCount) || 1))),
    defaultParams: { type: "hertel-mehlhorn", tolerance: 10, neckRatio: 3, pieceCount: 1, outputMode: "perCell" },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "hertel-mehlhorn", label: "Hertel–Mehlhorn" },
          { value: "bayazit", label: "Bayazit" },
          { value: "acd", label: "ACD (approximate)" },
          { value: "steiner", label: "Steiner (edge extension)" },
          { value: "neck-cut", label: "Neck-cut (big blocks)" },
        ],
      },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per piece (one each)" },
          { value: "single", label: "Single (all pieces)" },
        ],
      },
      { key: "tolerance", label: "Tolerance", kind: "range", min: 0, max: 40, step: 0.5, unit: "°", showIf: (p) => p.type === "acd" },
      // Neck-cut: minimum boundary-arc / chord ratio to treat a pinch as a neck. Higher → fewer, larger
      // blocks (only the deepest waists cut).
      { key: "neckRatio", label: "Neck sensitivity", kind: "range", min: 1.5, max: 8, step: 0.1, showIf: (p) => p.type === "neck-cut" },
    ],
    hint: "Decompose a concave space — exact convex (Hertel–Mehlhorn / Bayazit / ACD / Steiner) or Neck-cut into a few large blocks at narrow waists.",
  },
  mesh: {
    type: "mesh",
    label: "Meshing",
    color: "#0f766e",
    // Triangulate / quad-mesh the space into cells — one output Space per triangle/quad. Mirrors the
    // Meshing block's Type. One handle per cell (host bakes the live count into `handleCount`); "single"
    // → one bundle handle for all cells.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(200, Math.round(Number(p.handleCount) || 1))),
    defaultParams: { type: "ear-clipping", outputMode: "perCell" },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "ear-clipping", label: "Ear clipping (triangles)" },
          { value: "cdt", label: "Delaunay (CDT)" },
          { value: "blossom-quad", label: "Blossom quad" },
        ],
      },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
    ],
    hint: "Mesh a space into cells (triangles / Delaunay / blossom quads) — one Space per cell.",
  },
  "circle-packing": {
    type: "circle-packing",
    label: "Circle Packing",
    color: "#0ea5e9",
    // Greedily inscribe N largest non-overlapping circles / regular n-gons inside the space → one Space
    // per shape. Mirrors the InCircles block (count, min radius, sides, rotation, optimise rotation).
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(50, Math.round(Number(p.handleCount) || 1))),
    valueInputs: [{ key: "count", label: "Count" }, { key: "minRadius", label: "Min radius" }],
    defaultParams: { count: 8, minRadius: 0.5, sides: 30, rotation: 0, optimizeRotation: true, outputMode: "perCell" },
    fields: [
      { key: "count", label: "Count", kind: "range", min: 1, max: 50, step: 1 },
      { key: "minRadius", label: "Min radius", kind: "range", min: 0, max: 20, step: 0.1, unit: "m" },
      // Sides per shape: 30 → true circles; 3–29 → inscribed regular n-gons.
      { key: "sides", label: "Sides", kind: "range", min: 3, max: 30, step: 1 },
      { key: "optimizeRotation", label: "Optimise rotation", kind: "checkbox", showIf: (p) => Number(p.sides) < 30 },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°", showIf: (p) => Number(p.sides) < 30 && !p.optimizeRotation },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per circle (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
    ],
    hint: "Pack the largest inscribed circles / n-gons into a space — one Space per shape (InCircles).",
  },
  treemap: {
    type: "treemap",
    label: "Squarified Treemap",
    color: "#0891b2",
    // Partition the space into `count` weighted rectangles with aspect ratios kept near 1 (squarified),
    // clipped to the outline (concave-safe), aligned to the principal axis (or a manual tilt). One Space
    // per cell.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(60, Math.round(Number(p.handleCount) || 1))),
    valueInputs: [{ key: "count", label: "Cells" }],
    defaultParams: { count: 6, tiltAngle: 0, weights: "", outputMode: "perCell", showOuterOpenings: false, outerOpeningWidth: 1.0, showInnerOpenings: false, innerOpeningWidth: 0.9 },
    fields: [
      { key: "count", label: "Cells", kind: "range", min: 1, max: 30, step: 1 },
      { key: "tiltAngle", label: "Tilt", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      // Relative area weights, one per cell (comma list). Short/empty → equal shares.
      { key: "weights", label: "Weights", kind: "text", placeholder: "1, 2, 1 (blank = equal)" },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
      { key: "showOuterOpenings", label: "Show outer openings", kind: "checkbox" },
      { key: "outerOpeningWidth", label: "Outer opening width", kind: "range", min: 0.3, max: 3, step: 0.05, unit: "m", showIf: (p) => Boolean(p.showOuterOpenings) },
      { key: "showInnerOpenings", label: "Show inner openings", kind: "checkbox" },
      { key: "innerOpeningWidth", label: "Inner opening width", kind: "range", min: 0.3, max: 3, step: 0.05, unit: "m", showIf: (p) => Boolean(p.showInnerOpenings) },
    ],
    hint: "Squarified treemap — pack N weighted, aspect-balanced rectangles into the space (concave-safe). One Space per cell.",
  },
  "rect-pack": {
    type: "rect-pack",
    label: "Rectangle Packing",
    color: "#ea580c",
    // Pack FIXED-size rectangles (one unit type) into the space — `count` items or fill (0). Grid-packed in
    // the principal-axis frame and clipped to the outline (concave-safe). One Space per placed rectangle.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(200, Math.round(Number(p.handleCount) || 1))),
    valueInputs: [{ key: "count", label: "Count" }],
    valueOutputs: [{ key: "placed", label: "Placed" }, { key: "utilization", label: "Utilization", unit: "%" }],
    defaultParams: { width: 6, height: 9, count: 0, gap: 0, placement: "grid", seed: 1, allowRotate: true, optimiseOrientation: false, alignToAxis: true, tilt: 0, outputMode: "perCell" },
    fields: [
      { key: "width", label: "Width", kind: "range", min: 0.5, max: 50, step: 0.1, unit: "m" },
      { key: "height", label: "Height", kind: "range", min: 0.5, max: 50, step: 0.1, unit: "m" },
      { key: "count", label: "Count (0 = fill)", kind: "range", min: 0, max: 200, step: 1 },
      { key: "gap", label: "Gap", kind: "range", min: 0, max: 10, step: 0.05, unit: "m" },
      // Placement: a regular grid, or "random" — scatter rectangles at random positions/angles, packing
      // hard (rejecting overlaps) until full.
      {
        key: "placement",
        label: "Placement",
        kind: "select",
        options: [
          { value: "grid", label: "Grid" },
          { value: "random", label: "Random" },
        ],
      },
      { key: "seed", label: "Seed", kind: "number", min: 1, step: 1, showIf: (p) => p.placement === "random" },
      { key: "allowRotate", label: "Allow rotation", kind: "checkbox" },
      // Grid only: sweep the packing angle (0–90°) and keep whichever orientation fits the most.
      { key: "optimiseOrientation", label: "Optimise orientation", kind: "checkbox", showIf: (p) => p.placement !== "random" },
      // Orient the grid (or the random base angle when rotation is off) to the principal axis, or a manual tilt.
      { key: "alignToAxis", label: "Align to axis", kind: "checkbox", showIf: (p) => p.placement === "random" || !p.optimiseOrientation },
      { key: "tilt", label: "Tilt", kind: "range", min: 0, max: 180, step: 1, unit: "°", showIf: (p) => (p.placement === "random" || !p.optimiseOrientation) && p.alignToAxis === false },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per rect (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
    ],
    hint: "Pack fixed-size rectangles (units) into the space — Grid (aligned/optimised) or Random (scattered, any angle). Count or fill, with gap. Outputs placed count + utilization %.",
  },
  point: {
    type: "point",
    label: "Point",
    color: "#ca8a04",
    // Value source: an (x, y) point in metres. Publishes val-x / val-y for wiring (e.g. a Visibility
    // Polygon viewer offset). No geometry of its own.
    hasInput: false,
    hasOutput: false,
    valueOutputs: [{ key: "x", label: "X", unit: "m" }, { key: "y", label: "Y", unit: "m" }],
    defaultParams: { x: 0, y: 0 },
    fields: [
      { key: "x", label: "X", kind: "range", min: -50, max: 50, step: 0.1, unit: "m" },
      { key: "y", label: "Y", kind: "range", min: -50, max: 50, step: 0.1, unit: "m" },
    ],
    hint: "An (x, y) point in metres — feeds val-x / val-y (e.g. a Visibility viewer offset).",
  },
  visibility: {
    type: "visibility",
    label: "Visibility Polygon",
    color: "#65a30d",
    // Visibility region of the space from a viewer (point mode: centroid + (x,y) metre offset — wireable
    // from a Point node) or sampled along an edge (segment mode → a region per sample). Mirrors the block.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => (p.mode !== "segment" || p.outputMode === "single") ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.handleCount) || 1))),
    valueInputs: [{ key: "x", label: "Viewer X" }, { key: "y", label: "Viewer Y" }],
    defaultParams: { mode: "point", x: 0, y: 0, edgeIndex: 0, outputMode: "single" },
    fields: [
      {
        key: "mode",
        label: "Type",
        kind: "select",
        options: [
          { value: "point", label: "Point (viewer)" },
          { value: "segment", label: "Segment (edge)" },
        ],
      },
      // Viewer offset from the space centroid, in metres (0,0 = centroid). Wire a Point node here.
      { key: "x", label: "Viewer X", kind: "range", min: -50, max: 50, step: 0.1, unit: "m", showIf: (p) => p.mode !== "segment" },
      { key: "y", label: "Viewer Y", kind: "range", min: -50, max: 50, step: 0.1, unit: "m", showIf: (p) => p.mode !== "segment" },
      { key: "edgeIndex", label: "Edge", kind: "range", min: 0, max: 19, step: 1, showIf: (p) => p.mode === "segment" },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "single", label: "Single (all)" },
          { value: "perCell", label: "Per sample (one each)" },
        ],
        showIf: (p) => p.mode === "segment",
      },
    ],
    hint: "Visibility polygon from a viewer point (offset from centroid) or sampled along an edge.",
  },
  smoothing: {
    type: "smoothing",
    label: "Smoothing",
    color: "#9f1239",
    hasInput: true,
    hasOutput: true,
    // Multi-space: smooths EVERY connected space, emitting one output handle (out-i) per input space.
    // The host bakes the live input count into `inputCount`. "Outputs": per-space handles, or a single
    // bundle handle. 1 input → 1 output (unchanged single-space behaviour).
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.inputCount) || 1))),
    // Mirrors the Smoothing block: Chaikin corner-cutting or Bézier corner fillets, a smoothing
    // level, restrict-inside reflex handling, and a post curve-shortening pass.
    defaultParams: { type: "chaikin", level: 0.4, restrictInside: false, curveShortening: 0, outputMode: "perCell" },
    fields: [
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { value: "chaikin", label: "Chaikin corner" },
          { value: "bezier", label: "Bézier fillet" },
        ],
      },
      { key: "level", label: "Smoothing level", kind: "range", min: 0, max: 1, step: 0.02 },
      { key: "restrictInside", label: "Restrict inside polygon", kind: "checkbox" },
      { key: "curveShortening", label: "Curved shortening", kind: "range", min: 0, max: 100, step: 1, unit: "%" },
      // One handle per smoothed space, or a single bundle handle. Only meaningful with several inputs.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per space (one each)" },
          { value: "single", label: "Single (all spaces)" },
        ],
        showIf: (p) => Math.round(Number(p.inputCount) || 1) > 1,
      },
    ],
    hint: "Smooth the space boundary (Chaikin / Bézier), optionally kept inside + curve-shortened.",
  },
  contour: {
    type: "contour",
    label: "Contour",
    color: "#0e7490",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Contour block — nested inward-offset rings (topographic contours) at a fixed
    // interval, up to a max number of levels. Each ring is one output polygon.
    defaultParams: { interval: 0.5, maxLevels: 12 },
    fields: [
      { key: "interval", label: "Interval", kind: "range", min: 0.05, max: 10, step: 0.05, unit: "m" },
      { key: "maxLevels", label: "Max levels", kind: "range", min: 1, max: 30, step: 1 },
    ],
    hint: "Generate nested inward-offset contour rings at a fixed interval.",
  },
  "floor-massing": {
    type: "floor-massing",
    label: "Massing",
    color: "#475569",
    hasInput: true,
    hasOutput: true,
    // Tags the input space with a massing type + floor count (no geometry change). Upward → Footprint
    // Area (extrudes up); Downward → Basement Area (extrudes down). `n` is the floor count, and can be
    // driven by a wired-in value (e.g. a computed floor count) via the `n` value input.
    // Multi-space: tags EVERY connected space and passes each through — one output handle per input
    // space (host bakes the live count into `inputCount`). "single" → one bundle handle for all spaces.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.inputCount) || 1))),
    valueInputs: [{ key: "n", label: "Floors" }],
    // Floor count exposed as a scalar output (right) so it can feed Output Metrics / Math, etc. Mirrors
    // the resolved `n` (a wired-in value overrides the slider).
    valueOutputs: [{ key: "floors", label: "Floors", alignField: "n" }],
    defaultParams: { direction: "upward", n: 1, random: false, seed: 1, outputMode: "perCell", taper: "none", tierFloors: 4, setbackM: 2, tierAreaRatio: 0.85 },
    fields: [
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "upward", label: "Upward (Footprint)" },
          { value: "downward", label: "Downward (Basement)" },
        ],
      },
      // Taper / setback: step the footprint inward every `tierFloors` floors so the tower steps back as
      // it rises. Each tier is derived from the one below (always contained, area non-increasing).
      {
        key: "taper",
        label: "Taper",
        kind: "select",
        options: [
          { value: "none", label: "None (prism)" },
          { value: "setback", label: "Setback (m per tier)" },
          { value: "area-ratio", label: "Area ratio per tier" },
        ],
      },
      { key: "tierFloors", label: "Floors per tier", kind: "range", min: 1, max: 20, step: 1, showIf: (p) => p.taper !== "none" },
      { key: "setbackM", label: "Setback / tier", kind: "range", min: 0, max: 20, step: 0.1, unit: "m", showIf: (p) => p.taper === "setback" },
      { key: "tierAreaRatio", label: "Area ratio / tier", kind: "range", min: 0.1, max: 0.99, step: 0.01, showIf: (p) => p.taper === "area-ratio" },
      // Random floors: auto-pick a stable random floor count in [1, 30] per space (re-roll bumps seed).
      { key: "random", label: "Random floors (1–30)", kind: "checkbox" },
      { key: "seed", label: "Seed", kind: "number", min: 1, step: 1, showIf: (p) => Boolean(p.random) },
      // Manual floor count — hidden when Random is on (the count is auto-generated).
      { key: "n", label: "Floors (n)", kind: "range", min: 1, max: 50, step: 1, showIf: (p) => !p.random },
      // One handle per input space, or a single bundle handle. Only meaningful with several input spaces.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per space (one each)" },
          { value: "single", label: "Single (all spaces)" },
        ],
        showIf: (p) => Math.round(Number(p.inputCount) || 1) > 1,
      },
    ],
    hint: "Set the space as Footprint (up) / Basement (down) Area with n floors.",
  },
  "graph-source": {
    type: "graph-source",
    label: "Graph",
    color: "#1e3a8a",
    // Generator: emits one or more graphs (connected segment networks) as polylines to feed the
    // Graph nodes. References graphs by display id (GraphNNN); with grab on, the host keeps `id` synced to
    // the graph currently selected (Select tool → "Graph" scope). Outputs one handle per referenced graph
    // ("single" → one bundle), so it can output multiple graphs at once. The input endpoint accepts a
    // Schema node (attaches Node/Segment/Graph Schema properties to the graph's components); geometry
    // still comes from the canvas — incoming geometry is ignored.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(40, Math.round(Number(p.handleCount) || 1))),
    defaultParams: { id: "", grabFromSelection: true, outputMode: "perCell" },
    fields: [
      { key: "grabFromSelection", label: "Grab ID from selection", kind: "checkbox" },
      // Editable Graph id(s), comma-separated. Hidden while grabbing (the host overwrites it from the
      // selected graph) and shown as a readout instead.
      { key: "id", label: "ID", kind: "text", placeholder: "graph id (e.g. Graph001)", showIf: (p) => !p.grabFromSelection },
      // Output style: one handle per referenced graph, or a single bundle handle carrying every graph.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per graph (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
    ],
    hint: "Pipeline input — selected graph(s) by id (Select → Graph scope, or grab from selection). Outputs one handle per graph. Feeds Mitered Join / Graph Smoothing / Graph Metrics.",
  },
  "segment-source": {
    type: "segment-source",
    label: "Segment",
    color: "#0f766e",
    // Generator (no input): emits the selected segment(s) as polylines (each wall = a 2-point polyline),
    // mirroring Graph but scoped to individually-selected segments (Select → Segment scope) rather than a
    // connected component. References segments by display id (SegmentNNN, comma-separated for several);
    // with grab on, the host keeps `id` synced to the current segment selection. Outputs one handle per
    // segment ("single" → one bundle). Feeds Mitered Join / Graph Smoothing / Graph Metrics like a graph.
    hasInput: false,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(60, Math.round(Number(p.handleCount) || 1))),
    defaultParams: { id: "", grabFromSelection: true, outputMode: "single" },
    fields: [
      { key: "grabFromSelection", label: "Grab ID from selection", kind: "checkbox" },
      { key: "id", label: "ID", kind: "text", placeholder: "segment id (e.g. Segment001)", showIf: (p) => !p.grabFromSelection },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "single", label: "Single (all)" },
          { value: "perCell", label: "Per segment (one each)" },
        ],
      },
    ],
    hint: "Pipeline input — selected segment(s) by id (Select → Segment scope, or grab from selection). Emits each as a polyline; feeds Mitered Join / Graph Smoothing / Graph Metrics.",
  },
  "node-source": {
    type: "node-source",
    label: "Node",
    color: "#4f46e5",
    // Generator (no input): emits the selected canvas node(s) — junction points — as single points,
    // mirroring Segment but for points (Select → Node scope). References nodes by display id (NodeNNN,
    // comma-separated for several); with grab on, the host keeps `id` synced to the node selection.
    // Outputs one handle per node ("single" → one bundle). Feeds Buffer (point → disk Space).
    // STAMP input: wire a Footing → Footing to 2D Plan / Elevation / 3D Mesh (or any origin-relative
    // drawing/mesh) here and the node STAMPS a copy at each of its point(s) — placement by location.
    hasInput: false,
    hasOutput: true,
    geomInputs: [{ key: "stamp", label: "Stamp" }],
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(60, Math.round(Number(p.handleCount) || 1))),
    defaultParams: { id: "", grabFromSelection: true, outputMode: "single" },
    fields: [
      { key: "grabFromSelection", label: "Grab ID from selection", kind: "checkbox" },
      { key: "id", label: "ID", kind: "text", placeholder: "node id (e.g. Node001)", showIf: (p) => !p.grabFromSelection },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "single", label: "Single (all)" },
          { value: "perCell", label: "Per node (one each)" },
        ],
      },
    ],
    hint: "Pipeline input — selected node(s)/point(s) by id (Select → Node scope, or grab from selection). Emits each as a point; feed into Buffer to get a disk Space.",
  },
  "canvas-source": {
    type: "canvas-source",
    label: "Canvas",
    color: "#0891b2",
    // Generator: the whole canvas, exposed as five typed output endpoints. Each endpoint carries EVERY
    // item of its kind (multiple), so downstream nodes can consume all spaces / nodes / segments / graphs
    // / image footprints at once. Independent of the current selection. The input endpoint accepts a
    // Schema node (attaches Node/Segment/Graph Schema properties to the canvas components); geometry still
    // comes from the canvas — any incoming geometry is ignored.
    hasInput: true,
    hasOutput: true,
    outputCount: () => 5,
    outputLabels: ["Spaces", "Nodes", "Segments", "Graph", "Images"],
    defaultParams: {},
    fields: [],
    hint: "The whole canvas as five outputs — Spaces, Nodes, Segments, Graph, Images (footprints). Each carries every item of its kind. Independent of selection.",
  },
  separate: {
    type: "separate",
    label: "Separate",
    color: "#0e7490",
    // Fan-out: takes ONE input bundle (multiple items — spaces / segments / graphs / points) and exposes
    // each item on its own output endpoint (out-0, out-1, …). The live item count is baked into
    // `handleCount` so the number of output handles tracks the input.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => Math.max(1, Math.min(80, Math.round(Number(p.handleCount) || 1))),
    defaultParams: {},
    fields: [],
    hint: "Fan a multi-item input out to one output endpoint per item (e.g. Canvas → Spaces → one handle per space). Feeds each item downstream individually.",
  },
  "segment-split": {
    type: "segment-split",
    label: "Split Segment",
    color: "#0d9488",
    // Segment node: cuts each incoming segment (open polyline) into pieces — mirrors the Segment tools'
    // Splitting. Modes: "length" (equal pieces of Piece length m, remainder kept), "ratio" (a comma
    // ratio list → one piece per entry), "strip" (a centred strip of Strip length at Position% → up to
    // 3 pieces: before / strip / after). One output handle per piece, or a single bundle.
    hasInput: true,
    hasOutput: true,
    // Piece count depends on geometry (length / strip modes), so the host bakes the live count into
    // `handleCount`; ratio mode is known from the list. "single" → one bundle handle.
    outputCount: (p) => {
      if (p.outputMode === "single") return 1;
      const baked = Number(p.handleCount);
      if (Number.isFinite(baked) && baked >= 1) return Math.min(60, Math.round(baked));
      if (p.mode === "ratio") { const n = parseSplitRatios(p.ratios).length; if (n >= 1) return Math.max(1, Math.min(40, n)); }
      if (p.mode === "strip") return 3;
      return 2;
    },
    // Scalar inputs: Piece length / Strip length (m) and Position (%) are wireable; Ratios is a text
    // list, so a wired number is coerced to its string form (and not echoed back to the box).
    valueInputs: [
      { key: "pieceLength", label: "Piece length" },
      { key: "ratios", label: "Ratios" },
      { key: "stripLength", label: "Strip length" },
      { key: "stripPosition", label: "Position" },
    ],
    defaultParams: { mode: "length", pieceLength: 1, ratios: "1, 2, 1", stripLength: 1, stripPosition: 50, outputMode: "perCell" },
    fields: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "length", label: "Based on Length" },
          { value: "ratio", label: "Based on Ratio" },
          { value: "strip", label: "Based on Strip Length" },
        ],
      },
      // Length mode: each piece is this long (metres); the final shorter remainder is kept.
      { key: "pieceLength", label: "Piece length", kind: "range", min: 0.05, max: 50, step: 0.05, unit: "m", showIf: (p) => p.mode !== "ratio" && p.mode !== "strip" },
      // Ratio mode: comma list → one piece per entry, sized proportionally along the segment.
      { key: "ratios", label: "Ratios", kind: "text", placeholder: "1, 2, 1", showIf: (p) => p.mode === "ratio" },
      // Strip mode: a centred strip of this length (metres) at the position below; outer remainders kept.
      { key: "stripLength", label: "Strip length", kind: "range", min: 0.05, max: 50, step: 0.05, unit: "m", showIf: (p) => p.mode === "strip" },
      { key: "stripPosition", label: "Position", kind: "range", min: 0, max: 100, step: 1, unit: "%", showIf: (p) => p.mode === "strip" },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per piece (one each)" },
          { value: "single", label: "Single (all pieces)" },
        ],
      },
    ],
    hint: "Split each incoming segment into pieces — Based on Length (equal pieces, remainder kept), Based on Ratio (proportional list), or Based on Strip Length (a centred strip + outer remainders). One handle per piece, or a single bundle.",
  },
  buffer: {
    type: "buffer",
    label: "Buffer",
    color: "#0d9488",
    // Segment node: thickens an incoming graph/segment (polylines) into a Space by buffering every
    // segment by `radius` metres (Minkowski sum with a disk — round caps + round joins) and unioning the
    // result into a single closed polygon. Output = a Space (≥3 pts), so it feeds the Space pipeline.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "radius", label: "Radius" }],
    defaultParams: { radius: 0.5, capStyle: "capsule" },
    fields: [
      { key: "radius", label: "Radius", kind: "range", min: 0.05, max: 10, step: 0.05, unit: "m" },
      // Cap style at the segment ends: Capsule = round caps; Square = flat caps extended by the radius
      // (sharp rectangular ends); Flat = butt caps flush at the segment endpoints (no extension).
      {
        key: "capStyle",
        label: "Style",
        kind: "select",
        options: [
          { value: "capsule", label: "Capsule (round)" },
          { value: "square", label: "Square (extended)" },
          { value: "flat", label: "Flat (butt)" },
        ],
      },
    ],
    hint: "Buffer a segment/graph by a radius → a Space. Style: Capsule (round caps), Square (extended flat caps), or Flat (butt caps). Feeds the Space pipeline.",
  },
  bloom: {
    type: "bloom",
    label: "Bloom",
    color: "#7c3aed",
    // Node node: grows each incoming point (a node) into an n-gon Space of `sides` sides at `radius`.
    // Regular → a uniform polygon; Irregular → vertices jittered by `jitter` (deterministic per `seed`).
    // When sides = 4 the polygon is a rectangle sized by `width` × `height` (radius is ignored).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "radius", label: "Radius" }, { key: "sides", label: "Sides" }],
    defaultParams: { form: "polygon", radius: 1, sides: 6, regularity: "regular", width: 2, height: 2, rotation: 0, jitter: 0.3, seed: 1 },
    fields: [
      // Output form: an n-gon Polygon, a Circle (radius), or an Ellipse (width × height axes).
      {
        key: "form",
        label: "Form",
        kind: "select",
        options: [
          { value: "polygon", label: "Polygon" },
          { value: "circle", label: "Circle" },
          { value: "ellipse", label: "Ellipse" },
        ],
      },
      { key: "sides", label: "Sides", kind: "range", min: 3, max: 16, step: 1, showIf: (p) => (p.form ?? "polygon") === "polygon" },
      // Radius = circumradius for a Polygon (non-4-gon) and the Circle's radius.
      { key: "radius", label: "Radius", kind: "range", min: 0.05, max: 10, step: 0.05, unit: "m", showIf: (p) => { const f = p.form ?? "polygon"; return f === "circle" || (f === "polygon" && Number(p.sides) !== 4); } },
      // Width/Height = rectangle for a 4-gon Polygon, and the two axes (diameters) for an Ellipse.
      { key: "width", label: "Width", kind: "range", min: 0.05, max: 20, step: 0.05, unit: "m", showIf: (p) => { const f = p.form ?? "polygon"; return f === "ellipse" || (f === "polygon" && Number(p.sides) === 4); } },
      { key: "height", label: "Height", kind: "range", min: 0.05, max: 20, step: 0.05, unit: "m", showIf: (p) => { const f = p.form ?? "polygon"; return f === "ellipse" || (f === "polygon" && Number(p.sides) === 4); } },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      // Regular vs jittered — Polygon only (a circle/ellipse is always smooth).
      {
        key: "regularity",
        label: "Shape",
        kind: "select",
        showIf: (p) => (p.form ?? "polygon") === "polygon",
        options: [
          { value: "regular", label: "Regular" },
          { value: "irregular", label: "Irregular" },
        ],
      },
      // Irregular only: how far vertices are perturbed (0 = none) and a seed for the deterministic jitter.
      { key: "jitter", label: "Jitter", kind: "range", min: 0, max: 1, step: 0.05, showIf: (p) => (p.form ?? "polygon") === "polygon" && p.regularity === "irregular" },
      { key: "seed", label: "Seed", kind: "range", min: 1, max: 999, step: 1, showIf: (p) => (p.form ?? "polygon") === "polygon" && p.regularity === "irregular" },
    ],
    hint: "Grow each input node/point into a Space — Polygon (n-gon; 4 sides → width × height rectangle; regular or irregular), Circle (radius), or Ellipse (width × height). Feeds the Space pipeline.",
  },
  pull: {
    type: "pull",
    label: "Pull",
    color: "#ca8a04",
    // Space node: pull two Spaces together (or apart). Main input = Space A; second input (gin-b) = Space B.
    // Returns the two transformed Spaces on out-0 (A) and out-1 (B). Mirrors the Connection-segment Pull.
    hasInput: true,
    hasOutput: true,
    outputCount: () => 2,
    outputLabels: ["A", "B"],
    geomInputs: [{ key: "b", label: "Space B" }],
    valueInputs: [{ key: "distance", label: "Distance" }],
    defaultParams: { mode: "touch", contact: "point", anchor: "both", distance: 0.5, edgeSlide: true },
    fields: [
      {
        key: "mode", label: "Mode", kind: "select",
        options: [
          { value: "touch", label: "Touch" },
          { value: "distance", label: "Distance (gap)" },
          { value: "centroid", label: "Centroid" },
        ],
      },
      // Contact + Edge slide only matter when the move isn't a pure centroid slam.
      {
        key: "contact", label: "Contact", kind: "select", showIf: (p) => p.mode !== "centroid",
        options: [
          { value: "point", label: "Point (closest)" },
          { value: "edge-flush", label: "Edge flush" },
        ],
      },
      { key: "distance", label: "Gap", kind: "range", min: 0, max: 10, step: 0.05, unit: "m", showIf: (p) => p.mode === "distance" },
      {
        key: "anchor", label: "Move", kind: "select",
        options: [
          { value: "both", label: "Both" },
          { value: "A", label: "A only" },
          { value: "B", label: "B only" },
        ],
      },
      { key: "edgeSlide", label: "Edge slide", kind: "checkbox", showIf: (p) => p.mode !== "centroid" && p.contact === "edge-flush" },
    ],
    hint: "Pull two Spaces together/apart — Touch, a Distance gap, or Centroid; Point or Edge-flush contact; move A / B / both. Inputs: Space A (main) + Space B; outputs the two new Spaces.",
  },
  transform: {
    type: "transform",
    label: "Transform",
    color: "#7e22ce",
    // Space node: affine-transform every input Space — Scale → Mirror → Rotate about an Anchor, then
    // Translate. Multiple Spaces in → the transformed Spaces out (one bundle).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "rotate", label: "Rotate" }, { key: "scale", label: "Scale" }],
    defaultParams: { translateX: 0, translateY: 0, rotate: 0, scale: 1, mirror: "none", mirrorAngle: 0, mirrorEdge: 0, anchor: "each-centroid", anchorVertex: 0 },
    fields: [
      { key: "translateX", label: "Move X", kind: "range", min: -50, max: 50, step: 0.1, unit: "m" },
      { key: "translateY", label: "Move Y", kind: "range", min: -50, max: 50, step: 0.1, unit: "m" },
      { key: "rotate", label: "Rotate", kind: "range", min: -180, max: 180, step: 1, unit: "°" },
      { key: "scale", label: "Scale", kind: "range", min: 0.1, max: 5, step: 0.05 },
      {
        key: "mirror", label: "Mirror", kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "x", label: "Across X" },
          { value: "y", label: "Across Y" },
          { value: "custom", label: "Custom line" },
          { value: "edge", label: "Across edge" },
        ],
      },
      { key: "mirrorAngle", label: "Mirror angle", kind: "range", min: 0, max: 180, step: 1, unit: "°", showIf: (p) => p.mirror === "custom" },
      // "Across edge": reflect across this space's edge #N (wraps; 0 = first edge). Great for mirroring a
      // unit across a shared wall.
      { key: "mirrorEdge", label: "Edge #", kind: "range", min: 0, max: 50, step: 1, showIf: (p) => p.mirror === "edge" },
      // Pivot for scale/rotate (and the x/y/custom mirror): each space's centre, a chosen vertex, the
      // group's centre, or world origin.
      {
        key: "anchor", label: "Anchor", kind: "select",
        options: [
          { value: "each-centroid", label: "Each centroid" },
          { value: "vertex", label: "Vertex" },
          { value: "group-centroid", label: "Group centroid" },
          { value: "origin", label: "Origin (0,0)" },
        ],
      },
      { key: "anchorVertex", label: "Vertex #", kind: "range", min: 0, max: 50, step: 1, showIf: (p) => p.anchor === "vertex" },
    ],
    hint: "Translate / Rotate / Scale / Mirror every input Space. Anchor = pivot for scale/rotate (centroid, a vertex, group, or origin). Mirror across X/Y/a custom line/a chosen edge. Multiple Spaces in → transformed Spaces out.",
  },
  "mitered-join": {
    type: "mitered-join",
    label: "Mitered Join",
    color: "#b45309",
    // Graph node: strokes an incoming GRAPH (polylines — e.g. Skeleton in Branches mode) into a closed
    // ribbon of `width` metres, mitred at shared endpoints (junctions). Output = the ribbon polygons.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "width", label: "Width" }],
    // Output handles: "single" → one endpoint carrying every ribbon Space; "perCell" → one endpoint per
    // ribbon Space (baked live into `handleCount`). Union collapses to a single Space → one handle either way.
    outputCount: (p) => (p.getOuterBoundary || p.union || p.outputMode === "single") ? 1 : Math.max(1, Math.min(60, Math.round(Number(p.handleCount) || 1))),
    // Optional second geometry input: the Space to clip the ribbon to (id `gin-boundary`). Unwired →
    // falls back to auto-detecting the upstream Skeleton's source space.
    geomInputs: [{ key: "boundary", label: "Clip space" }],
    defaultParams: { width: 2, useSameWidth: true, join: "sharp", clipToBoundary: true, union: false, getOuterBoundary: false, outputMode: "perCell" },
    fields: [
      // Use same width for all: checked → the Width slider drives every segment; unchecked → each segment
      // is stroked at its own canvas thickness (segment properties), and the slider is hidden.
      { key: "useSameWidth", label: "Use same width for all", kind: "checkbox" },
      { key: "width", label: "Width", kind: "range", min: 0.1, max: 20, step: 0.1, unit: "m", showIf: (p) => p.useSameWidth !== false },
      // Output style: separate per-Space handles, or a single bundle handle carrying every ribbon Space.
      // Hidden when Union is on (the result is already a single Space).
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        showIf: (p) => !p.union && !p.getOuterBoundary,
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
      // Joint type at junctions/corners: Sharp = mitred corners; Curved = rounded (Chaikin) corners;
      // Rectangular = plain segment rectangles + a square box at each junction (no mitre).
      {
        key: "join",
        label: "Joint type",
        kind: "select",
        options: [
          { value: "sharp", label: "Sharp (mitred)" },
          { value: "curved", label: "Curved (rounded)" },
          { value: "rectangular", label: "Rectangular (boxed joints)" },
        ],
      },
      // Trim the ribbon to the source space so leaf-branch end-caps don't poke past the boundary.
      { key: "clipToBoundary", label: "Clip to boundary", kind: "checkbox", showIf: (p) => !p.getOuterBoundary },
      // Union: fuse the per-segment ribbon polygons into ONE Space (single outline) instead of emitting
      // each segment separately.
      { key: "union", label: "Union", kind: "checkbox", showIf: (p) => !p.getOuterBoundary },
      // Get Outer Boundary: instead of the ribbon, output the single closed Space bounded by the OUTER
      // edge of the joined segments (one space on the endpoint). Works for Sharp and Rectangular joints.
      { key: "getOuterBoundary", label: "Get Outer Boundary", kind: "checkbox" },
    ],
    hint: "Stroke a graph (polylines / Skeleton branches) into a ribbon of a set width — sharp, curved, or rectangular (boxed) joints. Clip to boundary trims ends to the source space; Union merges the segments into a single Space; Get Outer Boundary returns the single space bounded by the joined ribbon's outer edge.",
  },
  "graph-smooth": {
    type: "graph-smooth",
    label: "Graph Smoothing",
    color: "#9d174d",
    // Graph node: smooths each polyline of an incoming graph. "Through vertices" = interpolating
    // (Catmull-Rom, the curve passes through the nodes); off = approximating (Chaikin, stays away).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "level", label: "Smoothness" }],
    defaultParams: { interpolate: true, level: 2 },
    fields: [
      { key: "interpolate", label: "Through vertices", kind: "checkbox" },
      { key: "level", label: "Smoothness", kind: "range", min: 1, max: 8, step: 1 },
    ],
    hint: "Smooth a graph's polylines — through the vertices (NURBS/Catmull-Rom) or away from them (Chaikin).",
  },
  "graph-metrics": {
    type: "graph-metrics",
    label: "Graph Metrics",
    color: "#0e7490",
    // Calculator: reads an incoming GRAPH (polylines — e.g. Skeleton branches / Selected Graph) and
    // measures its topology. Forwards the graph unchanged on the main output so it can continue
    // downstream; every metric is also published as a value-OUT for wiring into other nodes / Output.
    hasInput: true,
    hasOutput: true,
    valueOutputs: [
      { key: "nodes", label: "Nodes" },          // unique vertices (endpoints / junctions)
      { key: "edges", label: "Edges" },          // unique segments between nodes
      { key: "faces", label: "Faces" },          // bounded regions = cyclomatic number E−V+C (planar)
      { key: "components", label: "Components" }, // disconnected sub-graphs
      { key: "leaves", label: "Leaves" },        // degree-1 nodes (branch tips)
      { key: "junctions", label: "Junctions" },  // degree-≥3 nodes (where branches meet)
      { key: "length", label: "Total length", unit: "m" },
    ],
    defaultParams: {},
    fields: [],
    hint: "Measure an incoming graph: nodes, edges, faces, components, leaves, junctions, total length. Forwards the graph on.",
  },
  "show-direction": {
    type: "show-direction",
    label: "Show Direction",
    color: "#0369a1",
    // Graph node: orient the incoming graph as a flow — Diverging (out of a root source) or Converging
    // (into a root sink) — and draw arrowheads along each edge. Arrow direction = flow direction; arrow
    // size = flow level (downstream accumulation, or BFS depth). Forwards the graph unchanged.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "arrowSize", label: "Arrow size" }],
    defaultParams: { mode: "diverging", root: "auto", levelMetric: "accumulation", arrowSize: 0.6, scaleByLevel: true },
    fields: [
      {
        key: "mode", label: "Flow", kind: "select",
        options: [
          { value: "diverging", label: "Diverging (out)" },
          { value: "converging", label: "Converging (in)" },
        ],
      },
      // Which node is the source (diverging) / sink (converging).
      {
        key: "root", label: "Source / Sink", kind: "select",
        options: [
          { value: "auto", label: "Auto (a leaf)" },
          { value: "top", label: "Topmost" },
          { value: "bottom", label: "Bottommost" },
          { value: "left", label: "Leftmost" },
          { value: "right", label: "Rightmost" },
          { value: "center", label: "Centremost" },
        ],
      },
      {
        key: "levelMetric", label: "Level", kind: "select",
        options: [
          { value: "accumulation", label: "Accumulation (downstream)" },
          { value: "depth", label: "Depth (from root)" },
        ],
      },
      { key: "arrowSize", label: "Arrow size", kind: "range", min: 0.1, max: 3, step: 0.05, unit: "m" },
      { key: "scaleByLevel", label: "Scale by level", kind: "checkbox" },
    ],
    hint: "Show flow direction on a graph — Diverging out of / Converging into a root, with arrows whose size tracks the flow level (downstream accumulation or depth). Forwards the graph on.",
  },
  dimension: {
    type: "dimension",
    label: "Linear Dimension",
    color: "#1d4ed8",
    // Space node: dimension the EDGES of the incoming Space — each edge gets its own length dimension,
    // placed Outer (outside the space) or inner, standing off by Offset. Mode "All edges" dimensions every
    // edge; "Edgewise" dimensions only the ticked edges. The Space is forwarded unchanged downstream.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "offset", label: "Offset" }],
    defaultParams: { outer: true, offset: 1, mode: "all", edges: "", style: "ticks", units: "metric", extension: 0.3, precision: 2 },
    fields: [
      // Outer = place the dimension OUTSIDE the space's edge; unchecked = inside.
      { key: "outer", label: "Outer", kind: "checkbox" },
      // Standoff from the edge to the dimension line (m).
      { key: "offset", label: "Offset", kind: "range", min: 0, max: 10, step: 0.1, unit: "m" },
      // End-marker style at each dimension-line end.
      {
        key: "style",
        label: "Style",
        kind: "select",
        options: [
          { value: "ticks", label: "Ticks (45°)" },
          { value: "arrowhead", label: "Arrowheads" },
          { value: "dot", label: "Dots" },
        ],
      },
      // All edges → dimension every edge; Edgewise → only the ticked edges (checkbox grid, rendered on the node).
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "all", label: "All edges" },
          { value: "edgewise", label: "Edgewise (pick edges)" },
        ],
      },
      // Dimension text format: metric metres or architectural feet-inches (to nearest 1/8").
      {
        key: "units",
        label: "Units",
        kind: "select",
        options: [
          { value: "metric", label: "Metric (m)" },
          { value: "imperial", label: "Feet-inches" },
        ],
      },
      // How far the witness lines overrun the dimension line (m).
      { key: "extension", label: "Witness overrun", kind: "range", min: 0, max: 2, step: 0.05, unit: "m" },
      // Decimal places on metric dimension text.
      { key: "precision", label: "Decimals", kind: "range", min: 0, max: 4, step: 1, showIf: (p) => p.units !== "imperial" },
    ],
    hint: "Dimension a Space's edges — Outer/inner placement at an Offset. All edges, or Edgewise to tick which edges. Forwards the Space on.",
  },
  "graph-to-grid": {
    type: "graph-to-grid",
    label: "Graph to Grid",
    color: "#7c3aed",
    // Grid generator: lays an m × n lattice over the input graph's (or space's) bounding box and emits it
    // as a graph (segments) that chains downstream. The grid's nodes are drawn at "Node size" px and its
    // segments stroked at "Segment width" px (the two values given to nodes vs segments).
    hasInput: true,
    hasOutput: true,
    valueInputs: [
      { key: "m", label: "Columns" },
      { key: "n", label: "Rows" },
      { key: "nodeValue", label: "Node size" },
      { key: "segmentValue", label: "Segment width" },
    ],
    defaultParams: {
      m: 4, n: 3, nodeValue: 3, segmentValue: 1,
      colorCells: false, nodeCellValue: 1, segmentCellValue: 0.5,
      nodeCellColor: "#ef4444", segmentCellColor: "#3b82f6", showCellValues: false,
    },
    fields: [
      { key: "m", label: "Columns (m)", kind: "range", min: 1, max: 60, step: 1 },
      { key: "n", label: "Rows (n)", kind: "range", min: 1, max: 60, step: 1 },
      // The value given to grid NODES (intersection dot size, px) and to grid SEGMENTS (line width, px).
      { key: "nodeValue", label: "Node size (px)", kind: "range", min: 0, max: 12, step: 0.5 },
      { key: "segmentValue", label: "Segment width (px)", kind: "range", min: 0.5, max: 8, step: 0.5 },
      // Cell occupancy colouring: classify each cell by what falls in it — a graph NODE (vertex) or a
      // graph SEGMENT passing through — and fill it with the matching value/colour.
      { key: "colorCells", label: "Colour cells", kind: "checkbox" },
      { key: "nodeCellValue", label: "Node-cell value", kind: "number", showIf: (p) => p.colorCells === true },
      { key: "nodeCellColor", label: "Node-cell colour", kind: "color", showIf: (p) => p.colorCells === true },
      { key: "segmentCellValue", label: "Segment-cell value", kind: "number", showIf: (p) => p.colorCells === true },
      { key: "segmentCellColor", label: "Segment-cell colour", kind: "color", showIf: (p) => p.colorCells === true },
      { key: "showCellValues", label: "Show cell values", kind: "checkbox", showIf: (p) => p.colorCells === true },
    ],
    hint: "Convert a graph/space into an m × n grid over its bounding box. Nodes drawn at Node size, segments at Segment width. Colour cells classifies each cell by node/segment occupancy with its own value+colour. Emits the grid as a graph to chain on.",
  },
  "grid-distance": {
    type: "grid-distance",
    label: "Grid Distance",
    color: "#9333ea",
    // Grid-field node: recolours an incoming grid (from Graph to Grid) by each cell's distance to the
    // nearest occupied cell — a heatmap. Consumes the grid-field; passes the distance field on.
    hasInput: true,
    hasOutput: true,
    defaultParams: { from: "any", metric: "manhattan", normalize: true, lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "from",
        label: "Distance from",
        kind: "select",
        options: [
          { value: "any", label: "Any occupied" },
          { value: "node", label: "Node cells" },
          { value: "segment", label: "Segment cells" },
        ],
      },
      {
        key: "metric",
        label: "Metric",
        kind: "select",
        options: [
          { value: "manhattan", label: "Manhattan (4-nbr)" },
          { value: "chebyshev", label: "Chebyshev (8-nbr)" },
          { value: "euclidean", label: "Euclidean" },
        ],
      },
      { key: "normalize", label: "Normalize", kind: "checkbox" },
      { key: "lowColor", label: "Near colour", kind: "color" },
      { key: "highColor", label: "Far colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Heatmap each grid cell by its distance to the nearest occupied (node/segment) cell — Manhattan / Chebyshev / Euclidean, coloured Near→Far. Feed it from Graph to Grid.",
  },
  "grid-field": {
    type: "grid-field",
    label: "Grid Field",
    color: "#9333ea",
    // Grid-field node: generate a synthetic elevation field over an incoming lattice — a directional ramp
    // (top→bottom, etc.) between High and Low + per-cell random jitter, optionally incising occupied
    // (river) cells lower. Publishes the DEM (values + elev) for Fill Depressions.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "high", label: "High" }, { key: "low", label: "Low" }],
    defaultParams: { direction: "top-bottom", high: 100, low: 0, randomness: 0.2, seed: 1, inciseOccupied: false, inciseDepth: 20, lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "direction",
        label: "Ramp direction",
        kind: "select",
        options: [
          { value: "top-bottom", label: "Top → Bottom" },
          { value: "bottom-top", label: "Bottom → Top" },
          { value: "left-right", label: "Left → Right" },
          { value: "right-left", label: "Right → Left" },
          { value: "radial", label: "Radial (centre high)" },
        ],
      },
      { key: "high", label: "High value", kind: "number" },
      { key: "low", label: "Low value", kind: "number" },
      { key: "randomness", label: "Randomness", kind: "range", min: 0, max: 1, step: 0.05 },
      { key: "seed", label: "Seed", kind: "number" },
      { key: "inciseOccupied", label: "Incise occupied (rivers)", kind: "checkbox" },
      { key: "inciseDepth", label: "Incise depth", kind: "number", showIf: (p) => p.inciseOccupied === true },
      { key: "lowColor", label: "Low colour", kind: "color" },
      { key: "highColor", label: "High colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Generate a synthetic elevation field over an incoming lattice — a directional ramp (High→Low) plus random jitter, optionally incising occupied (river) cells lower. Feed from Graph to Grid; chain into Fill Depressions for the watershed pipeline.",
  },
  "laplace-solver": {
    type: "laplace-solver",
    label: "Laplace Solver",
    color: "#9333ea",
    // Grid-field node: solve ∇²φ = 0 by iterative relaxation → a smooth harmonic potential field. Dirichlet
    // boundaries from the grid edges and/or occupied cells; free cells relax to the neighbour average.
    // Feed φ into Marching Squares for equipotentials / flow nets.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "highValue", label: "High" }, { key: "lowValue", label: "Low" }],
    defaultParams: { method: "sor", iterations: 300, tolerance: 0.001, omega: 1.8, pinEdges: "top-bottom", pinOccupied: false, highValue: 1, lowValue: 0, lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "method",
        label: "Solver",
        kind: "select",
        options: [
          { value: "sor", label: "SOR (fastest)" },
          { value: "gauss-seidel", label: "Gauss-Seidel" },
          { value: "jacobi", label: "Jacobi" },
        ],
      },
      { key: "iterations", label: "Max iterations", kind: "range", min: 10, max: 2000, step: 10 },
      { key: "tolerance", label: "Tolerance", kind: "number" },
      { key: "omega", label: "Over-relaxation (ω)", kind: "range", min: 1, max: 1.99, step: 0.01, showIf: (p) => p.method === "sor" },
      {
        key: "pinEdges",
        label: "Pin edges",
        kind: "select",
        options: [
          { value: "top-bottom", label: "Top → Bottom" },
          { value: "left-right", label: "Left → Right" },
          { value: "all", label: "All borders (low)" },
          { value: "none", label: "None" },
        ],
      },
      { key: "pinOccupied", label: "Pin occupied (sources)", kind: "checkbox" },
      { key: "highValue", label: "High potential", kind: "number" },
      { key: "lowValue", label: "Low potential", kind: "number" },
      { key: "lowColor", label: "Low colour", kind: "color" },
      { key: "highColor", label: "High colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Solve Laplace's equation ∇²φ = 0 over the grid (Jacobi / Gauss-Seidel / SOR relaxation) → a smooth harmonic potential. Pin boundaries from the edges (top→bottom battery) and/or occupied cells. Feed φ into Marching Squares for equipotentials / streamlines.",
  },
  "fill-depressions": {
    type: "fill-depressions",
    label: "Fill Depressions",
    color: "#9333ea",
    // Grid-field node: hydrologically condition a DEM (treat cell values as elevations) by Priority-Flood
    // so every cell drains to the border. epsilon > 0 forces a tiny slope across flats (Priority-Flood+ε).
    // Publishes the filled elevation field downstream (→ Flow Direction).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "epsilon", label: "Min slope (ε)" }],
    defaultParams: { epsilon: 0, edgesAreOutlets: true, highlightFilled: false, fillColor: "#0ea5e9", lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      { key: "epsilon", label: "Min slope (ε)", kind: "number" },
      { key: "edgesAreOutlets", label: "Edges drain off-grid", kind: "checkbox" },
      { key: "highlightFilled", label: "Show only raised cells", kind: "checkbox" },
      { key: "fillColor", label: "Raised colour", kind: "color", showIf: (p) => p.highlightFilled === true },
      { key: "lowColor", label: "Low colour", kind: "color", showIf: (p) => p.highlightFilled !== true },
      { key: "highColor", label: "High colour", kind: "color", showIf: (p) => p.highlightFilled !== true },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Fill sinks/pits in a DEM grid-field (Priority-Flood) so every cell drains to the border. Set Min slope (ε) > 0 to also resolve flats (Priority-Flood+ε). Feed from Grid / Graph to Grid; chain into Flow Direction.",
  },
  "flow-direction": {
    type: "flow-direction",
    label: "Flow Direction",
    color: "#9333ea",
    // Grid-field node: D8 steepest-descent receiver per cell → a direction code (the field's `dir`
    // channel). Elevations pass through. Feed it a filled DEM (Fill Depressions); chain into Flow
    // Accumulation / Watershed. Rho8 randomises the receiver among downslope neighbours (deterministic).
    hasInput: true,
    hasOutput: true,
    defaultParams: { method: "d8", showArrows: true, colorByDirection: false, showCellValues: false },
    fields: [
      {
        key: "method",
        label: "Method",
        kind: "select",
        options: [
          { value: "d8", label: "D8 (steepest)" },
          { value: "rho8", label: "Rho8 (stochastic)" },
        ],
      },
      { key: "showArrows", label: "Show arrows", kind: "checkbox" },
      { key: "colorByDirection", label: "Colour cells by direction", kind: "checkbox" },
      { key: "showCellValues", label: "Show direction codes", kind: "checkbox", showIf: (p) => p.colorByDirection === true },
    ],
    hint: "D8 flow direction — each cell points to its steepest-descent neighbour (code 0..7). Feed a filled DEM (Fill Depressions); emits arrows + a dir-carrying field for Flow Accumulation / Watershed. Rho8 randomises among downslope neighbours.",
  },
  "flow-accumulation": {
    type: "flow-accumulation",
    label: "Flow Accumulation",
    color: "#9333ea",
    // Grid-field node: how many upstream cells (or how much area) drain through each cell, following the
    // incoming dir channel (Flow Direction). High accumulation = channels. Passes the count field + dir on.
    hasInput: true,
    hasOutput: true,
    defaultParams: { asArea: false, logDisplay: true, lowColor: "#f1f5f9", highColor: "#1d4ed8", showCellValues: false },
    fields: [
      { key: "asArea", label: "Contributing area (m²)", kind: "checkbox" },
      { key: "logDisplay", label: "Log colour scale", kind: "checkbox" },
      { key: "lowColor", label: "Low colour", kind: "color" },
      { key: "highColor", label: "High colour", kind: "color" },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Flow accumulation — upstream contributing cells (or area) per cell, following Flow Direction. High values trace the channel network. Feed from Flow Direction; chain into Grid Threshold (streams) / Watershed.",
  },
  "watershed": {
    type: "watershed",
    label: "Watershed",
    color: "#9333ea",
    // Grid-field node: delineate the catchment draining to an outlet by flooding upstream over the dir
    // channel. Outlet = lowest-value cell (feed elevations from Flow Direction) or an explicit (col, row).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "col", label: "Outlet col" }, { key: "row", label: "Outlet row" }],
    defaultParams: { useLowestCell: true, col: 0, row: 0, fillColor: "#0ea5e9", showBoundary: true, showCellValues: false },
    fields: [
      { key: "useLowestCell", label: "Outlet = lowest cell", kind: "checkbox" },
      { key: "col", label: "Outlet column (m)", kind: "number", showIf: (p) => p.useLowestCell !== true },
      { key: "row", label: "Outlet row (n)", kind: "number", showIf: (p) => p.useLowestCell !== true },
      { key: "fillColor", label: "Basin colour", kind: "color" },
      { key: "showBoundary", label: "Show boundary", kind: "checkbox" },
    ],
    hint: "Delineate the watershed draining to an outlet cell — floods upstream over the Flow Direction dir channel. Outlet = the lowest-value cell, or an explicit (col, row) address. Emits a basin mask + outline. Feed from Flow Direction.",
  },
  "morphology": {
    type: "morphology",
    label: "Morphology",
    color: "#9333ea",
    // Grid-field node: morphological erosion / dilation and their compositions over a binary mask
    // (threshold the input) or grayscale field (min/max filters). Structuring element = cross / square /
    // disk of the given radius; iterations repeat the primitive. Passes the processed field on.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "radius", label: "Radius" }, { key: "iterations", label: "Iterations" }],
    defaultParams: { operation: "erode", shape: "cross", radius: 1, iterations: 1, grayscale: false, threshold: 0.5, clampEdges: true, showBackground: false, fgColor: "#22c55e", bgColor: "#475569", lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "operation",
        label: "Operation",
        kind: "select",
        options: [
          { value: "erode", label: "Erode (shrink)" },
          { value: "dilate", label: "Dilate (grow)" },
          { value: "open", label: "Open (erode→dilate)" },
          { value: "close", label: "Close (dilate→erode)" },
          { value: "gradient", label: "Gradient (edges)" },
          { value: "tophat", label: "Top-hat" },
          { value: "blackhat", label: "Black-hat" },
          { value: "boundary", label: "Boundary" },
        ],
      },
      {
        key: "shape",
        label: "Element",
        kind: "select",
        options: [
          { value: "cross", label: "Cross (4-nbr)" },
          { value: "square", label: "Square (8-nbr)" },
          { value: "disk", label: "Disk (radius)" },
        ],
      },
      { key: "radius", label: "Radius", kind: "range", min: 1, max: 10, step: 1 },
      { key: "iterations", label: "Iterations", kind: "range", min: 1, max: 10, step: 1 },
      { key: "grayscale", label: "Grayscale (min/max)", kind: "checkbox" },
      { key: "threshold", label: "Binarise threshold", kind: "number", showIf: (p) => p.grayscale !== true },
      { key: "clampEdges", label: "Preserve edges", kind: "checkbox" },
      { key: "showBackground", label: "Show background", kind: "checkbox", showIf: (p) => p.grayscale !== true },
      { key: "fgColor", label: "Foreground colour", kind: "color", showIf: (p) => p.grayscale !== true },
      { key: "bgColor", label: "Background colour", kind: "color", showIf: (p) => p.grayscale !== true && p.showBackground === true },
      { key: "lowColor", label: "Low colour", kind: "color", showIf: (p) => p.grayscale === true },
      { key: "highColor", label: "High colour", kind: "color", showIf: (p) => p.grayscale === true },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Morphological erosion / dilation and compositions (open, close, gradient, top-hat, black-hat, boundary) over a grid field — binary (threshold the input) or grayscale (min/max). Feed from Grid Threshold / Watershed / Flow Accumulation; chain into Marching Squares.",
  },
  "cellular-automaton": {
    type: "cellular-automaton",
    label: "Cellular Automaton",
    color: "#9333ea",
    // Grid-field node: evolve a binary lattice N generations under a Birth/Survive rule — Conway's Game of
    // Life (B3/S23) and friends (HighLife, Maze, Cave, custom). Seed from the input mask or a random fill.
    // Publishes the final 0/1 state for downstream masking / vectorisation.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "generations", label: "Generations" }],
    defaultParams: { preset: "conway", birth: "3", survive: "23", neighborhood: "moore", boundary: "toroidal", generations: 10, seedSource: "random", threshold: 0.5, density: 0.35, seed: 1, colorByAge: false, aliveColor: "#22c55e", showDead: false, deadColor: "#1e293b", lowColor: "#1e3a8a", highColor: "#ef4444", showCellValues: false },
    fields: [
      {
        key: "preset",
        label: "Rule (Game of Life)",
        kind: "select",
        options: [
          { value: "conway", label: "Conway B3/S23" },
          { value: "highlife", label: "HighLife B36/S23" },
          { value: "daynight", label: "Day & Night" },
          { value: "seeds", label: "Seeds B2/S" },
          { value: "replicator", label: "Replicator" },
          { value: "maze", label: "Maze B3/S12345" },
          { value: "cave", label: "Cave B678/S345678" },
          { value: "custom", label: "Custom B/S" },
        ],
      },
      { key: "birth", label: "Birth (B)", kind: "text", placeholder: "3", showIf: (p) => p.preset === "custom" },
      { key: "survive", label: "Survive (S)", kind: "text", placeholder: "23", showIf: (p) => p.preset === "custom" },
      {
        key: "neighborhood",
        label: "Neighbourhood",
        kind: "select",
        options: [
          { value: "moore", label: "Moore (8)" },
          { value: "vonneumann", label: "von Neumann (4)" },
        ],
      },
      {
        key: "boundary",
        label: "Boundary",
        kind: "select",
        options: [
          { value: "toroidal", label: "Toroidal (wrap)" },
          { value: "dead", label: "Dead edges" },
          { value: "mirror", label: "Mirror" },
        ],
      },
      { key: "generations", label: "Generations", kind: "range", min: 0, max: 200, step: 1 },
      {
        key: "seedSource",
        label: "Seed from",
        kind: "select",
        options: [
          { value: "random", label: "Random fill" },
          { value: "mask", label: "Input mask" },
        ],
      },
      { key: "density", label: "Fill density", kind: "range", min: 0, max: 1, step: 0.05, showIf: (p) => p.seedSource === "random" },
      { key: "seed", label: "Seed", kind: "number", showIf: (p) => p.seedSource === "random" },
      { key: "threshold", label: "Mask threshold", kind: "number", showIf: (p) => p.seedSource === "mask" },
      { key: "colorByAge", label: "Colour by age", kind: "checkbox" },
      { key: "aliveColor", label: "Alive colour", kind: "color", showIf: (p) => p.colorByAge !== true },
      { key: "lowColor", label: "Young colour", kind: "color", showIf: (p) => p.colorByAge === true },
      { key: "highColor", label: "Old colour", kind: "color", showIf: (p) => p.colorByAge === true },
      { key: "showDead", label: "Show dead cells", kind: "checkbox" },
      { key: "deadColor", label: "Dead colour", kind: "color", showIf: (p) => p.showDead === true },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Cellular automaton — evolve a grid N generations under a Birth/Survive rule (Conway's Game of Life B3/S23, HighLife, Maze, Cave, or custom). Seed from the input mask or a random fill. Moore/von-Neumann neighbours, wrap/dead/mirror edges. Emits the 0/1 state → Morphology / Marching Squares / Graph to Spaces.",
  },
  "grid-source": {
    type: "grid-source",
    label: "Grid",
    color: "#7c3aed",
    // Pipeline input — a construction Grid on the canvas (Create Grid). Like the Space node: references a
    // grid by display id, or tracks the grid currently selected on the canvas. Emits its lattice lines.
    hasInput: false,
    hasOutput: true,
    defaultParams: { id: "", grabFromSelection: true },
    fields: [
      { key: "grabFromSelection", label: "Grab ID from selection", kind: "checkbox" },
      { key: "id", label: "ID", kind: "text", placeholder: "Grid001", showIf: (p) => !p.grabFromSelection },
    ],
    hint: "Pipeline input — a Grid on the canvas (by id, or the current selection). Emits its lattice lines.",
  },
  "grid-threshold": {
    type: "grid-threshold",
    label: "Grid Threshold",
    color: "#9333ea",
    // Grid-field node: pass each cell's value through `value op threshold` → a 0/1 MASK field. Publishes
    // the mask downstream (Marching Squares / Cells→Spaces); fills passing cells (and optionally failing).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "threshold", label: "Threshold" }],
    defaultParams: { op: ">", threshold: 0, passColor: "#22c55e", failColor: "#475569", showFail: false, showCellValues: false },
    fields: [
      {
        key: "op",
        label: "Test",
        kind: "select",
        options: [
          { value: ">", label: "value > X" },
          { value: ">=", label: "value ≥ X" },
          { value: "<", label: "value < X" },
          { value: "<=", label: "value ≤ X" },
          { value: "==", label: "value = X" },
          { value: "!=", label: "value ≠ X" },
        ],
      },
      { key: "threshold", label: "Threshold (X)", kind: "number" },
      { key: "passColor", label: "Pass colour", kind: "color" },
      { key: "showFail", label: "Show fail cells", kind: "checkbox" },
      { key: "failColor", label: "Fail colour", kind: "color", showIf: (p) => p.showFail === true },
      { key: "showCellValues", label: "Show values", kind: "checkbox" },
    ],
    hint: "Threshold a grid field — keep cells where value passes the test → a 0/1 mask. Feed from Graph to Grid / Grid Distance; chain into Marching Squares.",
  },
  "marching-squares": {
    type: "marching-squares",
    label: "Marching Squares",
    color: "#9333ea",
    // Grid-field node: extract iso-contours from the field (cell-centre samples) → contour line segments
    // emitted as a graph (chains into Dimension / Mitered Join).
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "levels", label: "Levels" }],
    defaultParams: { levels: 5 },
    fields: [
      { key: "levels", label: "Contour levels", kind: "range", min: 1, max: 12, step: 1 },
    ],
    hint: "Extract iso-contours from a grid field — N evenly-spaced levels between min and max. Emits contour lines (a graph) to chain on. Feed from Graph to Grid / Grid Distance / Grid Threshold.",
  },
  "area-dimension": {
    type: "area-dimension",
    label: "Area Dimension",
    color: "#0e7490",
    // Space node: writes a centred annotation block in each incoming Space — Label, Area and the
    // bounding L×B dimension — in the chosen unit. The Space is forwarded unchanged downstream.
    hasInput: true,
    hasOutput: true,
    defaultParams: { unit: "m", label: "", showLabel: true, showArea: true, showDimension: true },
    fields: [
      {
        key: "unit",
        label: "Unit",
        kind: "select",
        options: [
          { value: "m", label: "Metres (m)" },
          { value: "cm", label: "Centimetres (cm)" },
          { value: "ft", label: "Feet (ft)" },
        ],
      },
      // Optional label text shown on the first line (when Show label is on).
      { key: "label", label: "Label", kind: "text", placeholder: "e.g. Living", showIf: (p) => p.showLabel !== false },
      { key: "showLabel", label: "Show label", kind: "checkbox" },
      { key: "showArea", label: "Show area", kind: "checkbox" },
      { key: "showDimension", label: "Show dimension (L×B)", kind: "checkbox" },
    ],
    hint: "Annotate each Space at its centroid with Label · Area · L×B dimension, in m / cm / ft. Forwards the Space on.",
  },
  "graph-to-spaces": {
    type: "graph-to-spaces",
    label: "Graph to Spaces",
    color: "#047857",
    // Converter: extracts the bounded FACES of an incoming graph (polylines) as closed Space polygons —
    // it fetches the spaces itself from the graph's topology. "single" → all spaces on one endpoint (the
    // default); "perCell" → one endpoint per space.
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(60, Math.round(Number(p.handleCount) || 1))),
    defaultParams: { outputMode: "single" },
    fields: [
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "single", label: "Single (all)" },
          { value: "perCell", label: "Per space (one each)" },
        ],
      },
    ],
    hint: "Convert a graph into Spaces — the bounded faces of the network. Single → all spaces on one endpoint; per space → one endpoint each.",
  },
  "longest-branch": {
    type: "longest-branch",
    label: "Longest Branch",
    color: "#0e7490",
    // Graph node: takes a graph (polylines — e.g. Skeleton branches) and returns its single longest
    // branch — the path between the two farthest tips (weighted graph diameter) — as one polyline graph.
    hasInput: true,
    hasOutput: true,
    defaultParams: {},
    fields: [],
    hint: "Return the longest branch of the incoming graph (the path between its two farthest tips) as a single polyline.",
  },
  "graph-reduce": {
    type: "graph-reduce",
    label: "Graph Reduce",
    color: "#0e7490",
    // Graph node: clean / reduce an incoming graph (polylines) by one of several algorithms, chosen by
    // `mode`. All output a single graph (polylines). Reuses the same snapped weighted adjacency as Graph
    // Metrics / Longest Branch.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "minLength", label: "Min length" }],
    defaultParams: { mode: "longest-branch", minLength: 1, iterate: true, mergeTol: 0.5 },
    fields: [
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "longest-branch", label: "Longest Branch" },
          { value: "prune", label: "Prune Spurs" },
          { value: "dissolve", label: "Dissolve (merge chains)" },
          { value: "mst", label: "Min Spanning Tree" },
          { value: "largest", label: "Largest Component" },
          { value: "loops", label: "Keep Loops" },
          { value: "bridges", label: "Keep Bridges" },
          { value: "outer", label: "Keep Outer Boundary" },
          { value: "inner", label: "Keep Inner Segments" },
        ],
      },
      // Prune: remove leaf branches (leaf → nearest junction) shorter than this. Wireable.
      { key: "minLength", label: "Min branch length", kind: "range", min: 0, max: 50, step: 0.1, unit: "m", showIf: (p) => p.mode === "prune" },
      { key: "iterate", label: "Prune to stable", kind: "checkbox", showIf: (p) => p.mode === "prune" },
      // Dissolve: snap junctions within this distance before merging degree-2 chains (0 = no snap).
      { key: "mergeTol", label: "Junction merge", kind: "range", min: 0, max: 5, step: 0.05, unit: "m", showIf: (p) => p.mode === "dissolve" },
    ],
    hint: "Reduce / clean a graph: Longest Branch · Prune Spurs · Dissolve · Min Spanning Tree · Largest Component · Keep Loops / Bridges · Keep Outer Boundary / Inner Segments.",
  },
  "voronoi-bloom": {
    type: "voronoi-bloom",
    label: "Voronoi Bloom",
    color: "#1d4ed8",
    // Graph node: grows a circle of `radius` metres from each NODE of an incoming graph, clipped to that
    // node's Voronoi cell — so dragging the radius animates the Voronoi tessellation assembling itself
    // (small r → separate disks; large r → disks fill their cells = the full Voronoi diagram). Seeds are
    // the graph's unique vertices (snapped so shared junctions collapse to one seed). Emits one Space per
    // grown cell. Radius is wireable so it can be driven/animated by another node.
    hasInput: true,
    hasOutput: true,
    // One output handle per grown cell (host bakes the live count into `handleCount`); "single" → one
    // bundle handle carrying every cell.
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(80, Math.round(Number(p.handleCount) || 1))),
    valueInputs: [{ key: "radius", label: "Radius" }],
    // Optional clip Space (id `gin-boundary`): the boundary the cells grow inside. Unwired → falls back to
    // the upstream Skeleton's source space, else the nodes' bounding box (expanded by the radius).
    geomInputs: [{ key: "boundary", label: "Clip space" }],
    defaultParams: { mode: "vertices", radius: 1, sides: 24, intersect: true, outputMode: "perCell" },
    fields: [
      // What blooms: a circle from each graph NODE (clipped to its Voronoi cell), or an equal-radius
      // capsule buffer from each graph SEGMENT (the whole edge thickens uniformly).
      {
        key: "mode",
        label: "Bloom from",
        kind: "select",
        options: [
          { value: "vertices", label: "Voronoi Vertices" },
          { value: "edges", label: "Voronoi Edges" },
        ],
      },
      // Edges only: let the growing capsules meet along the segment-Voronoi bisectors → one Space per
      // segment (a tessellation). Off → raw overlapping capsules.
      { key: "intersect", label: "Intersect to spaces", kind: "checkbox", showIf: (p) => p.mode === "edges" },
      { key: "radius", label: "Radius", kind: "range", min: 0, max: 30, step: 0.05, unit: "m" },
      // Circle / cap resolution: points per grown disk (vertices) or per capsule end-cap (edges). Higher → rounder.
      { key: "sides", label: "Circle sides", kind: "range", min: 3, max: 64, step: 1 },
      // Output style: separate per-cell handles, or a single bundle handle carrying every cell.
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
    ],
    hint: "Bloom an equal radius from a graph — Voronoi Vertices (a circle per node, clipped to its Voronoi cell) or Voronoi Edges (a capsule per segment; with Intersect on, the capsules expand and meet along the segment-Voronoi bisectors → one Space per segment). Drag Radius to watch the tessellation form.",
  },
  "spring-layout": {
    type: "spring-layout",
    label: "Spring Layout",
    color: "#6366f1",
    // Graph node: a Fruchterman–Reingold spring layout that runs on EVERY vertex (no degree-2
    // contraction). No node is merged and no segment is dropped — each particle is one input vertex,
    // and each input polyline is re-emitted with its vertices moved to their relaxed positions. So the
    // output has the SAME number of segments and the SAME number of edges as the input, just new
    // coordinates. Deterministic (init from the input positions), so the live preview is stable.
    hasInput: true,
    hasOutput: true,
    valueInputs: [
      { key: "iterations", label: "Iterations" },
      { key: "edgeLength", label: "Edge length" },
      { key: "repulsion", label: "Repulsion" },
    ],
    defaultParams: { iterations: 100, edgeLength: 5, repulsion: 1, step: 1 },
    fields: [
      { key: "iterations", label: "Iterations", kind: "range", min: 1, max: 500, step: 1 },
      // Spring rest length — the edge length the layout relaxes toward.
      { key: "edgeLength", label: "Edge length", kind: "range", min: 0.2, max: 50, step: 0.2, unit: "m" },
      // Repulsion strength: scales the all-pairs push-apart force (higher → more spread out).
      { key: "repulsion", label: "Repulsion", kind: "range", min: 0, max: 5, step: 0.05 },
      // Energy / initial temperature: how far nodes may move per iteration (cools to 0). Higher → looser.
      { key: "step", label: "Energy", kind: "range", min: 0.1, max: 3, step: 0.1 },
    ],
    hint: "Spring (force-directed) layout that PRESERVES every segment and edge — every vertex is relaxed (no degree-2 contraction), each input polyline re-emitted with new coordinates. Same segment & edge count, new positions.",
  },
  schema: {
    type: "schema",
    label: "Input Schema",
    color: "#7c3aed",
    // Generator (no input): a general component-property schema, edited inline on the node via four
    // foldable sections — Node / Segment / Space / Graph Schema — each a list of parameters (label,
    // type, unit, default, min/max/step, options, solver role) like the Input Properties node.
    // Wire its OUTPUT into a Graph node to attach the Node/Segment/Graph properties to that graph's
    // components, or into a Space node to attach the Space properties to that space — the properties
    // then appear in each component's Properties tab (added to the built-ins, never replacing them).
    hasInput: false,
    hasOutput: true,
    // PILOT: a params INPUT endpoint (violet `pin`, left side near the Node Schema section). Wire a
    // node's params OUTPUT (e.g. Display Node) into it to derive the schema from that node's fields.
    acceptsParams: true,
    defaultParams: { name: "", nodeProps: [], segmentProps: [], spaceProps: [], graphProps: [] },
    fields: [
      { key: "name", label: "Name", kind: "text", placeholder: "Schema name (optional)" },
    ],
    hint: "Define per-component input properties (Node / Segment / Space / Graph). Wire the output into a Graph or Space node to attach them — they surface in each component's Properties tab. The left params input can take a node's params (e.g. Display Node) to derive a schema from its fields.",
  },
  "output-schema": {
    type: "output-schema",
    label: "Output Schema",
    color: "#9333ea",
    // Terminal (input only): defines which RESULT rows a solver publishes into each component's
    // Metrics tab — same four foldable sections as the Input Schema (Node / Segment / Space / Graph),
    // edited the same way. Wire a solver's output (e.g. Pipe Network Solver) into it: each row's key
    // must match a result the solver writes (e.g. node "head"/"pressure"; segment "discharge"/
    // "velocity"/"headloss"/"unitHeadloss"); label/unit set the display, step sets the decimals.
    hasInput: true,
    hasOutput: false,
    defaultParams: { name: "", nodeProps: [], segmentProps: [], spaceProps: [], graphProps: [] },
    fields: [
      { key: "name", label: "Name", kind: "text", placeholder: "Schema name (optional)" },
    ],
    hint: "Define which solver results show per component (Node / Segment / Space / Graph). Wire a solver's output into this node — row keys match the solver's result keys; label/unit/step style the Metrics rows.",
  },
  "pipe-solver": {
    type: "pipe-solver",
    label: "Pipe Network Solver",
    color: "#0e7490",
    // Two inputs: the MAIN (geometry) input takes a Graph node — the solver then solves only that
    // graph's segments; unconnected, it solves the whole canvas segment graph. The "Schema" input
    // (gin-schema) takes a Schema node whose Node/Segment sections define the per-component input
    // properties (demand, elevation, diameter…) shown in each component's Properties tab; results
    // (discharge, head…) land in each component's Metrics tab. The algorithm (Todini global
    // gradient) is fixed; the schema decides which property keys feed it (via each row's `role`).
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "totalDemand", label: "Total demand (L/s)" },
      { key: "maxVelocity", label: "Max velocity (m/s)" },
      { key: "minPressure", label: "Min pressure (m)" },
      { key: "iterations", label: "Iterations" },
    ],
    defaultParams: { formula: "hazen-williams", maxIter: 60, tolerance: 0.001 },
    fields: [
      {
        key: "formula",
        label: "Formula",
        kind: "select",
        options: [
          { value: "hazen-williams", label: "Hazen-Williams" },
          { value: "darcy-weisbach", label: "Darcy-Weisbach" },
        ],
      },
      { key: "maxIter", label: "Max iterations", kind: "range", min: 5, max: 200, step: 1 },
      { key: "tolerance", label: "Tolerance", kind: "range", min: 0.0001, max: 0.05, step: 0.0001 },
    ],
    hint: "Solve a pipe network (Todini global gradient). Wire a Graph node into the main input (unconnected = whole canvas graph) and a Schema node into the Schema input to define node/segment properties; edit them per component in the Properties tab; per-component results appear in the Metrics tab.",
  },
  "frame-builder": {
    type: "frame-builder",
    label: "Frame Builder",
    color: "#9a3412",
    // Structural footprint generator (sibling of the Pipe Network Solver). Two inputs: the MAIN
    // (geometry) input takes a Graph node — it then frames only that graph; unconnected, it frames the
    // whole canvas segment graph. The "Schema" input (gin-schema) takes a Schema node whose Node /
    // Segment / Graph sections define the per-component inputs (column width/height, beam width, hatch,
    // and a graph-level "subtract"), shown + editable in each component's Properties tab. Reads them by
    // role: each node → a width×height column box; each segment → a beam ribbon; if the graph's
    // "subtract" is on, beams are cut back to the column faces. Emits the footprints as Spaces; wire its
    // output into an Output Schema node to choose which per-component results show in the Metrics tab.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "columns", label: "Columns" },
      { key: "beams", label: "Beams" },
      { key: "totalBeamLength", label: "Beam length", unit: "m" },
      { key: "totalColumnArea", label: "Column area", unit: "m²" },
    ],
    // Fallbacks used only when the wired Schema doesn't define the matching property (so the node still
    // produces a sensible frame on its own). The schema's per-component values override these.
    defaultParams: { columnWidthMm: 300, columnHeightMm: 450, beamWidthMm: 230, subtract: true },
    fields: [
      { key: "columnWidthMm", label: "Column width", kind: "range", min: 0, max: 2000, step: 10, unit: "mm" },
      { key: "columnHeightMm", label: "Column height", kind: "range", min: 0, max: 3000, step: 10, unit: "mm" },
      { key: "beamWidthMm", label: "Beam width", kind: "range", min: 0, max: 1000, step: 10, unit: "mm" },
      { key: "subtract", label: "Subtract beams from columns", kind: "checkbox" },
    ],
    hint: "Frame a graph: nodes → column boxes (width×height), segments → beam ribbons (width); optionally subtract beams from columns. Wire a Schema node for per-component sizing/hatch; wire Output Schema for Metrics.",
  },
  "wall-builder": {
    type: "wall-builder",
    label: "Graph to Walls",
    color: "#b45309",
    // Schema-driven mitred walls. Two inputs: the MAIN (geometry) input takes a Graph/Canvas node — it
    // strokes that graph's segments into mitred wall ribbons (junctions mitre cleanly via the canvas
    // mitering engine). The "Schema" input (gin-schema) takes a Schema node whose Segment section defines
    // per-segment Thickness / Justification / Hatch (and a Type discriminator); the wall width is read
    // straight from each segment's schema THICKNESS (role "wall-thickness"), not the canvas thickness.
    // Only "wall"-typed segments are stroked (doors / windows are openings). Emits the wall footprints.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "walls", label: "Walls" },
      { key: "totalLength", label: "Wall length", unit: "m" },
      { key: "totalArea", label: "Wall area", unit: "m²" },
    ],
    // Fallbacks used only when the schema doesn't define the property for a segment.
    defaultParams: { thicknessMm: 230, justification: "center", height: 3, union: true, showOuterDim: false, showInnerDim: false, showCenterDim: false, offsetDim: false, dimGap: 0.18 },
    fields: [
      { key: "thicknessMm", label: "Thickness", kind: "range", min: 0, max: 1000, step: 10, unit: "mm", role: "wall-thickness" },
      // Justification is which side of the (always-snappable) centerline the SOLID sits on. Inner / Outer
      // are decided from the enclosed room geometry (Inner = room side, Outer = street side) — so they read
      // sensibly while tracing; Center splits T/2 each side and keeps editing cleanest.
      {
        key: "justification",
        label: "Justification",
        kind: "select",
        role: "wall-justification",
        options: [
          { value: "inner", label: "Inner" },
          { value: "center", label: "Center" },
          { value: "outer", label: "Outer" },
        ],
      },
      // Wall height (m) — no plan-view effect; consumed by 3D / elevation. Per-element via role "wall-height".
      { key: "height", label: "Height", kind: "range", min: 0, max: 10, step: 0.05, unit: "m", role: "wall-height" },
      // Union: merge the band fills and stroke only the outer / inner faces — removes the internal
      // mitre-seam diagonals at junctions for a clean architectural drawing.
      { key: "union", label: "Union", kind: "checkbox" },
      // Dimension the wall band's faces. Which face is OUTER vs INNER is decided from the enclosed room
      // geometry (the room-facing face is "inner"), not the draw direction.
      { key: "showOuterDim", label: "Show Outer Dimension", kind: "checkbox" },
      { key: "showInnerDim", label: "Show Inner Dimension", kind: "checkbox" },
      // Center dimension = the wall's centerline (spine) length, drawn on the centerline.
      { key: "showCenterDim", label: "Show Center Dimension", kind: "checkbox" },
      // Offsetted Dimension: report the inner / outer face as the centerline length offset by half the
      // thickness each end (inner = spine − T, outer = spine + T) — the nominal trace dimension — rather
      // than the actual mitred face length. Only affects the inner / outer face values.
      { key: "offsetDim", label: "Offsetted Dimension", kind: "checkbox", showIf: (p) => p.showOuterDim === true || p.showInnerDim === true },
      { key: "dimGap", label: "Dimension Offset", kind: "number", min: 0, max: 2, step: 0.02, unit: "m", showIf: (p) => p.showOuterDim === true || p.showInnerDim === true },
    ],
    hint: "Stroke a graph into mitred walls, taking each wall's thickness from the Segment schema (role wall-thickness). The wall solid follows Justification (default center); the centerline is always what you snap to. Show Inner / Outer Dimension dimension the room-facing and street-facing faces — inner vs outer is decided from the enclosed room geometry; Show Center Dimension dimensions the centerline. Wire a Schema node into the Schema input; only wall-typed segments are drawn.",
  },
  "graph-to-room": {
    type: "graph-to-room",
    label: "Graph to Room",
    color: "#16a34a",
    // Forms the INNER (clear) rooms from the wall graph: each wall-bounded face is inset to the inner wall
    // faces by half each bounding wall's schema thickness. Present-only gate — the canvas auto-room detector
    // does the inset when this node exists, so the rooms stay selectable Spaces with the schema's Space
    // properties injected. Emits the resulting room polygons + count / area for downstream consumers.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueOutputs: [
      { key: "rooms", label: "Rooms" },
      { key: "totalArea", label: "Room area", unit: "m²" },
    ],
    defaultParams: {},
    fields: [],
    hint: "Forms inner (clear) rooms from the wall graph — each wall-bounded face is inset by half its schema thickness to the inner wall faces. The rooms stay selectable Spaces carrying the Schema's Space properties. Wire the Canvas Graph (out-3) in; attach a Schema for per-wall thickness.",
  },
  "segment-to-door": {
    type: "segment-to-door",
    label: "Segment to Door",
    color: "#9333ea",
    // Draws a door symbol on each input segment (the door opening). Shape:
    //  • polygon  — fills the opening as a rectangle of the given Thickness (a solid leaf block);
    //  • arc      — a simple swing arc plus two lines (the open leaf + the closed position);
    //  • detailed — the leaf drawn as a thin panel plus the swing arc, placed by Hinge (left/right end)
    //               and Swing (which side of the wall it opens).
    // Schema-driven: wire a Schema node into "gin-schema" (or attach one to the canvas/graph) and each
    // segment's shape / hinge / swing / thickness come from its own schema values by role (door-shape /
    // door-hinge / door-placement / door-thickness); only "door"-typed segments are drawn. The params
    // below are the fallback when no schema value is set.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { shape: "arc", thickness: 0.05, hinge: "left", swing: "left", lintelHeight: 2.1, color: "#9333ea" },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        role: "door-shape",
        options: [
          { value: "polygon", label: "Polygon (filled)" },
          { value: "arc", label: "Arc + lines" },
          { value: "detailed", label: "Detailed (leaf + swing)" },
        ],
      },
      // Leaf / fill thickness (m): the polygon block depth, or the detailed leaf panel thickness.
      { key: "thickness", label: "Thickness", kind: "range", min: 0.01, max: 0.5, step: 0.01, unit: "m", role: "door-thickness", showIf: (p) => p.shape === "polygon" || p.shape === "detailed" },
      // Hinge end + swing side — the door's main-line parameters (arc / detailed only).
      {
        key: "hinge",
        label: "Hinge",
        kind: "select",
        role: "door-hinge",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
        showIf: (p) => p.shape !== "polygon",
      },
      {
        key: "swing",
        label: "Swing",
        kind: "select",
        role: "door-placement",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
        showIf: (p) => p.shape !== "polygon",
      },
      // Door opening height (3D) — moved here from the native segment Properties so a door's lintel lives
      // with the rest of its parameters. Per-element via role "lintel-height".
      { key: "lintelHeight", label: "Lintel height", kind: "range", min: 0, max: 5, step: 0.05, unit: "m", role: "lintel-height" },
      // Symbol colour (fill + stroke). Per-element via role "door-color"; node param is the fallback.
      { key: "color", label: "Color", kind: "color", role: "door-color" },
    ],
    hint: "Draw a door on each input segment — polygon (filled), arc + two lines, or detailed (leaf + swing with hinge/swing side).",
  },
  "segment-to-window": {
    type: "segment-to-window",
    label: "Segment to Window",
    color: "#0891b2",
    // Draws a window symbol on each input segment (the window opening). Shape:
    //  • polygon  — fills the opening as a rectangle of the given Thickness (a solid frame block);
    //  • lines    — the classic window: the two frame edges + a centre glass line + jamb caps;
    //  • detailed — a frame rectangle + centre glass line + (Panes − 1) mullion dividers.
    // Schema-driven: wire a Schema into "gin-schema" (or attach one to the canvas/graph) and each segment's
    // shape / thickness / panes come from its own schema values by role (window-shape / window-thickness /
    // window-panes); only "window"-typed segments are drawn. The params below are the fallback.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { shape: "lines", thickness: 0.1, panes: 2, sillHeight: 0.9, lintelHeight: 2.1, color: "#0891b2" },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        role: "window-shape",
        options: [
          { value: "polygon", label: "Polygon (filled)" },
          { value: "lines", label: "Lines (frame + glass)" },
          { value: "detailed", label: "Detailed (panes)" },
        ],
      },
      // Frame / wall thickness (m): the opening depth across the wall (drives all three shapes).
      { key: "thickness", label: "Thickness", kind: "range", min: 0.02, max: 0.6, step: 0.01, unit: "m", role: "window-thickness" },
      // Glass divisions — the number of panes the window is split into (detailed only).
      { key: "panes", label: "Panes", kind: "range", min: 1, max: 8, step: 1, role: "window-panes", showIf: (p) => p.shape === "detailed" },
      // Opening heights (3D) — moved here from the native segment Properties. Per-element via roles
      // sill-height / lintel-height (metres); they drive the 3D window opening band.
      { key: "sillHeight", label: "Sill height", kind: "range", min: 0, max: 3, step: 0.05, unit: "m", role: "sill-height" },
      { key: "lintelHeight", label: "Lintel height", kind: "range", min: 0, max: 5, step: 0.05, unit: "m", role: "lintel-height" },
      // Symbol colour (fill + stroke). Per-element via role "window-color"; node param is the fallback.
      { key: "color", label: "Color", kind: "color", role: "window-color" },
    ],
    hint: "Draw a window on each input segment — polygon (filled), lines (frame + glass), or detailed (panes / mullions).",
  },
  "node-to-object": {
    type: "node-to-object",
    label: "Node to Object",
    color: "#db2777",
    // Places a furniture/fixture symbol (bed / sofa / table / …) on each input node. Mirrors the canvas
    // Node Properties tab with Type = Object: Width × Depth footprint (m), Rotation (°), and which point
    // of the footprint sits ON the node (Anchor). The chosen Kind drives the 2D plan symbol.
    // Schema-driven: wire a Schema into "gin-schema" (or attach one to the canvas/graph) and each node's
    // kind / width / depth / rotation / anchor come from its own schema values by role (object-kind /
    // obj-width / obj-height / obj-rotation / obj-anchor); only "object"-typed nodes are placed.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { kind: "bed", width: 1.5, height: 2.0, rotation: 0, anchor: "center" },
    fields: [
      { key: "kind", label: "Kind", kind: "select", role: "object-kind", options: PLACE_OBJECT_KIND_OPTIONS },
      { key: "width", label: "Width", kind: "range", min: 0.1, max: 6, step: 0.05, unit: "m", role: "obj-width" },
      { key: "height", label: "Depth", kind: "range", min: 0.1, max: 6, step: 0.05, unit: "m", role: "obj-height" },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°", role: "obj-rotation" },
      {
        key: "anchor",
        label: "Anchor",
        kind: "select",
        role: "obj-anchor",
        options: [
          { value: "center", label: "Center" },
          { value: "top-left", label: "Top-left" },
          { value: "top-right", label: "Top-right" },
          { value: "bottom-left", label: "Bottom-left" },
          { value: "bottom-right", label: "Bottom-right" },
        ],
      },
    ],
    hint: "Place a furniture symbol (bed / sofa / …) on each input node — Width × Depth, Rotation, Anchor and Kind.",
  },
  "layout-gen": {
    type: "layout-gen",
    label: "Layout Generation",
    color: "#9333ea",
    // Independent of the BSP node: a front-end to the existing interactive floorplan generator. Wire a
    // Space (boundary) into the input, set the rooms / connections / repulsions / algorithm, then press
    // "Generate" — the host runs generateFloorPlan and loads it as the canvas's editable layout (draggable
    // seeds, connection/repulsion lines, Add Room all work on the canvas). "Run Annealing" optimises the
    // seed positions. Room count / floor area / SA score are published for an Output node.
    hasInput: true,
    hasOutput: true,
    valueInputs: [
      { key: "wallWidth", label: "Wall width" },
      { key: "saIterations", label: "SA iterations" },
    ],
    valueOutputs: [
      { key: "rooms", label: "Rooms" },
      { key: "area", label: "Floor area", unit: "m²" },
      { key: "score", label: "SA score" },
    ],
    // `rooms` is a per-room list ({label, minArea, maxArea, maxRatio}); a custom editor renders it on the
    // node (see LayoutRoomsEditor). The canvas colour-codes each generated room's Area / Ratio against it.
    defaultParams: { rooms: [
      { label: "Living", minArea: 18, maxArea: 0, maxRatio: 2.5 },
      { label: "Kitchen", minArea: 8, maxArea: 0, maxRatio: 2.5 },
      { label: "Bedroom", minArea: 12, maxArea: 0, maxRatio: 2.5 },
      { label: "Bathroom", minArea: 4, maxArea: 0, maxRatio: 3 },
    ], algorithm: "bsp", wallWidth: 0.15, connections: "Living-Kitchen, Living-Bedroom", repulsions: "", saIterations: 600 },
    fields: [
      { key: "algorithm", label: "Algorithm", kind: "select", options: [
        { value: "bsp", label: "BSP (recursive split)" },
        { value: "rdg", label: "RDG (room graph)" },
      ] },
      { key: "wallWidth", label: "Wall Width", kind: "range", min: 0.05, max: 0.4, step: 0.01, unit: "m" },
      { key: "connections", label: "Connections (A-B, …)", kind: "text", placeholder: "Living-Kitchen, Living-Bedroom" },
      { key: "repulsions", label: "Repulsions (A-B, …)", kind: "text", placeholder: "Kitchen-Bathroom" },
      { key: "saIterations", label: "SA Iterations", kind: "range", min: 50, max: 3000, step: 50 },
    ],
    hint: "Generate a multi-room layout inside the wired Space — set each room's Min/Max area + max aspect Ratio. Draggable seeds + connection/repulsion lines on the canvas; each room's Area/Ratio is colour-coded green (ok) / red (violated). Run Annealing to optimise.",
  },
  "param-object": {
    type: "param-object",
    label: "Parametric Object",
    color: "#0d9488",
    // Definition SOURCE: a textbox holding a self-contained parametric object (JSON — `parameters` defaults
    // + a `geometry` block of declarative rules). Publishes the definition string on `val-def`; wire that
    // into a Parametric Renderer. No geometry of its own. A wired `valin-def` overrides the typed text.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition in" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: { definition: "" },
    fields: [
      { key: "definition", label: "Definition (JSON)", kind: "textarea", placeholder: "Paste a parametric object definition — parameters + geometry rules…" },
    ],
    hint: "A self-contained parametric object definition (parameters + geometry rules). Outputs it on val-def → wire into a Parametric Renderer.",
  },
  "param-grab": {
    type: "param-grab",
    label: "Grab Parameters",
    color: "#0891b2",
    // Interactive control panel: reads the parametric definition (wired from a Parametric Object into
    // `valin-def`), auto-builds one control per parameter (slider / options / checkbox / textbox — the
    // host bakes the control list into `props` from the definition), and re-publishes the definition on
    // `val-def` with the user's chosen values baked into its parameter defaults. Drop it between a
    // Parametric Object and a Parametric Renderer to tweak the object live.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: { props: [] },
    fields: [],
    hint: "Fetch the parameters of a wired Parametric Object as interactive controls (sliders / options / …) and pass the definition on with your values applied.",
  },
  "param-render": {
    type: "param-render",
    label: "Parametric Renderer",
    color: "#0f766e",
    // Generic, file-driven analogue of Node to Staircase: evaluates a parametric definition (wired from a
    // Parametric Object node into `valin-def`, or its own `definition` param) and draws the resulting lines
    // at EACH input node point. The geometry comes entirely from the definition — no per-object TypeScript.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "def", label: "Definition" }],
    defaultParams: { definition: "" },
    fields: [],
    hint: "Evaluate a parametric definition (from a Parametric Object node) and draw its lines at each input node — the file-driven analogue of Node to Staircase.",
  },
  "param-render-3d": {
    type: "param-render-3d",
    label: "Parametric 3D Renderer",
    color: "#7c3aed",
    // Evaluates a parametric definition (wired from a Parametric Object / Grab Parameters into `valin-def`,
    // or its own `definition` param) into a 3D MESH at each input node — one lofted prism per geometry box
    // (footprint extruded h0→h1 metres). Publishes the mesh on the mesh channel; wire into Mesh to 3D to
    // show it in the 3D view. Same definition + parameters as the 2D Parametric Renderer.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "def", label: "Definition" }],
    defaultParams: { definition: "" },
    fields: [],
    hint: "Evaluate a parametric definition into a 3D mesh at each input node (footprints extruded by height) → wire into Mesh to 3D.",
  },
  "node-to-staircase": {
    type: "node-to-staircase",
    label: "Node to Staircase",
    color: "#0f766e",
    // Draws a 2D plan staircase anchored at each input node, in one of three Configurations:
    //  • straight     — a single going (flight of N steps) ending in a landing;
    //  • u-shape      — a half-turn: a flight, a landing, then the remaining steps returning the other way
    //                   (the two parallel flights separated by Mid space; split at Mid steps);
    //  • u-shape-mid  — two 90° turns: a flight → landing → a perpendicular Mid flight (Mid steps) →
    //                   landing → a flight returning opposite the first.
    // Each flight gets a direction arrow showing the ascent. Param-driven (no schema): wire the Nodes
    // bundle (canvas out-1) or a Node source into the input.
    hasInput: true,
    hasOutput: true,
    defaultParams: { config: "straight", steps: 14, tread: 0.28, width: 1.0, direction: "ltr", midSteps: 0, landingWidth: 1.0, midSpace: 0.1, landingCuts: 1, rotation: 0, color: "#0f766e" },
    fields: [
      // Overall stair shape.
      {
        key: "config",
        label: "Configuration",
        kind: "select",
        options: [
          { value: "straight", label: "Straight (going + landing)" },
          { value: "u-shape", label: "U-shape (180° turn)" },
          { value: "u-shape-mid", label: "U-shape + mid flight (2 × 90°)" },
        ],
      },
      // Total number of treads in the stair (distributed across the flights for the multi-flight configs).
      { key: "steps", label: "Number of steps", kind: "range", min: 2, max: 60, step: 1 },
      // Going — the depth of each tread along the run (m).
      { key: "tread", label: "Tread (going)", kind: "range", min: 0.2, max: 0.45, step: 0.005, unit: "m" },
      // Flight width across the run (m).
      { key: "width", label: "Width", kind: "range", min: 0.6, max: 3, step: 0.05, unit: "m" },
      // Run direction of the FIRST flight: ascent along +x (Left → Right) or -x (Right → Left).
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "ltr", label: "Left → Right" },
          { value: "rtl", label: "Right → Left" },
        ],
      },
      // Multi-flight split. U-shape: steps in the FIRST flight (before the landing; rest return). U-shape +
      // mid: steps in the perpendicular MIDDLE flight (the rest split between the two outer flights). 0 →
      // auto (half for U-shape, ~a third for U-shape + mid).
      { key: "midSteps", label: "Mid / split steps", kind: "range", min: 0, max: 40, step: 1, showIf: (p) => p.config !== "straight" },
      // Landing depth along the run (m). Straight: the top landing. U-shape: the turn landing. (U-shape +
      // mid uses square width-sized landings so the perpendicular flights align, so it's hidden there.)
      { key: "landingWidth", label: "Landing depth", kind: "range", min: 0.5, max: 3, step: 0.05, unit: "m", showIf: (p) => p.config !== "u-shape-mid" },
      // Gap between the two parallel flights of a U-shape (half-turn) stair (m).
      { key: "midSpace", label: "Mid space (between flights)", kind: "range", min: 0, max: 1, step: 0.05, unit: "m", showIf: (p) => p.config === "u-shape" },
      // Divide the half-turn landing into n winder slices: lines fan from the inner corner (where the
      // flights meet) to n equally-spaced points on the landing's far edge → (n − 1) lines. 1 = no cuts;
      // 2 = a single mid line; 3 = two diagonals; 4 = two diagonals + a mid line; etc.
      { key: "landingCuts", label: "Landing cuts", kind: "range", min: 1, max: 10, step: 1, showIf: (p) => p.config === "u-shape" },
      // Rotate the whole assembly about the node (°).
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Draw a 2D staircase on each input node — Straight (going + landing), U-shape (180°), or U-shape with a perpendicular mid flight (2 × 90°). Steps, Tread, Width, Direction.",
  },
  "node-to-footing": {
    type: "node-to-footing",
    label: "Node to Footing",
    color: "#7c3aed",
    // Draws a column-footing SECTION anchored at each input node (column above, foundation layers below):
    //  • spread  — a flat wide RCC pad (T-section);
    //  • sloped  — a frustum (trapezoid) tapering from the frustum-top width to the base width;
    //  • stepped — a stack of widening steps.
    // Below the structural footing sit the PCC and soling beds. Skew offsets the footing under the column
    // (eccentric footing) — Left / Centre / Right. Defaults are the listed imperial sizes in metres
    // (12" col, 60" base, 8" RCC, 4" PCC, 4" soling, 8" frustum height, 24" frustum top). Param-driven (no
    // schema): wire the Nodes bundle (canvas out-1) or a Node source into the input.
    hasInput: true,
    hasOutput: true,
    // Numeric dims are wirable: drive any of them from a Math / Random / Metrics value (e.g. base width
    // computed from the column load). A wired value overrides the slider for that param.
    valueInputs: [
      { key: "baseWidth", label: "Base width" },
      { key: "columnWidth", label: "Column width" },
      { key: "columnHeight", label: "Column height" },
      { key: "rccThickness", label: "RCC thickness" },
      { key: "pccThickness", label: "PCC thickness" },
      { key: "solingThickness", label: "Soling thickness" },
      { key: "frustumHeight", label: "Frustum height" },
      { key: "frustumTopWidth", label: "Frustum top width" },
      { key: "steps", label: "Steps" },
      { key: "rotation", label: "Rotation" },
    ],
    defaultParams: {
      type: "sloped", columnWidth: 0.3, columnHeight: 1.0, baseWidth: 1.5,
      rccThickness: 0.2, pccThickness: 0.1, solingThickness: 0.1,
      frustumHeight: 0.2, frustumTopWidth: 0.6, steps: 3, skew: "center", rotation: 0, color: "#7c3aed",
    },
    fields: [
      {
        key: "type",
        label: "Footing type",
        kind: "select",
        options: [
          { value: "spread", label: "Spread (flat pad)" },
          { value: "sloped", label: "Sloped (frustum)" },
          { value: "stepped", label: "Stepped" },
        ],
      },
      // Column (drawn above the footing). Width = the column section; Height = how much stem to show.
      { key: "columnWidth", label: "Column width", kind: "range", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
      { key: "columnHeight", label: "Column height (shown)", kind: "range", min: 0.2, max: 4, step: 0.05, unit: "m" },
      // Footing base (the widest layer at the bottom of the structural footing).
      { key: "baseWidth", label: "Base width", kind: "range", min: 0.3, max: 5, step: 0.05, unit: "m" },
      // RCC = the structural footing thickness (the pad for spread; total step height for stepped; the
      // slab below the frustum for sloped).
      { key: "rccThickness", label: "RCC thickness", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m" },
      // PCC + soling beds below the structural footing.
      { key: "pccThickness", label: "PCC thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      { key: "solingThickness", label: "Soling thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      // Sloped only: the tapering frustum between the column and the RCC slab.
      { key: "frustumHeight", label: "Frustum height", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" },
      { key: "frustumTopWidth", label: "Frustum top width", kind: "range", min: 0.1, max: 3, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" },
      // Stepped only: how many steps the pad is built from.
      { key: "steps", label: "Steps", kind: "range", min: 1, max: 8, step: 1, showIf: (p) => p.type === "stepped" },
      // Eccentricity — shift the footing under the column (the node stays the column centre).
      {
        key: "skew",
        label: "Skew",
        kind: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ],
      },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Draw a column-footing section on each input node — Spread (flat pad), Sloped (frustum), or Stepped, with RCC / PCC / soling layers and an eccentric Skew.",
  },
  footing: {
    type: "footing",
    label: "Footing",
    color: "#6d28d9",
    // DATA node (pure definition, location-free): holds the full engineering definition of a column
    // footing — section type, column W×D×H, base W×D, RCC / PCC / soling depths, frustum dims, step count,
    // eccentric skew. Carries NO view params and NO location; feed its output into Footing → 2D Plan / 2D
    // Elevation / 3D Mesh, then place the result by wiring the view into a Node. Every numeric dim is wirable.
    hasInput: false,
    hasOutput: true,
    valueInputs: [
      { key: "baseWidth", label: "Base width" },
      { key: "baseDepth", label: "Base depth" },
      { key: "columnWidth", label: "Column width" },
      { key: "columnDepth", label: "Column depth" },
      { key: "columnHeight", label: "Column height" },
      { key: "rccThickness", label: "RCC thickness" },
      { key: "pccThickness", label: "PCC thickness" },
      { key: "solingThickness", label: "Soling thickness" },
      { key: "frustumHeight", label: "Frustum height" },
      { key: "frustumTopWidth", label: "Frustum top width" },
      { key: "frustumTopDepth", label: "Frustum top depth" },
      { key: "steps", label: "Steps" },
      { key: "rotation", label: "Rotation" },
    ],
    defaultParams: {
      type: "sloped", columnWidth: 0.3, columnDepth: 0.3, columnHeight: 1.0,
      baseWidth: 1.5, baseDepth: 1.5, rccThickness: 0.2, pccThickness: 0.1, solingThickness: 0.1,
      frustumHeight: 0.2, frustumTopWidth: 0.6, frustumTopDepth: 0.6, steps: 3, skew: "center", rotation: 0, color: "#7c3aed",
    },
    fields: [
      {
        key: "type",
        label: "Footing type",
        kind: "select",
        options: [
          { value: "spread", label: "Spread (flat pad)" },
          { value: "sloped", label: "Sloped (frustum)" },
          { value: "stepped", label: "Stepped" },
        ],
      },
      // Column (above the footing). Width = X, Depth = Z, Height = stem shown.
      { key: "columnWidth", label: "Column width", kind: "range", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
      { key: "columnDepth", label: "Column depth", kind: "range", min: 0.1, max: 1.5, step: 0.01, unit: "m" },
      { key: "columnHeight", label: "Column height (shown)", kind: "range", min: 0.2, max: 4, step: 0.05, unit: "m" },
      // Base pad (the widest layer at the bottom of the structural footing).
      { key: "baseWidth", label: "Base width", kind: "range", min: 0.3, max: 5, step: 0.05, unit: "m" },
      { key: "baseDepth", label: "Base depth", kind: "range", min: 0.3, max: 5, step: 0.05, unit: "m" },
      // Layers below the structural footing.
      { key: "rccThickness", label: "RCC thickness", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m" },
      { key: "pccThickness", label: "PCC thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      { key: "solingThickness", label: "Soling thickness", kind: "range", min: 0, max: 0.6, step: 0.01, unit: "m" },
      // Sloped only: the tapering frustum between the column and the RCC slab.
      { key: "frustumHeight", label: "Frustum height", kind: "range", min: 0.05, max: 1, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" },
      { key: "frustumTopWidth", label: "Frustum top width", kind: "range", min: 0.1, max: 3, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" || p.type === "stepped" },
      { key: "frustumTopDepth", label: "Frustum top depth", kind: "range", min: 0.1, max: 3, step: 0.01, unit: "m", showIf: (p) => p.type === "sloped" || p.type === "stepped" },
      // Stepped only: how many steps the pad is built from.
      { key: "steps", label: "Steps", kind: "range", min: 1, max: 8, step: 1, showIf: (p) => p.type === "stepped" },
      // Eccentricity — shift the footing under the column along its width (X) axis.
      {
        key: "skew",
        label: "Skew",
        kind: "select",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
        ],
      },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Define a column footing on each input node (type, column/base dimensions, RCC/PCC/soling, frustum, skew). Feed into Footing → 2D Plan / 2D Elevation / 3D Mesh.",
  },
  "footing-to-plan": {
    type: "footing-to-plan",
    label: "Footing to 2D Plan",
    color: "#7c3aed",
    // Draws the top-down PLAN of each footing from an upstream Footing node — concentric footprint
    // outlines (base, steps, column) in the X–Z plane.
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#7c3aed" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the 2D plan (footprint outlines) of an upstream Footing. Wire into a Node to stamp it at that node's point(s).",
  },
  "footing-to-elevation": {
    type: "footing-to-elevation",
    label: "Footing to 2D Elevation",
    color: "#7c3aed",
    // Draws the column-footing SECTION (elevation) of each footing from an upstream Footing node — column
    // above, then the structural footing and the PCC / soling beds below.
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#7c3aed" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the 2D elevation (section) of an upstream Footing. Wire into a Node to stamp it at that node's point(s).",
  },
  "footing-to-3d-mesh": {
    type: "footing-to-3d-mesh",
    label: "Footing to 3D Mesh",
    color: "#0d9488",
    // Converts each footing from an upstream Footing node into a generic 3D MESH (a stack of lofted prisms
    // — boxes + frustum). Feed the output into Mesh to 3D to view it.
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#7c3aed" },
    fields: [{ key: "color", label: "Color (column)", kind: "color" }],
    hint: "Convert an upstream Footing into a 3D mesh (boxes + frustum). Wire into a Node to place it at the structural point(s), or into Mesh to 3D for an unplaced preview.",
  },
  "mesh-to-3d": {
    type: "mesh-to-3d",
    label: "Mesh to 3D",
    color: "#0891b2",
    // TERMINAL: renders any incoming Mesh (from a … to 3D Mesh node) into the 3D view. Generic — every
    // future element that produces a Mesh feeds this one node.
    hasInput: true,
    hasOutput: false,
    defaultParams: {},
    fields: [],
    hint: "Render any incoming 3D Mesh in the 3D view. The single terminal for all … to 3D Mesh nodes.",
  },
  staircase: {
    type: "staircase",
    label: "Staircase",
    color: "#0f766e",
    // DATA node (pure definition, location-free): holds the full definition of a staircase — configuration
    // (straight / u-shape / u-shape-mid), step count, tread, riser, width, direction, landing & mid-flight
    // params. Carries NO view params and NO location; feed into Staircase → 2D Plan / Elevations / 3D Mesh,
    // then place the result by wiring the view into a Node.
    hasInput: false,
    hasOutput: true,
    valueInputs: [
      { key: "steps", label: "Steps" },
      { key: "tread", label: "Tread" },
      { key: "riser", label: "Riser" },
      { key: "width", label: "Width" },
      { key: "midSteps", label: "Mid steps" },
      { key: "landingWidth", label: "Landing depth" },
      { key: "rotation", label: "Rotation" },
    ],
    defaultParams: { config: "straight", steps: 14, tread: 0.28, riser: 0.17, width: 1.0, direction: "ltr", midSteps: 0, landingWidth: 1.0, midSpace: 0.1, landingCuts: 1, rotation: 0, color: "#0f766e" },
    fields: [
      {
        key: "config",
        label: "Configuration",
        kind: "select",
        options: [
          { value: "straight", label: "Straight (going + landing)" },
          { value: "u-shape", label: "U-shape (180° turn)" },
          { value: "u-shape-mid", label: "U-shape + mid flight (2 × 90°)" },
        ],
      },
      { key: "steps", label: "Number of steps", kind: "range", min: 2, max: 60, step: 1 },
      { key: "tread", label: "Tread (going)", kind: "range", min: 0.2, max: 0.45, step: 0.005, unit: "m" },
      { key: "riser", label: "Riser (rise)", kind: "range", min: 0.1, max: 0.25, step: 0.005, unit: "m" },
      { key: "width", label: "Width", kind: "range", min: 0.6, max: 3, step: 0.05, unit: "m" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "ltr", label: "Left → Right" },
          { value: "rtl", label: "Right → Left" },
        ],
      },
      { key: "midSteps", label: "Mid / split steps", kind: "range", min: 0, max: 40, step: 1, showIf: (p) => p.config !== "straight" },
      { key: "landingWidth", label: "Landing depth", kind: "range", min: 0.5, max: 3, step: 0.05, unit: "m", showIf: (p) => p.config !== "u-shape-mid" },
      { key: "midSpace", label: "Mid space (between flights)", kind: "range", min: 0, max: 1, step: 0.05, unit: "m", showIf: (p) => p.config === "u-shape" },
      { key: "landingCuts", label: "Landing cuts", kind: "range", min: 1, max: 10, step: 1, showIf: (p) => p.config === "u-shape" },
      { key: "rotation", label: "Rotation", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Define a staircase (config, steps, tread, riser, width, landings). Feed into Staircase → 2D Plan / Elevations / 3D Mesh, then place via a Node.",
  },
  "staircase-to-plan": {
    type: "staircase-to-plan",
    label: "Staircase to 2D Plan",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the 2D plan (flights, landings, tread lines, ascent arrows) of an upstream Staircase. Wire into a Node to stamp it at that node's point(s).",
  },
  "staircase-to-left-elevation": {
    type: "staircase-to-left-elevation",
    label: "Staircase to Left Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the LEFT side elevation (run × height, stepped profile) of an upstream Staircase. Wire into a Node to place it.",
  },
  "staircase-to-right-elevation": {
    type: "staircase-to-right-elevation",
    label: "Staircase to Right Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the RIGHT side elevation (run × height) of an upstream Staircase. Wire into a Node to place it.",
  },
  "staircase-to-front-elevation": {
    type: "staircase-to-front-elevation",
    label: "Staircase to Front Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the FRONT elevation (width × height) of an upstream Staircase. Wire into a Node to place it.",
  },
  "staircase-to-back-elevation": {
    type: "staircase-to-back-elevation",
    label: "Staircase to Back Elevation",
    color: "#0f766e",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Build the BACK elevation (width × height) of an upstream Staircase. Wire into a Node to place it.",
  },
  "staircase-to-3d-mesh": {
    type: "staircase-to-3d-mesh",
    label: "Staircase to 3D Mesh",
    color: "#0d9488",
    hasInput: true,
    hasOutput: true,
    defaultParams: { color: "#0f766e" },
    fields: [{ key: "color", label: "Color", kind: "color" }],
    hint: "Convert an upstream Staircase into a 3D mesh (stacked step boxes). Wire into a Node to place it at the structural point(s), or into Mesh to 3D for an unplaced preview.",
  },
  "schema-to-drawing": {
    type: "schema-to-drawing",
    label: "Schema to Drawing Tools",
    color: "#9333ea",
    // Reads an attached Schema's segment `type` (role seg-type) and node `type` (role node-type)
    // discriminators — their options + per-option icons — and surfaces them to the host so they appear as
    // tools in the Add Segment / Add Node drawing dropdowns (augmenting & overriding the built-ins by value).
    hasInput: true,
    hasOutput: false,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: {},
    fields: [],
    hint: "Bring an attached Schema's segment & node TYPES (with icons) into the Add Segment / Add Node drawing dropdowns.",
  },
  "schema-to-layers": {
    type: "schema-to-layers",
    label: "Schema to Layers",
    color: "#9333ea",
    // Reads an attached Schema's segment `type` (role seg-type) and node `type` (role node-type)
    // discriminators — their options — and surfaces them to the host as live LAYER blocks: a foldable
    // "Segment" block (Wall / Door / Window / Line) and "Node" block (Junction / Object) in the Layers
    // panel. Live-derived (not saved); removing the node returns the panel to just Layer 0. No geometry.
    hasInput: true,
    hasOutput: false,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: {},
    fields: [],
    hint: "Bring an attached Schema's segment & node TYPES into the Layers panel as foldable Segment / Node layer blocks.",
  },
  "floorplan-to-front-elevation": {
    type: "floorplan-to-front-elevation",
    label: "Floorplan to Front Elevation",
    color: "#9333ea",
    // Projects the wall / door / window graph onto the FRONT plane (X × height) as a schematic elevation
    // (outline rects + openings at sill/lintel + a ground line). Fed the Canvas Segments bundle; reads
    // wall heights + opening sill/lintel from the attached Schema. Wire into a Node to place it.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Project the plan's walls / openings onto the FRONT elevation. Wire into a Node to place it.",
  },
  "floorplan-to-back-elevation": {
    type: "floorplan-to-back-elevation",
    label: "Floorplan to Back Elevation",
    color: "#9333ea",
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Project the plan's walls / openings onto the BACK elevation. Wire into a Node to place it.",
  },
  "floorplan-to-left-elevation": {
    type: "floorplan-to-left-elevation",
    label: "Floorplan to Left Elevation",
    color: "#9333ea",
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Project the plan's walls / openings onto the LEFT elevation. Wire into a Node to place it.",
  },
  "floorplan-to-right-elevation": {
    type: "floorplan-to-right-elevation",
    label: "Floorplan to Right Elevation",
    color: "#9333ea",
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3, color: "#0f172a" },
    fields: [
      { key: "height", label: "Storey height (fallback)", kind: "range", min: 1, max: 12, step: 0.1, unit: "m" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "Project the plan's walls / openings onto the RIGHT elevation. Wire into a Node to place it.",
  },
  "views-layout": {
    type: "views-layout",
    label: "Views Layout",
    color: "#0891b2",
    // TERMINAL: routes wired views into the canvas "Views" mode panels instead of placing them at Nodes.
    // Wire a Plan into Top/Plan and the four elevations into Front / Back / Left / Right. The host reads
    // this node from the live flow and renders the panels (plan centre, Back top / Front bottom / L / R).
    hasInput: false,
    hasOutput: false,
    geomInputs: [
      { key: "plan", label: "Plan (top)" },
      { key: "front", label: "Front" },
      { key: "back", label: "Back" },
      { key: "left", label: "Left" },
      { key: "right", label: "Right" },
    ],
    defaultParams: {},
    fields: [],
    hint: "Route a Plan + the four elevations into the canvas \"Views\" mode panels (instead of placing them at Nodes).",
  },
  "segment-to-3d": {
    type: "segment-to-3d",
    label: "Segment to 3D",
    color: "#0d9488",
    // Extrudes each input segment (wall) vertically in the 3D view to a custom Height, Up from the floor
    // plane or Down below it. Per-element via roles extrude-height / extrude-direction (graphAttrs); the
    // 3D canvas resolves them, overriding the default storey height for that wall.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 2.7, direction: "up" },
    fields: [
      { key: "height", label: "Height", kind: "range", min: 0, max: 12, step: 0.1, unit: "m", role: "extrude-height" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        role: "extrude-direction",
        options: [
          { value: "up", label: "Upwards" },
          { value: "down", label: "Downwards" },
        ],
      },
    ],
    hint: "Extrude each input segment into a 3D wall of the given Height, Upwards from the floor or Downwards below it.",
  },
  "space-to-3d": {
    type: "space-to-3d",
    label: "Space to 3D",
    color: "#0891b2",
    // Extrudes each input space polygon into a solid 3D mass of the given Height, Up from the floor plane
    // or Down below it (massing / basements). Per-element via roles extrude-height / extrude-direction
    // (graphAttrs.spaces); the 3D canvas renders the mass.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    defaultParams: { height: 3.0, direction: "up", color: "#94a3b8", opacity: 1, showEdges: true },
    fields: [
      { key: "height", label: "Height", kind: "range", min: 0, max: 60, step: 0.1, unit: "m", role: "extrude-height" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        role: "extrude-direction",
        options: [
          { value: "up", label: "Upwards" },
          { value: "down", label: "Downwards" },
        ],
      },
      // Appearance of the extruded mass in the 3D view. Per-element via roles extrude-color /
      // extrude-opacity / extrude-edges (graphAttrs.spaces) — the node values are the fallback.
      { key: "color", label: "Color", kind: "color", role: "extrude-color" },
      { key: "opacity", label: "Opacity", kind: "range", min: 0, max: 1, step: 0.05, role: "extrude-opacity" },
      { key: "showEdges", label: "Show Edges", kind: "checkbox", role: "extrude-edges" },
    ],
    hint: "Extrude each input space into a solid 3D mass of the given Height, Upwards from the floor or Downwards below it. Set its Colour, Opacity (for see-through massing) and Show Edges in the 3D view.",
  },
  mass: {
    type: "mass",
    label: "Mass",
    color: "#0e7490",
    // Primitive 3D Mass generator (no input): a Cube / Cuboid / Sphere / Cone / Cylinder of the given
    // dimensions, rendered in the 3D view. A starting Mass to feed downstream Mass nodes.
    hasInput: false,
    hasOutput: true,
    defaultParams: { shape: "cube", length: 3, breadth: 2, height: 3, radius: 1.5, color: "#94a3b8" },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "cube", label: "Cube" },
          { value: "cuboid", label: "Cuboid" },
          { value: "sphere", label: "Sphere" },
          { value: "cone", label: "Cone" },
          { value: "cylinder", label: "Cylinder" },
        ],
      },
      { key: "length", label: "Length", kind: "range", min: 0.1, max: 50, step: 0.1, unit: "m", showIf: (p) => p.shape === "cube" || p.shape === "cuboid" },
      { key: "breadth", label: "Breadth", kind: "range", min: 0.1, max: 50, step: 0.1, unit: "m", showIf: (p) => p.shape === "cuboid" },
      { key: "radius", label: "Radius", kind: "range", min: 0.1, max: 25, step: 0.1, unit: "m", showIf: (p) => p.shape === "sphere" || p.shape === "cone" || p.shape === "cylinder" },
      { key: "height", label: "Height", kind: "range", min: 0.1, max: 50, step: 0.1, unit: "m", showIf: (p) => p.shape === "cuboid" || p.shape === "cone" || p.shape === "cylinder" },
      { key: "color", label: "Color", kind: "color" },
    ],
    hint: "A primitive 3D Mass — Cube (Length) · Cuboid (Length × Breadth × Height) · Sphere (Radius) · Cone (Radius, Height) · Cylinder (Radius, Height). Rendered in the 3D view as a starting Mass.",
  },
  "inset-3d": {
    type: "inset-3d",
    label: "Inset 3D",
    color: "#0e7490",
    // Mass op: inset (or outset) each incoming Mass's footprint by Offset — Inside shrinks it, Outside
    // grows it — producing a new Mass. Feed a Mass from Space to 3D; the host extrudes the inset footprint.
    hasInput: true,
    hasOutput: true,
    defaultParams: { direction: "inside", offset: 0.2 },
    fields: [
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "inside", label: "Inside (shrink)" },
          { value: "outside", label: "Outside (grow)" },
        ],
      },
      { key: "offset", label: "Offset", kind: "range", min: 0, max: 5, step: 0.05, unit: "m" },
    ],
    hint: "Inset a 3D Mass — shrink (Inside) or grow (Outside) its footprint by Offset → a new Mass. Feed a Mass from Space to 3D.",
  },
  "smooth-3d": {
    type: "smooth-3d",
    label: "Smoothing 3D",
    color: "#0e7490",
    // Mass op: round each incoming Mass's footprint (Chaikin corner-cutting) so the extruded mass has
    // smooth vertical faces — producing a new Mass. Feed a Mass from Space to 3D / Inset 3D.
    hasInput: true,
    hasOutput: true,
    defaultParams: { iterations: 2 },
    fields: [
      { key: "iterations", label: "Iterations", kind: "range", min: 1, max: 5, step: 1 },
    ],
    hint: "Smooth a 3D Mass — rounds its footprint corners (more Iterations = rounder) so the extruded mass has smooth faces → a new Mass. Feed a Mass from Space to 3D / Inset 3D.",
  },
  "voronoi-3d": {
    type: "voronoi-3d",
    label: "Voronoi 3D",
    color: "#0e7490",
    // Mass op: the 3D Voronoi diagram of the input Mass's vertices — each vertex seeds a convex cell
    // (clipped to the Mass's bounding box). Rendered as cell wireframes in the 3D view. Feed a Mass node.
    hasInput: true,
    hasOutput: true,
    defaultParams: {},
    fields: [],
    hint: "3D Voronoi of a Mass's vertices — each vertex seeds a convex cell (half-space intersection), clipped to the Mass's bounding box. Wire a Mass primitive in; cells render in the 3D view.",
  },
  image: {
    type: "image",
    label: "Image",
    color: "#7e22ce",
    // Generator (no input): the imported underlay image. Auto-binds to the canvas's current image and
    // feeds the Image nodes (Vectorisation). Carries no geometry itself.
    hasInput: false,
    hasOutput: true,
    defaultParams: {},
    fields: [],
    hint: "The imported underlay image (auto-connects to the canvas image). Feeds Vectorisation.",
  },
  vectorise: {
    type: "vectorise",
    label: "Vectorisation",
    color: "#9333ea",
    // Traces the input image's lines into a PROPERLY CONNECTED node/edge graph in world coords: colour
    // mask → despeckle → gap close → skeleton → spur prune → simplify → vertex snap → endpoint bridging
    // (T-junctions) → ortho straighten → collinear merge. Output feeds the Graph nodes (Mitered Join /
    // Graph to Spaces / Metrics).
    hasInput: true,
    hasOutput: true,
    valueInputs: [
      { key: "tolerance", label: "Tolerance" },
      { key: "minLength", label: "Min length" },
      { key: "snapTolerance", label: "Node snap" },
      { key: "connectGap", label: "Bridge gaps" },
    ],
    defaultParams: {
      colorMode: "black", tolerance: 50, despeckle: 12, dilate: 3, spurLength: 10,
      simplifyEpsilon: 2, minLength: 30, snapTolerance: 8, connectGap: 12,
      mergeAngle: 7, orthoSnap: 0, orthoTol: 10,
    },
    fields: [
      {
        key: "colorMode",
        label: "Colour",
        kind: "select",
        options: [
          { value: "black", label: "Black" },
          { value: "red", label: "Red" },
          { value: "blue", label: "Blue" },
          { value: "green", label: "Green" },
          { value: "all", label: "All (non-white)" },
        ],
      },
      // Colour-match tolerance — higher matches more shades of the chosen colour.
      { key: "tolerance", label: "Tolerance", kind: "range", min: 5, max: 120, step: 1 },
      // Remove noise blobs (text, hatching, stamps) below this area before tracing.
      { key: "despeckle", label: "Despeckle", kind: "range", min: 0, max: 400, step: 4, unit: "px²" },
      // Morphological close kernel — bridges pixel-level breaks in dashed/anti-aliased lines.
      { key: "dilate", label: "Gap close", kind: "range", min: 1, max: 15, step: 2, unit: "px" },
      // Erase skeleton whiskers (thick-wall thinning artefacts) shorter than this off junctions.
      { key: "spurLength", label: "Prune spurs", kind: "range", min: 0, max: 60, step: 1, unit: "px" },
      // Douglas–Peucker tolerance — higher collapses wobbly pixel runs into straighter segments.
      { key: "simplifyEpsilon", label: "Simplify", kind: "range", min: 0, max: 12, step: 0.1, unit: "px" },
      // Discard traced lines (and leftover dangling whiskers) shorter than this.
      { key: "minLength", label: "Min length", kind: "range", min: 0, max: 300, step: 1, unit: "px" },
      // Cluster vertices within this radius into one shared graph node.
      { key: "snapTolerance", label: "Node snap", kind: "range", min: 0, max: 30, step: 1, unit: "px" },
      // Connect dangling endpoints to the nearest node or edge (makes T-junctions) within this reach.
      { key: "connectGap", label: "Bridge gaps", kind: "range", min: 0, max: 80, step: 1, unit: "px" },
      // Collapse pass-through nodes whose edges deviate less than this from a straight line.
      { key: "mergeAngle", label: "Straighten", kind: "range", min: 0, max: 30, step: 0.5, unit: "°" },
      // Snap near-horizontal/vertical runs onto the image axes (great for floorplans).
      { key: "orthoSnap", label: "Ortho snap", kind: "checkbox" },
      // How far off-axis an edge may be and still get squared up.
      { key: "orthoTol", label: "Ortho window", kind: "range", min: 1, max: 30, step: 1, unit: "°", showIf: (p) => !!p.orthoSnap },
    ],
    hint: "Trace the image's lines into a connected node/edge graph — colour filter, despeckle, gap-close, spur pruning, simplify, vertex snap, endpoint bridging (T-junctions), ortho straightening and collinear merging. Feeds the Graph nodes.",
  },
  "object-detection": {
    type: "object-detection",
    label: "Object Detection",
    color: "#a21caf",
    // Action node: detects objects in the input image (Gemini) and outputs one Space (bounding box) per
    // object. The async detect bakes `_boxes` (world polygons); the eval reads them. Mirrors Image Tools →
    // Object Detection (box mode).
    hasInput: true,
    hasOutput: true,
    outputCount: (p) => p.outputMode === "single" ? 1 : Math.max(1, Math.min(80, Math.round(Number(p.handleCount) || 1))),
    defaultParams: { api_key: "", model: "gemini-robotics-er-1.6-preview", targets: "", maxItems: 20, outputMode: "perCell" },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Gemini API key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-robotics-er-1.6-preview" },
      { key: "targets", label: "Detect", kind: "text", placeholder: "e.g. trees, cars (blank = all)" },
      { key: "maxItems", label: "Max items", kind: "range", min: 1, max: 50, step: 1 },
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        options: [
          { value: "perCell", label: "Per object (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
    ],
    hint: "Detect objects in the image → one Space (bounding box) per object. Needs a Gemini key; click Detect.",
  },
  render: {
    type: "render",
    label: "Render",
    color: "#1d4ed8",
    hasInput: true,
    hasOutput: false,
    // Action node (not a geometry/recipe op): captures the 3D view's isometric snapshot and sends it
    // with the prompt to a Google AI image model, then shows the result + a download link. Mirrors the
    // Render tool in Global Tools.
    defaultParams: {
      api_key: "",
      model: "gemini-3.1-flash-image-preview",
      prompt: "Edit the attached architectural massing snapshot into a photorealistic render with daylight, realistic facade materials, landscaping, and sky.",
    },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-3.1-flash-image-preview" },
      { key: "prompt", label: "Prompt", kind: "textarea", placeholder: "Describe the render style…" },
    ],
    hint: "Render the 3D isometric view into a photorealistic image (Google AI).",
  },
  hatching: {
    type: "hatching",
    label: "Display Space",
    color: "#475569",
    // Pure styling node: takes a Space, passes its geometry straight through (so the pipeline can
    // continue), and paints a coloured fill / hatch pattern over it in the live preview. When "Hatch"
    // is off it's a flat colour fill at the given opacity; when on, a diagonal-line or random-dot
    // pattern (with spacing / angle / line-weight controls). Mirrors the Display block's hatch styling.
    hasInput: true,
    hasOutput: true,
    defaultParams: {
      color: "#0ea5e9",
      opacity: 0.5,
      hatch: true,
      hatchStyle: "diagonal",
      spacing: 8,
      angle: 45,
      weight: 1,
    },
    fields: [
      { key: "color", label: "Color", kind: "color" },
      { key: "opacity", label: "Opacity", kind: "range", min: 0, max: 1, step: 0.05 },
      { key: "hatch", label: "Hatch", kind: "checkbox" },
      {
        key: "hatchStyle",
        label: "Style",
        kind: "select",
        options: [
          { value: "diagonal", label: "Diagonal lines" },
          { value: "dots", label: "Random dots" },
        ],
        showIf: (p) => Boolean(p.hatch),
      },
      // Stripe period / dot density (px). Drives both diagonal-line spacing and the dot tile period.
      { key: "spacing", label: "Spacing", kind: "range", min: 3, max: 40, step: 1, unit: "px", showIf: (p) => Boolean(p.hatch) },
      // Diagonal only: rotation of the stripes (dots have no orientation).
      { key: "angle", label: "Angle", kind: "range", min: 0, max: 180, step: 1, unit: "°", showIf: (p) => Boolean(p.hatch) && p.hatchStyle === "diagonal" },
      // Line thickness (diagonal) / dot radius (dots), in px.
      { key: "weight", label: "Weight", kind: "range", min: 0.5, max: 5, step: 0.5, unit: "px", showIf: (p) => Boolean(p.hatch) },
    ],
    hint: "Paint the input Space with a colour fill or diagonal/dots hatch (passes the space through).",
  },
  "display-segment": {
    type: "display-segment",
    label: "Display Segment",
    color: "#b45309",
    // Two modes (the Buffer node is folded in here):
    //  • "line"     — restyle the incoming segment's stroke (line style / colour) + optional direction
    //                 arrow; the centerline is threaded downstream unchanged.
    //  • "buffered" — thicken the segment into a Space by `thickness` m (full ribbon width), with a buffer
    //                 Style (capsule / square / flat). Output is a Space → feeds the Space pipeline.
    // Schema-driven: wire a Schema into "gin-schema" (or attach one) and each segment styles per its own
    // schema values by role (wall-color / wall-linestyle / show-direction / wall-thickness / wall-
    // justification / hatch…); node params are the fallback. Styling is per-segment.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    valueInputs: [{ key: "thickness", label: "Thickness" }],
    defaultParams: {
      applyTo: "any",
      mode: "line",
      lineStyle: "solid",
      color: "#334155",
      weight: 2,
      showDirection: false,
      thickness: 0.2,
      justification: "center",
      bufferStyle: "capsule",
      hatch: false,
      hatchStyle: "diagonal",
      hatchSpacing: 8,
      hatchAngle: 45,
      hatchWeight: 1,
    },
    fields: [
      // Type self-filter (when a schema type discriminator is present): style only matching segments, so
      // it can coexist with Segment to Door / Window in the same flow without restyling them.
      {
        key: "applyTo",
        label: "Apply to",
        kind: "select",
        options: [
          { value: "any", label: "Any segment" },
          { value: "wall", label: "Walls only" },
          { value: "door", label: "Doors only" },
          { value: "window", label: "Windows only" },
        ],
      },
      {
        key: "mode",
        label: "Mode",
        kind: "select",
        options: [
          { value: "line", label: "Line" },
          { value: "buffered", label: "Buffered" },
        ],
      },
      {
        key: "lineStyle",
        label: "Line Style",
        kind: "select",
        role: "wall-linestyle",
        options: [
          { value: "solid", label: "Solid" },
          { value: "dashed", label: "Dashed" },
          { value: "dotted", label: "Dotted" },
        ],
        showIf: (p) => p.mode !== "buffered",
      },
      { key: "color", label: "Color", kind: "color", role: "wall-color" },
      // Arrow at the segment midpoint, pointing source → target — shown in both Line and Buffered modes.
      { key: "showDirection", label: "Show Direction", kind: "checkbox", role: "show-direction" },
      // Buffered mode — thickness (the full ribbon width, replaces the old Buffer radius) + cap style.
      { key: "thickness", label: "Thickness", kind: "range", min: 0.02, max: 10, step: 0.02, unit: "m", role: "buffer-thickness", showIf: (p) => p.mode === "buffered" },
      // Which side of the centerline the ribbon sits on: Center = symmetric; Left / Right = entirely on
      // that side (inner edge on the centerline).
      {
        key: "justification",
        label: "Justification",
        kind: "select",
        role: "wall-justification",
        options: [
          { value: "left", label: "Left" },
          { value: "center", label: "Center" },
          { value: "right", label: "Right" },
        ],
        showIf: (p) => p.mode === "buffered",
      },
      {
        key: "bufferStyle",
        label: "Buffer Style",
        kind: "select",
        options: [
          { value: "capsule", label: "Capsule (round)" },
          { value: "square", label: "Square (extended)" },
          { value: "flat", label: "Flat (butt)" },
        ],
        showIf: (p) => p.mode === "buffered",
      },
      // Hatch — fill the buffered ribbon with a pattern instead of a solid colour (mirrors the Segment
      // Display block's hatch in the canvas Properties tab). Buffered mode only (line has no fill area).
      { key: "hatch", label: "Hatch", kind: "checkbox", role: "hatch", showIf: (p) => p.mode === "buffered" },
      {
        key: "hatchStyle",
        label: "Hatch Style",
        kind: "select",
        role: "hatch-style",
        options: [
          { value: "diagonal", label: "Diagonal lines" },
          { value: "dots", label: "Random dots" },
        ],
        showIf: (p) => p.mode === "buffered" && Boolean(p.hatch),
      },
      { key: "hatchSpacing", label: "Spacing", kind: "range", min: 3, max: 40, step: 1, unit: "px", role: "hatch-spacing", showIf: (p) => p.mode === "buffered" && Boolean(p.hatch) },
      { key: "hatchAngle", label: "Angle", kind: "range", min: 0, max: 180, step: 1, unit: "°", role: "hatch-angle", showIf: (p) => p.mode === "buffered" && Boolean(p.hatch) && p.hatchStyle === "diagonal" },
      { key: "hatchWeight", label: "Weight", kind: "range", min: 0.5, max: 5, step: 0.5, unit: "px", showIf: (p) => p.mode === "buffered" && Boolean(p.hatch) },
    ],
    hint: "Display a segment — Line (restyle stroke + direction arrow) or Buffered (thicken to a Space by Thickness, with a buffer style + optional hatch fill). Buffered output feeds the Space pipeline.",
  },
  "display-node": {
    type: "display-node",
    label: "Display Node",
    color: "#475569",
    // Styling pass-through for nodes (points): draw the incoming node as a marker — shape, stroke style,
    // colour, size and an optional diagonal/dots hatch fill — and thread it downstream unchanged. Mirrors
    // the Node Display block in the canvas Properties tab.
    // Schema-driven: wire a Schema into "gin-schema" (or attach one) and each node styles per its own
    // schema values by role (node-shape / node-style / node-color / node-size / node-hatch…); node params
    // are the fallback. Styling is per-node.
    hasInput: true,
    hasOutput: true,
    geomInputs: [{ key: "schema", label: "Schema" }],
    // PILOT: a params OUTPUT endpoint (violet `pout`, right side) so this node's fields can be wired into
    // an Input Schema node's params input to derive a Node schema from them.
    exposesParams: true,
    defaultParams: {
      applyTo: "any",
      shape: "dot",
      style: "solid",
      color: "#475569",
      size: 1,
      hatch: false,
      hatchStyle: "diagonal",
      spacing: 8,
      angle: 45,
      weight: 1,
    },
    fields: [
      // Type self-filter (when a schema type discriminator is present): mark only matching nodes, so it
      // can coexist with Node to Object without re-marking object nodes.
      {
        key: "applyTo",
        label: "Apply to",
        kind: "select",
        options: [
          { value: "any", label: "Any node" },
          { value: "node", label: "Nodes only" },
          { value: "object", label: "Objects only" },
        ],
      },
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        role: "node-shape",
        options: [
          { value: "dot", label: "Dot" },
          { value: "circle", label: "Circle" },
          { value: "square", label: "Square" },
          { value: "triangle", label: "Triangle" },
        ],
      },
      {
        key: "style",
        label: "Style",
        kind: "select",
        role: "node-style",
        options: [
          { value: "solid", label: "Solid" },
          { value: "dashed", label: "Dashed" },
          { value: "dotted", label: "Dotted" },
        ],
      },
      { key: "color", label: "Color", kind: "color", role: "node-color" },
      { key: "size", label: "Size", kind: "range", min: 0.5, max: 5, step: 0.5, unit: "×", role: "node-size" },
      { key: "hatch", label: "Hatch", kind: "checkbox", role: "node-hatch" },
      {
        key: "hatchStyle",
        label: "Hatch Style",
        kind: "select",
        role: "node-hatch-style",
        options: [
          { value: "diagonal", label: "Diagonal lines" },
          { value: "dots", label: "Random dots" },
        ],
        showIf: (p) => Boolean(p.hatch),
      },
      { key: "spacing", label: "Spacing", kind: "range", min: 3, max: 40, step: 1, unit: "px", role: "node-hatch-spacing", showIf: (p) => Boolean(p.hatch) },
      { key: "angle", label: "Angle", kind: "range", min: 0, max: 180, step: 1, unit: "°", role: "node-hatch-angle", showIf: (p) => Boolean(p.hatch) && p.hatchStyle === "diagonal" },
      { key: "weight", label: "Weight", kind: "range", min: 0.5, max: 5, step: 0.5, unit: "px", showIf: (p) => Boolean(p.hatch) },
    ],
    hint: "Draw the input node as a marker — shape / style / colour / size / hatch (passes the node through).",
  },
  bua: {
    type: "bua",
    label: "BUA Calculator",
    color: "#0d9488",
    // Calculator: takes a space as input to read its plot area (falls back to the Plot area param when
    // unconnected). Emits scalar BUA values, and passes its input Space straight through on the main
    // geometry output (no-op) so the same space can continue down the pipeline.
    hasInput: true,
    hasOutput: true,
    valueOutputs: [
      { key: "fsiBua", label: "FSI BUA", unit: "m²" },
      { key: "nonFsiBua", label: "Non-FSI BUA", unit: "m²" },
    ],
    // Mirrors the BUA Calculator block's input fields (defaults match the block). Plot area comes from
    // the wired-in space, so it isn't a field here.
    defaultParams: {
      amenityOsRate: 0.1,
      losRate: 0.15,
      basicFsiMultiplier: 1.0,
      premiumFsiMultiplier: 0.5,
      tdrMultiplier: 0.9,
      fungibleRate: 0.35,
      schemeFsiSqm: 11721.6,
      inSituFsiFactor: 2,
      carParksRequired: 417,
      areaPerCarParkSqm: 30,
      otherNonFsiSqm: 6000,
      wingsPerFloor: 5,
      podiumOffsetM: 3.5,
      // Pass-through layout knobs (each emitted as a value output for wiring into Inset / Split /
      // Optimise Rectangle).
      front: 0,
      remaining: 0,
      edgeIndex: 0,
      ratio: "50, 50",
      splitAngle: 0,
      axisTilt: 0,
      rectangles: 1,
      optimiseAxisTilt: false,
    },
    fields: [
      { key: "amenityOsRate", label: "Amenity OS Rate", kind: "number", min: 0, max: 1, step: 0.01 },
      { key: "losRate", label: "LOS Rate", kind: "number", min: 0, max: 1, step: 0.01 },
      { key: "basicFsiMultiplier", label: "Basic FSI", kind: "number", min: 0, step: 0.1 },
      { key: "premiumFsiMultiplier", label: "Premium FSI", kind: "number", min: 0, step: 0.1 },
      { key: "tdrMultiplier", label: "TDR FSI", kind: "number", min: 0, step: 0.1 },
      { key: "fungibleRate", label: "Fungible Rate", kind: "number", min: 0, max: 1, step: 0.05 },
      { key: "schemeFsiSqm", label: "Scheme FSI (m²)", kind: "number", min: 0, step: 10 },
      { key: "inSituFsiFactor", label: "In-Situ FSI (×)", kind: "number", min: 0, step: 0.5 },
      { key: "carParksRequired", label: "Car Parks (nos)", kind: "number", min: 0, step: 1 },
      { key: "areaPerCarParkSqm", label: "Area/Car Park (m²)", kind: "number", min: 0, step: 1 },
      { key: "otherNonFsiSqm", label: "Other Non-FSI (m²)", kind: "number", min: 0, step: 100 },
      { key: "wingsPerFloor", label: "Wings / Cores", kind: "number", min: 1, step: 1 },
      { key: "podiumOffsetM", label: "Podium Offset (m)", kind: "number", min: 0, step: 0.5, output: true },
      // Pass-through layout knobs — each has its own value-output endpoint (right) to wire downstream.
      { key: "front", label: "Front offset", kind: "range", min: 0, max: 6, step: 0.1, unit: "m", output: true },
      { key: "remaining", label: "Remaining offset", kind: "range", min: 0, max: 6, step: 0.1, unit: "m", output: true },
      { key: "edgeIndex", label: "Edge index", kind: "range", min: 0, max: 15, step: 1, output: true },
      // Ratio: a list like "10, 90" passed through verbatim — wire into Split's Ratio input for a 10:90 cut.
      { key: "ratio", label: "Ratio", kind: "text", placeholder: "10, 90", output: true },
      { key: "splitAngle", label: "Split Angle", kind: "range", min: 0, max: 360, step: 1, unit: "°", output: true },
      { key: "axisTilt", label: "Axis tilt", kind: "range", min: 0, max: 360, step: 1, unit: "°", output: true },
      { key: "rectangles", label: "Rectangles", kind: "range", min: 1, max: 5, step: 1, output: true },
      { key: "optimiseAxisTilt", label: "Optimise axis tilt", kind: "checkbox", output: true },
    ],
    hint: "Connect a space for plot area → FSI BUA (max permissible) + Non-FSI BUA.",
  },
  math: {
    type: "math",
    label: "Math",
    color: "#ca8a04",
    // Generic value calculator: result = A <op> B, optionally rounded. A/B come from wired value
    // inputs (else the fallback fields). E.g. FSI BUA ÷ footprint area, ceil → number of floors.
    hasInput: false,
    hasOutput: false,
    valueInputs: [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ],
    valueOutputs: [{ key: "result", label: "Result" }],
    defaultParams: { a: 0, b: 1, op: "divide", round: "ceil" },
    fields: [
      { key: "a", label: "A (if no input)", kind: "number", step: 1 },
      { key: "b", label: "B (if no input)", kind: "number", step: 1 },
      {
        key: "op",
        label: "Operation",
        kind: "select",
        options: [
          { value: "divide", label: "÷ Divide (A ÷ B)" },
          { value: "multiply", label: "× Multiply" },
          { value: "add", label: "+ Add" },
          { value: "subtract", label: "− Subtract (A − B)" },
        ],
      },
      {
        key: "round",
        label: "Round",
        kind: "select",
        options: [
          { value: "none", label: "None" },
          { value: "ceil", label: "Ceil (round up)" },
          { value: "floor", label: "Floor (round down)" },
          { value: "round", label: "Nearest" },
        ],
      },
    ],
    hint: "result = A (op) B, optionally rounded. e.g. BUA ÷ footprint, ceil = floors.",
  },
  random: {
    type: "random",
    label: "Random",
    color: "#9333ea",
    // Value generator: a DETERMINISTIC pseudo-random number in [min, max], rounded to `decimals` places.
    // The draw is keyed on `seed` so the live preview is stable (and matches commit) — "Re-roll" bumps
    // the seed for a fresh number. min / max are wireable (valin-min / valin-max).
    hasInput: false,
    hasOutput: false,
    valueInputs: [
      { key: "min", label: "Min" },
      { key: "max", label: "Max" },
    ],
    valueOutputs: [{ key: "result", label: "Result" }],
    defaultParams: { min: 0, max: 10, decimals: 0, seed: 1 },
    fields: [
      { key: "min", label: "Min (if no input)", kind: "number", step: 1 },
      { key: "max", label: "Max (if no input)", kind: "number", step: 1 },
      { key: "decimals", label: "Decimal places", kind: "range", min: 0, max: 6, step: 1 },
      { key: "seed", label: "Seed", kind: "number", min: 1, step: 1 },
    ],
    hint: "Random number in [min, max] with N decimals. Seeded (stable) — press Re-roll for a new draw.",
  },
  output: {
    type: "output",
    label: "Output Metrics",
    color: "#0d9488",
    // A terminal collector: wire any node's `val-*` output into one of its named slots; the slot's value
    // is surfaced live on the node and in the Space's Metrics tab. Slots auto-grow + are user-named, so
    // its endpoints are dynamic (driven by params.slots) rather than the static valueInputs list.
    hasInput: false,
    hasOutput: false,
    defaultParams: { slots: [{ id: "s1", label: "" }] },
    fields: [],
    hint: "Collect values from any node into named metrics (shown in the Metrics tab).",
  },
  "space-geometry": {
    type: "space-geometry",
    label: "Space Geometry",
    color: "#0891b2",
    // Measures the input space. Forwards the polygon unchanged on the main output (so it can sit inline)
    // and exposes three scalar value outputs: area (m²), perimeter (m), and vertex count.
    hasInput: true,
    hasOutput: true,
    valueOutputs: [
      { key: "area", label: "Area", unit: "m²" },
      { key: "perimeter", label: "Perimeter", unit: "m" },
      { key: "vertices", label: "Vertices" },
    ],
    defaultParams: {},
    fields: [],
    hint: "Measure the input space — outputs Area, Perimeter and vertex count.",
  },
  merge: {
    type: "merge",
    label: "Merge",
    color: "#16a34a",
    // Boolean UNION of every connected space → one combined Space (the outer outline). Fuses adjacent or
    // overlapping spaces back into a single footprint. Abutting/touching spaces use an EXACT vector union
    // (dissolve shared walls, straight edges); truly overlapping spaces fall back to a raster union whose
    // tilted edges are lightly stair-stepped. Disjoint inputs collapse to their largest blob (a single
    // Space can't carry separate islands).
    hasInput: true,
    hasOutput: true,
    defaultParams: {},
    fields: [],
    hint: "Union multiple input spaces into a single Space (their combined outer outline).",
  },
  "input-props": {
    type: "input-props",
    label: "Input Properties",
    color: "#9333ea",
    // Takes a Space (forwarded unchanged on the main output) and exposes user-defined adjustable
    // parameters — each renders its own control (slider / options / checkbox / textbox) and publishes
    // its current value as a `val-<propId>` output endpoint on the right. Endpoints are DYNAMIC (driven
    // by params.props), so the value-output handles are rendered from the prop list, not valueOutputs.
    hasInput: true,
    hasOutput: true,
    defaultParams: { props: [] },
    fields: [],
    hint: "Define adjustable parameters (slider / options / checkbox / text); each exposes its value as an output.",
  },
  "file-upload": {
    type: "file-upload",
    label: "File Upload",
    color: "#2563eb",
    // Input source (no geometry): pick a file from disk via the OS open dialog. Publishes the chosen
    // file's path (browsers expose only the name, not the absolute path) as a `val-path` text endpoint
    // so it can be wired into any value input / the Output node. The picker UI is rendered by the host.
    hasInput: false,
    hasOutput: false,
    // `path` → the file name (browsers don't expose the absolute path). `data` → the file's data URL
    // (data:<mime>;base64,…), kept transient (`_data`) so it isn't written into saved flows but can be
    // wired into an Analyse node's File input to send the bytes to Gemini.
    valueOutputs: [{ key: "path", label: "Path" }, { key: "data", label: "Data" }],
    defaultParams: { path: "", fileName: "" },
    fields: [],
    hint: "Pick a file (OS open dialog) → outputs its path (val-path) and data URL (val-data, e.g. for Analyse).",
  },
  text: {
    type: "text",
    label: "Text",
    color: "#475569",
    // Text value node: a string source / pass-through. Type text in the box, or wire a `val-*` string
    // into the `valin-text` input to override it. Re-publishes the resolved string on `val-text` for
    // downstream value consumers / the Output node. No geometry.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "text", label: "Text in" }],
    valueOutputs: [{ key: "text", label: "Text" }],
    defaultParams: { text: "" },
    fields: [
      { key: "text", label: "Text", kind: "textarea", placeholder: "Type text… (or wire an input)" },
    ],
    hint: "A text value — type it, or pass one in (valin-text); outputs it on val-text.",
  },
  analyse: {
    type: "analyse",
    label: "Analyse",
    color: "#1d4ed8",
    // Action node (like Render): sends a media file (PDF / image / audio / video) to Gemini with a system
    // prompt and shows the model's text answer. The media comes from EITHER the File input (a data URL —
    // wire a File Upload node's val-data here) OR the Url input / Url field (an http(s) link; the node
    // fetches the bytes and inlines them). The analysis text is also published on `val-result` for wiring.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "file", label: "File" }, { key: "url", label: "Url" }],
    valueOutputs: [{ key: "result", label: "Result" }],
    defaultParams: {
      api_key: "",
      model: "gemini-2.5-flash",
      url: "",
      systemPrompt: "Analyse the attached file and describe its contents in detail.",
    },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-2.5-flash" },
      // Url input: type a link here, or wire a value into the Url endpoint (valin-url) to override it.
      { key: "url", label: "Url", kind: "text", placeholder: "https://… (or wire the Url input)" },
      { key: "systemPrompt", label: "System Prompt", kind: "textarea", placeholder: "What should Gemini do with the file?" },
    ],
    hint: "Send a file (PDF/image/audio/video) or URL to Gemini with a system prompt → text analysis (val-result).",
  },
  generate: {
    type: "generate",
    label: "Generate",
    color: "#7c3aed",
    // Action node (like Render): text-to-media generation via the Google AI / Gemini API. The "Kind"
    // dropdown picks image / video / music and swaps the model to that kind's default (see
    // GENERATE_DEFAULT_MODEL): image → Gemini 2.5 Flash Image (generateContent), video → Veo 3
    // (predictLongRunning + poll), music → Lyria RealTime (live websocket). The result is shown on the
    // node with a download link. No geometry.
    hasInput: false,
    hasOutput: false,
    defaultParams: { kind: "image", api_key: "", model: "gemini-2.5-flash-image", prompt: "", searchWeb: false },
    fields: [
      {
        key: "kind",
        label: "Kind",
        kind: "select",
        options: [
          { value: "image", label: "Image" },
          { value: "video", label: "Video" },
          { value: "music", label: "Music" },
          { value: "text", label: "Text" },
        ],
      },
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "model id" },
      { key: "prompt", label: "Prompt", kind: "textarea", placeholder: "Describe what to generate…" },
      // Text only: ground the answer with Google Search (Gemini's google_search tool).
      { key: "searchWeb", label: "Search web", kind: "checkbox", showIf: (p) => p.kind === "text" },
    ],
    hint: "Generate image / video / music from a prompt (Google AI) — the result is downloadable.",
  },
};

/** Data carried on every React Flow node. */
export interface FlowNodeData extends Record<string, unknown> {
  tool: FlowToolType;
  params: Record<string, unknown>;
  /** Injected by the host so a node can write param edits back into graph state. */
  onParamChange?: (nodeId: string, key: string, value: unknown) => void;
  /** Injected by the host — the Render node's "Generate" action (captures the 3D view + calls the AI). */
  onRunRender?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Object Detection node's "Detect" action (runs Gemini, bakes `_boxes`). */
  onRunDetect?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Analyse node's "Analyse" action (sends a file/url to Gemini, bakes `_result`). */
  onRunAnalyse?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Generate node's "Generate" action (image/video/music via Google AI, bakes `_resultUrl`). */
  onRunGenerate?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Layout Generation node's "Generate" action (runs the floorplan generator on
   *  the wired Space and loads it as the canvas's editable layout: draggable seeds + connections/repulsions). */
  onRunLayoutGen?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Layout Generation node's "Run Annealing" action (simulated annealing). */
  onRunAnneal?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Layout Generation node's "Add Room" action (enter add-room-on-canvas mode:
   *  the next canvas click drops a new room into the current generated layout). */
  onAddRoom?: (nodeId: string, params: Record<string, unknown>) => void;
}

/** Default model per Generate-node media kind. Changing the kind dropdown swaps the model to its default
 *  (https://ai.google.dev/gemini-api/docs — image: Gemini 2.5 Flash Image "Nano Banana"; video: Veo 3;
 *  music: Lyria RealTime). */
export const GENERATE_DEFAULT_MODEL: Record<string, string> = {
  image: "gemini-2.5-flash-image",
  video: "veo-3.0-generate-001",
  music: "lyria-3-pro-preview",
  text: "gemini-2.5-flash",
};
