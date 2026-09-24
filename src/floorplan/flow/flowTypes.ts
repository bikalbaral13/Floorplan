/** Node-graph ("Flow") model for composing the stepwise space tools (Inset, Split,
 *  Optimise Rectangle, …) into a no-code pipeline. A flow compiles to the same recipe
 *  JSON the rest of the app already executes via `applyRecipeJson`, so the graph is just
 *  a visual editor over the existing operations engine. */

import { CONDITION_METRIC_OPTIONS, CONDITION_OP_OPTIONS } from "./conditional";
// Prototype: this ONE tool's definition is built from a data declaration file (params schema + handles +
// showWhen + instructions) instead of a hand-written literal — the pattern for a full node-declaration
// migration. The behaviour (evalOptimise) stays in code, dispatched by `tool` id in evaluateFlow.
import { buildToolDefFromDeclaration, type NodeDeclaration } from "./nodeDeclaration";
// The complete node declarations (full param schema + handles + showWhen + instructions) drive these tools'
// FLOW_TOOLS entries at build time — the whole "Reshape" category is now data-declared. Vite can't import
// from public/, so the BUNDLED copies live here under src/declarations/; the byte-identical copies under
// public/Library/Tools/Reshape/ are what the Import picker + agent fetch at runtime. Keep the
// two in sync (a full migration would load one copy via import.meta.glob and retire the other).
import optimiseRectDecl from "./declarations/optimise-rect.node.json";
import densifyDecl from "./declarations/densify.node.json";
import loopDecl from "./declarations/loop.node.json";
import matchDecl from "./declarations/match.node.json";
import loop3dDecl from "./declarations/loop-3d.node.json";
import insetDecl from "./declarations/inset.node.json";
import boundingShapeDecl from "./declarations/bounding-shape.node.json";
import convexHullDecl from "./declarations/convex-hull.node.json";
import smoothingDecl from "./declarations/smoothing.node.json";
import contourDecl from "./declarations/contour.node.json";
// 2d primitives
import pointDecl from "./declarations/point.node.json";
import verticesDecl from "./declarations/vertices.node.json";
import networkDecl from "./declarations/network.node.json";
import rectangleDecl from "./declarations/rectangle.node.json";
import arcDecl from "./declarations/arc.node.json";
import circleDecl from "./declarations/circle.node.json";
import polygonDecl from "./declarations/polygon.node.json";
import polylineDecl from "./declarations/polyline.node.json";
import lineDecl from "./declarations/line.node.json";
import ngonDecl from "./declarations/ngon.node.json";
import ellipseDecl from "./declarations/ellipse.node.json";
import roundedRectDecl from "./declarations/rounded-rect.node.json";
import sectorDecl from "./declarations/sector.node.json";
// Calculate
import buaDecl from "./declarations/bua.node.json";
import mathDecl from "./declarations/math.node.json";
import randomDecl from "./declarations/random.node.json";
import exprDecl from "./declarations/expr.node.json";
import fileUploadDecl from "./declarations/file-upload.node.json";
import textDecl from "./declarations/text.node.json";
import promptBuilderDecl from "./declarations/prompt-builder.node.json";
import planJsonDecl from "./declarations/plan-json.node.json";
import filterBySpaceDecl from "./declarations/filter-by-space.node.json";
// 3d primitives
import cuboidDecl from "./declarations/cuboid.node.json";
import cylinderDecl from "./declarations/cylinder.node.json";
import sphereDecl from "./declarations/sphere.node.json";
import coneDecl from "./declarations/cone.node.json";
import frustumDecl from "./declarations/frustum.node.json";
import taperedBoxDecl from "./declarations/tapered-box.node.json";
import torusDecl from "./declarations/torus.node.json";
import capsuleDecl from "./declarations/capsule.node.json";
import transform3dDecl from "./declarations/transform-3d.node.json";
import boolean3dDecl from "./declarations/boolean-3d.node.json";
import display3dDecl from "./declarations/display-3d.node.json";
import materialDecl from "./declarations/material.node.json";
// Segment
import segmentSourceDecl from "./declarations/segment-source.node.json";
import segmentSplitDecl from "./declarations/segment-split.node.json";
import displaySegmentDecl from "./declarations/display-segment.node.json";
// Node
import bloomDecl from "./declarations/bloom.node.json";
import nodeSourceDecl from "./declarations/node-source.node.json";
import nodeGeometryDecl from "./declarations/node-geometry.node.json";
import segmentGeometryDecl from "./declarations/segment-geometry.node.json";
import displayNodeDecl from "./declarations/display-node.node.json";
// Canvas
import canvasSourceDecl from "./declarations/canvas-source.node.json";
import freehandSourceDecl from "./declarations/freehand-source.node.json";
import freehandGeometryDecl from "./declarations/freehand-geometry.node.json";
import separateDecl from "./declarations/separate.node.json";
import filterByTypeDecl from "./declarations/filter-by-type.node.json";
import setObjectParamDecl from "./declarations/set-object-param.node.json";
import getObjectParamDecl from "./declarations/get-object-param.node.json";
// Mass
import massDecl from "./declarations/mass.node.json";
import inset3dDecl from "./declarations/inset-3d.node.json";
import smooth3dDecl from "./declarations/smooth-3d.node.json";
import meshTo3dDecl from "./declarations/mesh-to-3d.node.json";
// Graph
import graphSourceDecl from "./declarations/graph-source.node.json";
import miteredJoinDecl from "./declarations/mitered-join.node.json";
import graphToPathDecl from "./declarations/graph-to-path.node.json";
import graphSmoothDecl from "./declarations/graph-smooth.node.json";
import graphMetricsDecl from "./declarations/graph-metrics.node.json";
import graphGeometryDecl from "./declarations/graph-geometry.node.json";
import showDirectionDecl from "./declarations/show-direction.node.json";
import graphToSpacesDecl from "./declarations/graph-to-spaces.node.json";
import graphReduceDecl from "./declarations/graph-reduce.node.json";
import graphSimplifyDecl from "./declarations/graph-simplify.node.json";
import graphClipDecl from "./declarations/graph-clip.node.json";
import graphFitLinesDecl from "./declarations/graph-fit-lines.node.json";
import graphClassifyDecl from "./declarations/graph-classify.node.json";
import gridGeometryDecl from "./declarations/grid-geometry.node.json";
import renderGridDecl from "./declarations/render-grid.node.json";
import matrixTransposeDecl from "./declarations/matrix-transpose.node.json";
import matrixInverseDecl from "./declarations/matrix-inverse.node.json";
import matrixSolveDecl from "./declarations/matrix-solve.node.json";
import leastSquaresDecl from "./declarations/least-squares.node.json";
import matrixOpsDecl from "./declarations/matrix-ops.node.json";
import matrixShiftDecl from "./declarations/matrix-shift.node.json";
import vectorOpsDecl from "./declarations/vector-ops.node.json";
import vectorProductDecl from "./declarations/vector-product.node.json";
import matrixToGraphDecl from "./declarations/matrix-to-graph.node.json";
import render2dDecl from "./declarations/render-2d.node.json";
import render3dDecl from "./declarations/render-3d.node.json";
import exportDxfDecl from "./declarations/export-dxf.node.json";
import export3dDecl from "./declarations/export-3d.node.json";
import exportCanvasDecl from "./declarations/export-canvas.node.json";
import graphToMatrixDecl from "./declarations/graph-to-matrix.node.json";
import graphInterpreterDecl from "./declarations/graph-interpreter.node.json";
import canvasEncoderDecl from "./declarations/canvas-encoder.node.json";
import matrixReduceDecl from "./declarations/matrix-reduce.node.json";
import matrixEigenDecl from "./declarations/matrix-eigen.node.json";
import snapshotDecl from "./declarations/snapshot.node.json";
import setThicknessDecl from "./declarations/set-thickness.node.json";
import mergeGraphDecl from "./declarations/merge-graph.node.json";
import graphToOpeningsDecl from "./declarations/graph-to-openings.node.json";
import labelGraphDecl from "./declarations/label-graph.node.json";
import filterByLabelDecl from "./declarations/filter-by-label.node.json";
import voronoiBloomDecl from "./declarations/voronoi-bloom.node.json";
import springLayoutDecl from "./declarations/spring-layout.node.json";
import pipeSolverDecl from "./declarations/pipe-solver.node.json";
// Partition
import splitDecl from "./declarations/split.node.json";
import skeletonDecl from "./declarations/skeleton.node.json";
import bspDecl from "./declarations/bsp.node.json";
import corridoorDecl from "./declarations/corridoor.node.json";
import coreRackingDecl from "./declarations/core-racking.node.json";
import voronoiDecl from "./declarations/voronoi.node.json";
import convexDecompDecl from "./declarations/convex-decomp.node.json";
import meshDecl from "./declarations/mesh.node.json";
import circlePackingDecl from "./declarations/circle-packing.node.json";
import treemapDecl from "./declarations/treemap.node.json";
import rectPackDecl from "./declarations/rect-pack.node.json";
import visibilityDecl from "./declarations/visibility.node.json";
// Space
import sourceDecl from "./declarations/source.node.json";
import spaceCreatorDecl from "./declarations/space-creator.node.json";
import pullDecl from "./declarations/pull.node.json";
import transformDecl from "./declarations/transform.node.json";
import dimensionDecl from "./declarations/dimension.node.json";
import areaDimensionDecl from "./declarations/area-dimension.node.json";
import schemaDecl from "./declarations/schema.node.json";
import outputSchemaDecl from "./declarations/output-schema.node.json";
import layoutGenDecl from "./declarations/layout-gen.node.json";
import schemaToDrawingDecl from "./declarations/schema-to-drawing.node.json";
import schemaToLayersDecl from "./declarations/schema-to-layers.node.json";
import hatchingDecl from "./declarations/hatching.node.json";
import spaceGeometryDecl from "./declarations/space-geometry.node.json";
import mergeDecl from "./declarations/merge.node.json";
import boolean2dDecl from "./declarations/boolean-2d.node.json";
import inputPropsDecl from "./declarations/input-props.node.json";
import agentDecl from "./declarations/agent.node.json";

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

export type FlowToolType = "source" | "space-creator" | "graph-source" | "segment-source" | "segment-geometry" | "node-source" | "node-geometry" | "canvas-source" | "freehand-source" | "freehand-geometry" | "separate" | "filter-by-type" | "set-object-param" | "get-object-param" | "buffer" | "bloom" | "pull" | "transform" | "show-direction" | "densify" | "inset" | "split" | "optimise-rect" | "skeleton" | "place-object" | "bsp" | "corridoor" | "core-racking" | "voronoi" | "conditional" | "param-manip" | "bounding-shape" | "convex-hull" | "convex-decomp" | "smoothing" | "contour" | "floor-massing" | "mitered-join" | "graph-smooth" | "graph-metrics" | "graph-geometry" | "graph-to-spaces" | "graph-to-grid" | "grid-source" | "grid-field" | "cellular-automaton" | "laplace-solver" | "fill-depressions" | "flow-direction" | "flow-accumulation" | "watershed" | "morphology" | "grid-distance" | "grid-threshold" | "marching-squares" | "grid-geometry" | "render-grid" | "matrix-transpose" | "matrix-inverse" | "matrix-solve" | "least-squares" | "matrix-ops" | "matrix-shift" | "vector-ops" | "vector-product" | "matrix-to-graph" | "graph-to-matrix" | "graph-interpreter" | "canvas-encoder" | "render-2d" | "render-3d" | "matrix-reduce" | "matrix-eigen" | "dimension" | "area-dimension" | "longest-branch" | "graph-reduce" | "graph-simplify" | "graph-clip" | "graph-fit-lines" | "graph-classify" | "set-thickness" | "label-graph" | "merge-graph" | "graph-to-openings" | "voronoi-bloom" | "spring-layout" | "pipe-solver" | "schema" | "output-schema" | "segment-split" | "image" | "vectorise" | "object-detection" | "filter-by-label" | "mesh" | "circle-packing" | "treemap" | "rect-pack" | "point" | "visibility" | "render" | "bua" | "math" | "random" | "output" | "space-geometry" | "input-props" | "merge" | "boolean-2d" | "file-upload" | "text" | "prompt-builder" | "plan-json" | "filter-by-space" | "analyse" | "generate" | "hatching" | "display-segment" | "display-node" | "frame-builder" | "wall-builder" | "segment-to-door" | "segment-to-window" | "node-to-object" | "node-to-staircase" | "node-to-footing" | "footing" | "footing-to-plan" | "footing-to-elevation" | "footing-to-3d-mesh" | "mesh-to-3d" | "staircase" | "staircase-to-plan" | "staircase-to-left-elevation" | "staircase-to-right-elevation" | "staircase-to-front-elevation" | "staircase-to-back-elevation" | "staircase-to-3d-mesh" | "schema-to-drawing" | "schema-to-layers" | "floorplan-to-front-elevation" | "floorplan-to-back-elevation" | "floorplan-to-left-elevation" | "floorplan-to-right-elevation" | "views-layout" | "segment-to-3d" | "space-to-3d" | "pobj-source" | "grab-object" | "param-object" | "param-grab" | "param-geometry" | "param-output-metrics" | "layout-gen" | "expr" | "rectangle" | "arc" | "circle" | "polygon" | "polyline" | "vertices" | "network" | "cuboid" | "cylinder" | "sphere" | "cone" | "transform-3d" | "boolean-3d" | "display-3d" | "material" | "agent" | "loop" | "match" | "loop-3d" | "line" | "ngon" | "ellipse" | "rounded-rect" | "sector" | "frustum" | "tapered-box" | "torus" | "capsule" | "snapshot" | "export-dxf" | "export-3d" | "export-canvas";

