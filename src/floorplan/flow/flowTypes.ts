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

export type FlowToolType = "source" | "inset" | "split" | "optimise-rect" | "skeleton" | "place-object" | "bsp" | "voronoi" | "conditional" | "bounding-shape" | "convex-hull" | "convex-decomp" | "smoothing" | "contour" | "floor-massing" | "render" | "bua" | "math";

/** One editable parameter exposed on a node. The `key` is written verbatim into the op's
 *  `params`, so these map 1:1 to the keys `applyRecipeJson`'s tool handlers read. */
export interface ParamField {
  key: string;
  label: string;
  kind: "number" | "range" | "select" | "checkbox" | "text" | "textarea";
  options?: { value: string; label: string }[];
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
}

export interface FlowToolDef {
  type: FlowToolType;
  label: string;
  /** Accent colour for the node header. */
  color: string;
  /** Whether the node has an input handle (consumes upstream rooms) / output handle. */
  hasInput: boolean;
  hasOutput: boolean;
  /** Number of output handles for this node given its params. Omitted → (hasOutput ? 1 : 0).
   *  Split returns N (one handle per piece) so a single piece can be wired onward. */
  outputCount?: (params: Record<string, unknown>) => number;
  /** Optional labels for the output handles (index-aligned). Omitted → "P1", "P2", … is used.
   *  The Conditional node uses ["T", "F"] to mark its True / False routes. */
  outputLabels?: string[];
  /** Extra SCALAR output endpoints (values, not polygons) — e.g. Inset's "area". Rendered as amber
   *  handles (id `val-<key>`) below the geometry outputs; the live value is shown on the node and
   *  baked under params._values for the badge. */
  valueOutputs?: { key: string; label: string; unit?: string }[];
  /** SCALAR input endpoints (amber target handles, id `valin-<key>`) — when wired from another node's
   *  value output, the incoming number OVERRIDES the param named `key` (e.g. Massing's `n` floors). */
  valueInputs?: { key: string; label: string }[];
  /** Default params (already in op-param shape — compiled verbatim into `params`). */
  defaultParams: Record<string, unknown>;
  fields: ParamField[];
  /** One-line description shown in the palette + node. */
  hint: string;
}

