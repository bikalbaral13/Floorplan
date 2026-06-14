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

export type FlowToolType = "source" | "space-creator" | "graph-source" | "segment-source" | "node-source" | "canvas-source" | "separate" | "buffer" | "bloom" | "pull" | "transform" | "show-direction" | "densify" | "inset" | "split" | "optimise-rect" | "skeleton" | "place-object" | "bsp" | "voronoi" | "conditional" | "param-manip" | "bounding-shape" | "convex-hull" | "convex-decomp" | "smoothing" | "contour" | "floor-massing" | "mitered-join" | "graph-smooth" | "graph-metrics" | "graph-to-spaces" | "longest-branch" | "graph-reduce" | "voronoi-bloom" | "spring-layout" | "pipe-solver" | "schema" | "output-schema" | "segment-split" | "image" | "vectorise" | "object-detection" | "mesh" | "circle-packing" | "treemap" | "rect-pack" | "point" | "visibility" | "render" | "bua" | "math" | "random" | "output" | "space-geometry" | "input-props" | "merge" | "file-upload" | "text" | "analyse" | "generate";

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
  kind: "number" | "select" | "checkbox" | "text";
  unit: string;
  /** Default value (applies until the user edits the component's own value). */
  def: number | string | boolean;
  min: number;
  max: number;
  step: number;
  options: string[];
  /** Optional solver binding (e.g. "demand", "diameter") — consumed by solver nodes. */
  role: string;
}

/** The four Schema-node sections, in display order. `param` is the params key holding the list. */
export const SCHEMA_SECTIONS = [
  { param: "nodeProps", title: "Node Schema" },
  { param: "segmentProps", title: "Segment Schema" },
  { param: "spaceProps", title: "Space Schema" },
  { param: "graphProps", title: "Graph Schema" },
] as const;
export type SchemaSectionParam = (typeof SCHEMA_SECTIONS)[number]["param"];

/** Normalise one Schema-node section's params entry into its row list. */
export const schemaEntries = (params: Record<string, unknown>, param: SchemaSectionParam): SchemaPropEntry[] => {
  const raw = params[param];
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const kind = (["number", "select", "checkbox", "text"].includes(o.kind as string) ? o.kind : "number") as SchemaPropEntry["kind"];
    const def: string | number | boolean =
      kind === "checkbox" ? o.def === true
      : kind === "number" ? (Number(o.def) || 0)
      : typeof o.def === "string" ? o.def : String(o.def ?? "");
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
    };
  });
};

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

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
      options: e.kind === "select" ? e.options.map((v) => ({ value: v })) : undefined,
      role: e.role.trim() || undefined,
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
} => ({
  name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined,
  node: sectionToResultDefs(schemaEntries(params, "nodeProps")),
  segment: sectionToResultDefs(schemaEntries(params, "segmentProps")),
  space: sectionToResultDefs(schemaEntries(params, "spaceProps")),
  graph: sectionToResultDefs(schemaEntries(params, "graphProps")),
});

/** All four sections of a Schema node as Properties-tab definitions. */
export const schemaNodeToSchemas = (params: Record<string, unknown>): {
  name?: string;
  node: import("../types").GraphPropDef[];
  segment: import("../types").GraphPropDef[];
  space: import("../types").GraphPropDef[];
  graph: import("../types").GraphPropDef[];
} => ({
  name: typeof params.name === "string" && params.name.trim() ? params.name.trim() : undefined,
  node: sectionToDefs(schemaEntries(params, "nodeProps")),
  segment: sectionToDefs(schemaEntries(params, "segmentProps")),
  space: sectionToDefs(schemaEntries(params, "spaceProps")),
  graph: sectionToDefs(schemaEntries(params, "graphProps")),
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
  kind: "number" | "range" | "select" | "checkbox" | "text" | "textarea";
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
    hasInput: false,
    hasOutput: true,
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
    // Generator (no input): the whole canvas, exposed as five typed output endpoints. Each endpoint carries
    // EVERY item of its kind (multiple), so downstream nodes can consume all spaces / nodes / segments /
    // graphs / image footprints at once. Independent of the current selection.
    hasInput: false,
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
    color: "#7c2d12",
    // Graph node: strokes an incoming GRAPH (polylines — e.g. Skeleton in Branches mode) into a closed
    // ribbon of `width` metres, mitred at shared endpoints (junctions). Output = the ribbon polygons.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "width", label: "Width" }],
    // Output handles: "single" → one endpoint carrying every ribbon Space; "perCell" → one endpoint per
    // ribbon Space (baked live into `handleCount`). Union collapses to a single Space → one handle either way.
    outputCount: (p) => (p.union || p.outputMode === "single") ? 1 : Math.max(1, Math.min(60, Math.round(Number(p.handleCount) || 1))),
    // Optional second geometry input: the Space to clip the ribbon to (id `gin-boundary`). Unwired →
    // falls back to auto-detecting the upstream Skeleton's source space.
    geomInputs: [{ key: "boundary", label: "Clip space" }],
    defaultParams: { width: 2, join: "sharp", clipToBoundary: true, union: false, outputMode: "perCell" },
    fields: [
      { key: "width", label: "Width", kind: "range", min: 0.1, max: 20, step: 0.1, unit: "m" },
      // Output style: separate per-Space handles, or a single bundle handle carrying every ribbon Space.
      // Hidden when Union is on (the result is already a single Space).
      {
        key: "outputMode",
        label: "Outputs",
        kind: "select",
        showIf: (p) => !p.union,
        options: [
          { value: "perCell", label: "Per cell (one each)" },
          { value: "single", label: "Single (all)" },
        ],
      },
      // Joint type at junctions/corners: Sharp = mitred corners; Curved = rounded (Chaikin) corners.
      {
        key: "join",
        label: "Joint type",
        kind: "select",
        options: [
          { value: "sharp", label: "Sharp (mitred)" },
          { value: "curved", label: "Curved (rounded)" },
        ],
      },
      // Trim the ribbon to the source space so leaf-branch end-caps don't poke past the boundary.
      { key: "clipToBoundary", label: "Clip to boundary", kind: "checkbox" },
      // Union: fuse the per-segment ribbon polygons into ONE Space (single outline) instead of emitting
      // each segment separately.
      { key: "union", label: "Union", kind: "checkbox" },
    ],
    hint: "Stroke a graph (polylines / Skeleton branches) into a ribbon of a set width — sharp or curved joints. Clip to boundary trims ends to the source space; Union merges the segments into a single Space.",
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
    defaultParams: { name: "", nodeProps: [], segmentProps: [], spaceProps: [], graphProps: [] },
    fields: [
      { key: "name", label: "Name", kind: "text", placeholder: "Schema name (optional)" },
    ],
    hint: "Define per-component input properties (Node / Segment / Space / Graph). Wire the output into a Graph or Space node to attach them — they surface in each component's Properties tab.",
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