// ── The "Geometry" node ─────────────────────────────────────────────────────────────────────────────
// ONE node in the Library, five canvas-source kernels behind it. The node's `kind` parameter IS its
// identity: switching it rewrites the node's `tool` to that kind's existing source tool (see
// FlowOverlay's onParamChange), carrying the shared identity params across. Deliberately a UI-level
// merge — the five tool ids stay the discriminator in evaluateFlow / compileFlow / the host resolvers,
// so nothing downstream changes and every saved flow keeps loading. The header reads "Geometry" (its
// `nodeLabel`) with the live kind as the muted suffix, so the node still says what it currently is.

/** Kind → the source tool that implements it. The order is the order the dropdown shows. */
export const GEOMETRY_KINDS: { value: string; label: string; tool: FlowToolType }[] = [
  { value: "point", label: "Point (node)", tool: "node-source" },
  { value: "segment", label: "Segment", tool: "segment-source" },
  { value: "space", label: "Space", tool: "source" },
  { value: "graph", label: "Graph", tool: "graph-source" },
  { value: "freehand", label: "Freehand", tool: "freehand-source" },
  // A picture is a canvas element like the rest now — it carries an `image_<uid>`, it has its own select
  // scope, and it answers to Grab from selection — so it belongs in the same node rather than beside it.
  // Selecting one retargets a grabbing Geometry node onto the Image kernel, whose outputs are the raster
  // ones: `val-image` (the data URL), `val-matrix`, and the underlay's placement in metres. It publishes
  // no `val-points`, which is the honest answer to "what are this thing's vertices" for a photograph.
  { value: "image", label: "Image", tool: "image" },
];
export const GEOMETRY_TOOL_BY_KIND: Record<string, FlowToolType> =
  Object.fromEntries(GEOMETRY_KINDS.map((k) => [k.value, k.tool]));
export const GEOMETRY_KIND_BY_TOOL: Partial<Record<FlowToolType, string>> =
  Object.fromEntries(GEOMETRY_KINDS.map((k) => [k.tool, k.value]));
/** True for the five tools the Geometry node can switch between. */
export const isGeometryTool = (tool: string): boolean => tool in GEOMETRY_KIND_BY_TOOL;

/** A user-defined adjustable parameter on the Input Properties node. Each one renders a control
 *  (slider / options / checkbox / textbox) and exposes its current value as a `val-<id>` output. */
export type InputPropType = "range" | "select" | "checkbox" | "text" | "color" | "button";

/** A `button` prop is an ACTION, and its value is a RUN COUNTER. Pressing it increments that number,
 *  which is the only form an action can take here: a flow re-evaluates whenever anything changes, so a
 *  press has to leave a trace in the graph or nothing downstream can tell it happened. A Math Engine
 *  gates expensive work on it (`iterations = run > 0 ? maxIter : 0`), so the work stays undone until
 *  asked for, and every press is a NEW value, so pressing again re-runs rather than being deduplicated
 *  as "no change". Where a run action is available (the flow editor) the press also applies the flow's
 *  pending Set Object Param writes, which is what makes one button mean "solve and commit". */

/** A `color` prop publishes its `#rrggbb` string on `val-<propId>`; wire it into a `valin-color`
 *  endpoint (Rectangle / Circle …) to drive a node's tint. */
export const DEFAULT_PROP_COLOR = "#4a90e2";
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;
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
  /** Whether the CONSUMER (Properties tab) may change this value. Author-set; the flow canvas editor
   *  always stays editable, or a parameter locked by mistake could never be unlocked. Defaults to
   *  true, and a file saved before this existed has no `editable` key — {@link inputProps} reads
   *  "missing" as true, so every previous version keeps behaving exactly as it did. */
  editable: boolean;
  /** Draw this parameter's live value as a label on the 2D canvas, on the host the object is attached to:
   *  a Space labels its CENTROID, a Segment its MIDPOINT, a Node the point itself. Author-set; defaults to
   *  FALSE, so a file written before this existed labels nothing and looks exactly as it did. */
  showInCanvas: boolean;
  /** Whether this parameter is required. Author-set, defaults to true (a file without the key reads as
   *  necessary), so marking one `false` is the deliberate act. Carried on the schema for consumers; it does
   *  not gate evaluation. */
  necessary: boolean;
  /** Optional conditional visibility: show this parameter only when a sibling prop (`when` = its id) has a
   *  matching value — a `select` option, or `true`/`false` for a `checkbox`. Author-set in the editor. UI-only:
   *  a hidden parameter keeps its value and still publishes its `val-<id>` output, so wiring is unaffected. */
  showIf?: { when: string; equals: string | number | boolean };
}

/** Whether an Input Properties parameter is currently visible — honours its optional `showIf` gate against the
 *  CURRENT values of its sibling params. Fail-open: no gate (or a deleted/dangling controller) shows it. */
export const propVisible = (p: InputProp, all: InputProp[]): boolean => {
  const si = p.showIf;
  if (!si || !si.when) return true;
  const ctrl = all.find((x) => x.id === si.when);
  if (!ctrl) return true;
  return typeof ctrl.value === "boolean" ? ctrl.value === (si.equals === true) : String(ctrl.value) === String(si.equals);
};

/** Normalise an Input Properties node's params into its parameter list. */
export const inputProps = (params: Record<string, unknown>): InputProp[] => {
  const raw = params.props;
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const type = (["range", "select", "checkbox", "text", "color", "button"].includes(o.type as string) ? o.type : "range") as InputPropType;
    const value: string | number | boolean =
      type === "checkbox" ? o.value === true
      : type === "range" ? (Number(o.value) || 0)
      // A button carries its run counter, so it is a number like a range rather than the empty string
      // the text branch below would give it (which would reach the Math Engine as an inert string).
      : type === "button" ? (Number(o.value) || 0)
      // `<input type="color">` silently rejects anything that isn't #rrggbb, so a missing / short / named
      // colour falls back to the default rather than leaving the swatch stuck on black.
      : type === "color" ? (typeof o.value === "string" && HEX6_RE.test(o.value) ? o.value.toLowerCase() : DEFAULT_PROP_COLOR)
      : typeof o.value === "string" ? o.value : String(o.value ?? "");
    // Conditional visibility ({ when: <sibling prop id>, equals }) — passed through when well-formed.
    const siRaw = o.showIf as Record<string, unknown> | undefined;
    const showIf = siRaw && typeof siRaw.when === "string" && siRaw.when
      ? { when: siRaw.when, equals: (siRaw.equals ?? "") as string | number | boolean }
      : undefined;
    return {
      id: typeof o.id === "string" && o.id ? o.id : `p${i + 1}`,
      name: typeof o.name === "string" ? o.name : "",
      type,
      value,
      min: Number.isFinite(Number(o.min)) ? Number(o.min) : 0,
      max: Number.isFinite(Number(o.max)) ? Number(o.max) : 10,
      step: Number(o.step) || 1,
      options: Array.isArray(o.options) ? o.options.map(String) : [],
      // `!== false`, not `=== true`: a file authored before this field existed omits it entirely, and
      // must keep its parameters editable. Only an explicit false locks one.
      editable: o.editable !== false,
      // Opposite defaults, and each matches the safe reading of a file that predates the field: canvas
      // labels are opt-IN (`=== true`), so nothing starts drawing text over an existing plan, while
      // `necessary` is opt-OUT (`!== false`), so a parameter is required unless the author says otherwise.
      showInCanvas: o.showInCanvas === true,
      necessary: o.necessary !== false,
      ...(showIf ? { showIf } : {}),
    };
  });
};

/** Coerce a wired value onto one of a target SELECT's options, so options connect across nodes WITHOUT needing
 *  identical strings (the pain when a source's "Wireframe"/"Solid" meets a target's "solid"/"wireframe").
 *  Preference: exact value (case-insensitive) → label (case-insensitive) → a numeric INDEX → the value's
 *  position in the SOURCE options mapped to the target (index-based — just order the two option lists the same).
 *  Returns the matched target option value, or undefined when nothing fits (the caller keeps the node's own). */
export const coerceSelectWire = (
  value: number | string,
  targetOptions: ReadonlyArray<string | { value: string; label?: string }>,
  sourceOptions?: ReadonlyArray<string>,
): string | undefined => {
  const opts = targetOptions.map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }));
  if (!opts.length) return undefined;
  const s = String(value).trim();
  const sl = s.toLowerCase();
  const byVal = opts.find((o) => o.value.toLowerCase() === sl);
  if (byVal) return byVal.value;
  const byLabel = opts.find((o) => o.label.toLowerCase() === sl);
  if (byLabel) return byLabel.value;
  const idx = typeof value === "number" ? value : (/^\d+$/.test(s) ? Number(s) : NaN);
  if (Number.isInteger(idx) && idx >= 0 && idx < opts.length) return opts[idx].value;
  if (sourceOptions && sourceOptions.length) {
    const i = sourceOptions.findIndex((o) => String(o).toLowerCase() === sl);
    if (i >= 0 && i < opts.length) return opts[i].value;
  }
  return undefined;
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
export interface OutputSlot {
  id: string;
  label: string;
  /** Draw this metric's live value on the 2D canvas at the host's anchor — Space centroid, Segment midpoint,
   *  over a Node. The measured counterpart of {@link InputProp.showInCanvas}; same opt-in default of FALSE. */
  showInCanvas: boolean;
  /** Whether this metric is required. Defaults to true, so only an explicit `false` marks one optional. */
  necessary: boolean;
}

/** One primitive ROW on a 2D / 3D Render node — the drawing counterpart of an Input Properties parameter.
 *  A row is a KIND plus its style, not a single shape: fed a point list with several entries it draws one
 *  piece per entry (a Polygon row splits on its third column, a Circle row draws a circle per point), so a
 *  computed result of any size needs ONE row rather than one node per shape.
 *
 *  Each row exposes its own value-input endpoint (`valin-<id>`) for that geometry, and everything that is
 *  NOT a number — colour, layer name — lives here on the row, because a Math Engine can only put numbers on
 *  a wire. */