export const FLOW_TOOLS: Record<FlowToolType, FlowToolDef> = {
  source: {
    type: "source",
    label: "Selected Space",
    color: "#0f172a",
    hasInput: false,
    hasOutput: true,
    defaultParams: {},
    fields: [],
    hint: "Pipeline input — the space currently selected on the canvas.",
  },
  inset: {
    type: "inset",
    label: "Inset",
    color: "#0369a1",
    hasInput: true,
    hasOutput: true,
    // Second output endpoint: the inset polygon's area (m²) as a scalar value.
    valueOutputs: [{ key: "area", label: "Area", unit: "m²" }],
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
    },
    fields: [
      { key: "inside", label: "Inside", kind: "checkbox" },
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
    hint: "Offset the boundary inward → produces an Inset Area space. Equal / Front&Remaining / Per-edge.",
  },
  "optimise-rect": {
    type: "optimise-rect",
    label: "Optimise Rectangle",
    color: "#7c3aed",
    hasInput: true,
    hasOutput: true,
    // Second output endpoint: total packed rectangle area (m²) — sum of all placed rects / union.
    valueOutputs: [{ key: "area", label: "Area", unit: "m²" }],
    // Mirrors the Optimise Rectangle block (recipe-supported params). Per-edge reference and
    // the layout-variations modal aren't exposed on the node.
    defaultParams: {
      shape: "rectangle",
      reference: "none",
      referenceEdge: 0,
      axisAngle: 0,
      count: 1,
      union: false,
      optimiseAxisTilt: false,
      shrinkEnabled: false,
      targetArea: 50,
      shrinkAngle: 0,
      shrinkSlide: 0,
      optimiseShrinkEnabled: false,
      exactArea: false,
    },
    fields: [
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "rectangle", label: "Rectangle" },
          { value: "square", label: "Square" },
          { value: "hexagon", label: "Hexagon" },
          { value: "lshape", label: "L-shape" },
        ],
      },
      {
        key: "reference",
        label: "Reference",
        kind: "select",
        options: [
          { value: "none", label: "None (any-angle)" },
          { value: "custom", label: "Custom angle" },
          { value: "by-edge", label: "By edge" },
        ],
      },
      { key: "referenceEdge", label: "Edge index", kind: "range", min: 0, max: 19, step: 1, showIf: (p) => p.reference === "by-edge" },
      // Optimise axis tilt: auto-pick the Custom angle that maximises the packed area (sweeps tilt).
      { key: "optimiseAxisTilt", label: "Optimise axis tilt", kind: "checkbox", showIf: (p) => p.reference === "custom" },
      // Axis tilt: absolute angle for Custom; an offset on the edge angle for By edge. Hidden for
      // Custom when "Optimise axis tilt" is on (the angle is chosen automatically).
      { key: "axisAngle", label: "Axis tilt", kind: "range", min: 0, max: 180, step: 0.5, unit: "°", showIf: (p) => (p.reference === "custom" && !p.optimiseAxisTilt) || p.reference === "by-edge" },
      { key: "count", label: "Rectangles (n)", kind: "range", min: 1, max: 20, step: 1 },
      { key: "union", label: "Union", kind: "checkbox", showIf: (p) => Number(p.count) > 1 },
      { key: "shrinkEnabled", label: "Shrink to target", kind: "checkbox" },
      { key: "targetArea", label: "Target area", kind: "range", min: 0, max: 500, step: 0.5, unit: "m²", showIf: (p) => Boolean(p.shrinkEnabled) },
      { key: "shrinkAngle", label: "Shrink angle", kind: "range", min: 0, max: 360, step: 1, unit: "°", showIf: (p) => Boolean(p.shrinkEnabled) },
      { key: "optimiseShrinkEnabled", label: "Optimise shrink", kind: "checkbox", showIf: (p) => Boolean(p.shrinkEnabled) },
      { key: "shrinkSlide", label: "Shrink slide", kind: "range", min: 0, max: 100, step: 0.1, unit: "%", showIf: (p) => Boolean(p.shrinkEnabled) && !p.optimiseShrinkEnabled },
      { key: "exactArea", label: "Exact area", kind: "checkbox", showIf: (p) => Boolean(p.shrinkEnabled) },
    ],
    hint: "Fit the largest rectangle(s) inside the input space.",
  },
  split: {
    type: "split",
    label: "Split",
    color: "#0d9488",
    hasInput: true,
    hasOutput: true,
    // One output handle per resulting piece: Strip → up to 3 bands; Ratio → one per ratio entry;
    // otherwise `count` pieces.
    outputCount: (p) => {
      if (p.type === "strip") return 3;
      if (p.type === "normal" && p.mode === "ratio") {
        const n = parseSplitRatios(p.ratios).length;
        if (n >= 1) return Math.max(1, Math.min(12, n));
      }
      return Math.max(1, Math.min(12, Math.round(Number(p.count) || 2)));
    },
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
    hint: "Compute the medial axis / straight skeleton of the input space.",
  },
  "place-object": {
    type: "place-object",
    label: "Place Object",
    color: "#db2777",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Place Object Along Boundary block (single object on a node). Length runs along
    // the boundary edge; breadth + setback push into the space from the wall.
    defaultParams: { kind: "bed", length: 2, breadth: 1.6, position: 25, setback: 0 },
    fields: [
      {
        key: "kind",
        label: "Type",
        kind: "select",
        options: [
          { value: "bed", label: "Bed" },
          { value: "table", label: "Table" },
          { value: "sofa", label: "Sofa" },
          { value: "desk", label: "Desk" },
          { value: "wardrobe", label: "Wardrobe" },
          { value: "fridge", label: "Fridge" },
          { value: "toilet", label: "Toilet" },
          { value: "bathtub", label: "Bathtub" },
        ],
      },
      { key: "length", label: "Length", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "breadth", label: "Breadth", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "position", label: "Position", kind: "range", min: 0, max: 100, step: 0.5, unit: "%" },
      { key: "setback", label: "Setback", kind: "range", min: 0, max: 5, step: 0.05, unit: "m" },
    ],
    hint: "Place an object's footprint along the input space's boundary.",
  },
  bsp: {
    type: "bsp",
    label: "BSP",
    color: "#c026d3",
    hasInput: true,
    hasOutput: true,
    // One output handle per seed/cell. Seeds are auto-distributed along the longer axis (matches
    // the engine), so increasing Seeds adds cells; each cell has its own output (like Split).
    outputCount: (p) => Math.max(1, Math.min(12, Math.round(Number(p.seeds) || 2))),
    defaultParams: { seeds: 3, tiltAngle: 0, useAreaPercent: false },
    fields: [
      { key: "seeds", label: "Seeds", kind: "range", min: 2, max: 12, step: 1 },
      { key: "tiltAngle", label: "Tilt", kind: "range", min: 0, max: 360, step: 1, unit: "°" },
      { key: "useAreaPercent", label: "Balance by weight", kind: "checkbox" },
    ],
    hint: "Binary-space-partition the input space into one cell per seed.",
  },
  voronoi: {
    type: "voronoi",
    label: "Voronoi",
    color: "#2563eb",
    hasInput: true,
    hasOutput: true,
    // Seeds ARE the input space's vertices → exactly one cell per vertex, and one output handle per
    // cell (like Split / BSP). The vertex count isn't known from params alone (it depends on the
    // upstream polygon), so the host bakes the live input vertex count into `vertexCount`; this
    // drives both the handle count and the compiled `produces` list.
    outputCount: (p) => Math.max(2, Math.min(40, Math.round(Number(p.vertexCount) || 2))),
    defaultParams: { metric: "euclidean", relax: false },
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
      { key: "relax", label: "Relax seeds", kind: "checkbox" },
    ],
    hint: "Voronoi-partition the space — one cell per vertex. Metric: Euclidean (cells) / Manhattan / Chebyshev; Relax = Lloyd/CVT.",
  },
  conditional: {
    type: "conditional",
    label: "Conditional",
    color: "#b45309",
    hasInput: true,
    hasOutput: true,
    // A gate: reads the input space's metrics, tests one against a value, and routes the SAME
    // polygon to its True (handle 0) or False (handle 1) output — the other output stays empty so
    // anything wired to it is skipped. Always two handles, labelled T / F.
    outputCount: () => 2,
    outputLabels: ["T", "F"],
    defaultParams: { metric: "area", op: "gt", value: 30 },
    fields: [
      { key: "metric", label: "Metric", kind: "select", options: CONDITION_METRIC_OPTIONS },
      { key: "op", label: "Condition", kind: "select", options: CONDITION_OP_OPTIONS },
      { key: "value", label: "Value", kind: "number", step: 0.5 },
    ],
    hint: "Route the space to True / False by a metric test (e.g. area > 30).",
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
    // four methods. Tolerance only applies to ACD. A single output handle fans out over all pieces.
    defaultParams: { type: "hertel-mehlhorn", tolerance: 10 },
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
        ],
      },
      { key: "tolerance", label: "Tolerance", kind: "range", min: 0, max: 40, step: 0.5, unit: "°", showIf: (p) => p.type === "acd" },
    ],
    hint: "Decompose a concave space into convex pieces (Hertel–Mehlhorn / Bayazit / ACD / Steiner).",
  },
  smoothing: {
    type: "smoothing",
    label: "Smoothing",
    color: "#9f1239",
    hasInput: true,
    hasOutput: true,
    // Mirrors the Smoothing block: Chaikin corner-cutting or Bézier corner fillets, a smoothing
    // level, restrict-inside reflex handling, and a post curve-shortening pass.
    defaultParams: { type: "chaikin", level: 0.4, restrictInside: false, curveShortening: 0 },
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
    valueInputs: [{ key: "n", label: "Floors" }],
    defaultParams: { direction: "upward", n: 1 },
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
      { key: "n", label: "Floors (n)", kind: "range", min: 1, max: 50, step: 1 },
    ],
    hint: "Set the space as Footprint (up) / Basement (down) Area with n floors.",
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
    // unconnected). No geometry output — just scalar BUA values out.
    hasInput: true,
    hasOutput: false,
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
      { key: "podiumOffsetM", label: "Podium Offset (m)", kind: "number", min: 0, step: 0.5 },
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
};

/** Data carried on every React Flow node. */
export interface FlowNodeData extends Record<string, unknown> {
  tool: FlowToolType;
  params: Record<string, unknown>;
  /** Injected by the host so a node can write param edits back into graph state. */
  onParamChange?: (nodeId: string, key: string, value: unknown) => void;
  /** Injected by the host — the Render node's "Generate" action (captures the 3D view + calls the AI). */
  onRunRender?: (nodeId: string, params: Record<string, unknown>) => void;
}