export interface RenderPrim {
  id: string;
  /** 2D: "polygon" | "circle" | "stroke".
   *  3D: "cuboid" | "cylinder" | "sphere" | "cone" | "capsule" | "frustum" | "tapered-box" | "torus"
   *      | "polyhedron" | "tube" | "ring" | "loft". */
  kind: string;
  /** Optional row label (falls back to the kind). */
  name: string;
  color: string;
  /** Canvas layer the pieces this row draws are created on — 2D rows put their geometry there on commit,
   *  3D rows carry it as the mass's layer label. Blank = the flow's default layer. */
  layer: string;
  /** 2D outline style — how the row's edges are stroked. */
  lineStyle: "solid" | "dashed" | "dotted";
  /** 2D fill — "filled" paints the ring (hatched when `hatch` is set), "outlined" draws the edge only. */
  fillMode: "filled" | "outlined";
  /** 2D poché pattern for a filled row: "none" = flat colour, else the canvas hatch pattern. */
  hatch: "none" | "diagonal" | "dots";
  /** Hatch pitch (px) and line weight — only read when `hatch` isn't "none". */
  hatchSpacing: number;
  hatchWeight: number;
  /** 3D material, per row: opacity (<1 → transparent), solid vs wireframe, and whether the mesh draws its
   *  edge outline. These are what a downstream Display 3D node sets for a WHOLE node — on the row they can
   *  differ per material, so one 3D Render node can carry grey walls, red leaves and glazing at once. */
  opacity: number;
  displayType: "solid" | "wireframe";
  showEdges: boolean;
  /** Circle: radius (m) — overridden per point by a third column on the wired list.
   *  Cylinder: radius (m). Tube: the cylinder's radius; Ring: the RING radius (hole centre → tube centre). */
  radius: number;
  /** Stroke: the band's full width (m) — overridden per segment by a FIFTH column on the wired list. */
  width: number;
  /** Ring / Torus: the tube (minor) radius (m) — on a Ring, overridden per axis segment by an EIGHTH column. */
  tubeRadius: number;
  /** Torus: the sweep in DEGREES (5–360). 360 is a closed donut; less leaves an open arc, so a partial ring
   *  needs no boolean. Unused by every other kind. */
  arcDeg: number;
  /** Cuboid / Tapered Box plan dimensions (m). Capsule: the MID length — the straight cylinder between the
   *  two hemispherical caps, so the pill's overall height is `length + 2 × radius`. */
  length: number;
  breadth: number;
  /** Cuboid / Cylinder / Cone / Frustum / Tapered Box height (m). */
  height: number;
  /** Frustum: the TOP radius (m) — `radius` is the bottom one, so top < bottom tapers inward and 0 gives a
   *  cone. Unused by every other kind. */
  radiusTop: number;
  /** Tapered Box: the TOP plan dimensions (m) that `length` × `breadth` taper to over `height`. */
  topLength: number;
  topBreadth: number;
  /** Own position (m) — used when nothing is wired into the row. Plan frame: x across, y down the plan.
   *  On a POLYHEDRON row the mesh carries its own absolute coordinates, so these are an OFFSET instead. */
  x: number;
  y: number;
  /** Base elevation (m) for 3D rows; a third column on the wired list overrides it per point. */
  z: number;
  show: boolean;
}

// STROKE is the open-path row: the fill kinds (Polygon, Circle) can only draw a CLOSED ring, so a centreline
// — a frame member, a pipe run, a bar — had to be thickened into a quad by hand before it could be drawn.
// It takes a SEGMENT list instead of a point list and strokes each one to a band.
const RENDER_2D_KINDS = new Set(["polygon", "circle", "stroke"]);
// POLYHEDRON is the 3D twin of the 2D Polygon row: its dimensions are not fields at all — the wired FACE
// LIST is the whole shape — which is what lets a Math Engine emit a solid whose size is parametric, where a
// Cuboid row's Length / Breadth / Height are fixed numbers.
// TUBE and RING are the 3D twins of the Stroke row, and read the same AXIS-SEGMENT list as each other: a
// Cuboid / Cylinder row is axis-aligned and positioned by a point, so nothing wired could ever tilt one —
// an off-axis member (a bike's down tube, a strut, a handrail) was unreachable except by hand-building its
// faces. Tube fills the segment as a cylinder; Ring treats it as the AXIS of a torus.
// LOFT reads the same grouped point list a Polyhedron row does, but each run is a CROSS-SECTION rather than
// a finished face: it skins them. Polyhedron can already draw any solid — provided the Math Engine
// enumerates every face, which for a curved body means hand-writing the same quad-stitching loop every time.
// Sections are what varies between one lofted thing and the next; the stitching is not.
// The SOLID-OF-REVOLUTION / TAPERED kinds (Sphere, Cone, Capsule, Frustum, Tapered Box) are the row twins of
// the standalone 3D-primitive nodes: same shapes, same meshing (the 3D canvas keys off `shape`, which is the
// kind string), but reached through a row — so one node covers a whole operation's solids, and a wired
// position list builds one per point instead of needing one node per instance.
// TORUS is the point-positioned donut — distinct from RING, which is the same solid oriented by a wired AXIS
// SEGMENT. Keep both: a wheel driven by its axle needs Ring, a flat ring at an X/Y/Z needs Torus.
const RENDER_3D_KINDS = new Set([
  "cuboid", "cylinder", "polyhedron", "tube", "ring", "loft",
  "sphere", "cone", "capsule", "frustum", "tapered-box", "torus",
]);

/** Read a Render node's primitive rows from its params. Missing fields fall back to sane defaults, so a row
 *  authored before a field existed still loads. `is3d` only decides which kind a bad/blank value falls back
 *  to, so the two nodes share one reader. */
export const renderPrims = (params: Record<string, unknown>, is3d = false): RenderPrim[] => {
  const raw = Array.isArray(params.prims) ? (params.prims as unknown[]) : [];
  const num = (v: unknown, d: number): number => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const str = (v: unknown, d: string): string => (typeof v === "string" && v ? v : d);
  const kinds = is3d ? RENDER_3D_KINDS : RENDER_2D_KINDS;
  const fallbackKind = is3d ? "cuboid" : "polygon";
  return raw.map((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const kind = typeof o.kind === "string" && kinds.has(o.kind) ? o.kind : fallbackKind;
    return {
      id: str(o.id, `pr${i + 1}`),
      kind,
      name: typeof o.name === "string" ? o.name : "",
      color: str(o.color, is3d ? "#94a3b8" : "#0891b2"),
      layer: typeof o.layer === "string" ? o.layer : "",
      radius: num(o.radius, 1),
      width: num(o.width, 0.1),
      tubeRadius: num(o.tubeRadius, 0.1),
      length: num(o.length, 3),
      breadth: num(o.breadth, 2),
      height: num(o.height, 3),
      // Taper dimensions. Defaults match the standalone Frustum / Tapered Box nodes, so switching a chain
      // over to a row reproduces the same solid rather than a differently-proportioned one.
      radiusTop: num(o.radiusTop, 0.8),
      topLength: num(o.topLength, 2),
      topBreadth: num(o.topBreadth, 1.5),
      // Torus sweep. The canvas clamps to 5–360; the default is the closed donut the standalone node ships.
      arcDeg: num(o.arcDeg, 360),
      x: num(o.x, 0),
      y: num(o.y, 0),
      z: num(o.z, 0),
      // Style, per row. Defaults reproduce the old fixed behaviour exactly — a solid, filled, unhatched 2D
      // row and an opaque solid 3D row with no edges — so a flow authored before these fields loads unchanged.
      lineStyle: o.lineStyle === "dashed" ? "dashed" : o.lineStyle === "dotted" ? "dotted" : "solid",
      fillMode: o.fillMode === "outlined" ? "outlined" : "filled",
      hatch: o.hatch === "diagonal" ? "diagonal" : o.hatch === "dots" ? "dots" : "none",
      hatchSpacing: num(o.hatchSpacing, 8),
      hatchWeight: num(o.hatchWeight, 1),
      opacity: Math.max(0, Math.min(1, num(o.opacity, 1))),
      displayType: o.displayType === "wireframe" ? "wireframe" : "solid",
      showEdges: o.showEdges === true,
      show: o.show !== false,
    };
  });
};

/** Read an Output node's slots from its params (defaults to one empty slot). */
export const outputSlots = (params: Record<string, unknown>): OutputSlot[] => {
  const raw = params.slots;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((s, i) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return {
        id: typeof o.id === "string" && o.id ? o.id : `s${i + 1}`,
        label: typeof o.label === "string" ? o.label : "",
        // Same defaults as an Input Properties row: labelling is opt-in, `necessary` opt-out.
        showInCanvas: o.showInCanvas === true,
        necessary: o.necessary !== false,
      };
    });
  }
  return [{ id: "s1", label: "", showInCanvas: false, necessary: true }];
};

/** One detection target on the Object Detection node — added with "Add object". The name is BOTH what
 *  Gemini is asked for (all names go into one prompt, so it stays a single call) and the term the reply
 *  is split back on, which is the point: the ask and the split can no longer drift apart. */
export interface DetectionObject { id: string; name: string }

/** The Object Detection node's target rows. An EMPTY list means "no rows configured" — the node then
 *  falls back to the free-text `targets` param and its fixed endpoints, so pre-rows flows keep working. */
export const detectionObjects = (params: Record<string, unknown>): DetectionObject[] => {
  const raw = params.objects;
  if (!Array.isArray(raw)) return [];
  return raw.map((o, i) => {
    const r = (o ?? {}) as Record<string, unknown>;
    return { id: typeof r.id === "string" && r.id ? r.id : `o${i + 1}`, name: typeof r.name === "string" ? r.name : "" };
  });
};

/** One furniture/fixture footprint placed along a Space's boundary by the Place Object node. The node
 *  stores an ARRAY of these under `params.objects` so a single node can lay out many objects at once
 *  (mirrors the Place Object Along Boundary block in the Space tools). */
export interface PlaceObjectEntry {
  kind: string;
  /** Parametric-object library id (e.g. "sofa.v2") — when set, the entry places THAT object: dimensions
   *  not explicitly overridden are measured from the object's own geometry (resolvePlaceObjectParams in
   *  eval/objectFootprints), and the commit drops the real .pobj attachment node instead of a 2D-symbol
   *  box. `kind` then only picks the live-preview symbol. */
  objectId?: string;
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
    if (typeof src.objectId === "string" && src.objectId.trim()) e.objectId = src.objectId.trim();
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
  /** `textarea` only — split the value into FOLDABLE REGIONS on `# <title>` marker lines (see
   *  ExprSectionsEditor). Purely presentational: the value stays one string and a body with no markers
   *  renders as the ordinary textarea. */
  sections?: boolean;
  /** Render a text field as a password input (e.g. an API key). */
  secret?: boolean;
  /** Placeholder for text / textarea inputs. */
  placeholder?: string;
  /** Visible row count for a `textarea` (default 3). Raise it for fields meant to hold a long pasted
   *  block — e.g. the Agent node's Instructions persona. The box stays user-resizable either way. */
  rows?: number;
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
  /** True for a node that takes a geometry INPUT but draws nothing on canvas (Vectorisation: image in,
   *  graph JSON out). The canvas-visibility (eye) toggle is hidden for these — `hasInput || hasOutput`
   *  alone would show a control with nothing to hide. */
  drawsNothing?: boolean;
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
  /** Optional multi-line usage guide (how to drive the params) — carried from a node-declaration file's
   *  `instructions`. Available to the agent catalog + the node's info panel. */
  instructions?: string;
  /** This node outputs real Space polygon(s) (its `polygons` are room boundaries, not overlays/graphs).
   *  Flow "Live" mode materialises such nodes as REAL, editable Spaces + boundary segments that track the
   *  params — see FloorPlanEditor's live-materialise effect. Opt-in per tool (inset, optimise-rect, …).
   *  Carried from a node-declaration file's `materialisesSpace`. */
  materialisesSpace?: boolean;
  /** This node outputs real SEGMENT geometry (open strokes — a graph, centerline or linework, not a room
   *  face). Flow "Live" materialises it as one editable wall per point-pair; canvas nodes are wall
   *  endpoints in this model, so junctions appear automatically where segments meet — "graph as nodes and
   *  segments". The open-path counterpart of `materialisesSpace`; carried from `materialisesSegments`. */
  materialisesSegments?: boolean;
  /** Whether a `materialisesSpace` node also OWNS the boundary of the Spaces it makes, i.e. whether Live
   *  should draw one editable wall per boundary edge alongside the Space. Defaults to true, which is right
   *  for a node that invents its boundary (Inset, Optimise Rectangle, Corridoor, Voronoi): the edges are
   *  its output and nothing else is drawing them.
   *
   *  FALSE for a node that DERIVES faces from geometry already on the canvas — Graph to Spaces, whose whole
   *  purpose is to add rooms to a graph a Network node has already materialised. There the boundary edges
   *  are a duplicate of segments that exist, at the editor's default thickness rather than the real wall's,
   *  on a layer painted above them; and because the faces close across every door and window, the duplicates
   *  are drawn straight over the openings, filling them in. Carried from `materialisesSpaceEdges`. */
  materialisesSpaceEdges?: boolean;
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
  // Data-declared (see ./declarations/source.node.json) — behaviour stays in code.
  source: buildToolDefFromDeclaration(sourceDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/space-creator.node.json) — behaviour stays in code.
  "space-creator": buildToolDefFromDeclaration(spaceCreatorDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/densify.node.json) — behaviour stays in code (evalDensify).
  densify: buildToolDefFromDeclaration(densifyDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/loop.node.json) — behaviour in code (evalLoop): array the input N times.
  loop: buildToolDefFromDeclaration(loopDecl as unknown as NodeDeclaration),
  // Data-declared — value node (computeMatch in evaluateFlow): select-equality → 1/0 gate.
  match: buildToolDefFromDeclaration(matchDecl as unknown as NodeDeclaration),
  // Data-declared — behaviour in the host's primitiveMasses walk (FloorPlanEditor): array a 3D primitive.
  "loop-3d": buildToolDefFromDeclaration(loop3dDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/inset.node.json) — behaviour stays in code (evalInset).
  inset: buildToolDefFromDeclaration(insetDecl as unknown as NodeDeclaration),
  // PROTOTYPE — built from ./declarations/optimise-rect.node.json (params schema + handles + showWhen +
  // instructions), NOT a hand-written literal. Behaviour stays in code: evaluateFlow dispatches this
  // `tool` to evalOptimise. This is the pattern a full node-declaration migration would follow.
  "optimise-rect": buildToolDefFromDeclaration(optimiseRectDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/split.node.json) — behaviour stays in code. NOTE: outputCount matches
  // the baked-handleCount path exactly; the pre-bake ratio-mode estimate is approximated (parseSplitRatios).
  split: buildToolDefFromDeclaration(splitDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/skeleton.node.json) — behaviour stays in code.
  skeleton: buildToolDefFromDeclaration(skeletonDecl as unknown as NodeDeclaration),
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
    // `boundary` is the LIST-DRIVEN input (see LIST_INPUT_PARAM in evaluateFlow): wire an N×2 point matrix
    // — metres, local to the flow anchor — and the node solves against THAT outline with no canvas Space
    // wired in, exactly as Inset's `polygon` / Skeleton's `vertices` do. That is what lets a computed room
    // (a Math Engine rectangle) host objects without first materialising it as a Space.
    valueInputs: [{ key: "boundary", label: "Boundary (JSON)" }],
    defaultParams: { objects: [{ ...PLACE_OBJECT_DEFAULT_ENTRY }], seed: 1, boundary: "" },
    fields: [
      { key: "kind", label: "Type", kind: "select", options: PLACE_OBJECT_KIND_OPTIONS },
      { key: "length", label: "Length", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "breadth", label: "Breadth", kind: "range", min: 0.2, max: 5, step: 0.05, unit: "m" },
      { key: "position", label: "Position", kind: "range", min: 0, max: 100, step: 0.5, unit: "%" },
      { key: "setback", label: "Setback", kind: "range", min: 0, max: 5, step: 0.05, unit: "m" },
      { key: "height", label: "Height", kind: "range", min: 0.05, max: 3, step: 0.05, unit: "m" },
      { key: "clearance", label: "Clearance", kind: "range", min: 0, max: 3, step: 0.05, unit: "m" },
    ],
    hint: "Place one or more objects along the input space's boundary — pick a parametric library object (size auto-measured) or a custom box.",
  },
  // Data-declared (see ./declarations/bsp.node.json) — behaviour stays in code (adjacency matrix editor).
  bsp: buildToolDefFromDeclaration(bspDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/corridoor.node.json) — behaviour stays in code (evalCorridoor +
  // the applyRecipeJson "corridoor" commit runner). Re-registered after the FLOW_TOOLS literals were lost.
  corridoor: buildToolDefFromDeclaration(corridoorDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/core-racking.node.json) — behaviour stays in code (evalCoreRacking).
  "core-racking": buildToolDefFromDeclaration(coreRackingDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/agent.node.json). Geometry passes straight through in evaluateFlow;
  // the model call lives in the host's onRunAgent action (never in eval), which bakes its answer into the
  // DOWNSTREAM nodes' params and into this node's own `props` (→ one val-<key> output per suggestion).
  agent: buildToolDefFromDeclaration(agentDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/voronoi.node.json) — behaviour stays in code.
  voronoi: buildToolDefFromDeclaration(voronoiDecl as unknown as NodeDeclaration),
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
  // Data-declared (see ./declarations/bounding-shape.node.json) — behaviour stays in code.
  "bounding-shape": buildToolDefFromDeclaration(boundingShapeDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/convex-hull.node.json) — behaviour stays in code.
  "convex-hull": buildToolDefFromDeclaration(convexHullDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/convex-decomp.node.json) — behaviour stays in code.
  "convex-decomp": buildToolDefFromDeclaration(convexDecompDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/mesh.node.json) — behaviour stays in code.
  mesh: buildToolDefFromDeclaration(meshDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/circle-packing.node.json) — behaviour stays in code.
  "circle-packing": buildToolDefFromDeclaration(circlePackingDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/treemap.node.json) — behaviour stays in code.
  treemap: buildToolDefFromDeclaration(treemapDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/rect-pack.node.json) — behaviour stays in code.
  "rect-pack": buildToolDefFromDeclaration(rectPackDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/point.node.json) — behaviour stays in code.
  point: buildToolDefFromDeclaration(pointDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/vertices.node.json) — a pure VALUE node: vertex list in, same list
  // out, nothing drawn. Polygon is the node that DRAWS a list; this one only carries it.
  vertices: buildToolDefFromDeclaration(verticesDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/network.node.json) — DRAWS a graph JSON as canvas segments
  // (the inverse of Graph Geometry). Behaviour stays in code (evaluateFlow).
  network: buildToolDefFromDeclaration(networkDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/rectangle.node.json) — behaviour stays in code.
  rectangle: buildToolDefFromDeclaration(rectangleDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/arc.node.json) — an OPEN arc polyline (centre / radius / start / end
  // angles), evaluated in evaluateFlow. Deliberately NOT IR-safe: a flow using it takes the evaluateFlow
  // path, where rectangles honour their `rotation` and this arc renders (the IR does neither).
  arc: buildToolDefFromDeclaration(arcDecl as unknown as NodeDeclaration),
  polygon: buildToolDefFromDeclaration(polygonDecl as unknown as NodeDeclaration),
  polyline: buildToolDefFromDeclaration(polylineDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/circle.node.json) — behaviour stays in code.
  circle: buildToolDefFromDeclaration(circleDecl as unknown as NodeDeclaration),
  // Batch-A 2D primitives (declarations + evaluateFlow cases): a wireable 2-point Line (open stroke),
  // regular N-gon, Ellipse, Rounded Rectangle and a FILLED Sector (the arc node stays an open stroke).
  line: buildToolDefFromDeclaration(lineDecl as unknown as NodeDeclaration),
  ngon: buildToolDefFromDeclaration(ngonDecl as unknown as NodeDeclaration),
  ellipse: buildToolDefFromDeclaration(ellipseDecl as unknown as NodeDeclaration),
  "rounded-rect": buildToolDefFromDeclaration(roundedRectDecl as unknown as NodeDeclaration),
  sector: buildToolDefFromDeclaration(sectorDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/visibility.node.json) — behaviour stays in code.
  visibility: buildToolDefFromDeclaration(visibilityDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/smoothing.node.json) — behaviour stays in code (evalSmoothing).
  smoothing: buildToolDefFromDeclaration(smoothingDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/contour.node.json) — behaviour stays in code.
  contour: buildToolDefFromDeclaration(contourDecl as unknown as NodeDeclaration),
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
  // Data-declared (see ./declarations/graph-source.node.json) — behaviour stays in code.
  "graph-source": buildToolDefFromDeclaration(graphSourceDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/segment-source.node.json) — behaviour stays in code.
  "segment-source": buildToolDefFromDeclaration(segmentSourceDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/node-source.node.json) — behaviour stays in code.
  "node-source": buildToolDefFromDeclaration(nodeSourceDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/node-geometry.node.json) — reads a Node's canvas point and publishes
  // its x / y as value outputs (evaluated in evaluateFlow); wire into a Point to place geometry at the node.
  "node-geometry": buildToolDefFromDeclaration(nodeGeometryDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/segment-geometry.node.json) — reads a Segment's midpoint / angle /
  // length and publishes them as value outputs (evaluated in evaluateFlow); wire X / Y into a Point.
  "segment-geometry": buildToolDefFromDeclaration(segmentGeometryDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/canvas-source.node.json) — behaviour stays in code.
  "canvas-source": buildToolDefFromDeclaration(canvasSourceDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/freehand-source.node.json) — behaviour stays in code (graph-source machinery).
  "freehand-source": buildToolDefFromDeclaration(freehandSourceDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/freehand-geometry.node.json) — behaviour stays in code (polylines → graph JSON).
  "freehand-geometry": buildToolDefFromDeclaration(freehandGeometryDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/separate.node.json) — behaviour stays in code.
  separate: buildToolDefFromDeclaration(separateDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/filter-by-type.node.json) — behaviour stays in code (reads the
  // attached object's params out of canvasContent.spaceMeta and splits the bundle in two).
  "filter-by-type": buildToolDefFromDeclaration(filterByTypeDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/set-object-param.node.json) — behaviour stays in code (computes the
  // writes in evaluateFlow; the host applies them on Apply, as one undoable history step).
  "set-object-param": buildToolDefFromDeclaration(setObjectParamDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/get-object-param.node.json) — behaviour stays in code (reads the
  // attached object params out of canvasContent.spaceMeta into a matrix).
  "get-object-param": buildToolDefFromDeclaration(getObjectParamDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/segment-split.node.json) — behaviour stays in code. NOTE: the
  // declaration's outputCount matches the baked-handleCount path exactly; the pre-bake ratio-mode estimate
  // is approximated (falls to 2) since it needs parseSplitRatios — the live count bakes on evaluation.
  "segment-split": buildToolDefFromDeclaration(segmentSplitDecl as unknown as NodeDeclaration),
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
  // Data-declared (see ./declarations/bloom.node.json) — behaviour stays in code.
  bloom: buildToolDefFromDeclaration(bloomDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/pull.node.json) — behaviour stays in code.
  pull: buildToolDefFromDeclaration(pullDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/transform.node.json) — behaviour stays in code.
  transform: buildToolDefFromDeclaration(transformDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/mitered-join.node.json) — behaviour stays in code.
  "mitered-join": buildToolDefFromDeclaration(miteredJoinDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/graph-to-path.node.json) — behaviour stays in code.
  "graph-to-path": buildToolDefFromDeclaration(graphToPathDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/graph-smooth.node.json) — behaviour stays in code.
  "graph-smooth": buildToolDefFromDeclaration(graphSmoothDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/graph-metrics.node.json) — behaviour stays in code.
  "graph-metrics": buildToolDefFromDeclaration(graphMetricsDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/graph-geometry.node.json) — publishes the graph STRUCTURE (node ids +
  // from/to/thickness edges) as JSON on val-graph. Behaviour stays in code (evaluateFlow).
  "graph-geometry": buildToolDefFromDeclaration(graphGeometryDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/show-direction.node.json) — behaviour stays in code.
  "show-direction": buildToolDefFromDeclaration(showDirectionDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/dimension.node.json) — behaviour stays in code.
  dimension: buildToolDefFromDeclaration(dimensionDecl as unknown as NodeDeclaration),
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
    // Pure MATRIX value node: a DEM MATRIX in (valin-matrix — the wired matrix shows in the Matrix box) with
    // wireable Min slope (ε) / Edges-drain params, the hydrologically-conditioned (filled) DEM MATRIX out
    // (val-matrix, bottom-right). No geometry endpoints. Draws nothing — wire Render Grid to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }, { key: "epsilon", label: "Min slope (ε)" }, { key: "edgesAreOutlets", label: "Edges drain off" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", epsilon: 0, edgesAreOutlets: true },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "epsilon", label: "Min slope (ε)", kind: "number" },
      { key: "edgesAreOutlets", label: "Edges drain off-grid", kind: "checkbox" },
    ],
    hint: "Fill sinks/pits in a DEM grid-field (Priority-Flood) so every cell drains to the border. Set Min slope (ε) > 0 to also resolve flats (Priority-Flood+ε). Feed from Grid / Graph to Grid; chain into Flow Direction.",
  },
  "flow-direction": {
    type: "flow-direction",
    label: "Flow Direction",
    color: "#9333ea",
    // Pure MATRIX value node: a DEM MATRIX in (valin-matrix, next to the Matrix box — the wired matrix appears
    // there) and a wireable Method, the D8 direction-code MATRIX out (val-matrix, bottom-right). No geometry
    // endpoints. Draws nothing — wire Render Grid (arrows) to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }, { key: "method", label: "Method" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", method: "d8" },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      {
        key: "method",
        label: "Method",
        kind: "select",
        options: [
          { value: "d8", label: "D8 (steepest)" },
          { value: "rho8", label: "Rho8 (stochastic)" },
        ],
      },
    ],
    hint: "D8 flow direction as a VALUE node — a DEM matrix in (wire val-matrix into valin-matrix, or a grid-field), the direction-code matrix (0..7, -1 = sink) out on val-matrix. Wire Render Grid (arrows) to see it. Rho8 randomises among downslope neighbours.",
  },
  "flow-accumulation": {
    type: "flow-accumulation",
    label: "Flow Accumulation",
    color: "#9333ea",
    // Pure MATRIX value node: a flow-direction MATRIX in (valin-matrix — the wired matrix shows in the Matrix
    // box), the accumulation-count MATRIX out (val-matrix, bottom-right). No geometry endpoints. Draws nothing
    // — wire Render Grid to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", asArea: false },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "asArea", label: "Contributing area (m²)", kind: "checkbox" },
    ],
    hint: "Flow accumulation as a VALUE node — a flow-direction matrix / grid-field in, the accumulation-count matrix out on val-matrix. Feed from Flow Direction; wire Render Grid to see the channels.",
  },
  "watershed": {
    type: "watershed",
    label: "Watershed",
    color: "#9333ea",
    // Pure MATRIX value node: a flow-direction MATRIX in (valin-matrix — the wired matrix shows in the Matrix
    // box) + a wireable Outlet, the basin-mask MATRIX out (val-matrix, bottom-right). No geometry endpoints.
    // Outlet = "col,row" cell index (blank = lowest cell). Draws nothing — wire Render Grid to display.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "matrix", label: "Matrix" }, { key: "outlet", label: "Outlet" }],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", outlet: "" },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "outlet", label: "Outlet (col,row)", kind: "text", placeholder: "blank = lowest cell" },
    ],
    hint: "Watershed as a MATRIX value node — a flow-direction matrix in, the basin-mask matrix out on val-matrix. Outlet = 'col,row' cell index (blank = lowest cell). Wire Render Grid (categorical) to see the basin.",
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
    // Pure MATRIX value node: a MATRIX in (valin-matrix — the wired matrix shows in the Matrix box) with a
    // wireable Test / Threshold, a 0/1 MASK MATRIX out (val-matrix, bottom-right). No geometry endpoints.
    // Draws nothing — chain into Marching Squares (streamlines) or Render Grid.
    hasInput: false,
    hasOutput: false,
    // WHERE THE MATRIX IS — and this is the node that decides it for the whole chain. A bare matrix is
    // only numbers; the FIRST node to lift one into a grid field fixes its world frame, and every node
    // downstream inherits that field rather than re-reading the matrix (fieldInputOf follows any incoming
    // edge, value edges included). So placing a contour on the picture it came from means setting Cell
    // size / Origin here, not on Marching Squares, where the same params are silently overridden by the
    // field arriving from this node.
    valueInputs: [
      { key: "matrix", label: "Matrix" }, { key: "op", label: "Test" }, { key: "threshold", label: "Threshold" },
      { key: "cellSize", label: "Cell size" }, { key: "originX", label: "Origin X" }, { key: "originY", label: "Origin Y" },
    ],
    valueOutputs: [{ key: "matrix", label: "Matrix (JSON)" }],
    defaultParams: { matrix: "", op: ">", threshold: 0, cellSize: 1, originX: 0, originY: 0 },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
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
    ],
    hint: "Grid Threshold as a MATRIX value node — a matrix in, a 0/1 mask matrix out (cells where value passes the test). Feed from Flow Accumulation; chain into Marching Squares for streamlines.",
  },
  "marching-squares": {
    type: "marching-squares",
    label: "Marching Squares",
    color: "#9333ea",
    // Matrix / grid-field IN → contour LINES out (polylines, a graph). Takes a MATRIX (valin-matrix — e.g. a
    // Grid Threshold mask for streamlines — shown in the Matrix box) or a wired grid-field; keeps its geometry
    // OUTPUT so the contours render / chain into Polygon / Network / Mitered Join.
    hasInput: true,
    hasOutput: true,
    // WHERE THE MATRIX IS. A wired grid-FIELD carries its own world frame; a bare MATRIX does not — it is
    // just numbers — so `gridFieldFromMatrix` places it by Cell size + Origin X/Y. Those three were params
    // only, which meant a contour traced off an IMAGE could not be put back on the picture it was read
    // from: the Image node publishes the underlay's real `val-cellM` / `val-originX` / `val-originY` for
    // exactly that purpose, and there was no endpoint to wire them into. Now there is, so the contour
    // lands registered on the drawing and follows it when the underlay is moved or rescaled.
    valueInputs: [
      { key: "matrix", label: "Matrix" }, { key: "levels", label: "Levels" },
      { key: "cellSize", label: "Cell size" }, { key: "originX", label: "Origin X" }, { key: "originY", label: "Origin Y" },
    ],
    defaultParams: { matrix: "", levels: 5, cellSize: 1, originX: 0, originY: 0 },
    fields: [
      { key: "matrix", label: "Matrix", kind: "text" },
      { key: "levels", label: "Contour levels", kind: "range", min: 1, max: 12, step: 1 },
      { key: "cellSize", label: "Cell size", kind: "number", unit: "m" },
      { key: "originX", label: "Origin X", kind: "number", unit: "m" },
      { key: "originY", label: "Origin Y", kind: "number", unit: "m" },
    ],
    hint: "Extract iso-contours from a MATRIX / grid field — N evenly-spaced levels between min and max → contour lines (a graph). Feed a Grid Threshold mask (val-matrix) for streamlines, or any grid-field. A bare matrix has no world frame: wire an Image node's Cell size / Origin X / Origin Y to land the contour on the picture it was traced from. Levels 1 over a 0/1 mask gives the single boundary of that mask — the outline of the black region. Chain into Polygon / Network / Graph Geometry → Graph to Spaces.",
  },
  // Data-declared (see ./declarations/area-dimension.node.json) — behaviour stays in code.
  "area-dimension": buildToolDefFromDeclaration(areaDimensionDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/graph-to-spaces.node.json) — behaviour stays in code.
  "graph-to-spaces": buildToolDefFromDeclaration(graphToSpacesDecl as unknown as NodeDeclaration),
  "longest-branch": {
    type: "longest-branch",
    label: "Longest Branch",
    color: "#0e7490",
    // Pure VALUE node: takes a graph as JSON (`valin-graph`) and returns its single longest branch — the
    // path between the two farthest tips (weighted graph diameter) — on `val-graph`. Draws nothing.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "graph", label: "Graph" }],
    valueOutputs: [{ key: "graph", label: "Graph (JSON)" }],
    defaultParams: { graph: "" },
    fields: [{ key: "graph", label: "Graph (JSON)", kind: "text" }],
    hint: "Return the longest branch of the incoming graph (the path between its two farthest tips) as a graph on val-graph.",
  },
  // Data-declared (see ./declarations/graph-reduce.node.json) — behaviour stays in code.
  "graph-reduce": buildToolDefFromDeclaration(graphReduceDecl as unknown as NodeDeclaration),
  "graph-simplify": buildToolDefFromDeclaration(graphSimplifyDecl as unknown as NodeDeclaration),
  "graph-clip": buildToolDefFromDeclaration(graphClipDecl as unknown as NodeDeclaration),
  "graph-fit-lines": buildToolDefFromDeclaration(graphFitLinesDecl as unknown as NodeDeclaration),
  "graph-classify": buildToolDefFromDeclaration(graphClassifyDecl as unknown as NodeDeclaration),
  "grid-geometry": buildToolDefFromDeclaration(gridGeometryDecl as unknown as NodeDeclaration),
  "render-grid": buildToolDefFromDeclaration(renderGridDecl as unknown as NodeDeclaration),
  "matrix-transpose": buildToolDefFromDeclaration(matrixTransposeDecl as unknown as NodeDeclaration),
  "matrix-inverse": buildToolDefFromDeclaration(matrixInverseDecl as unknown as NodeDeclaration),
  "matrix-solve": buildToolDefFromDeclaration(matrixSolveDecl as unknown as NodeDeclaration),
  "least-squares": buildToolDefFromDeclaration(leastSquaresDecl as unknown as NodeDeclaration),
  "matrix-ops": buildToolDefFromDeclaration(matrixOpsDecl as unknown as NodeDeclaration),
  "matrix-shift": buildToolDefFromDeclaration(matrixShiftDecl as unknown as NodeDeclaration),
  "vector-ops": buildToolDefFromDeclaration(vectorOpsDecl as unknown as NodeDeclaration),
  "vector-product": buildToolDefFromDeclaration(vectorProductDecl as unknown as NodeDeclaration),
  "matrix-to-graph": buildToolDefFromDeclaration(matrixToGraphDecl as unknown as NodeDeclaration),
  "graph-to-matrix": buildToolDefFromDeclaration(graphToMatrixDecl as unknown as NodeDeclaration),
  "graph-interpreter": buildToolDefFromDeclaration(graphInterpreterDecl as unknown as NodeDeclaration),
  "canvas-encoder": buildToolDefFromDeclaration(canvasEncoderDecl as unknown as NodeDeclaration),
  // 2D / 3D Render — one node per operation's whole drawing output; the ROWS (params.prims) are dynamic,
  // so behaviour lives in code (renderPrims + the per-row editor/handles) exactly like Input Properties.
  "render-2d": buildToolDefFromDeclaration(render2dDecl as unknown as NodeDeclaration),
  "render-3d": buildToolDefFromDeclaration(render3dDecl as unknown as NodeDeclaration),
  // Material — a LINK to a Library/Materials file, wired into a 3D Render row's own `matin-<rowId>`
  // endpoint. It holds a path and nothing else: the file is resolved by whoever renders (viewport,
  // glTF, DXF, the Blender addon), so retuning one material restyles every row pointing at it.
  material: buildToolDefFromDeclaration(materialDecl as unknown as NodeDeclaration),
  // Export sinks: they draw nothing and commit nothing — the node body's Download button writes the file
  // from what is wired in (2D preview pieces → DXF; 3D primitive descriptors → glTF/OBJ/STL/PLY).
  "export-dxf": buildToolDefFromDeclaration(exportDxfDecl as unknown as NodeDeclaration),
  "export-3d": buildToolDefFromDeclaration(export3dDecl as unknown as NodeDeclaration),
  // The third sink: same "read what is wired in, produce nothing" shape, but it writes to the PLAN rather
  // than to a file — the wired node's polygons land as ordinary Spaces + segments (see onExportToCanvas).
  "export-canvas": buildToolDefFromDeclaration(exportCanvasDecl as unknown as NodeDeclaration),
  "matrix-reduce": buildToolDefFromDeclaration(matrixReduceDecl as unknown as NodeDeclaration),
  "matrix-eigen": buildToolDefFromDeclaration(matrixEigenDecl as unknown as NodeDeclaration),
  snapshot: buildToolDefFromDeclaration(snapshotDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/set-thickness.node.json) — behaviour stays in code.
  "set-thickness": buildToolDefFromDeclaration(setThicknessDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/merge-graph.node.json) — behaviour stays in code.
  "merge-graph": buildToolDefFromDeclaration(mergeGraphDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/graph-to-openings.node.json) — behaviour stays in code.
  "graph-to-openings": buildToolDefFromDeclaration(graphToOpeningsDecl as unknown as NodeDeclaration),
  "label-graph": buildToolDefFromDeclaration(labelGraphDecl as unknown as NodeDeclaration),
  "filter-by-label": buildToolDefFromDeclaration(filterByLabelDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/voronoi-bloom.node.json) — behaviour stays in code.
  "voronoi-bloom": buildToolDefFromDeclaration(voronoiBloomDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/spring-layout.node.json) — behaviour stays in code.
  "spring-layout": buildToolDefFromDeclaration(springLayoutDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/schema.node.json) — behaviour stays in code (custom on-node editor).
  schema: buildToolDefFromDeclaration(schemaDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/output-schema.node.json) — behaviour stays in code (custom editor).
  "output-schema": buildToolDefFromDeclaration(outputSchemaDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/pipe-solver.node.json) — behaviour stays in code (schema-driven solver).
  "pipe-solver": buildToolDefFromDeclaration(pipeSolverDecl as unknown as NodeDeclaration),
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
    // Wireable so an Input Properties brief can drive the door (a wired value overrides the node param).
    valueInputs: [{ key: "shape", label: "Shape" }, { key: "thickness", label: "Thickness" }, { key: "hinge", label: "Hinge" }, { key: "swing", label: "Swing" }],
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
  // Data-declared (see ./declarations/layout-gen.node.json) — behaviour stays in code (run actions + rooms editor).
  "layout-gen": buildToolDefFromDeclaration(layoutGenDecl as unknown as NodeDeclaration),
  "pobj-source": {
    type: "pobj-source",
    label: "Parametric Site",
    color: "#0f766e",
    // GEOMETRY SOURCE / HOSTABLE parametric object: evaluates a .pobj definition into its footprint polygon
    // and publishes it as this node's geometry output, while exposing each parameter as a `val-<key>` value
    // output (e.g. offset → val-offset) to drive downstream nodes. OPTIONAL HOST (left input): wire a Space
    // — or a Node / Segment — source in to ATTACH the object to that geometry; its `host` op + pipeline then
    // run over the wired footprint (centroid-anchored, in local metres), exactly like attaching the object to
    // a Space in the Properties tab. Unhosted it evaluates self-contained geometry only (a `host`-based object
    // yields nothing until hosted). Edit values in-node; a wired `valin-def` overrides the stored definition.
    // Commits its footprint as a real Space.
    hasInput: true,
    hasOutput: true,
    valueInputs: [{ key: "def", label: "Definition" }],
    defaultParams: { definition: "", props: [] },
    fields: [],
    hint: "Attach to a host by wiring a Space (or Node / Segment) source into the input; its footprint is emitted on the geometry output and each parameter is a val-<key> output → wire into Inset / Optimise Rectangle.",
    instructions: "A parametric object (.pobj) evaluated to a footprint. ATTACH TO A HOST: wire a Space source (or a Node / Segment) into the left input to host the object on that geometry — its `host` op and pipeline (e.g. inset → split → optimise) run over the wired footprint, just like attaching the object to a Space in the Properties tab. With no host wired it evaluates self-contained geometry only (a `host`-based object yields nothing until hosted). The footprint is emitted on the geometry output — consume it exactly like a Space source (wire into Inset, then Optimise Rectangle, etc.) or let it commit as a real Space. Every parameter of the object is also published as a value output `val-<key>` (e.g. a param named `offset` → `val-offset`); wire those into downstream value inputs (e.g. val-offset → Inset's valin-offset) so one object parameter drives the whole chain. Load a definition with the Import button (or wire a Parametric Object into Definition); edit parameter values directly in the node.",
    materialisesSpace: true,
  },
  "grab-object": {
    type: "grab-object",
    label: "Grab Object",
    color: "#0891b2",
    // Reads a canvas Space / Node / Segment (by id, the current selection, OR — preferred — a Space wired into
    // its INPUT) and republishes each parameter of the parametric object attached to it as a `val-<key>` value
    // output, while PASSING THE GEOMETRY THROUGH on its output. So it sits mid-pipeline: Space → Grab Object →
    // Inset/Split/… — the incoming Space's geometry flows on to the op, and the `val-<key>` handles wire into
    // the op's value inputs so the attached object's Properties drive it. With nothing wired in it falls back to
    // its own referenced element (by id / selection). Host resolves the element → its attachment → params,
    // baked into `props` (shown read-only); one amber `val-<key>` endpoint per parameter.
    hasInput: true,
    hasOutput: true,
    defaultParams: { hostKind: "space", grabFromSelection: true, id: "", props: [] },
    fields: [
      { key: "hostKind", label: "Host", kind: "select", options: [{ value: "space", label: "Space" }, { value: "node", label: "Node" }, { value: "segment", label: "Segment" }], showIf: (p) => !p._hasInput },
      { key: "grabFromSelection", label: "Grab from selection", kind: "checkbox", showIf: (p) => !p._hasInput },
      { key: "id", label: "ID", kind: "text", placeholder: "e.g. Space001", showIf: (p) => !p.grabFromSelection && !p._hasInput },
    ],
    hint: "Wire a Space into its input → passes the geometry through AND exposes that Space's attached object's parameters as val-<key> outputs.",
    instructions: "Republishes the parameters of the parametric object attached to a Space as `val-<key>` value outputs, and passes the Space's GEOMETRY through on its output — so it belongs mid-pipeline: wire a Space (source) node into its input, then wire its geometry output into an op (Inset / Split / Optimise) and each `val-<key>` into that op's value input (e.g. val-setback → Inset's valin-uniformSetback). The attached object of whatever Space flows in is what it reads — the Space node itself needs no parameters. With nothing wired into the input it falls back to its own referenced element: pick the Host kind, and with 'Grab from selection' on it tracks the selected element (turn it off and type an id like Space001 to pin one). NOTE: geometry resolves for Host = Space; Node/Segment emit values only.",
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
    label: "Grab Input Parameters",
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
  "param-geometry": {
    type: "param-geometry",
    label: "Grab Geometry",
    color: "#0891b2",
    // Read-only INSPECTOR: reads the parametric definition wired into `valin-def` (from a Parametric Object,
    // or downstream of Grab Parameters so it reflects the chosen values), evaluates its geometry block (vars
    // + chosen case + box rules) at the CURRENT parameters, and shows each formula next to its live computed
    // value INLINE in the node. Passes the definition through on `val-def` so it can sit mid-chain. The host
    // bakes the evaluated inspection into `_inspection`. No geometry of its own.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: {},
    fields: [],
    hint: "Inspect a wired Parametric Object's geometry — each var / box formula with its live computed value. Passes the definition through.",
  },
  "param-output-metrics": {
    type: "param-output-metrics",
    label: "Grab Output Metrics",
    color: "#0891b2",
    // Read-only METRICS readout: reads the parametric definition wired into `valin-def` (from a Parametric
    // Object, or downstream of Grab Input Parameters so it reflects the chosen values), and shows the object's
    // OUTPUT metrics inline — both DECLARED outputs (a top-level `outputs` array of named expressions) and a
    // few DERIVED ones (bounding W×D×H, footprint area, volume, shape count). The host bakes the evaluated
    // values into `_outputs`. Passes the definition through on `val-def`. No geometry of its own.
    //
    // EVERY METRIC IS WIREABLE: besides the declared `def` pass-through, the node grows one DYNAMIC
    // `val-<key>` endpoint per metric — declared outputs first, then the derived ones — each anchored to its
    // own readout row. The key is the metric's name reduced to an identifier ("Built-up area" →
    // `val-Built_up_area`), from the shared `paramOutputEntries` so the row, the handle and the value the
    // evaluator publishes always agree. Wire a metric into a Math Engine, an Output slot or any param.
    hasInput: false,
    hasOutput: false,
    valueInputs: [{ key: "def", label: "Definition" }],
    valueOutputs: [{ key: "def", label: "Definition" }],
    defaultParams: {},
    fields: [],
    hint: "Read a wired Parametric Object's output metrics (declared `outputs` + derived size/area/volume). Each metric gets its own output endpoint; the definition passes through.",
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
  // Data-declared (see ./declarations/mesh-to-3d.node.json) — behaviour stays in code.
  "mesh-to-3d": buildToolDefFromDeclaration(meshTo3dDecl as unknown as NodeDeclaration),
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
  // Data-declared (see ./declarations/schema-to-drawing.node.json) — behaviour stays in code.
  "schema-to-drawing": buildToolDefFromDeclaration(schemaToDrawingDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/schema-to-layers.node.json) — behaviour stays in code.
  "schema-to-layers": buildToolDefFromDeclaration(schemaToLayersDecl as unknown as NodeDeclaration),
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
  // Data-declared (see ./declarations/mass.node.json) — behaviour stays in code.
  mass: buildToolDefFromDeclaration(massDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/cuboid.node.json) — behaviour stays in code.
  cuboid: buildToolDefFromDeclaration(cuboidDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/cylinder.node.json) — behaviour stays in code.
  cylinder: buildToolDefFromDeclaration(cylinderDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/sphere.node.json) — behaviour stays in code.
  sphere: buildToolDefFromDeclaration(sphereDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/cone.node.json) — behaviour stays in code.
  cone: buildToolDefFromDeclaration(coneDecl as unknown as NodeDeclaration),
  // Batch-A 3D primitives — rendered host-side by primitiveMasses like cuboid/cylinder/sphere/cone:
  // Frustum (tapered cylinder), Tapered Box (rectangular frustum), Torus (flat ring, partial sweep), Capsule.
  frustum: buildToolDefFromDeclaration(frustumDecl as unknown as NodeDeclaration),
  "tapered-box": buildToolDefFromDeclaration(taperedBoxDecl as unknown as NodeDeclaration),
  torus: buildToolDefFromDeclaration(torusDecl as unknown as NodeDeclaration),
  capsule: buildToolDefFromDeclaration(capsuleDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/transform-3d.node.json) — behaviour stays in code.
  "transform-3d": buildToolDefFromDeclaration(transform3dDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/boolean-3d.node.json) — behaviour stays in code.
  "boolean-3d": buildToolDefFromDeclaration(boolean3dDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/display-3d.node.json) — behaviour stays in code.
  "display-3d": buildToolDefFromDeclaration(display3dDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/inset-3d.node.json) — behaviour stays in code.
  "inset-3d": buildToolDefFromDeclaration(inset3dDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/smooth-3d.node.json) — behaviour stays in code.
  "smooth-3d": buildToolDefFromDeclaration(smooth3dDecl as unknown as NodeDeclaration),
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
    // The image AS A MATRIX (`val-matrix`) — the bridge from the raster into the Matrix / Grid nodes,
    // mirroring what Grid Geometry does for a grid-field. Per-pixel luminance 0..1, row-major, and
    // DOWNSAMPLED (long edge capped, see IMAGE_MATRIX_MAX_EDGE in evaluateFlow) because values travel
    // between nodes as JSON strings and a full-resolution photo would be megabytes on every eval. The
    // node body shows no matrix box — the data lives on the wire, not on the node.
    // `matrix` is the pixels; the five that follow are WHERE THOSE PIXELS ARE. The matrix alone is just
    // numbers on a wire with no world box, so anything derived from it had to be placed BY HAND — a typed
    // image width and origin that only ever approximated the underlay, and drifted the moment the picture
    // was moved or rescaled. These publish the real placement in the same anchor-relative METRES every
    // other value output speaks, so a Math Engine can put its result back exactly on top of the picture it
    // read. `cellM` is the one to reach for: the matrix is DOWNSAMPLED, so one cell is several image
    // pixels, and this is that cell's size in metres — exact, unlike width ÷ columns, which smears the
    // last partial cell's rounding across every cell.
    // `image` is the picture ITSELF as a `data:` URL — the underlay's own bytes, not a re-render. It is
    // what an Analyse / Render node's File / Image input wants, so the plan already on canvas can be sent
    // to a model without a File Upload node asking for the same file a second time. The matrix cannot
    // serve that purpose: it is downsampled to a luminance grid, which is unreadable as a drawing.
    valueOutputs: [
      { key: "id", label: "Image id" },
      { key: "image", label: "Image (data URL)" },
      { key: "matrix", label: "Matrix (JSON)" },
      { key: "matrixR", label: "Red (JSON)" },
      { key: "matrixG", label: "Green (JSON)" },
      { key: "matrixB", label: "Blue (JSON)" },
      { key: "originX", label: "Origin X", unit: "m" },
      { key: "originY", label: "Origin Y", unit: "m" },
      { key: "cellM", label: "Cell size", unit: "m" },
      { key: "widthM", label: "Image width", unit: "m" },
      { key: "heightM", label: "Image height", unit: "m" },
    ],
    // WHICH PICTURE. Blank is the base underlay — the imported drawing, and what every flow written
    // before overlays existed goes on reading. Naming an overlay ("render-1") points this node, and the
    // Vectorisation / Object Detection chain hanging off it, at that picture instead. A name with no
    // overlay behind it falls back to the base rather than going dark, so deleting an overlay degrades
    // to the original drawing instead of silently emptying the branch.
    // Which channel `val-matrix` carries. Every option is oriented LOW = INK, so one `value ≤ threshold`
    // test downstream means "ink" whichever is picked. Distance to colour is the general form of the
    // Vectorisation node's Colour + Tolerance pair — any target colour, with the consumer's own threshold
    // acting as the tolerance. These live on the node rather than being wireable BY DESIGN: the Image node
    // is a root, so an edge back into it from an Input Properties brief would close a cycle, and
    // evaluateFlow's topological sort bails on one.
    defaultParams: { grabFromSelection: true, id: "", channel: "luma", inkColor: "#000000", pooling: "mean" },
    fields: [
      // POOLING is a property of the SOURCE - how the raster is sampled - which is why it belongs here
      // and the removed "Read" selector did not: which channel counts as ink is a question about the
      // trace. Mean box-filters and is right for a photograph; Ink reports each block's darkest pixel,
      // which is what keeps a 1 px coloured hairline alive through the 128-cell downsample instead of
      // averaging it into the paper. Mean stays the default so existing flows are untouched.
      { key: "pooling", label: "Sampling", kind: "select", options: [
        { value: "mean", label: "Mean (photographic)" },
        { value: "ink", label: "Ink (keep hairlines)" },
      ] },
      // Same pair every other source node carries: a checkbox that FOLLOWS the canvas selection, and the
      // id it writes, which stays editable when the checkbox is off. On by default, matching Graph /
      // Segment / Node — a node dropped while a picture is selected should already be reading it.
      { key: "grabFromSelection", label: "Grab from selection", kind: "checkbox" },
      { key: "id", label: "Image", kind: "text", placeholder: "blank = the imported plan; or render-1 …" },
      // NO "Read" SELECTOR. `channel` and `inkColor` are still read below and still drive `val-matrix`,
      // so a flow that sets them keeps working — they simply have no control on the node any more.
      // They were a Vectorisation-era detail on a node that is now the Geometry node's Image kind, and
      // the wrong place for it either way: which channel counts as ink is a question about the TRACE,
      // and Vectorisation has its own Colour mode for exactly that. Leaving the pair here offered two
      // answers to one question, on two different nodes, with only one of them consulted by the tracer.
      // `inkColor` goes with it: it only ever appeared for `channel: "dist"`, which is now unreachable
      // from the UI, so a colour swatch that can never be shown is not a control, it is dead weight.
    ],
    hint: "The imported underlay image (auto-connects to the canvas image, or to whichever picture is selected). `val-image` is the picture's own bytes as a data URL — what an Analyse or Render node's File input wants. `val-matrix` publishes it as a downsampled 0..1 luminance matrix (LOW = ink) for the Matrix / Grid nodes, and the four placement outputs say where those pixels are, in metres. Feeds Vectorisation, which picks its own colour to trace.",
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
    // VALUE-ONLY: the trace leaves on `val-graph`, never as geometry, and the node draws nothing —
    // `drawsNothing` therefore hides the canvas-visibility (eye) toggle, which would have nothing to
    // toggle. Wire the graph into Network / Polygon to see it, or into any Graph node to work on it.
    hasOutput: false,
    drawsNothing: true,
    // EVERY tracing parameter is wireable, not just the four that used to be. The kernel already reads
    // them all through `{ ...data.params, ...vin }`, so the list below was the only thing standing between
    // a brief and the trace: a flow that puts the whole tuning set on ONE Input Properties node — the
    // shape detect_* flows already use — needs an endpoint per row, or half the brief silently does
    // nothing. Ordered as the sliders are, so the endpoints read top-to-bottom like the panel.
    valueInputs: [
      { key: "colorMode", label: "Colour" },
      { key: "tolerance", label: "Tolerance" },
      { key: "despeckle", label: "Despeckle" },
      { key: "dilate", label: "Gap close" },
      { key: "spurLength", label: "Prune spurs" },
      { key: "simplifyEpsilon", label: "Simplify" },
      { key: "minLength", label: "Min length" },
      { key: "snapTolerance", label: "Node snap" },
      { key: "connectGap", label: "Bridge gaps" },
      { key: "mergeAngle", label: "Straighten" },
      { key: "orthoSnap", label: "Ortho snap" },
      { key: "orthoTol", label: "Ortho window" },
      { key: "tuneMinArea", label: "Min space area" },
      { key: "tuneColour", label: "Tune colour too" },
    ],
    // The vector result, plus the live trace-quality readouts (also the Auto-Tune objective): closed
    // faces ≥ Min space area, dangling degree-1 endpoints (broken loops), and traced polyline count.
    valueOutputs: [
      { key: "graph", label: "Graph (JSON)" },
      { key: "nodes", label: "Nodes" },
      { key: "edges", label: "Edges" },
      { key: "spaces", label: "Spaces" },
      { key: "openEnds", label: "Open ends" },
      { key: "lines", label: "Lines" },
    ],
    defaultParams: {
      colorMode: "black", tolerance: 50, despeckle: 12, dilate: 3, spurLength: 10,
      simplifyEpsilon: 2, minLength: 30, snapTolerance: 8, connectGap: 12,
      mergeAngle: 7, orthoSnap: 0, orthoTol: 10,
      tuneMinArea: 1, tuneColour: false,
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
      // Auto-Tune scoring floor: faces smaller than this don't count as spaces (text boxes, hatching).
      { key: "tuneMinArea", label: "Min space area", kind: "range", min: 0, max: 50, step: 0.5, unit: "m²" },
      // Auto-Tune also sweeps the colour mode (for drawings whose line colour is unknown).
      { key: "tuneColour", label: "Tune colour too", kind: "checkbox" },
    ],
    hint: "Trace the image's lines into a connected node/edge graph — colour filter, despeckle, gap-close, spur pruning, simplify, vertex snap, endpoint bridging (T-junctions), ortho straightening and collinear merging. VECTOR OUT ONLY: the result leaves on val-graph as node/edge JSON in metres (with val-nodes / val-edges counts) and the node draws nothing — wire the graph into Fit Lines, Graph to Spaces, Network or Polygon. AUTO-TUNE loops these parameters against the image, scores each combo on closed spaces found (minus noise faces and open ends) and bakes the best values back into the sliders — no manual hit-and-trial; judge it on the Spaces / Open ends / Lines readouts.",
  },
  "object-detection": {
    type: "object-detection",
    label: "Object Detection",
    color: "#a21caf",
    // Pure VALUE node: detects objects in the input image (Gemini) and publishes their bounding boxes as
    // MATH values — a nested polygon list and a node/edge graph — instead of emitting geometry. The async
    // detect bakes `_boxes` (world polygons); the eval reads them and republishes in anchor-relative
    // metres. It has NO geometry output: wire `val-polygons` into a Polygon node, or `val-graph` into a
    // Network node, to draw the boxes — which keeps the detection composable with the Math / Graph nodes
    // rather than dumping one Space per object. Mirrors Image Tools → Object Detection (box mode).
    hasInput: true,
    hasOutput: false,
    // THE THREE SETTINGS A BRIEF NEEDS TO REACH. Key, model and Max items were params only, so a flow
    // that gathers every input into one Input Properties panel had nowhere to put them and the detection
    // node stayed a second place to configure. Wired values are baked back onto the params (see the
    // object-detection branch in FlowOverlay's bake pass), because DETECT is a button that reads params
    // rather than the live graph — without that bake a wired key would resolve in the preview and still
    // be missing at the moment it is pressed.
    valueInputs: [
      { key: "api_key", label: "API key" },
      { key: "model", label: "Model" },
      { key: "maxItems", label: "Max items" },
    ],
    // On top of these fixed endpoints the node publishes ONE DYNAMIC endpoint per "Add object" row
    // (`val-<rowId>`, rendered from params.objects like Input Properties renders its props) plus
    // `val-unmatched` — see the detection branch in evaluateFlow.
    valueOutputs: [
      { key: "polygons", label: "Polygons (JSON)" },
      // FLAT corner matrix — one row per box [x0,y0,x1,y1,x2,y2,x3,y3], anchor-relative metres. The form
      // a Math Engine can lift directly: the nested ring list on `polygons` parses to zeros there (a ring
      // is not a number), so this is the endpoint that lets detection wire straight into `expr` with no
      // Graph to Matrix bridge. Per-row twins exist too (`val-<rowId>_corners`).
      { key: "corners", label: "Corners (N×8, row per box)" },
      { key: "points", label: "Points (JSON)" },
      { key: "labels", label: "Labels (JSON)" },
      { key: "graph", label: "Graph (JSON)" },
      { key: "count", label: "Objects" },
      { key: "area", label: "Total area", unit: "m²" },
    ],
    defaultParams: { api_key: "", model: "gemini-robotics-er-2-preview", targets: "", maxItems: 20, shape: "polygon", objects: [] },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Gemini API key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-robotics-er-2-preview" },
      // Free-text fallback — only meaningful when NO object rows are configured (rows drive the ask).
      { key: "targets", label: "Detect", kind: "text", placeholder: "e.g. trees, cars (blank = all)", showIf: (p) => !(Array.isArray(p.objects) && p.objects.length) },
      // PER OBJECT once rows exist: the cap sent to the model is this × the number of rows, so adding a
      // row can't starve the classes listed after it.
      { key: "maxItems", label: "Max items", kind: "range", min: 1, max: 50, step: 1 },
      // WHAT the model is asked to return: the object's boundary, a point on it, or both in one call.
      // Gemini's spatial models answer either form natively — this is the ask, not a post-process.
      {
        key: "shape",
        label: "Shape",
        kind: "select",
        options: [
          { value: "polygon", label: "Polygon (boundary)" },
          { value: "point", label: "Point" },
          { value: "both", label: "Both" },
        ],
      },
    ],
    hint: "Detect objects in the image → their geometry as MATH values. ADD OBJECT lists what to find (door, window, room, …): every row goes into ONE prompt, so it stays a single API call, and the reply is split back so each row gets its OWN endpoint. Because the row name is both the ask and the split term, the two can't drift apart. Shape is chosen once for the whole node — Polygon (boundary), Point, or Both — so every row endpoint carries the same kind of value: a nested [[[x,y],…],…] metre ring list, or an N×2 metre point matrix. `val-unmatched` collects anything the model returned that no row claimed, so nothing is silently lost. The fixed endpoints still publish the whole reply: val-polygons, val-points, val-labels, val-graph, val-count, val-area. With no rows added it falls back to the free-text Detect field. No geometry output — wire a row into a Polygon node, a Label Graph, or a Point / Place Object node. Needs a Gemini key; click Detect.",
    instructions: "Reads the drawing SEMANTICALLY — what a thing IS and roughly WHERE — and publishes it as values. Vectorisation reads geometry and cannot tell a door from a gap; this can, and the two are meant to be used together.\n\nSETUP\n1. Paste a Gemini API key. Without one this node produces nothing while everything downstream still evaluates, so a missing key looks exactly like \"the drawing had no doors\" — check the key before believing an empty result.\n2. Wire an Image node in (plain geometry edge, no handles). It reads whatever is on the canvas, title block and legend included.\n3. Press DETECT. It is an ASYNCHRONOUS, MANUAL action: the pass runs against the image and bakes its result into the node. Nothing detects on its own, and re-running the flow does NOT re-detect — press it again after changing the image or the rows.\n\nADD OBJECT ROWS — the main control\nEach row is one class to find: \"Door\", \"Window\", \"Room\", \"Furniture\". Every row goes into a SINGLE prompt, so four rows still cost ONE API call — billed per image, so four separate nodes would cost roughly four times as much for the same reading. The reply is split back by row, and each row publishes:\n  • val-<rowId>         — its own geometry (rings, or points)\n  • val-<rowId>_labels  — the individual names the model returned for that row\n  • val-<rowId>_count   — how many it claimed\nMatching is CASE-INSENSITIVE and BIDIRECTIONAL containment, so a row named \"door\" claims \"Door\", \"sliding door\" and \"doorway\". Name rows in the singular and keep them short.\n\nSHAPE is chosen ONCE for the whole node, so every row carries the same kind of value:\n  • Polygon — a nested [[[x,y],…],…] metre ring list. Draw with a Render 2D POLYGON row.\n  • Point   — an N×2 metre matrix (which IS a point list). Draw with a Render 2D CIRCLE row.\n  • Both    — a boundary and a point per object, paired by index.\nPick the one the downstream node wants: a boundary to outline a room, a point to place an object.\n\nMAX ITEMS is PER ROW once rows exist, so adding a row cannot starve the classes after it. Keep it near the real count — a 6-room plan does not need 50.\n\nCHECK val-unmatched. It collects everything the model returned that no row claimed. A row reading 0 while unmatched is full means the model used a different word — rename the row to match, do not raise Max items.\n\nWHAT THE RESULT IS, AND IS NOT\nThis node has NO geometry output and commits nothing: a detection is a READING of the image, not a decision about the plan, so you choose what to draw. Boundaries are axis-aligned and approximate — NEVER take a boundary edge as a wall line. Use detection for what a thing IS and roughly WHERE; use Vectorisation / Fit Lines for exactly where its edges are. Good uses: naming traced Spaces by overlapping detected rooms, placing openings where the drawing actually shows them rather than by rule, and putting objects at detected points.\n\nFilter by Label splits one mixed detection into families; Label Graph names each component from a labels array; Merge Graph unions the families into one typed graph.",
  },
  render: {
    type: "render",
    label: "Render",
    color: "#1d4ed8",
    hasInput: false,
    hasOutput: false,
    // Action node (not a geometry/recipe op): sends the wired image(s) with the prompt to a Google AI
    // image model, then shows the result + a download link.
    //
    // WHAT IT SENDS IS EXACTLY WHAT YOU GAVE IT — the system prompt, the prompt and the wired image(s),
    // and nothing else. It used to do more: a geometry input framed a camera, a `padding` slider grew
    // that frame, and an unwired Image input fell back to photographing the 3D view. Every one of those
    // put content into the request that the author never wrote, which is indefensible for a node whose
    // whole job is to carry an instruction faithfully — a prompt asking for a schematic line drawing
    // would be answered with a rendering of a 3D view it silently captured. There is no camera to aim
    // any more, so the geometry input is gone with it, and a missing image is an ERROR rather than a
    // substitution. `generationConfig.responseModalities` is the one thing still set here: it is the
    // wire protocol for asking the endpoint for an image at all, not content.
    //
    // The PROMPT is a value input as well as a field, so a Text / Math Engine / Analyse node can compose
    // it in the flow (the Agent node cannot: it only ever writes range/number/select/checkbox params).
    //
    // THREE INPUTS, and they are three different things:
    //  • IMAGE — what to render. Wire a Snapshot's `val-image` (the 2D plan as drawn) or an Image node's
    //    `val-image` (the underlay's own bytes). REQUIRED: one of Image / 3D image must resolve to a
    //    data URL, or the run stops and says so.
    //  • 3D IMAGE — the SAME subject from above, for a Snapshot's `val-image-3d`. Both images are sent
    //    together when both are wired, in that order, so the model reads the plan for what the geometry IS
    //    and the 3D shot for how it stands. Either alone works; the pair is the point.
    //  • PROMPT — what to render THIS time. The per-run instruction.
    //  • SYSTEM PROMPT — how the model should behave, every time. Sent as Gemini's `systemInstruction`
    //    rather than folded into the prompt, so the standing rules ("hold the geometry, never move
    //    anything") cannot be diluted by whatever the per-run prompt happens to say.
    valueInputs: [{ key: "image", label: "Image" }, { key: "image3d", label: "3D image" }, { key: "prompt", label: "Prompt" }, { key: "systemPrompt", label: "System prompt" }],
    // The generated picture, as a data URL. Empty until the button has been pressed — this is an ACTION
    // node, so the value appears when a run bakes `_resultUrl` and not on evaluation.
    valueOutputs: [{ key: "image", label: "Image (data URL)" }],
    // A fresh Render node starts BLANK — every field included. The system prompt used to ship an
    // architectural-visualiser persona ending "Render materials and light only", which is a reasonable
    // default for exactly one use and silently contradicts every other: a prompt asking for a flat
    // schematic of coloured lines would be overruled by a standing rule the author never wrote and had
    // no reason to look for. What the model is told is now entirely what is typed or wired here.
    defaultParams: {
      name: "",
      api_key: "",
      model: "gemini-3.1-flash-image-preview",
      systemPrompt: "",
      prompt: "",
    },
    fields: [
      { key: "api_key", label: "API key", kind: "text", secret: true, placeholder: "Google AI Studio key" },
      { key: "model", label: "Model", kind: "text", placeholder: "gemini-3.1-flash-image-preview" },
      { key: "systemPrompt", label: "System prompt", kind: "textarea", placeholder: "How the model should behave — the standing rules…" },
      { key: "prompt", label: "Prompt", kind: "textarea", placeholder: "What to render this time…" },
    ],
    hint: "Render an image with Google AI. Four inputs: Image and 3D image (wire an Image node's underlay bytes, or a Snapshot's plan and top-view outputs — both are sent together when both are wired; one of the two is required), Prompt (what to render now) and System prompt (the standing rules, sent as systemInstruction). All four can be wired or typed. Only these are sent — the node adds nothing of its own.",
  },
  // Data-declared (see ./declarations/hatching.node.json) — behaviour stays in code.
  hatching: buildToolDefFromDeclaration(hatchingDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/display-segment.node.json) — behaviour stays in code.
  "display-segment": buildToolDefFromDeclaration(displaySegmentDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/display-node.node.json) — behaviour stays in code.
  "display-node": buildToolDefFromDeclaration(displayNodeDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/bua.node.json) — behaviour stays in code.
  bua: buildToolDefFromDeclaration(buaDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/math.node.json) — behaviour stays in code.
  math: buildToolDefFromDeclaration(mathDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/random.node.json) — behaviour stays in code.
  random: buildToolDefFromDeclaration(randomDecl as unknown as NodeDeclaration),
  // ── Parametric-object decomposition (read-only) — nodes emitted by "Load Parametric Object" to visualise
  //    a .pobj.json's vars (Expression) + geometry rules (Create Polygon / Segment / Arc / Box) as a graph.
  //    These are display-only: the flow evaluator ignores them (evalNode default), so they annotate structure
  //    without recomputing geometry. ──
  // Data-declared (see ./declarations/expr.node.json) — display-only node (evaluator ignores it).
  expr: buildToolDefFromDeclaration(exprDecl as unknown as NodeDeclaration),
  output: {
    type: "output",
    label: "Output Metrics",
    color: "#0d9488",
    // A collector: wire any node's `val-*` output into one of its named slots; the slot's value is surfaced
    // live on the node and in the Space's Metrics tab. Slots auto-grow + are user-named, so its endpoints
    // are dynamic (driven by params.slots) rather than the static valueInputs list.
    //
    // Each slot PUBLISHES what it collected too, on `val-<slotId>` — the mirror of its own `valin-<slotId>`,
    // on the same row — so the node can sit mid-chain rather than only terminating: read a metric, show it,
    // pass it on. Both endpoints are keyed by the SLOT ID, never the label, so renaming a slot cannot move a
    // wire. An unwired slot publishes nothing, leaving a downstream consumer on its own value.
    hasInput: false,
    hasOutput: false,
    defaultParams: { slots: [{ id: "s1", label: "" }] },
    fields: [],
    hint: "Collect values from any node into named metrics (shown in the Metrics tab). Each slot also re-publishes its value.",
  },
  // Data-declared (see ./declarations/space-geometry.node.json) — behaviour stays in code.
  "space-geometry": buildToolDefFromDeclaration(spaceGeometryDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/merge.node.json) — behaviour stays in code.
  merge: buildToolDefFromDeclaration(mergeDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/boolean-2d.node.json) — behaviour stays in code.
  "boolean-2d": buildToolDefFromDeclaration(boolean2dDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/input-props.node.json) — behaviour stays in code (dynamic prop outputs).
  "input-props": buildToolDefFromDeclaration(inputPropsDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/file-upload.node.json) — behaviour stays in code.
  "file-upload": buildToolDefFromDeclaration(fileUploadDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/text.node.json) — behaviour stays in code.
  text: buildToolDefFromDeclaration(textDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/prompt-builder.node.json) — fills a {name} template from its
  // wired values. The step between the flow's numbers and a model's words: the Math Engine cannot
  // concatenate strings and Text only passes one through, so nothing else can build a prompt.
  "prompt-builder": buildToolDefFromDeclaration(promptBuilderDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/plan-json.node.json) — the canvas model as JSON on a wire,
  // scoped to the wired Space. The only node that can say what a segment IS and what object is on it.
  "plan-json": buildToolDefFromDeclaration(planJsonDecl as unknown as NodeDeclaration),
  // Data-declared (see ./declarations/filter-by-space.node.json) — the scoping half of Plan JSON, split
  // out so the region can be any wired Space rather than only the canvas selection.
  "filter-by-space": buildToolDefFromDeclaration(filterBySpaceDecl as unknown as NodeDeclaration),
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
  /** Injected by the host — the Vectorisation node's "Auto-Tune" action (sweeps the tracing parameters
   *  against the loaded image, scores combos on closed spaces found, bakes the best values back). */
  onRunVectorTune?: (nodeId: string, params: Record<string, unknown>) => void;
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
  /** Injected by the host — the Agent node's "Run" action: analyses the wired Space with the selected
   *  Library agent and bakes the suggested parameters into the nodes chained downstream. */
  onRunAgent?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Export DXF node's "Download" action: serialises the wired 2D geometry to
   *  an R12 DXF and saves it. */
  onExportDxf?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Export 3D node's "Download" action: serialises the wired 3D solids to
   *  glTF / OBJ / STL / PLY and saves it. */
  onExport3d?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Export to Canvas node's "Reflect" action: stamps the wired 2D geometry onto
   *  the plan as ordinary Spaces + segments (not flow-owned, so nothing rewrites it afterwards). */
  onExportToCanvas?: (nodeId: string, params: Record<string, unknown>) => void;
  onSetObjectParams?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Injected by the host — the Object Node's "decompile" toggle: hide/show every node + edge DOWNSTREAM of
   *  this one (the materialised Inset / Circle Packing / Cylinder … chain), collapsing it back to the lone
   *  Object Node. Reflected by the transient `_decompileHidden` param. */
  onToggleDecompile?: (nodeId: string) => void;
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
