import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { X, Play, Plus, Trash2, Download, Loader2, Wand2, Upload, Sparkles, ChevronDown, ChevronRight, Group as GroupIcon, FilePlus, Eye, EyeOff, Minus, Maximize2, Minimize2, Copy, Boxes, Radio, Folder, Search, Stamp } from "lucide-react";
import { toast } from "sonner";
import type { Point, SerializedFlow, SerializedFlowNode, ParametricObjectFile } from "../types";
import { pobjToAttachedFlow } from "./pobjToFlow";
import { FLOW_TOOLS, outputSlots, inputProps, renderPrims, detectionObjects, schemaEntries, GENERATE_DEFAULT_MODEL, GEOMETRY_TOOL_BY_KIND, isGeometryTool, type FlowNodeData, type FlowToolType, type OutputSlot, type InputProp, type InputPropType, type ParamField, type RenderPrim, type DetectionObject } from "./flowTypes";
import { compileFlow } from "./compileFlow";
import { mergeObjectIntoFlow, mergeOpeningIntoFlow, mergeWallGraphIntoFlow, mergeNodeObjectIntoFlow, mergeAttachedObjectIntoFlow, pobjPropList, type AutoPlaceEntry, type OpeningKind } from "./autoFlow";
import { ExprSectionsEditor } from "./ExprSectionsEditor";
import { PlaceObjectEditor } from "./PlaceObjectEditor";
import { DimensionEdgesEditor } from "./DimensionEdgesEditor";
import { InputPropsEditor } from "./InputPropsEditor";
import { RenderPrimsEditor } from "./RenderPrimsEditor";
import { LayoutRoomsEditor } from "./LayoutRoomsEditor";
import { SchemaNodeEditor } from "./SchemaNodeEditor";
import { evaluateFlow, type FlowPreviewItem } from "./eval/evaluateFlow";
import { bakeFlowToIR, runFlowIR, irToPreviewItems } from "./flowIR";
import { inspectParametricGeometry, evalParametricOutputs, paramOutputEntries, type GeomInspection, type ParamOutputs, type ParamOutputEntry } from "./eval/parametricObject";
import { exprInputs, exprOutputs } from "@builderpluss/engine";
import type { GridField } from "./eval/evalNodes";
import { detectObjects, splitDataUrl } from "../algorithms/vision/geminiObjectDetection";
import { LibrarySourceNote } from "../components/LibrarySourceNote";
import { tuneVectorise } from "./vectorTune";
import { runAgentSuggest, runAgentCritique, runAgentGenerate, suggestInputHash, type SuggestTarget, type SuggestParamSpec, type SuggestContext, type SuggestedValue, type GenTarget } from "../ai/agentSuggest";
import type { VectorizeParams, VectorizeColorMode } from "@builderpluss/engine";
import { saveLibraryFile, listParametricObjectFiles, listFlowNodeFiles, listWorkflowFiles, fetchLibraryJson, LIB_OBJECTS, LIB_TOOLS, LIB_WORKFLOWS } from "../libraryFiles";
import { parseBspConnections, serializeBspConnections } from "@builderpluss/engine";
import type { PipeGraphInput } from "@builderpluss/engine";
import { flowPiecesToDxf, DXF_UNIT_SCALE, type FlowDxfPiece, type DxfUnit } from "../export/flowDxf";
import { exportMassesToBlob, MESH3D_FORMATS, MESH3D_UNIT_SCALE, type Mesh3DFormat, type ExportMass3D } from "../export/flowMesh3d";

let nodeSeq = 1;
const nextId = (tool: string) => `${tool}_${nodeSeq++}`;

/** Palette grouping — the left "Add" rail is split into foldable category blocks (in this order). */
const PALETTE_CATEGORIES: { title: string; tools: FlowToolType[] }[] = [
  // "plan-json" is deliberately ABSENT: the Geometry node publishes the same payload on `val-canvasJson`,
  // so a new flow needs one node where this took two. The tool itself still evaluates — every saved flow
  // holding one keeps loading — it simply cannot be added any more.
  { title: "Canvas", tools: ["canvas-source", "separate", "filter-by-type", "get-object-param", "set-object-param"] },
  { title: "Freehand", tools: ["freehand-source", "freehand-geometry"] },
  { title: "2D Primitives", tools: ["render-2d", "point", "vertices", "network", "rectangle", "circle"] },
  { title: "3D Primitives", tools: ["render-3d", "cuboid", "cylinder", "sphere", "cone", "loop-3d", "transform-3d", "boolean-3d", "display-3d", "material"] },
  { title: "Space", tools: ["source", "space-creator", "space-geometry", "pull", "transform", "hatching", "dimension", "area-dimension", "input-props", "schema", "output-schema", "schema-to-drawing", "schema-to-layers", "boolean-2d", "layout-gen"] },
  { title: "Reshape", tools: ["inset", "optimise-rect", "smoothing", "densify", "bounding-shape", "convex-hull", "contour"] },
  { title: "Partition", tools: ["split", "loop", "bsp", "voronoi", "treemap", "rect-pack", "convex-decomp", "mesh", "circle-packing", "skeleton", "visibility"] },
  { title: "Segment", tools: ["segment-source", "segment-split", "display-segment"] },
  { title: "Node", tools: ["node-source", "bloom", "display-node"] },
  { title: "Graph", tools: ["graph-source", "mitered-join", "graph-smooth", "graph-metrics", "graph-geometry", "show-direction", "graph-to-spaces", "graph-reduce", "graph-simplify", "graph-clip", "graph-fit-lines", "graph-classify", "set-thickness", "label-graph", "merge-graph", "graph-to-openings", "voronoi-bloom", "spring-layout", "pipe-solver", "matrix-to-graph", "graph-to-matrix"] },
  { title: "Grid", tools: ["grid-source", "graph-to-grid", "grid-field", "cellular-automaton", "laplace-solver", "fill-depressions", "flow-direction", "flow-accumulation", "watershed", "morphology", "grid-distance", "grid-threshold", "marching-squares", "grid-geometry", "render-grid", "matrix-transpose", "matrix-inverse", "matrix-solve", "least-squares", "matrix-ops", "matrix-shift", "matrix-reduce", "matrix-eigen", "vector-ops", "vector-product"] },
  { title: "Image", tools: ["image", "vectorise", "object-detection", "filter-by-label"] },
  { title: "Logic", tools: ["conditional", "param-manip"] },
  { title: "Build", tools: ["floor-massing", "place-object", "frame-builder"] },
  { title: "Building", tools: ["wall-builder", "graph-to-room", "segment-to-door", "segment-to-window", "node-to-object", "segment-to-3d", "space-to-3d"] },
  { title: "Mass", tools: ["mass", "inset-3d", "smooth-3d", "mesh-to-3d"] },
  { title: "Parametric", tools: ["pobj-source", "grab-object", "param-object", "param-grab", "param-output-metrics", "param-geometry"] },
  { title: "Calculate", tools: ["math", "match", "random", "expr", "bua", "file-upload", "text"] },
  { title: "Output", tools: ["output", "prompt-builder", "render", "analyse", "generate", "snapshot", "export-dxf", "export-3d", "export-canvas"] },
];

// ("Arrange" no longer classifies tools into blocks — it boxes the whole operation and leaves only the canvas
//  readers out. See `arrangeFlow`; the old ARRANGE_BLOCKS / ARRANGE_CLASS tables are gone with that behaviour.)

/** How long a value baked back onto a node for its READOUT may get before only its shape is kept. */
const READOUT_MAX = 96;
/** The bake-safe form of a live value. A number or a short string passes through; a long JSON payload — an
 *  image matrix, a thousand-row point list — is replaced by its SHAPE ("96×128", "412 pts").
 *
 *  These bakes (`_values` for a node's value-output rows, `_wired` for a driven Input Properties parameter)
 *  exist ONLY to show the value on the node, and they are node params, so they serialise with the flow. A
 *  128-cell image matrix is ~200 kB of digits — kept in full it would be written into params on every
 *  evaluation, deep-compared against the previous bake on every evaluation, and saved into the flow file,
 *  to render as a number no one can read. The payload itself never needs to be there: it travels on the
 *  wire, and the consumer reads it from the wire. Params a node actually COMPUTES from (a grid node's
 *  `matrix` textbox, a wired numeric field) are baked in full elsewhere and are deliberately not routed
 *  through here. */
const readoutValue = (v: number | string): number | string => {
  if (typeof v !== "string" || v.length <= READOUT_MAX) return v;
  try {
    const arr = JSON.parse(v) as unknown;
    if (Array.isArray(arr)) {
      const first = arr[0] as unknown;
      // Rows of rows = a matrix (its shape); an N×2 list is a point list (its length) — the same reading
      // the readout row itself applies to a value small enough to keep.
      if (Array.isArray(first) && first.length !== 2) return `${arr.length}×${first.length}`;
      return `${arr.length} pts`;
    }
  } catch { /* not JSON — fall through to a plain clip */ }
  return `${v.slice(0, READOUT_MAX)}…`;
};
/** {@link readoutValue} over a whole value set, returning the ORIGINAL object when nothing was long enough
 *  to summarise — so the identity checks that decide whether a node changed still short-circuit. */
const readoutValues = (v: Record<string, number | string>): Record<string, number | string> => {
  const out: Record<string, number | string> = {};
  let clipped = false;
  for (const [k, val] of Object.entries(v)) {
    const s = readoutValue(val);
    if (s !== val) clipped = true;
    out[k] = s;
  }
  return clipped ? out : v;
};

/** A workflow FILE name as a group title: "inset_with_math.json" → "Inset with Math". Words are capitalised
 *  except the little joining ones, which is what makes it read as a name rather than a slug. */
const NAME_MINOR = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);
export const prettyFlowName = (file: string): string => {
  const base = file.replace(/\.[^.]+$/, "").split(/[\\/]/).pop() ?? "";
  const words = base.split(/[_\-\s]+/).filter(Boolean);
  return words
    .map((w, i) => (i > 0 && NAME_MINOR.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
};

// Inline monochrome SVG → data URL, for default per-option type icons in the schema. encodeURIComponent
// keeps it valid in an <img src> (handles #, quotes, etc.).
const svgIcon = (body: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  )}`;

// Default type icons for the Floorplan Tracer's segment `type` and node `objectKind` selects.
const SEG_TYPE_ICONS: Record<string, string> = {
  wall: svgIcon(`<rect x="3" y="10" width="18" height="4" rx="0.5" fill="#0f172a" stroke="none"/>`),
  door: svgIcon(`<path d="M6 19V6"/><path d="M6 6a13 13 0 0 1 12 13"/><line x1="6" y1="19" x2="18" y2="19"/>`),
  window: svgIcon(`<rect x="3" y="9" width="18" height="6" rx="0.5"/><line x1="12" y1="9" x2="12" y2="15"/>`),
  line: svgIcon(`<line x1="4" y1="20" x2="20" y2="4"/>`),
};
const NODE_TYPE_ICONS: Record<string, string> = {
  object: svgIcon(`<rect x="5" y="5" width="14" height="14" rx="1"/><line x1="5" y1="5" x2="19" y2="19"/>`),
  junction: svgIcon(`<circle cx="12" cy="12" r="3" fill="#0f172a" stroke="none"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>`),
  staircase: svgIcon(`<path d="M3 20h4v-4h4v-4h4v-4h4v-4h2"/>`),
};
// Space-type icons for the Floorplan Tracer's space `type` select (Room / Open Space).
const SPACE_TYPE_ICONS: Record<string, string> = {
  room: svgIcon(`<path d="M4 10 12 4l8 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><rect x="10" y="14" width="4" height="6"/>`),
  "open-space": svgIcon(`<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="3.5"/>`),
};
const OBJECT_KIND_ICONS: Record<string, string> = {
  bed: svgIcon(`<rect x="3" y="6" width="18" height="12" rx="1"/><line x1="9" y1="6" x2="9" y2="18"/>`),
  sofa: svgIcon(`<rect x="3" y="9" width="18" height="9" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/>`),
  table: svgIcon(`<rect x="5" y="5" width="14" height="14" rx="1"/>`),
  chair: svgIcon(`<rect x="7" y="10" width="10" height="8" rx="1"/><path d="M7 10V6h10v4"/>`),
  sink: svgIcon(`<rect x="4" y="6" width="16" height="12" rx="2"/><circle cx="12" cy="13" r="1.6"/><line x1="12" y1="6" x2="12" y2="9"/>`),
};

// General schema row (supports select options / color / type-driven showIf) — for the Floorplan Tracer.
const xProp = (
  id: string, key: string, label: string,
  kind: "number" | "select" | "checkbox" | "text" | "color",
  def: number | string | boolean,
  extra: { unit?: string; min?: number; max?: number; step?: number; role?: string; options?: string[]; showIf?: { when: string; equals?: string | number | boolean }; optionIcons?: Record<string, string> } = {},
) => ({
  id, key, label, kind,
  unit: extra.unit ?? "",
  def,
  min: extra.min ?? 0, max: extra.max ?? 1000, step: extra.step ?? 1,
  options: extra.options ?? ([] as string[]),
  role: extra.role ?? "",
  ...(extra.showIf ? { showIf: extra.showIf } : {}),
  ...(extra.optionIcons ? { optionIcons: extra.optionIcons } : {}),
});

// Shared "Element Schema" — the type-driven Segment (wall/door/window/line) + Node (object/junction)
// property schema. Reused by the Floorplan Tracer and Parametric Floorplan templates.
export const FLOORPLAN_SCHEMA_PARAMS = {
  name: "Element Schema",
  segmentProps: [
    xProp("s_type", "type", "Type", "select", "line", { role: "seg-type", options: ["wall", "door", "window", "line"], optionIcons: SEG_TYPE_ICONS }),
    xProp("s_wt", "wallThickness", "Wall Thickness", "number", 0.23, { unit: "m", min: 0.05, max: 0.6, step: 0.01, role: "wall-thickness", showIf: { when: "type", equals: "wall" } }),
    xProp("s_wjust", "wallJustification", "Justification", "select", "center", { role: "wall-justification", options: ["inner", "center", "outer"], showIf: { when: "type", equals: "wall" } }),
    xProp("s_wh", "wallHeight", "Wall Height", "number", 3, { unit: "m", min: 0, max: 10, step: 0.05, role: "wall-height", showIf: { when: "type", equals: "wall" } }),
    xProp("s_wunion", "wallUnion", "Union", "checkbox", true, { role: "wall-union", showIf: { when: "type", equals: "wall" } }),
    xProp("s_wodim", "showOuterDim", "Show Outer Dimension", "checkbox", true, { role: "show-outer-dim", showIf: { when: "type", equals: "wall" } }),
    xProp("s_widim", "showInnerDim", "Show Inner Dimension", "checkbox", true, { role: "show-inner-dim", showIf: { when: "type", equals: "wall" } }),
    xProp("s_wcdim", "showCenterDim", "Show Center Dimension", "checkbox", false, { role: "show-center-dim", showIf: { when: "type", equals: "wall" } }),
    xProp("s_woffdim", "offsetDim", "Offsetted Dimension", "checkbox", false, { role: "offset-dim", showIf: { when: "type", equals: "wall" } }),
    xProp("s_dshape", "doorShape", "Shape", "select", "arc", { role: "door-shape", options: ["polygon", "arc", "detailed"], showIf: { when: "type", equals: "door" } }),
    xProp("s_dthk", "doorThickness", "Leaf Thickness", "number", 0.05, { unit: "m", min: 0.01, max: 0.5, step: 0.01, role: "door-thickness", showIf: { when: "type", equals: "door" } }),
    xProp("s_dhinge", "doorHinge", "Hinge", "select", "left", { role: "door-hinge", options: ["left", "right"], showIf: { when: "type", equals: "door" } }),
    xProp("s_dswing", "doorSwing", "Swing", "select", "left", { role: "door-placement", options: ["left", "right"], showIf: { when: "type", equals: "door" } }),
    xProp("s_dlintel", "doorLintel", "Lintel Height", "number", 2.1, { unit: "m", min: 0, max: 5, step: 0.05, role: "lintel-height", showIf: { when: "type", equals: "door" } }),
    xProp("s_dcol", "doorColor", "Color", "color", "#9333ea", { role: "door-color", showIf: { when: "type", equals: "door" } }),
    xProp("s_wshape", "windowShape", "Shape", "select", "lines", { role: "window-shape", options: ["polygon", "lines", "detailed"], showIf: { when: "type", equals: "window" } }),
    xProp("s_wthk", "windowThickness", "Thickness", "number", 0.1, { unit: "m", min: 0.02, max: 0.6, step: 0.01, role: "window-thickness", showIf: { when: "type", equals: "window" } }),
    xProp("s_wpanes", "windowPanes", "Panes", "number", 2, { min: 1, max: 8, step: 1, role: "window-panes", showIf: { when: "type", equals: "window" } }),
    xProp("s_wsill", "windowSill", "Sill Height", "number", 0.9, { unit: "m", min: 0, max: 3, step: 0.05, role: "sill-height", showIf: { when: "type", equals: "window" } }),
    xProp("s_wlintel", "windowLintel", "Lintel Height", "number", 2.1, { unit: "m", min: 0, max: 5, step: 0.05, role: "lintel-height", showIf: { when: "type", equals: "window" } }),
    xProp("s_wcol", "windowColor", "Color", "color", "#0891b2", { role: "window-color", showIf: { when: "type", equals: "window" } }),
  ],
  nodeProps: [
    xProp("n_type", "type", "Type", "select", "junction", { role: "node-type", options: ["object", "junction", "staircase"], optionIcons: NODE_TYPE_ICONS }),
    xProp("n_kind", "objectKind", "Object", "select", "bed", { role: "object-kind", options: ["bed", "sofa", "table", "chair", "sink"], showIf: { when: "type", equals: "object" }, optionIcons: OBJECT_KIND_ICONS }),
    xProp("n_w", "objWidth", "Width", "number", 1, { unit: "m", min: 0.1, max: 5, step: 0.05, role: "obj-width", showIf: { when: "type", equals: "object" } }),
    xProp("n_h", "objHeight", "Depth", "number", 1, { unit: "m", min: 0.1, max: 5, step: 0.05, role: "obj-height", showIf: { when: "type", equals: "object" } }),
    xProp("n_rot", "objRotation", "Rotation", "number", 0, { unit: "°", min: 0, max: 360, step: 5, role: "obj-rotation", showIf: { when: "type", equals: "object" } }),
    xProp("n_anchor", "objAnchor", "Anchor", "select", "center", { role: "obj-anchor", options: ["center", "top-left", "top-right", "bottom-left", "bottom-right"], showIf: { when: "type", equals: "object" } }),
    // Staircase (type = staircase) — per-node Node-to-Staircase parameters.
    xProp("n_sconfig", "stairConfig", "Configuration", "select", "straight", { role: "stair-config", options: ["straight", "u-shape", "u-shape-mid"], showIf: { when: "type", equals: "staircase" } }),
    xProp("n_ssteps", "stairSteps", "Number of steps", "number", 14, { min: 2, max: 60, step: 1, role: "stair-steps", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_stread", "stairTread", "Tread (going)", "number", 0.28, { unit: "m", min: 0.2, max: 0.45, step: 0.005, role: "stair-tread", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_swidth", "stairWidth", "Width", "number", 1, { unit: "m", min: 0.6, max: 3, step: 0.05, role: "stair-width", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_sdir", "stairDirection", "Direction", "select", "ltr", { role: "stair-direction", options: ["ltr", "rtl"], showIf: { when: "type", equals: "staircase" } }),
    xProp("n_smid", "stairMidSteps", "Mid / split steps", "number", 0, { min: 0, max: 40, step: 1, role: "stair-mid-steps", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_sland", "stairLandingWidth", "Landing depth", "number", 1, { unit: "m", min: 0.5, max: 3, step: 0.05, role: "stair-landing-width", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_sspace", "stairMidSpace", "Mid space", "number", 0.1, { unit: "m", min: 0, max: 1, step: 0.05, role: "stair-mid-space", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_scuts", "stairLandingCuts", "Landing cuts", "number", 1, { min: 1, max: 10, step: 1, role: "stair-landing-cuts", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_srot", "stairRotation", "Rotation", "number", 0, { unit: "°", min: 0, max: 360, step: 1, role: "stair-rotation", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_scol", "stairColor", "Color", "color", "#0f766e", { role: "stair-color", showIf: { when: "type", equals: "staircase" } }),
    xProp("n_col", "nodeColor", "Color", "color", "#475569", { role: "node-color" }),
  ],
  spaceProps: [
    // Space TYPE discriminator (drives the Space layer block + per-space Properties). Room carries area /
    // ratio sizing constraints; Open Space carries none.
    xProp("sp_type", "type", "Type", "select", "room", { role: "space-type", options: ["room", "open-space"], optionIcons: SPACE_TYPE_ICONS }),
    xProp("sp_maxa", "maxArea", "Maximum Area", "number", 0, { unit: "m²", min: 0, max: 100000, step: 1, role: "max-area", showIf: { when: "type", equals: "room" } }),
    xProp("sp_mina", "minArea", "Minimum Area", "number", 0, { unit: "m²", min: 0, max: 100000, step: 1, role: "min-area", showIf: { when: "type", equals: "room" } }),
    xProp("sp_maxr", "maxRatio", "Maximum Ratio", "number", 0, { min: 0, max: 100, step: 0.1, role: "max-ratio", showIf: { when: "type", equals: "room" } }),
  ],
  graphProps: [],
  // Canvas-wide Settings — shown in the Properties tab when nothing is selected. Ortho drives the canvas
  // Ortho draw lock (horizontal / vertical only). Default on.
  settingsProps: [
    xProp("set_ortho", "ortho", "Ortho", "checkbox", true, { role: "ortho" }),
    // Display unit for all dimensions / areas — drives the canvas unit (mirrors the m / ft / cm toolbar).
    xProp("set_units", "units", "Units", "select", "m", { role: "units", options: ["m", "ft", "cm"] }),
    // Snap radii (px) — pointer snapping while drawing. Node = snap to existing endpoints; Wall-spine =
    // project the pointer onto the nearest wall centerline. 0 disables each.
    xProp("set_nsnap", "nodeSnapRadius", "Node Snap Radius", "number", 14, { unit: "px", min: 0, max: 30, step: 1, role: "node-snap-radius" }),
    xProp("set_ssnap", "spineSnapRadius", "Wall-Spine Snap Radius", "number", 14, { unit: "px", min: 0, max: 56, step: 1, role: "spine-snap-radius" }),
    // Layer-visibility toggles — each hides / unhides the matching default Layer in the Layers panel.
    // The imported Image defaults on; the Map system layer defaults off.
    xProp("set_vimage", "showImage", "Image", "checkbox", true, { role: "show-image" }),
    xProp("set_vmap", "showMap", "Map", "checkbox", false, { role: "show-map" }),
  ],
  // Layout title-block fields — role-bound to the LayoutSheet (see INFO_ROLE_TO_PROP). Edit these in
  // the Properties tab (View Mode → Layout) and the sheet's title block updates live.
  informationProps: [
    xProp("i_dtitle", "drawingTitle", "Drawing Title", "text", "GROUND FLOOR PLAN", { role: "drawing-title" }),
    xProp("i_disc", "discipline", "Discipline", "text", "ARCHITECTURAL", { role: "discipline" }),
    xProp("i_status", "status", "Status", "select", "FOR CONSTRUCTION", { role: "status", options: ["FOR CONSTRUCTION", "FOR TENDER", "PRELIMINARY", "FOR APPROVAL", "AS-BUILT"] }),
    xProp("i_firm", "firmName", "Designed By (Firm)", "text", "CONSULTANCY / FIRM NAME", { role: "firm-name" }),
    xProp("i_firmaddr", "firmAddress", "Firm Address", "text", "Street Address, City, Country", { role: "firm-address" }),
    xProp("i_firmcontact", "firmContact", "Firm Contact", "text", "+00 000 0000 · info@firm.com", { role: "firm-contact" }),
    xProp("i_proj", "projectName", "Project Name", "text", "PROJECT NAME", { role: "project-name" }),
    xProp("i_projaddr", "projectAddress", "Project Address", "text", "Plot / Street, City", { role: "project-address" }),
    xProp("i_client", "client", "Client", "text", "CLIENT NAME", { role: "client" }),
    xProp("i_drawn", "drawnBy", "Drawn By", "text", "—", { role: "drawn-by" }),
    xProp("i_checked", "checkedBy", "Checked By", "text", "—", { role: "checked-by" }),
    xProp("i_approved", "approvedBy", "Approved By", "text", "—", { role: "approved-by" }),
    xProp("i_date", "date", "Date", "text", "—", { role: "date" }),
    xProp("i_scale", "scale", "Scale", "text", "1:100", { role: "scale" }),
    xProp("i_projno", "projectNo", "Project No", "text", "—", { role: "project-no" }),
    xProp("i_sheetno", "sheetNo", "Sheet No", "text", "A-101", { role: "sheet-no" }),
    xProp("i_sheetsize", "sheetSize", "Sheet Size", "select", "A1", { role: "sheet-size", options: ["A0", "A1", "A2", "A3", "A4"] }),
    xProp("i_revlevel", "revisionLevel", "Revision", "text", "0", { role: "revision-level" }),
    // One revision-table row (rev{N}-no/date/desc/by). Add more rows with roles rev2-*, rev3-… to extend.
    xProp("i_r1no", "rev1No", "Rev 1 · No", "text", "", { role: "rev1-no" }),
    xProp("i_r1date", "rev1Date", "Rev 1 · Date", "text", "", { role: "rev1-date" }),
    xProp("i_r1desc", "rev1Desc", "Rev 1 · Description", "text", "", { role: "rev1-desc" }),
    xProp("i_r1by", "rev1By", "Rev 1 · By", "text", "", { role: "rev1-by" }),
    xProp("i_disc2", "disclaimer", "Disclaimer", "text", "© Property of the firm. Do not scale — use figured dimensions. Verify all dimensions on site.", { role: "disclaimer" }),
  ],
};

/** Build the Grab Parameters node's interactive control list from a parametric definition's `parameters`
 *  (number→slider, select→options, checkbox, text/color→textbox). Preserves the user's CURRENT value for
 *  any parameter whose key still exists (so edits survive re-syncs); seeds from the parameter default
 *  otherwise. Returns `existing` unchanged when the definition can't be parsed. Shape matches inputProps so
 *  the host's sync effect can compare cheaply. */
const paramGrabProps = (defText: string, existing: InputProp[]): InputProp[] => {
  let parsed: { parameters?: unknown };
  try { parsed = JSON.parse(defText) as { parameters?: unknown }; } catch { return existing; }
  const params = parsed?.parameters;
  if (!Array.isArray(params)) return existing.length ? existing : [];
  const prevById = new Map(existing.map((p) => [p.id, p]));
  return params.map((q, i) => {
    const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
    const key = typeof o.key === "string" && o.key ? o.key : `p${i + 1}`;
    const kind = typeof o.kind === "string" ? o.kind : "number";
    const type: InputPropType = kind === "select" ? "select" : kind === "checkbox" ? "checkbox" : kind === "text" || kind === "color" ? "text" : "range";
    const options = Array.isArray(o.options)
      ? o.options.map((op) => (op && typeof op === "object" ? String((op as Record<string, unknown>).value ?? "") : String(op))).filter(Boolean)
      : [];
    const d = o.default;
    const seed: string | number | boolean = type === "checkbox" ? d === true : type === "range" ? Number(d) || 0 : typeof d === "string" ? d : String(d ?? "");
    const prev = prevById.get(key);
    return {
      id: key,
      name: typeof o.label === "string" && o.label ? o.label : key,
      type,
      value: prev ? prev.value : seed,
      min: Number.isFinite(Number(o.min)) ? Number(o.min) : 0,
      max: Number.isFinite(Number(o.max)) ? Number(o.max) : 10,
      step: Number(o.step) || (type === "range" ? 0.1 : 1),
      options,
      // Preserved across re-syncs like `value`, so an author who locked a grabbed parameter does not
      // have it silently unlocked the next time the definition is re-read.
      editable: prev ? prev.editable : true,
    };
  });
};

/** Bake a Grab Parameters node's current control values into a definition's parameter defaults — the same
 *  transform the flow evaluator applies, so a Grab Geometry node downstream of Grab Parameters can resolve
 *  the EFFECTIVE definition (with the chosen values) for its live inspection. Unparseable → returned as-is. */
const bakeParamDefaults = (defText: string, props: InputProp[]): string => {
  try {
    const parsed = JSON.parse(defText) as { parameters?: unknown[] };
    if (!Array.isArray(parsed.parameters)) return defText;
    const vals: Record<string, string | number | boolean> = {};
    for (const p of props) vals[p.id] = p.type === "checkbox" ? p.value === true : p.value;
    parsed.parameters = parsed.parameters.map((q) => {
      const o = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
      const k = typeof o.key === "string" ? o.key : "";
      return k && k in vals ? { ...o, default: vals[k] } : o;
    });
    return JSON.stringify(parsed);
  } catch { return defText; }
};

// Unique id for an Output-node metric slot (unique within a node is enough; keep globally unique anyway).
let slotSeq = 1;
const nextSlotId = () => `s_${slotSeq++}_${Math.random().toString(36).slice(2, 6)}`;
/** Does this collected value look like a PLAN DOCUMENT — the thing Canvas Encoder (standalone, or folded
 *  into a Math Engine's encode block) publishes on `val-json`? A slot can collect any string, so the test
 *  is what makes "Show in canvas" appear on the Output Metrics nodes that have a plan to show and stay
 *  away from the ones collecting a point list. Shape, not length: `schemaVersion` + `segments` is what the
 *  importer reads, and a document with neither would fail there anyway. */
export const isPlanDocument = (v: unknown): v is string =>
  typeof v === "string" && v.trimStart().startsWith("{") && v.includes('"schemaVersion"') && v.includes('"segments"');
/** What one Detect run reports back — the same numbers the node's readout shows, returned so the
 *  agent-facing `run_detect` tool can state what was found instead of guessing. */
export type DetectRun = {
  ok: boolean;
  error?: string;
  /** Total objects the model returned (across every row). */
  detected: number;
  labels: string[];
  /** Per "Add object" row: how many detections claimed it. Absent when the node uses free-text targets. */
  rows?: { name: string; found: number }[];
  /** Detections that matched NO row — a full tally here with zero row hits means the model used a
   *  different word, so rename the row rather than raising Max items. */
  unmatched?: number;
};

/** Detection-row ids are STABLE and endpoint-bearing (`val-<rowId>`), so reordering or deleting a row
 *  must never renumber the survivors and silently rewire their edges to a different target. */
let objSeq = 1;
const nextObjectId = () => `o_${objSeq++}_${Math.random().toString(36).slice(2, 6)}`;

// --- Generate-node helper (image / video / music via the Google AI API) ---
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** (The AI flow-generation catalog + one-shot instruction moved to ai/flowAgent.ts — the agentic Flow tab
 *  in Chat AI replaced the one-shot "Generate flow with AI" panel.) */

/** Generic op node — header + param fields + handles. Reads/writes graph state via
 *  the `onParamChange` callback the host injects into node data. */
const OpNode = ({ id, data, selected }: NodeProps) => {
  const d = data as FlowNodeData;
  // An unregistered tool (stale type, malformed hand-authored graph) falls back to a safe, handle-less
  // stand-in def rather than crashing this always-rendered node component — a hooks-order-safe way to
  // degrade (an early return here would violate the Rules of Hooks against the hooks called below).
  const def = FLOW_TOOLS[d.tool] ?? {
    ...FLOW_TOOLS.source,
    label: d.tool || "Unknown",
    color: "#9ca3af",
    hasInput: false, hasOutput: false,
    valueInputs: [], valueOutputs: [], fields: [], outputCount: undefined,
    hint: "Unrecognised node type — not registered in this build.",
  };
  const outN = def.outputCount ? def.outputCount(d.params) : def.hasOutput ? 1 : 0;
  // Re-measure this node's handle positions whenever its handle set changes (or on mount). Without
  // this, React Flow can't compute edge paths to the value handles (the edge exists and the value
  // flows, but no curve is drawn). Keyed on the handle count so it also covers Split/Voronoi/BUA.
  const updateNodeInternals = useUpdateNodeInternals();
  // Output / Input-Properties nodes expose dynamic handles (per slot / per parameter), so their counts
  // must factor into the handle signature that triggers a re-measure.
  const slotCount = d.tool === "output" ? outputSlots(d.params).length : 0;
  const propCount = (d.tool === "input-props" || d.tool === "pobj-source" || d.tool === "grab-object" || d.tool === "agent") ? inputProps(d.params).length : 0;
  // Expression node: one dynamic value-INPUT endpoint per input variable, one dynamic value-OUTPUT endpoint
  // per defined name (a multi-output `name = expr` block, or a single `result`).
  const exprInCount = d.tool === "expr" ? exprInputs(d.params.expr).length : 0;
  const exprOutCount = d.tool === "expr" ? exprOutputs(d.params.expr).length : 0;
  // Grab Output Metrics: one dynamic value-OUTPUT endpoint per metric, so a changed definition (different
  // metric list) has to re-measure exactly like a changed parameter list does.
  const poutCount = d.tool === "param-output-metrics" ? paramOutputEntries(d.params._outputs as ParamOutputs | undefined).length : 0;
  // Render nodes: one dynamic value-INPUT + value-OUTPUT endpoint per primitive row.
  const primCount = (d.tool === "render-2d" || d.tool === "render-3d") ? renderPrims(d.params, d.tool === "render-3d").length : 0;
  // Object Detection: one dynamic value-OUTPUT endpoint per "Add object" row, so adding or removing a
  // target has to re-measure exactly like a changed slot list does.
  const objCount = d.tool === "object-detection" ? detectionObjects(d.params).length : 0;
  const handleSig = `${outN}|${def.valueInputs?.length ?? 0}|${def.valueOutputs?.length ?? 0}|${slotCount}|${propCount}|${exprInCount}|${exprOutCount}|${poutCount}|${primCount}|${objCount}`;
  useEffect(() => { updateNodeInternals(id); }, [id, handleSig, updateNodeInternals]);
  // Align each side handle to the vertical centre of its row: stash a ref per row, then measure
  // offsetTop after layout. Keys are `field:<key>` (parameter rows) and `vout:<key>` (computed value-
  // output readout rows). `rowTops[key]` is the px offset (relative to the node); a row hidden by
  // showIf isn't measured, so its handle falls back to the default position.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [rowTops, setRowTops] = useState<Record<string, number>>({});
  // File Upload node: a hidden <input type=file> driven by the "Choose File" button (OS open dialog).
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Fold the node down to its title bar. Stored as a `_collapsed` param so the toolbar's "Fold" toggle
  // can drive every node while the per-node chevron stays in sync. Ignored by eval, so it never affects
  // geometry — but unlike the other `_` params it DOES survive export (see PERSISTED_VIEW_PARAMS), so a
  // library flow can ship folded. When collapsed, only the main in/out handles show (on the title bar).
  const collapsed = Boolean(d.params._collapsed);
  // Per-node output visibility — when `_hidden`, this node's preview/output is omitted from the canvas
  // (downstream nodes still receive its geometry; only the on-screen rendering is suppressed).
  const hidden = Boolean(d.params._hidden);
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    for (const [k, el] of Object.entries(rowRefs.current)) {
      if (el) next[k] = el.offsetTop + el.offsetHeight / 2;
    }
    setRowTops((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const k of keys) if (prev[k] !== next[k]) return next;
      return prev;
    });
  });
  // Re-route edges once the handles settle (measured rows, or collapse toggling the handle set).
  useEffect(() => { updateNodeInternals(id); }, [id, rowTops, collapsed, updateNodeInternals]);
  // Fields flagged `output` expose their own value as a `val-<key>` endpoint on the right (pass-through).
  const outputFields = def.fields.filter((f) => f.output && (!f.showIf || f.showIf(d.params)));
  return (
    <div className={`relative rounded-md border bg-white shadow-md transition-shadow ${selected ? "border-blue-500 ring-2 ring-blue-400/70 shadow-lg" : "border-slate-300"} ${d.tool === "render" || d.tool === "agent" ? "min-w-[230px]" : "min-w-[180px]"}`}>
      {/* Main geometry input (Space / polygon): top-left below the title; centred when collapsed.
          `_foldIn` (stamped by the fold-edge view transform) additionally anchors a folded node that has
          incoming edges but declares no geometry input — a Cuboid is fed only through `valin-*` handles,
          which don't exist while folded, so without this its edges would have nowhere to land. */}
      {(def.hasInput || (collapsed && d.params._foldIn)) && <Handle type="target" position={Position.Left} style={{ top: collapsed ? "50%" : 30 }} className="!h-2.5 !w-2.5 !bg-slate-400" />}
      {/* Extra geometry inputs (emerald, left) — id `gin-<key>`, e.g. Mitered Join / Graph to Path's clip
          Space. Stacked just below the main input handle, each tagged with a short emerald label (like the
          violet "prm" endpoint) so the secondary input is discoverable; hidden when collapsed. */}
      {!collapsed && def.geomInputs?.flatMap((gi, i) => {
        const top = 30 + (i + 1) * 16;
        return [
          <span key={`${gi.key}-lbl`} style={{ position: "absolute", left: 12, top, transform: "translateY(-50%)" }} className="pointer-events-none font-mono text-[8px] text-emerald-500">{gi.label.split(/\s+/)[0].slice(0, 4).toLowerCase()}</span>,
          <Handle
            key={gi.key}
            id={`gin-${gi.key}`}
            type="target"
            position={Position.Left}
            style={{ top }}
            className="!h-2.5 !w-2.5 !bg-emerald-500"
            title={gi.label}
          />,
        ];
      })}
      {/* Scalar value INPUT endpoints (amber, left) — id `valin-<key>`. A wired value overrides the param.
          Each sits at its parameter row (measured into `valinTops`); the row's own label identifies it.
          Hidden while collapsed (no rows to anchor to). */}
      {!collapsed && def.valueInputs
        ?.filter((vi) => {
          // Show a value handle only when its parameter row is visible (same showIf as the field), so
          // e.g. Inset's Front/Remaining/Edge-index endpoints appear only in Front & Remaining mode.
          const f = def.fields.find((fld) => fld.key === vi.key);
          return !f?.showIf || f.showIf(d.params);
        })
        .map((vi) => {
          const top = rowTops[`field:${vi.key}`];
          return (
            <Handle
              key={vi.key}
              id={`valin-${vi.key}`}
              type="target"
              position={Position.Left}
              style={top != null ? { top } : undefined}
              className="!h-2.5 !w-2.5 !bg-amber-500"
            />
          );
        })}
      {/* Params INPUT endpoint (violet, left) — id `pin`. Receives a node's parameters (Loop node). */}
      {!collapsed && def.acceptsParams && (
        <>
          <span style={{ position: "absolute", left: 12, top: 30, transform: "translateY(-50%)" }} className="pointer-events-none font-mono text-[8px] text-violet-400">prm</span>
          <Handle id="pin" type="target" position={Position.Left} style={{ top: 30 }} className="!h-2.5 !w-2.5 !bg-violet-500" title="Parameters in" />
        </>
      )}
      {/* Output node: one dynamic value-input endpoint per slot (id `valin-<slotId>`), anchored to its row —
          and its MIRROR on the right (`val-<slotId>`), publishing what that slot collected so the collector
          can sit mid-chain instead of only terminating. Both keyed by the slot ID, so renaming a slot's label
          never moves either wire. */}
      {!collapsed && d.tool === "output" && outputSlots(d.params).map((s) => {
        const top = rowTops[`slot:${s.id}`];
        return (
          <Fragment key={s.id}>
            <Handle
              id={`valin-${s.id}`}
              type="target"
              position={Position.Left}
              style={top != null ? { top } : undefined}
              className="!h-2.5 !w-2.5 !bg-amber-500"
            />
            <Handle
              id={`val-${s.id}`}
              type="source"
              position={Position.Right}
              style={top != null ? { top } : undefined}
              className="!h-2.5 !w-2.5 !bg-amber-500"
            />
          </Fragment>
        );
      })}
      {/* Expression node: one dynamic value-INPUT endpoint per input variable (id `valin-<var>`), anchored
          to its row. The static `deps` endpoint (declaration) stays — it merges a whole params node's values
          into the scope in one wire. */}
      {!collapsed && d.tool === "expr" && exprInputs(d.params.expr).map((v) => {
        const top = rowTops[`evar:${v}`];
        return (
          <Handle
            key={`in-${v}`}
            id={`valin-${v}`}
            type="target"
            position={Position.Left}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
      {/* DECODE payload endpoint. A Math Engine with a `decode` block reads the canvas payload out of scope
          under the key its `from` names (default `canvasJson`) — but that key is not a free VARIABLE of the
          body, so it never appeared in `exprInputs` and the node documented an input it did not render.
          Wire the Geometry node's Canvas JSON here. Skipped when the body happens to name it anyway, or
          there would be two handles with one id. */}
      {!collapsed && d.tool === "expr" && (() => {
        if (!d.params.decode) return null;
        let from = "canvasJson";
        try {
          const cfg = typeof d.params.decode === "string" ? JSON.parse(d.params.decode) as Record<string, unknown> : d.params.decode as Record<string, unknown>;
          if (cfg && typeof cfg.from === "string" && cfg.from) from = cfg.from;
        } catch { /* a half-typed config keeps the default key */ }
        if (exprInputs(d.params.expr).includes(from)) return null;
        return (
          <Handle
            key={`in-decode-${from}`}
            id={`valin-${from}`}
            type="target"
            position={Position.Left}
            style={{ top: 18 }}
            title={`Canvas JSON in — decoded as ${from}`}
            className="!h-2.5 !w-2.5 !bg-violet-500"
          />
        );
      })()}
      {/* Expression node: one dynamic value-OUTPUT endpoint per defined name (id `val-<name>`), anchored to
          its output row — so a single node can publish several results (a `name = expr` block). */}
      {!collapsed && d.tool === "expr" && exprOutputs(d.params.expr).map((nm) => {
        const top = rowTops[`eout:${nm}`];
        return (
          <Handle
            key={`out-${nm}`}
            id={`val-${nm}`}
            type="source"
            position={Position.Right}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
      <div className={`flex items-center justify-between gap-1 px-2 py-1 text-[11px] font-semibold text-white ${collapsed ? "rounded-md" : "rounded-t-md"}`} style={{ background: d.tool === "pobj-source" ? "#dc2626" : def.color }}>
        {/* `nodeLabel` (typed into the Name field, or the OBJECT's name on parametric-object import) titles
            the node; the tool label stays beside it as a muted suffix so "Leg 1" still reads as a Cuboid.
            With no name set, the tool label alone is the title (no duplicate). */}
        {(() => {
          const custom = typeof d.params.nodeLabel === "string" ? d.params.nodeLabel.trim() : "";
          return (
            <span className="flex min-w-0 items-baseline gap-1">
              <span className="truncate">{custom || def.label}</span>
              {custom && <span className="shrink-0 text-[9px] font-medium text-white/70">{def.label}</span>}
            </span>
          );
        })()}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Decompile toggle (Parametric Object + Input Properties): hide/show every node + edge coming out
              of this one — collapse the driven expr/primitives back to the brief node, or expand them again.
              Sources stay visible, and so does any Output Metrics node, which docks under the brief: folded, the
              pair reads as the operation's interface (parameters in, metrics out) and stays wireable. */}
          {(d.tool === "pobj-source" || d.tool === "input-props") && (
            <button
              type="button"
              onClick={() => d.onToggleDecompile?.(id)}
              title={d.params._decompileHidden ? "Show the internals again" : "Hide the internals — sources and Output Metrics stay"}
              className={`nodrag flex h-4 w-4 items-center justify-center rounded hover:bg-white/20 ${d.params._decompileHidden ? "opacity-60" : ""}`}
            >
              <Boxes className="h-3 w-3" />
            </button>
          )}
          {/* Eye: toggle whether this node's output/preview shows on the canvas (transient `_hidden`).
              Omitted for pure VALUE nodes (no geometry input and no geometry output — Expression, Math,
              Point, Vertices, Convex Decomposition …): they draw nothing, so there is nothing to hide and
              the control would only mislead. `drawsNothing` covers the same case for a node that DOES
              take a geometry input but publishes only values (Vectorisation: image in, graph out). */}
          {(def.hasInput || def.hasOutput) && !def.drawsNothing && (
            <button
              type="button"
              onClick={() => d.onParamChange?.(id, "_hidden", !hidden)}
              title={hidden ? "Show output on canvas" : "Hide output on canvas"}
              className={`nodrag flex h-4 w-4 items-center justify-center rounded hover:bg-white/20 ${hidden ? "opacity-60" : ""}`}
            >
              {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            </button>
          )}
          <button
            type="button"
            onClick={() => d.onParamChange?.(id, "_collapsed", !collapsed)}
            title={collapsed ? "Expand" : "Collapse"}
            className="nodrag flex h-4 w-4 items-center justify-center rounded hover:bg-white/20"
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>
      {!collapsed && (
      <div className="space-y-1.5 px-2 py-1.5">
        {/* Optional per-node name ("Leg 1", "Mattress") — surfaces in the header beside the tool label and
            in the Properties tab. Purely presentational: not a `def.fields` param, never read by
            compile/eval. Skipped for tools that already declare their own `name` field (e.g. expr). */}
        {!def.fields.some((f) => f.key === "name") && (
          <input
            type="text"
            value={typeof d.params.nodeLabel === "string" ? d.params.nodeLabel : ""}
            onChange={(e) => d.onParamChange?.(id, "nodeLabel", e.target.value)}
            placeholder="Name"
            className="nodrag w-full rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 placeholder:text-slate-300"
          />
        )}
        {/* Usage instructions (from the node.json `instructions` field) — a read-only, collapsible
            textbox so the node's own documentation is available inline. Hidden until toggled. */}
        {def.instructions && (() => {
          const open = Boolean(d.params._showInstructions);
          return (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => d.onParamChange?.(id, "_showInstructions", !open)}
                className="nodrag flex w-full items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Instructions
              </button>
              {open && (
                <textarea
                  readOnly
                  className="w-full resize-y rounded border border-slate-200 bg-slate-50/60 px-1.5 py-1 text-[10px] leading-snug text-slate-600 nodrag"
                  rows={8}
                  value={def.instructions}
                />
              )}
            </div>
          );
        })()}
        {/* Canvas: one tall row per typed output (Spaces / Nodes / Segments / Graph / Images) with its
            live count, so the five endpoints are clearly separated and each handle aligns to its row. */}
        {d.tool === "canvas-source" && (() => {
          const counts = (d.params._counts as number[] | undefined) ?? [];
          return (
            <div className="space-y-2 py-1">
              {(def.outputLabels ?? []).map((lbl, i) => (
                <div
                  key={lbl}
                  ref={(el) => { rowRefs.current[`cout:${i}`] = el; }}
                  className="flex items-center justify-between gap-3 rounded bg-cyan-50 px-2 py-1.5 text-[10px] font-semibold text-cyan-800"
                >
                  <span>{lbl}</span>
                  <span className="font-mono text-cyan-600">{counts[i] ?? 0}</span>
                </div>
              ))}
            </div>
          );
        })()}
        {def.fields.length === 0 && d.tool !== "place-object" && d.tool !== "output" && d.tool !== "input-props" && d.tool !== "pobj-source" && d.tool !== "param-grab" && d.tool !== "param-geometry" && d.tool !== "param-output-metrics" && d.tool !== "canvas-source" && (
          <div className="text-[9px] italic text-slate-400">{def.hint}</div>
        )}
        {/* Place Object: a multi-object list editor instead of the generic flat-param fields. */}
        {d.tool === "place-object" && (
          <PlaceObjectEditor params={d.params} onParamChange={(key, val) => d.onParamChange?.(id, key, val)} nodrag />
        )}
        {/* Dimension · Edgewise: a per-edge checkbox grid (which edges to dimension). */}
        {d.tool === "dimension" && d.params.mode === "edgewise" && (
          <DimensionEdgesEditor params={d.params} onParamChange={(key, val) => d.onParamChange?.(id, key, val)} nodrag />
        )}
        {/* Input/Output Schema: four foldable parameter-list sections (Node / Segment / Space / Graph
            Schema). Input Schema → wire its output into a Graph/Space node to attach the properties;
            Output Schema → wire a solver's output into it to choose the Metrics-tab result rows. */}
        {(d.tool === "schema" || d.tool === "output-schema") && (
          <SchemaNodeEditor params={d.params} onParamChange={(key, val) => d.onParamChange?.(id, key, val)} nodrag />
        )}
        {/* Input Properties: a list of user-defined parameters (slider / options / checkbox / text);
            each row's value is exposed as a `val-<propId>` output handle (anchored via onRowRef). */}
        {(d.tool === "render-2d" || d.tool === "render-3d") && (
          <RenderPrimsEditor
            params={d.params}
            is3d={d.tool === "render-3d"}
            onParamChange={(key, val) => d.onParamChange?.(id, key, val)}
            onRowRef={(pid, el) => { rowRefs.current[`prim:${pid}`] = el; }}
            nodrag
          />
        )}
        {d.tool === "input-props" && (
          <InputPropsEditor
            params={d.params}
            onParamChange={(key, val) => d.onParamChange?.(id, key, val)}
            onRowRef={(pid, el) => { rowRefs.current[`prop:${pid}`] = el; }}
            // `_wired` is baked by the preview sync: the parameters currently driven by a wire into their
            // `valin-<id>` endpoint, shown read-only in place of their own control.
            wired={d.params._wired as Record<string, number | string> | undefined}
            // A `button` parameter bumps its own run counter; this is the other half — commit every
            // Set Object Param node in the graph, so one press means "solve and write it onto the plan".
            onRunAction={() => d.onRunAllApply?.(id)}
            nodrag
          />
        )}
        {/* RUN — press Detect on every Object Detection node in the flow. The brief is where the intent
            lives ("read this drawing"), and a flow that reads openings, rooms and furniture has three
            detection nodes behind that one intent; pressing three buttons in the right order is bookkeeping,
            not a decision. Shown only when `_detectCount` says there is something to run — baked by the
            preview sync, so a brief in a flow with no detection node carries no dead button. */}
        {d.tool === "input-props" && Number(d.params._detectCount ?? 0) > 0 && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._runBusy)}
              onClick={() => d.onRunAllDetect?.(id)}
            >
              {d.params._runBusy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Running…</>
                : <><Play className="h-3 w-3" /> Run — detect all ({Number(d.params._detectCount)})</>}
            </Button>
            {typeof d.params._runStatus === "string" && d.params._runStatus && (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
                {String(d.params._runStatus)}
              </p>
            )}
          </div>
        )}
        {/* AUTO-TUNE — the twin of Run, for the tracing half. Same argument: when the brief carries the
            tuning rows, the sweep belongs where the rows are, and it bakes its winners back into THEM.
            Shown only when `_tuneCount` says the flow has a Vectorisation node to tune. */}
        {d.tool === "input-props" && Number(d.params._tuneCount ?? 0) > 0 && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._tuneBusy)}
              onClick={() => d.onRunAllTune?.(id)}
            >
              {d.params._tuneBusy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Tuning…</>
                : <><Wand2 className="h-3 w-3" /> Auto-Tune</>}
            </Button>
            {typeof d.params._tuneStatus === "string" && d.params._tuneStatus && (
              <p className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] leading-tight text-violet-700 nodrag">
                {String(d.params._tuneStatus)}
              </p>
            )}
          </div>
        )}
        {/* Parametric Object: its parameters, each exposing a `val-<propId>` output handle (anchored via
            onRowRef). A params-ONLY object (no `geometry` block — its geometry is built downstream by the
            flow, e.g. the staircase) IS an Input Properties node: render the FULL editor so its parameters
            are fully editable — name / type / range AND value, plus add / remove — exactly like input-props.
            A geometry-BEARING object keeps values-only, since its parameters are defined by the .pobj file. */}
        {d.tool === "pobj-source" && (
          inputProps(d.params).length === 0
            ? <span className="text-[10px] italic text-slate-400">Load a parametric object (.pobj) →</span>
            : <InputPropsEditor
                params={d.params}
                onParamChange={(key, val) => d.onParamChange?.(id, key, val)}
                onRowRef={(pid, el) => { rowRefs.current[`prop:${pid}`] = el; }}
                valuesOnly={(() => { try { return !!(JSON.parse(String(d.params.definition ?? "{}")) as { geometry?: unknown }).geometry; } catch { return true; } })()}
                nodrag
              />
        )}
        {/* Grab Object: READ-ONLY readout of the parameters of the object attached to the referenced canvas
            Space / Node / Segment (baked into `props` by the host). Each row is anchored (onRowRef) so its
            `val-<propId>` output handle aligns — edit the values on the host element, not here. */}
        {/* Grab Object: READ-ONLY readout of the parameters of the object attached to the Space wired into its
            input (or its referenced element). Each row is anchored (onRowRef) so its `val-<propId>` output handle
            aligns — edit the values on the host element, not here. */}
        {d.tool === "grab-object" && (
          inputProps(d.params).length === 0
            ? <span className="text-[10px] italic text-slate-400">Wire a Space into the input to read its attached object →</span>
            : <div className="space-y-1">
                {inputProps(d.params).map((p, i) => (
                  <div key={p.id} ref={(el) => { rowRefs.current[`prop:${p.id}`] = el; }} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-1.5 py-0.5 text-[10px]">
                    <span className="truncate text-slate-500">{p.name || `Param ${i + 1}`}</span>
                    <span className="shrink-0 font-mono text-slate-700">{p.type === "checkbox" ? (p.value ? "on" : "off") : String(p.value)}</span>
                  </div>
                ))}
              </div>
        )}
        {/* Grab Parameters: interactive controls auto-built from the wired Parametric Object's definition
            (values-only — label + slider/options/checkbox/textbox). Editing republishes the definition. */}
        {d.tool === "param-grab" && (
          inputProps(d.params).length === 0
            ? <span className="text-[10px] italic text-slate-400">Wire a Parametric Object into Definition →</span>
            : <InputPropsEditor params={d.params} onParamChange={(key, val) => d.onParamChange?.(id, key, val)} valuesOnly nodrag />
        )}
        {/* Grab Geometry: read-only inspector — each var / box formula with its live computed value (baked
            into `_inspection` by the host sync). Scrollable so a large object stays compact in the node. */}
        {d.tool === "param-geometry" && (() => {
          const insp = d.params._inspection as GeomInspection | undefined;
          if (!insp || !insp.ok) {
            return <span className="text-[10px] italic text-slate-400">Wire a Parametric Object into Definition →</span>;
          }
          const Row = ({ name, expr, value }: { name: string; expr: string; value: string }) => (
            <div className="flex items-baseline justify-between gap-2 leading-tight">
              <span className="truncate font-medium text-slate-600" title={`${name} = ${expr}`}>{name}</span>
              <span className="shrink-0 font-mono text-[9px] text-slate-400">{expr}</span>
              <span className="shrink-0 font-mono font-semibold text-teal-700">{value}</span>
            </div>
          );
          return (
            <div className="nodrag max-h-64 space-y-1.5 overflow-y-auto pr-0.5 text-[10px]">
              {insp.params.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Parameters</div>
                  {insp.params.map((r) => <Row key={`p-${r.name}`} {...r} />)}
                </div>
              )}
              {insp.vars.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Vars</div>
                  {insp.vars.map((r, i) => <Row key={`v-${i}-${r.name}`} {...r} />)}
                </div>
              )}
              {insp.chosenCase != null && (
                <div className="text-[9px] text-slate-500">Case: <span className="font-mono text-slate-700">{insp.chosenCase}</span></div>
              )}
              {insp.boxes.map((b, i) => (
                <div key={`b-${i}`} className="rounded border border-slate-200 bg-slate-50/60 px-1.5 py-1">
                  <div className="mb-0.5 flex items-baseline justify-between text-[8px] font-semibold uppercase tracking-wide text-slate-500">
                    <span>{b.label}</span>
                    {b.when && <span className="font-mono normal-case text-slate-400" title="condition">if {b.when}</span>}
                  </div>
                  {b.fields.map((r) => <Row key={`bf-${r.name}`} {...r} />)}
                </div>
              ))}
              {insp.boxes.length === 0 && insp.vars.length === 0 && (
                <span className="italic text-slate-400">No geometry rules to inspect.</span>
              )}
            </div>
          );
        })()}
        {/* Grab Output Metrics: read-only readout of the object's output metrics (declared `outputs` + derived
            size/area/volume), baked into `_outputs` by the host sync. */}
        {d.tool === "param-output-metrics" && (() => {
          const out = d.params._outputs as ParamOutputs | undefined;
          if (!out || !out.ok) {
            return <span className="text-[10px] italic text-slate-400">Wire a Parametric Object into Definition →</span>;
          }
          // Every metric is WIREABLE: each row anchors its own `val-<key>` output handle (mounted below),
          // keyed by the shared `paramOutputEntries` so the row and its endpoint can't drift apart.
          const entries = paramOutputEntries(out);
          const Row = ({ e }: { e: ParamOutputEntry }) => (
            <div
              ref={(el) => { rowRefs.current[`pout:${e.key}`] = el; }}
              className="flex items-baseline justify-between gap-2 leading-tight"
              title={`val-${e.key}`}
            >
              <span className="truncate font-medium text-slate-600">{e.name}</span>
              <span className="shrink-0 font-mono font-semibold text-cyan-700">{e.value}{e.unit ? <span className="ml-0.5 font-normal text-slate-400">{e.unit}</span> : null}</span>
            </div>
          );
          const declared = entries.filter((e) => e.group === "declared");
          const derived = entries.filter((e) => e.group === "derived");
          return (
            <div className="nodrag space-y-1.5 pr-0.5 text-[10px]">
              {declared.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Outputs</div>
                  {declared.map((e) => <Row key={`o-${e.key}`} e={e} />)}
                </div>
              )}
              {derived.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Derived</div>
                  {derived.map((e) => <Row key={`d-${e.key}`} e={e} />)}
                </div>
              )}
              {declared.length === 0 && (
                <span className="text-[9px] italic text-slate-400">No declared outputs — add an `outputs` array to the object to publish named metrics.</span>
              )}
            </div>
          );
        })()}
        {/* Layout Generation: trigger the host's floorplan generator (loads the editable canvas layout —
            draggable seeds + connection/repulsion lines) and simulated annealing; show a live result line. */}
        {d.tool === "layout-gen" && (
          <div className="space-y-1.5">
            <LayoutRoomsEditor params={d.params} onParamChange={(key, val) => d.onParamChange?.(id, key, val)} />
            <Button size="sm" className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag" onClick={() => d.onRunLayoutGen?.(id, d.params)}>
              <Wand2 className="h-3 w-3" /> Generate Layout
            </Button>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 flex-1 gap-1.5 px-2 text-[11px] nodrag" onClick={() => d.onAddRoom?.(id, d.params)}>
                <Plus className="h-3 w-3" /> Add Room
              </Button>
              <Button size="sm" variant="outline" className="h-7 flex-1 gap-1.5 px-2 text-[11px] nodrag" disabled={Boolean(d.params._saRunning)} onClick={() => d.onRunAnneal?.(id, d.params)}>
                {d.params._saRunning ? <><Loader2 className="h-3 w-3 animate-spin" /> Annealing…</> : <><Wand2 className="h-3 w-3" /> Anneal</>}
              </Button>
            </div>
            {d.params._rooms != null && (
              <div className="rounded bg-purple-50 px-1.5 py-1 text-center font-mono text-[9px] text-purple-700">
                {String(d.params._rooms)} rooms · {Number(d.params._area || 0).toFixed(1)} m²{d.params._score != null ? ` · score ${Number(d.params._score).toFixed(1)}` : ""}
              </div>
            )}
          </div>
        )}
        {/* Output Metrics: a named-slot editor. Each row = an editable name + amber input endpoint (left)
            + the live wired value. Slots auto-grow (a free endpoint is always kept) and can be added. */}
        {d.tool === "output" && (() => {
          const slots = outputSlots(d.params);
          const baked = (d.params._metrics as { slotId: string; value: number | string | null }[] | undefined) ?? [];
          const valueOf = (sid: string) => baked.find((m) => m.slotId === sid)?.value ?? null;
          const setSlots = (next: OutputSlot[]) => d.onParamChange?.(id, "slots", next);
          const fmt = (v: number | string | null) =>
            v == null ? "—" : typeof v === "number" ? (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)) : String(v);
          return (
            <div className="space-y-1">
              {slots.map((s, i) => (
                <div key={s.id} ref={(el) => { rowRefs.current[`slot:${s.id}`] = el; }} className="space-y-0.5">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      className="h-6 min-w-0 flex-1 rounded border border-slate-200 px-1.5 text-[10px] nodrag"
                      placeholder={`Output ${i + 1}`}
                      value={s.label}
                      onChange={(e) => setSlots(slots.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                    />
                    {/* `truncate` because a slot can now collect a STRING as well as a number — a wired
                        point-list / graph JSON would otherwise stretch the node to its full length. */}
                    <span className="w-14 shrink-0 truncate text-right font-mono text-[10px] text-slate-700" title={String(valueOf(s.id) ?? "")}>{fmt(valueOf(s.id))}</span>
                    <button
                      type="button"
                      title="Remove output"
                      disabled={slots.length <= 1}
                      className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"
                      onClick={() => setSlots(slots.filter((x) => x.id !== s.id))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {/* Per-metric criteria, mirroring an Input Properties row: draw the measured value on the
                      plan (Space centroid / Segment midpoint / over a Node), and mark it required. */}
                  <div className="flex items-center gap-3 pl-0.5">
                    <label className="nodrag flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-400" title="Draw this metric on the 2D canvas at the host's anchor">
                      <input type="checkbox" checked={s.showInCanvas} onChange={(e) => setSlots(slots.map((x) => (x.id === s.id ? { ...x, showInCanvas: e.target.checked } : x)))} />
                      Show in canvas
                    </label>
                    <label className="nodrag flex items-center gap-1 text-[9px] uppercase tracking-wide text-slate-400" title="Mark this metric as required">
                      <input type="checkbox" checked={s.necessary} onChange={(e) => setSlots(slots.map((x) => (x.id === s.id ? { ...x, necessary: e.target.checked } : x)))} />
                      Necessary
                    </label>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="nodrag flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50"
                onClick={() => setSlots([...slots, { id: nextSlotId(), label: "", showInCanvas: false, necessary: true }])}
              >
                <Plus className="h-3 w-3" /> Add output
              </button>
              {/* SHOW IN CANVAS — a slot collecting a whole PLAN DOCUMENT (a Math Engine's encode block, or
                  a Canvas Encoder wired in here) is loaded by the same path File ▸ Import takes for a plan
                  the user picked, so a detect-and-measure flow ends where it should: at the drawing, not at
                  a JSON string nobody can act on. Shown only when a slot actually holds one — the per-slot
                  "Show in canvas" checkbox above is a different thing entirely (it draws that METRIC's value
                  on the plan at the host's anchor) and neither reads the other. Nothing is committed until
                  this is pressed: the flow only ever computes the document. */}
              {baked.some((m) => isPlanDocument(m.value)) && (
                <div className="space-y-1 pt-0.5">
                  <Button
                    size="sm"
                    className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
                    onClick={() => d.onImportPlan?.(id)}
                  >
                    <Stamp className="h-3 w-3" /> Show in canvas
                  </Button>
                  {typeof d.params._importStatus === "string" && d.params._importStatus && (
                    <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
                      {String(d.params._importStatus)}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })()}
        {d.tool !== "place-object" && def.fields
          .filter((f) => !f.showIf || f.showIf(d.params))
          .map((f) => {
            const val = d.params[f.key];
            // Range = full-width slider with a live value label (matches the tool blocks).
            if (f.kind === "range") {
              const num = typeof val === "number" ? val : 0;
              return (
                <div key={f.key} ref={(el) => { rowRefs.current[`field:${f.key}`] = el; }} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">{f.label}</span>
                    <span className="font-mono text-[10px] text-slate-700">
                      {num.toFixed(2)}{f.unit ? ` ${f.unit}` : ""}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="w-full nodrag"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={num}
                    onChange={(e) => d.onParamChange?.(id, f.key, +e.target.value)}
                  />
                </div>
              );
            }
            // Text / textarea = full-width stacked field (label above the input).
            if (f.kind === "text" || f.kind === "textarea") {
              const str = typeof val === "string" ? val : "";
              // The Math Engine's three STAGES, marked as such. Decode and Encode are not more parameters
              // among the rest — they are the read and write halves of the pipeline, running before and
              // after the formulas, so they read as distinct blocks rather than two more text boxes. The
              // colours are the standalone Graph Interpreter's and Canvas Encoder's own, so the folded
              // version is recognisably the same thing and the direction is visible at a glance.
              const stage = d.tool === "expr"
                ? ({ decode: { title: "Decode", color: "#7c3aed" },
                     // The body's own label is "Formula(s)", which the title already says.
                     expr: { title: "Formulas", color: FLOW_TOOLS.expr.color, hideLabel: true },
                     encode: { title: "Encode", color: "#be123c" } } as Record<string, { title: string; color: string; hideLabel?: boolean }>)[f.key]
                : undefined;
              return (
                <div
                  key={f.key}
                  ref={(el) => { rowRefs.current[`field:${f.key}`] = el; }}
                  className={stage ? "space-y-0.5 border-l-2 pl-1.5" : "space-y-0.5"}
                  style={stage ? { borderColor: stage.color } : undefined}
                >
                  {stage ? (
                    <span className="text-[10px] font-semibold" style={{ color: stage.color }}>
                      {stage.title}
                      {/* The field's own label only when it adds something to the title. */}
                      {!stage.hideLabel && (
                        <span className="ml-1 font-normal text-slate-400">{f.label}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">{f.label}</span>
                  )}
                  {f.kind === "textarea" && f.sections ? (
                    // Foldable `# <title>` regions. Presentational only — the value stays one string, and a
                    // body with no markers renders as a single plain box, so this changes nothing until the
                    // author actually writes a marker line.
                    <ExprSectionsEditor
                      value={str}
                      rows={f.rows ?? 3}
                      placeholder={f.placeholder}
                      folded={Array.isArray(d.params._exprFolded) ? (d.params._exprFolded as string[]) : []}
                      onChange={(next) => d.onParamChange?.(id, f.key, next)}
                      onFoldedChange={(next) => d.onParamChange?.(id, "_exprFolded", next)}
                    />
                  ) : f.kind === "textarea" ? (
                    <textarea
                      className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[10px] nodrag nowheel"
                      rows={f.rows ?? 3}
                      placeholder={f.placeholder}
                      value={str}
                      spellCheck={false}
                      // `nowheel` matters once rows is large: without it, scrolling INSIDE the box zooms the
                      // React Flow canvas instead. The key/pointer guards are belt-and-braces — React Flow
                      // already ignores its own shortcuts when the event target is an input.
                      onKeyDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type={f.secret ? "password" : "text"}
                      className="h-6 w-full rounded border border-slate-200 px-1.5 text-[10px] nodrag"
                      placeholder={f.placeholder}
                      value={str}
                      onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                    />
                  )}
                </div>
              );
            }
            return (
              <div key={f.key} ref={(el) => { rowRefs.current[`field:${f.key}`] = el; }} className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">{f.label}</span>
                {f.kind === "number" && (
                  <input
                    type="number"
                    className="h-6 w-20 rounded border border-slate-200 px-1 text-[10px] font-mono nodrag"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={typeof val === "number" ? val : 0}
                    onChange={(e) => d.onParamChange?.(id, f.key, +e.target.value)}
                  />
                )}
                {f.kind === "select" && (() => {
                  // Dynamic options (e.g. Loop's parameter list, baked from the connected node) override
                  // the static ones; show a placeholder when none are available yet.
                  const dyn = f.optionsFromParam ? (d.params[f.optionsFromParam] as { value: string; label: string }[] | undefined) : undefined;
                  const opts = dyn ?? f.options ?? [];
                  return (
                    <select
                      className="h-6 w-28 rounded border border-slate-200 px-1 text-[10px] nodrag"
                      value={typeof val === "string" ? val : ""}
                      onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                    >
                      {f.optionsFromParam && <option value="">{opts.length ? "— select —" : "— connect a node —"}</option>}
                      {opts.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  );
                })()}
                {f.kind === "checkbox" && (
                  <input
                    type="checkbox"
                    className="nodrag"
                    checked={Boolean(val)}
                    onChange={(e) => d.onParamChange?.(id, f.key, e.target.checked)}
                  />
                )}
                {f.kind === "color" && (
                  <input
                    type="color"
                    className="h-6 w-10 rounded border border-slate-200 bg-white p-0.5 nodrag"
                    value={typeof val === "string" && val ? val : "#000000"}
                    onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        {/* Expression: anchored INPUT rows (each `valin-<var>` endpoint aligns to its row — wire from any
            val-* output, or wire a whole params node into the static `deps` endpoint to bring every parameter
            into scope by name), then anchored OUTPUT rows (each `val-<name>` endpoint — a `name = expr` block
            publishes one per name). Placed AFTER the formula so it reads top-to-bottom: formula → in → out. */}
        {d.tool === "expr" && (() => {
          const ins = exprInputs(d.params.expr);
          const outs = exprOutputs(d.params.expr);
          if (!ins.length && outs.length <= 1) return null;
          return (
            <div className="space-y-1 pt-1">
              {ins.map((v) => (
                <div
                  key={`in-${v}`}
                  ref={(el) => { rowRefs.current[`evar:${v}`] = el; }}
                  className="flex items-center justify-between rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800"
                >
                  <span className="text-amber-400">value →</span>
                  <span className="font-mono">{v}</span>
                </div>
              ))}
              {outs.length > 1 && outs.map((nm) => (
                <div
                  key={`out-${nm}`}
                  ref={(el) => { rowRefs.current[`eout:${nm}`] = el; }}
                  className="flex items-center justify-between rounded bg-emerald-50 px-2 py-1 text-[10px] text-emerald-800"
                >
                  <span className="font-mono">{nm}</span>
                  <span className="text-emerald-400">→ out</span>
                </div>
              ))}
            </div>
          );
        })()}
        {/* Agent: Run analyses the wired Space against this node's own Instructions + Prompt (the two
            fields rendered just above) and writes the suggestion into the CONNECTED nodes. Deliberately
            placed AFTER the generic fields so the node reads top-to-bottom in the order you use it:
            edit Instructions → type a Prompt → Run → read what it set. The rows are a READ-ONLY record
            (each anchored via rowRefs so its `val-<key>` output handle aligns) — the live values now sit
            on the target nodes, edit them there. `_stale` = the space / text / chain moved since the run. */}
        {d.tool === "agent" && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunAgent?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Analysing…</>
                : <><Sparkles className="h-3 w-3" /> Run</>}
            </Button>
            {typeof d.params._status === "string" && d.params._status && (
              <p className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] leading-tight text-violet-700 nodrag">
                {String(d.params._status)}
              </p>
            )}
            {Boolean(d.params._stale) && !d.params._busy && (
              <p className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] leading-tight text-amber-700 nodrag">
                ⚠ Stale — the space, instructions, prompt or chain changed since this ran. Press Run to refresh.
              </p>
            )}
            {inputProps(d.params).length > 0 && (
              <div className="space-y-0.5">
                {inputProps(d.params).map((p, i) => (
                  <div key={p.id} ref={(el) => { rowRefs.current[`prop:${p.id}`] = el; }} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-1.5 py-0.5 text-[10px]">
                    <span className="truncate text-slate-500">{p.name || `Param ${i + 1}`}</span>
                    <span className="shrink-0 font-mono text-slate-700">{p.type === "checkbox" ? (p.value ? "on" : "off") : String(p.value)}</span>
                  </div>
                ))}
              </div>
            )}
            {typeof d.params.rationale === "string" && d.params.rationale && (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] italic leading-tight text-slate-600 nodrag">
                {String(d.params.rationale)}
              </p>
            )}
            {/* Feedback loop, last round: the reviewer's verdict on the drawing, and the drawing it saw.
                Showing the snapshot matters — if the agent is judging a blank or stale frame, that's only
                visible here. Both are `_`-prefixed, so neither is exported. */}
            {typeof d.params._critique === "string" && d.params._critique && (
              <p className="rounded bg-sky-50 px-1.5 py-0.5 text-[9px] leading-tight text-sky-800 nodrag">
                {String(d.params._critique)}
              </p>
            )}
            {typeof d.params._snapshot === "string" && d.params._snapshot && (
              <img
                src={String(d.params._snapshot)}
                alt="what the reviewer saw"
                className="w-full rounded border border-slate-200 bg-white nodrag"
              />
            )}
          </div>
        )}
        {/* Snapshot: a LIVE diagnostic — no Capture button. The overlay re-photographs the canvas (the SAME
            snapshot the Agent's critique takes) whenever what the canvas draws changes, so the image here is
            always current and you can see at a glance whether the geometry is being captured rather than a
            blank frame. Its `val-image` output carries the PNG data URL onward. See the live-snapshot effect. */}
        {d.tool === "snapshot" && (
          <div className="space-y-1 pt-0.5">
            <p className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] leading-tight text-violet-700 nodrag">
              {typeof d.params._status === "string" && d.params._status ? String(d.params._status) : "● live — watching the canvas"}
            </p>
            {typeof d.params._snapshot === "string" && d.params._snapshot ? (
              <img
                src={String(d.params._snapshot)}
                alt="canvas snapshot"
                className="w-full rounded border border-slate-200 bg-white nodrag"
              />
            ) : (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] italic leading-tight text-slate-500 nodrag">
                Nothing drawn on the canvas yet.
              </p>
            )}
            {/* The 3D half — only present while the 3D view is actually mounted (the live capture refuses
                to switch the app into it), so its absence is a normal state, not a failure. */}
            {typeof d.params._snapshot3d === "string" && d.params._snapshot3d && (
              <img
                src={String(d.params._snapshot3d)}
                alt="3D view snapshot"
                className="w-full rounded border border-slate-200 bg-white nodrag"
              />
            )}
          </div>
        )}
        {/* BSP adjacency matrix: lower-triangle checkbox grid (cells 1..n). A ticked pair must share
            a wall — stored in params.connections as a "1-2,2-3" list (1-based, comma separated). */}
        {d.tool === "bsp" && Boolean(d.params.useConnection) && (() => {
          const nCells = Math.max(1, Math.min(30, Math.round(Number(d.params.seeds) || 2)));
          const pairs = parseBspConnections(String(d.params.connections ?? ""), nCells);
          const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
          const ticked = new Set(pairs.map(([a, b]) => pairKey(a, b)));
          const toggle = (a: number, b: number) => {
            const k = pairKey(a, b);
            const next = ticked.has(k)
              ? pairs.filter(([x, y]) => pairKey(x, y) !== k)
              : [...pairs, (a < b ? [a, b] : [b, a]) as [number, number]];
            d.onParamChange?.(id, "connections", serializeBspConnections(next));
          };
          if (nCells < 2) return <div className="text-[9px] italic text-slate-400">Need at least 2 cells for adjacency.</div>;
          return (
            <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Adjacency</span>
                <span className="font-mono text-[10px] text-slate-700">{pairs.length}</span>
              </div>
              <p className="text-[9px] leading-tight text-slate-400">Tick a pair to make those cells share a wall.</p>
              <div className="max-h-40 overflow-auto">
                <table className="border-collapse text-[9px]">
                  <thead>
                    <tr>
                      <th className="w-6" />
                      {Array.from({ length: nCells - 1 }, (_, j) => (
                        <th key={`bspm-c-${j}`} className="w-5 text-center font-mono text-slate-500">{j + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: nCells - 1 }, (_, ri) => {
                      const i = ri + 1;
                      return (
                        <tr key={`bspm-r-${i}`}>
                          <td className="w-6 pr-1 text-right font-mono text-slate-500">{i + 1}</td>
                          {Array.from({ length: nCells - 1 }, (_, j) => (
                            <td key={`bspm-${i}-${j}`} className="w-5 text-center">
                              {j < i && (
                                <input
                                  type="checkbox"
                                  className="nodrag"
                                  checked={ticked.has(pairKey(i, j))}
                                  onChange={() => toggle(i, j)}
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
        {/* Space (source) node: while grabbing from selection, show the live grabbed id (the editable
            input is hidden in that mode). Empty id → nothing selected. */}
        {d.tool === "source" && Boolean(d.params.grabFromSelection) && (
          <div className="flex items-center justify-between gap-2 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">
            <span>ID</span>
            <span className="truncate font-mono text-slate-800">{String(d.params.id || "") || "— no selection"}</span>
          </div>
        )}
        {/* Conditional comparator: live A <op> B + the resulting boolean. */}
        {d.tool === "conditional" && typeof d.params._value === "number" && (
          <div
            className={`flex items-center justify-between rounded px-1.5 py-0.5 text-[9px] font-semibold ${
              d.params._pass ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}
          >
            <span>
              {Number(d.params._value).toFixed(1)} {({ gt: ">", gte: "≥", eq: "=", lte: "≤", lt: "<", ne: "≠" } as Record<string, string>)[String(d.params.op)] ?? ">"} {Number(d.params.value ?? 0).toFixed(1)}
            </span>
            <span>→ {d.params._pass ? "TRUE" : "FALSE"}</span>
          </div>
        )}
        {/* Vectorisation Auto-Tune: sweep the tracing params against the image, score on closed spaces
            found, bake the best combo back into the sliders. Live progress under the button. */}
        {d.tool === "vectorise" && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunVectorTune?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Tuning…</>
                : <><Wand2 className="h-3 w-3" /> Auto-Tune</>}
            </Button>
            {typeof d.params._tuneStatus === "string" && d.params._tuneStatus && (
              <p className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] leading-tight text-violet-700 nodrag">
                {String(d.params._tuneStatus)}
              </p>
            )}
          </div>
        )}
        {/* Export sinks: one Download button that writes the wired node's geometry to a file (DXF for the
            2D side, glTF/OBJ/STL/PLY for the 3D side), plus the last export's result line. */}
        {(d.tool === "export-dxf" || d.tool === "export-3d") && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => (d.tool === "export-dxf" ? d.onExportDxf?.(id, d.params) : d.onExport3d?.(id, d.params))}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Exporting…</>
                : <><Download className="h-3 w-3" /> Download {d.tool === "export-dxf" ? ".dxf" : `.${MESH3D_FORMATS[(typeof d.params.format === "string" && d.params.format in MESH3D_FORMATS ? d.params.format : "glb") as Mesh3DFormat].ext}`}</>}
            </Button>
            {typeof d.params._exportStatus === "string" && d.params._exportStatus && (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
                {String(d.params._exportStatus)}
              </p>
            )}
          </div>
        )}
        {/* Canvas Encoder: the node computes a whole plan document and holds it as text. Import loads it,
            by the same path File ▸ Import takes for a plan the user picked. There is no preview to commit
            here and nothing for Run Flow to hand over — the result of this node IS the document. */}
        {d.tool === "canvas-encoder" && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              onClick={() => d.onImportPlan?.(id)}
            >
              <Stamp className="h-3 w-3" /> Import in canvas
            </Button>
            {typeof d.params._importStatus === "string" && d.params._importStatus && (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
                {String(d.params._importStatus)}
              </p>
            )}
          </div>
        )}
        {/* Export to Canvas: the same sink shape, but it writes to the PLAN instead of to a file. The eye in
            the title bar previews the result as real canvas geometry; Commit hands that geometry over. */}
        {d.tool === "export-canvas" && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              onClick={() => d.onExportToCanvas?.(id, d.params)}
            >
              <Stamp className="h-3 w-3" /> Commit
            </Button>
            {!hidden && (
              <p className="rounded bg-teal-50 px-1.5 py-0.5 text-[9px] leading-tight text-teal-700 nodrag">
                Previewing on canvas — Commit to hand it over
              </p>
            )}
            {typeof d.params._exportStatus === "string" && d.params._exportStatus && (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
                {String(d.params._exportStatus)}
              </p>
            )}
          </div>
        )}
        {/* Set Object Param: the only node that edits existing canvas objects, so it gets the same
            explicit-commit shape as Export to Canvas — a live count of what WOULD be written, and a button
            that performs it as one undoable step. */}
        {d.tool === "set-object-param" && (
          <div className="space-y-1 pt-0.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 bg-amber-600 px-2 text-[11px] hover:bg-amber-700 nodrag"
              onClick={() => d.onSetObjectParams?.(id, d.params)}
            >
              <Stamp className="h-3 w-3" /> Apply to canvas
            </Button>
            {typeof d.params._applyStatus === "string" && d.params._applyStatus && (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
                {String(d.params._applyStatus)}
              </p>
            )}
          </div>
        )}
        {/* Plan JSON: the payload itself, so the node is visibly holding the canvas model. Truncated —
            the whole string is on `val-json`; the readout row above reports its true size. */}
        {d.tool === "plan-json" && (
          <div className="pt-0.5">
            {typeof d.params._preview === "string" && d.params._preview ? (
              <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 px-1.5 py-1 font-mono text-[8px] leading-tight text-slate-600 nodrag">
                {String(d.params._preview)}
              </pre>
            ) : (
              <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] italic leading-tight text-slate-500 nodrag">
                Nothing on the canvas yet — draw or select something.
              </p>
            )}
          </div>
        )}
        {/* Render action: Generate button + result image + download link. */}
        {d.tool === "render" && (
          <div className="space-y-1.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunRender?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Rendering…</>
                : <><Wand2 className="h-3 w-3" /> Generate</>}
            </Button>
            {/* WHAT WILL BE SENT. There is no fallback capture any more, so an unwired node has nothing
                to send and says so here rather than at the moment the button is pressed. */}
            <p className="rounded bg-slate-50 px-1.5 py-0.5 text-[9px] leading-tight text-slate-600 nodrag">
              {(() => {
                const plan = typeof d.params._image === "string" && d.params._image;
                const iso = typeof d.params._image3d === "string" && d.params._image3d;
                if (plan && iso) return "sends: plan + 3D image";
                if (plan || iso) return `sends: ${plan ? "plan" : "3D"} image`;
                return "no image wired — nothing to send";
              })()}
            </p>
            {typeof d.params._resultUrl === "string" && (
              <div className="space-y-1">
                <img src={d.params._resultUrl} alt="Render result" className="w-full rounded border border-slate-200" />
                <a
                  href={d.params._resultUrl}
                  download="flow-render.png"
                  className="flex items-center justify-center gap-1 rounded border border-slate-200 py-1 text-[10px] text-slate-600 hover:bg-slate-50 nodrag"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
              </div>
            )}
          </div>
        )}
        {/* Generate action: a button + the generated media (image / video / audio) + a download link.
            The default model follows the Kind dropdown (handled in onParamChange). */}
        {d.tool === "generate" && (
          <div className="space-y-1.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunGenerate?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                : <><Wand2 className="h-3 w-3" /> Generate</>}
            </Button>
            {d.params._busy && d.params.kind === "video" && (
              <p className="text-center text-[9px] text-slate-400">Video can take 1–3 minutes…</p>
            )}
            {typeof d.params._resultUrl === "string" && (
              <div className="space-y-1">
                {d.params.kind === "image" && <img src={String(d.params._resultUrl)} alt="Generated" className="w-full rounded border border-slate-200" />}
                {d.params.kind === "video" && <video src={String(d.params._resultUrl)} controls className="w-full rounded border border-slate-200 nodrag" />}
                {d.params.kind === "music" && <audio src={String(d.params._resultUrl)} controls className="w-full nodrag" />}
                {d.params.kind === "text" && typeof d.params._resultText === "string" && (
                  <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-1.5 text-[10px] text-slate-700 nodrag">
                    {String(d.params._resultText)}
                  </div>
                )}
                <a
                  href={String(d.params._resultUrl)}
                  download={String(d.params._resultName ?? "generated")}
                  className="flex items-center justify-center gap-1 rounded border border-slate-200 py-1 text-[10px] text-slate-600 hover:bg-slate-50 nodrag"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
              </div>
            )}
          </div>
        )}
        {/* Analyse action: File-input status row (anchors the valin-file handle) + Analyse button +
            the model's text answer. The Url / model / key / prompt render as normal fields above. */}
        {d.tool === "analyse" && (
          <div className="space-y-1.5">
            <div
              ref={(el) => { rowRefs.current["field:file"] = el; }}
              className="flex items-center justify-between rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700"
            >
              <span>File</span>
              <span className="font-mono">{String(d.params._file ?? "").startsWith("data:") ? "wired ●" : "—"}</span>
            </div>
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunAnalyse?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Analysing…</>
                : <><Sparkles className="h-3 w-3" /> Analyse</>}
            </Button>
            {typeof d.params._result === "string" && d.params._result && (
              <div className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-1.5 text-[10px] text-slate-700 nodrag">
                {String(d.params._result)}
              </div>
            )}
          </div>
        )}
        {/* Object Detection: the "Add object" target list. Each row is ONE name that goes into the single
            prompt AND is the term the reply is split back on, so the ask and the split can't drift apart.
            Each row gets its own `val-<rowId>` endpoint (rendered below, anchored to this row). */}
        {d.tool === "object-detection" && (() => {
          const rows = detectionObjects(d.params);
          const setRows = (next: DetectionObject[]) => d.onParamChange?.(id, "objects", next);
          const counts = (d.params._rowCounts as Record<string, number> | undefined) ?? {};
          return (
            <div className="space-y-1">
              {rows.map((o, i) => (
                <div key={o.id} ref={(el) => { rowRefs.current[`obj:${o.id}`] = el; }} className="flex items-center gap-1">
                  <input
                    type="text"
                    className="h-6 min-w-0 flex-1 rounded border border-slate-200 px-1.5 text-[10px] nodrag"
                    placeholder={`Object ${i + 1} — e.g. door`}
                    value={o.name}
                    onChange={(e) => setRows(rows.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)))}
                  />
                  <span className="w-6 shrink-0 text-right font-mono text-[10px] text-slate-700">{counts[o.id] ?? "—"}</span>
                  <button
                    type="button"
                    title="Remove object"
                    className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => setRows(rows.filter((x) => x.id !== o.id))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="nodrag flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50"
                onClick={() => setRows([...rows, { id: nextObjectId(), name: "" }])}
              >
                <Plus className="h-3 w-3" /> Add object
              </button>
              {rows.length > 0 && Number(d.params._unmatched) > 0 && (
                <p className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] leading-tight text-amber-700 nodrag">
                  {Number(d.params._unmatched)} detected object(s) matched no row — see val-unmatched.
                </p>
              )}
            </div>
          );
        })()}
        {/* Object Detection action: Detect button + detected-count readout. */}
        {d.tool === "object-detection" && (
          <div className="space-y-1.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunDetect?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Detecting…</>
                : <><Sparkles className="h-3 w-3" /> Detect</>}
            </Button>
            {Array.isArray(d.params._labels) && (
              <p className="text-center text-[10px] text-slate-500">
                {(d.params._labels as unknown[]).length} object(s) →{" "}
                {[
                  (d.params._boxes as unknown[] | undefined)?.length ? "polygons" : null,
                  (d.params._points as unknown[] | undefined)?.length ? "points" : null,
                  "labels",
                ].filter(Boolean).join(" / ")}
              </p>
            )}
          </div>
        )}
        {/* File Upload action: a button that opens the OS file dialog; the chosen file's path/name is
            stored in params and exposed on the val-path output endpoint. */}
        {d.tool === "file-upload" && (
          <div className="space-y-1.5">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                // Browsers don't expose the real absolute path (security); use the file name as the path.
                d.onParamChange?.(id, "fileName", file.name);
                d.onParamChange?.(id, "path", file.name);
                // Also read the bytes as a data URL into a transient param (`_data`, stripped on export)
                // so the val-data output can feed an Analyse node. Skipped for very large files.
                const reader = new FileReader();
                reader.onload = () => d.onParamChange?.(id, "_data", String(reader.result ?? ""));
                reader.readAsDataURL(file);
                e.target.value = ""; // allow re-selecting the same file
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-3 w-3" /> Choose File
            </Button>
            <p className="truncate text-center text-[10px] text-slate-500" title={String(d.params.fileName ?? "")}>
              {d.params.fileName ? String(d.params.fileName) : "No file selected"}
            </p>
          </div>
        )}
        {/* Pipe Network Solver: schema comes from a wired Schema node (the gin-schema input); the
            main input takes a Graph node. Show the live schema source + solve status. */}
        {d.tool === "pipe-solver" && (
          <div className="space-y-1.5">
            <p className="truncate text-center text-[10px] text-slate-500" title={String(d.params._schemaName ?? "")}>
              {d.params._schemaName
                ? `Schema: ${String(d.params._schemaName)}`
                : "Wire a Schema node into the Schema input"}
            </p>
            {Boolean(d.params._pipeStatus) && (
              <div className={`rounded px-1.5 py-1 text-[9px] font-semibold leading-tight ${String(d.params._pipeStatus).startsWith("Converged") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {String(d.params._pipeStatus)}
              </div>
            )}
          </div>
        )}
        {/* Random / Massing "Random floors" / Optimise Rectangle "Random": re-roll bumps the seed → a
            fresh deterministic draw (the preview stays stable otherwise). */}
        {(d.tool === "random" || ((d.tool === "floor-massing" || d.tool === "optimise-rect") && Boolean(d.params.random)) || (d.tool === "space-creator" && d.params.regularity === "irregular")) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
            onClick={() => d.onParamChange?.(id, "seed", Math.max(1, Math.round(Number(d.params.seed) || 1)) + 1)}
          >
            <Wand2 className="h-3 w-3" /> Re-roll
          </Button>
        )}
        {/* Scalar value outputs (e.g. Inset area, BUA): each is a labelled row with an amber endpoint
            handle (id `val-<key>`) anchored at the node's right edge — no overlap with the fields. */}
        {def.valueOutputs?.some((vo) => !vo.alignField) && d.tool !== "file-upload" && d.tool !== "text" && d.tool !== "analyse" && d.tool !== "param-object" && d.tool !== "param-grab" && d.tool !== "param-geometry" && d.tool !== "param-output-metrics" ? (
          <div className="flex flex-col gap-0.5 pt-0.5">
            {def.valueOutputs.filter((vo) => !vo.alignField).map((vo) => {
              const v = (d.params._values as Record<string, number | string> | undefined)?.[vo.key];
              // A value output is USUALLY a number, but not always — `points` publishes a vertex LIST as a
              // JSON string. Numbers get 2dp + unit; a list reports its length rather than dumping the whole
              // array into the node body; any other string is truncated.
              const shown = (() => {
                if (typeof v === "number") return `${v.toFixed(2)}${vo.unit ? ` ${vo.unit}` : ""}`;
                if (typeof v === "string" && v.length) {
                  try {
                    const arr = JSON.parse(v) as unknown;
                    // A MATRIX (rows of rows — Image, Grid Geometry, the grid nodes) reports its shape, not
                    // a point count: it isn't a vertex list, and the cells never belong on the node face.
                    if (Array.isArray(arr) && Array.isArray(arr[0]) && (arr[0] as unknown[]).length !== 2) return `${arr.length}×${(arr[0] as unknown[]).length}`;
                    if (Array.isArray(arr)) return `${arr.length} pts`;
                  } catch { /* not a list — fall through to the raw string */ }
                  return v.length > 18 ? `${v.slice(0, 18)}…` : v;
                }
                return "—";
              })();
              return (
                <div key={vo.key} ref={(el) => { rowRefs.current[`vout:${vo.key}`] = el; }} className="flex items-center justify-between rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                  <span>{vo.label}</span>
                  <span className="font-mono">{shown}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      )}
      {/* DECOMPILE DOCK — while this node's internals are folded away, the Output Metrics node(s) are real
          React Flow CHILDREN of it (`parentId` + `extent: "parent"`, set by onToggleDecompile), so the pair
          drags, folds, serializes and deletes as ONE unit while every metric keeps its own wireable
          `val-<key>` endpoint. This strip is the space they sit in; `_dockH` is its height, measured from the
          docked nodes when folding. Nothing docked (or this node folded) → no strip. */}
      {!collapsed && Boolean(d.params._decompileHidden) && Number(d.params._dockH) > 0 && (
        <div
          style={{ height: Number(d.params._dockH) }}
          className="rounded-b-md border-t border-dashed border-slate-200 bg-slate-50/70"
        />
      )}
      {/* Main geometry output: top-right below the title; centred (single handle) when collapsed. */}
      {collapsed
        ? (def.hasOutput || d.params._foldOut) && <Handle type="source" position={Position.Right} style={{ top: "50%" }} className="!h-2.5 !w-2.5 !bg-slate-400" />
        : outN <= 1
        ? def.hasOutput && <Handle type="source" position={Position.Right} style={{ top: 30 }} className="!h-2.5 !w-2.5 !bg-slate-400" />
        : Array.from({ length: outN }).map((_, i) => {
            // Canvas: anchor each handle to its measured body row (Spaces/Nodes/…) and let the row show the
            // label + count, so skip the generic floating "P{i}" tag. Others: evenly spaced with a tag.
            const measured = d.tool === "canvas-source" ? rowTops[`cout:${i}`] : undefined;
            const topPct = ((i + 1) / (outN + 1)) * 100;
            const handleStyle = measured != null ? { top: measured } : { top: `${topPct}%` };
            const label = def.outputLabels?.[i] ?? `P${i + 1}`;
            return (
              <span key={i}>
                {d.tool !== "canvas-source" && (
                  <span
                    style={{ position: "absolute", right: 9, top: `${topPct}%`, transform: "translateY(-50%)" }}
                    className="pointer-events-none font-mono text-[8px] text-slate-400"
                  >
                    {label}
                  </span>
                )}
                <Handle
                  id={`out-${i}`}
                  type="source"
                  position={Position.Right}
                  style={handleStyle}
                  className="!h-2.5 !w-2.5 !bg-teal-500"
                />
              </span>
            );
          })}
      {/* Scalar value OUTPUT endpoints (amber, right) — id `val-<key>`. Direct children of the node so
          React Flow registers them as connectable, like the geometry output handles. Computed outputs
          align to their readout rows; falls back to a stacked % when not yet measured. Hidden while collapsed. */}
      {!collapsed && d.tool !== "expr" && def.valueOutputs?.map((vo, i) => {
        const n = def.valueOutputs!.length;
        // alignField → anchor the endpoint to that field's row (e.g. Massing "floors" on the "n" slider);
        // otherwise anchor to the output's own readout row, falling back to a stacked % until measured.
        const measured = vo.alignField ? rowTops[`field:${vo.alignField}`] : rowTops[`vout:${vo.key}`];
        const style = measured != null ? { top: measured } : { top: `${n === 1 ? 84 : 72 + (i / (n - 1)) * 22}%` };
        return (
          <Handle
            key={vo.key}
            id={`val-${vo.key}`}
            type="source"
            position={Position.Right}
            style={style}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
      {/* Params OUTPUT endpoint (violet, right) — id `pout`. Advertises this node's parameters to a Loop. */}
      {!collapsed && def.exposesParams && (
        <>
          <span style={{ position: "absolute", right: 12, top: 48, transform: "translateY(-50%)" }} className="pointer-events-none font-mono text-[8px] text-violet-400">prm</span>
          <Handle id="pout" type="source" position={Position.Right} style={{ top: 48 }} className="!h-2.5 !w-2.5 !bg-violet-500" title="Parameters" />
        </>
      )}
      {/* Object Detection: one dynamic value-output endpoint per "Add object" row (id `val-<rowId>`),
          anchored to its row. Carries that target's rings (or points, when Shape is Point) split out of
          the single detection reply. */}
      {!collapsed && d.tool === "object-detection" && detectionObjects(d.params).map((o) => {
        const top = rowTops[`obj:${o.id}`];
        return (
          <Handle
            key={o.id}
            id={`val-${o.id}`}
            type="source"
            position={Position.Right}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
            title={o.name || "object"}
          />
        );
      })}
      {/* Input Properties: one dynamic value-output endpoint per parameter (id `val-<propId>`), anchored
          to its row, so each user-defined parameter feeds the pipeline. */}
      {!collapsed && (d.tool === "input-props" || d.tool === "pobj-source" || d.tool === "grab-object" || d.tool === "agent") && inputProps(d.params).map((p) => {
        const top = rowTops[`prop:${p.id}`];
        return (
          <Handle
            key={p.id}
            id={`val-${p.id}`}
            type="source"
            position={Position.Right}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
      {/* Input Properties: the MIRROR of the block above — one dynamic value-INPUT endpoint per parameter
          (id `valin-<propId>`), on the same row as its output. A value wired in OVERRIDES that parameter's
          own control, so a brief can be driven from upstream (a computed number, another params node, an
          Agent) exactly as every op's params can. Only for input-props: a Parametric Object / Grab Object /
          Agent publishes its parameters, it does not take them. */}
      {!collapsed && d.tool === "input-props" && inputProps(d.params).map((p) => {
        const top = rowTops[`prop:${p.id}`];
        return (
          <Handle
            key={`in-${p.id}`}
            id={`valin-${p.id}`}
            type="target"
            position={Position.Left}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
      {/* Grab Output Metrics: one dynamic value-OUTPUT endpoint per metric (id `val-<key>`), anchored to its
          readout row, so any declared or derived metric can drive something downstream — a Math Engine, an
          Output slot, another node's param. Keys come from the shared paramOutputEntries, the same list the
          rows are rendered from. */}
      {!collapsed && d.tool === "param-output-metrics" && paramOutputEntries(d.params._outputs as ParamOutputs | undefined).map((e) => {
        const top = rowTops[`pout:${e.key}`];
        return (
          <Handle
            key={`pout-${e.key}`}
            id={`val-${e.key}`}
            type="source"
            position={Position.Right}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
      {/* 2D / 3D Render: one dynamic value-INPUT per primitive row (`valin-<rowId>`, the geometry that row
          draws) and its echo on the right (`val-<rowId>`), both anchored to the row. A row is a style GROUP,
          so one endpoint can carry many pieces. */}
      {!collapsed && (d.tool === "render-2d" || d.tool === "render-3d") && renderPrims(d.params, d.tool === "render-3d").map((p) => {
        const top = rowTops[`prim:${p.id}`];
        return (
          <Fragment key={p.id}>
            <Handle
              id={`valin-${p.id}`}
              type="target"
              position={Position.Left}
              style={top != null ? { top } : undefined}
              className="!h-2.5 !w-2.5 !bg-amber-500"
            />
            <Handle
              id={`val-${p.id}`}
              type="source"
              position={Position.Right}
              style={top != null ? { top } : undefined}
              className="!h-2.5 !w-2.5 !bg-amber-500"
            />
            {/* 3D only — the row's MATERIAL endpoint (`matin-<rowId>`, emerald), sitting outboard of the
                amber geometry one on the same row. Two planes, deliberately not one: the amber wire
                carries a face list that belongs to this row alone, the green wire carries a Library
                material that a dozen rows across a dozen objects share. With nothing wired the row
                keeps its own flat colour, so every existing object is unchanged. */}
            {d.tool === "render-3d" && (
              <Handle
                id={`matin-${p.id}`}
                type="target"
                position={Position.Left}
                style={top != null ? { top, left: -15 } : { left: -15 }}
                className="!h-2.5 !w-2.5 !bg-emerald-500"
                title="Material"
              />
            )}
          </Fragment>
        );
      })}
      {/* Pass-through field outputs — id `val-<key>` aligned to each flagged field's row (right edge). */}
      {!collapsed && outputFields.map((f) => {
        const top = rowTops[`field:${f.key}`];
        return (
          <Handle
            key={`out-field-${f.key}`}
            id={`val-${f.key}`}
            type="source"
            position={Position.Right}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
    </div>
  );
};

/** The `_`-prefixed params that survive serialization (see buildGraph): view state that is an authoring
 *  choice, not runtime scratch, so a flow saved folded reopens folded. `_decompileHidden` / `_dockedFrom` /
 *  `_dockH` must ride along with it — `parentId` IS serialized, so a brief saved with its Output Metrics
 *  docked would otherwise reopen with a child it no longer knows how to size or release. */
// `_exprFolded` joins them for the same reason `_collapsed` did: a library workflow carrying a ported
// algorithm should be able to ship with its regions folded, so the node opens as a readable table of
// contents rather than two hundred lines of matrix algebra.
const PERSISTED_VIEW_PARAMS = new Set(["_collapsed", "_decompileHidden", "_dockedFrom", "_dockH", "_exprFolded"]);

/** Group box padding around its children, and the height of its title bar (also the box's total height
 *  once collapsed). Shared by group creation, the auto-fit effect and the collapse toggle. */
const GROUP_PAD = 28;
const GROUP_HEADER = 26;

/** A labelled container box drawn BEHIND its child nodes. Created by the "Group" button; its children
 *  carry `parentId` so dragging the box moves them together. Not a pipeline op — it has no handles and
 *  is stripped from the compiled recipe / serialized graph (a pure editor-organisation convenience). */
const GroupNode = ({ id, data, selected }: NodeProps) => {
  const d = data as {
    label?: string;
    params?: { label?: string; collapsed?: boolean; _childCount?: number };
    onParamChange?: (nodeId: string, key: string, value: unknown) => void;
    onToggleGroup?: (nodeId: string) => void;
  };
  const label = d.label ?? d.params?.label ?? "Group";
  const collapsed = Boolean(d.params?.collapsed);
  const count = d.params?._childCount ?? 0;
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={`h-full w-full rounded-lg border-2 ${collapsed ? "border-solid" : "border-dashed"} ${
        selected ? "border-violet-500 bg-violet-500/10" : "border-violet-300 bg-violet-500/5"
      }`}
    >
      <div className="absolute left-2 top-1 flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
        {/* Chevron: fold the group down to this header bar (children + their edges get React Flow's
            `hidden`); the expanded box height is stashed on the node so expanding restores it. */}
        <button
          type="button"
          onClick={() => d.onToggleGroup?.(id)}
          title={collapsed ? "Expand group" : "Collapse group"}
          className="nodrag flex h-3.5 w-3.5 items-center justify-center rounded hover:bg-violet-200"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {editing ? (
          <input
            autoFocus
            defaultValue={label}
            onBlur={(e) => { d.onParamChange?.(id, "label", e.target.value.trim() || "Group"); setEditing(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="nodrag w-28 rounded border border-violet-300 bg-white px-1 text-[10px] font-semibold text-violet-700"
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
            className="cursor-text select-none"
          >
            {label}
          </span>
        )}
        {collapsed && count > 0 && <span className="font-normal text-violet-500">({count})</span>}
      </div>
    </div>
  );
};

const nodeTypes = { op: OpNode, group: GroupNode };

export interface FlowOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Collapsed-to-a-bar state: the editor renders header-only (the flow engine keeps running) so the
   *  canvas reclaims the area. Driven by the host's panel collapse. */
  minimized?: boolean;
  /** Window controls — minimize (collapse to a bar), maximize (grow the panel), restore (normal size). */
  onMinimize?: () => void;
  onMaximize?: () => void;
  onRestore?: () => void;
  /** Run Flow → commit the pipeline via the app's recipe engine (creates real Spaces). `committedNodeIds`
   *  lists the nodes the recipe handles, so the host can commit OTHER terminal nodes' preview geometry
   *  (e.g. Split Segment pieces) as canvas walls without double-committing. */
  onRunCommit: (json: string, committedNodeIds: string[]) => void;
  /** Live mode (pilot): when on, supported nodes (currently Inset) materialise their output as REAL
   *  canvas geometry that regenerates on every parameter change — instead of a preview overlay you must
   *  Run to commit. Owned by the host; the footer toggle flips it. */
  liveFlow?: boolean;
  /** True when a host-aware pipeline object (Site/Floor/Massing) is attached to a Space — lets the Live
   *  toggle be enabled even with an empty/incomplete flow, so the attachment alone can be live-committed. */
  hasLiveAttachments?: boolean;
  onToggleLiveFlow?: () => void;
  /** Pure live preview: the evaluated output polygons per node, for canvas overlay rendering. */
  onPreview: (items: FlowPreviewItem[]) => void;
  /** The selected space's vertices (pixel coords) — the pipeline input. */
  sourcePolygon: Point[];
  /** Pixels-per-metre, for the geometry algorithms. */
  pixelsPerMeter: number;
  /** Google AI key + model from the Chat AI preferences — the Agent node uses these rather than carrying
   *  its own key field, so one setting drives every model call in the app. */
  aiApiKey?: string;
  aiModel?: string;
  /** Preferences -> Object detection model: fallback for an Object Detection node with an empty Model field. */
  aiVisionModel?: string;
  /** Preferences -> Image model: fallback for a Generate node (kind "image") with an empty Model field. */
  aiImageModel?: string;
  /** Label of the currently-selected space (pipeline input), or null. */
  selectedRoomLabel: string | null;
  /** Display id of the currently-selected space (e.g. "Space001") — synced into a Space node's `id`
   *  param while its "Grab ID from selection" toggle is on. */
  selectedRoomId?: string | null;
  /** Display ids of ALL currently-selected spaces (e.g. ["Space001","Space002"]) — a Space node with
   *  "Grab ID from selection" on captures the whole list, so one node can output several spaces. */
  selectedRoomIds?: string[];
  /** Resolve a Space node's entered id (display id "Space001", room id, or label) to that space's
   *  polygon (pixel coords), independent of the current canvas selection. Returns null if unmatched. */
  resolveSpacePolygon?: (id: string) => Point[] | null;
  /** The parametric object attached to the currently-selected canvas element (Space / Node / Segment), for
   *  the "Grab Object" node: its host kind, display id, and parameters as input-props rows. Null when the
   *  selection has no attached object. A grabbing Grab Object node of the matching hostKind bakes these. */
  grabObjectSelection?: { hostKind: "space" | "node" | "segment"; id: string; props: Record<string, unknown>[] } | null;
  /** Per-Space attachment parameters, keyed by every id form that resolves to the space (display id
   *  "Space001", room id, label). A Space (source) node with a matching id reflects its attached object's
   *  parameters as read-only val-<key> outputs — so the Space node itself doubles as a Grab Object. Empty /
   *  absent when a space has no attachment (the node then shows no parameters). */
  spaceAttachmentProps?: Record<string, Record<string, unknown>[]>;
  /** Anchor (pixel coords) where a Space Creator centres its generated geometry — typically the selected
   *  space's centroid, else the centre of existing content. */
  createAnchor?: Point;
  /** The resolved 3D solids the viewport is drawing for this flow (host-side `primitiveMasses`), keyed by
   *  `${nodeId}` / `${nodeId}__${rowId}`. The Export 3D node writes its file from these, so what you export
   *  is exactly what the 3D view shows. */
  masses3D?: ExportMass3D[];
  /** Every freehand stroke drawn on the canvas — its polyline (absolute px) + stroke colour. A Freehand
   *  node emits the strokes matching its `color` param (blank = all) as one polyline network. */
  freehandStrokes?: { points: Point[]; color: string }[];
  /** The canvas's currently-selected segment network (each a 2-point polyline) — what a Graph node
   *  emits while grabbing. */
  selectedGraphSegments?: Point[][];
  /** Resolve a Graph display id (e.g. "Graph001") → its segment polylines, independent of the current
   *  selection (so a Graph node can reference graphs by id). Returns null if unmatched. */
  resolveGraphSegments?: (id: string) => Point[][] | null;
  /** Display id of the graph currently selected on the canvas (Select → Graph scope), kept synced onto a
   *  grabbing Graph node's `id`. */
  selectedGraphId?: string | null;
  /** The selected picture's id — "" for the base underlay, "render-1" for an overlay, null for none. */
  selectedImageId?: string | null;
  /** The canvas's currently-selected construction Grid's lattice lines — what a Grid node emits while
   *  grabbing. */
  selectedGridSegments?: Point[][];
  /** Resolve a Grid display id (e.g. "Grid001") → its lattice line polylines. Returns null if unmatched. */
  resolveGridSegments?: (id: string) => Point[][] | null;
  /** The selected grid as a typed grid-field (cells + per-cell values) — what a grabbing Grid node feeds
   *  to the grid pipeline (Grid Threshold, Grid Distance, …). */
  selectedGridField?: GridField | null;
  /** Resolve a Grid display id → its grid-field, independent of the current selection. */
  resolveGridField?: (id: string) => GridField | null;
  /** Display id of the grid currently selected on the canvas (Select → Grid scope), synced onto a grabbing
   *  Grid node's `id`. */
  selectedGridId?: string | null;
  /** The canvas's currently-selected segment(s), each a 2-point polyline — what a Segment node emits
   *  while grabbing. */
  selectedSegmentSegments?: Point[][];
  /** Resolve a Segment display id (e.g. "Segment001") → its polyline ([start,end]), independent of the
   *  current selection. Returns null if unmatched. */
  resolveSegmentSegments?: (id: string) => Point[][] | null;
  /** Display id(s) of the segment(s) currently selected on the canvas (Select → Segment scope), kept
   *  synced onto a grabbing Segment node's `id`. */
  selectedSegmentId?: string | null;
  /** The canvas's currently-selected node(s)/point(s), each as a single-point polyline — what a Node
   *  node emits while grabbing. */
  selectedNodeSegments?: Point[][];
  /** Resolve a Node display id (e.g. "Node001") → its point (as a single-point polyline), independent of
   *  the current selection. Returns null if unmatched. */
  resolveNodeSegments?: (id: string) => Point[][] | null;
  /** Display id(s) of the node(s) currently selected on the canvas (Select → Node scope), kept synced
   *  onto a grabbing Node node's `id`. */
  selectedNodeId?: string | null;
  /** The full canvas content for the Canvas node — all spaces / nodes / segments / graphs / image
   *  footprints (px world coords). Each becomes a typed output endpoint. */
  canvasContent?: { spaces: Point[][]; nodes: Point[][]; segments: Point[][]; graphs: Point[][][]; images: Point[][] };
  /** Path segments (segmentType "path") with half-width in px — Graph to Spaces pushes faces back along
   *  these so the path opens as a corridor between adjacent Spaces. */
  pathEdges?: { a: Point; b: Point; halfPx: number }[];
  /** The imported underlay image (RGBA + world box) for the Image / Vectorisation nodes. */
  imageData?: { data: Uint8ClampedArray; w: number; h: number; box: { x: number; y: number; scale: number }; key: string };
  /** The same shape per OVERLAY id — what an Image node's `id` field selects. Empty id keeps `imageData`. */
  overlayImages?: Record<string, { data: Uint8ClampedArray; w: number; h: number; box: { x: number; y: number; scale: number }; key: string }>;
  /** Put a generated picture on the canvas, registered on the picture it was made from. */
  onAddImageOverlay?: (dataUrl: string, sourceSrc?: string) => void;
  /** The canvas graph with component identity + schema attribute values, for the Pipe Network Solver. */
  pipeGraph?: PipeGraphInput;
  /** Capture ONE view of the 3D scene as a PNG data URL (for the Render node).
   *  `view` is a SnapshotView ("isometric" | "top" | "front" | … | "composite"); `focusPx` is the
   *  PLAN-PIXEL bounding box the camera should frame — the Render node passes the bounds of whatever
   *  Space was wired into it. Both optional: no view = isometric, no focus = the whole model. */
  onCapture3dView?: (opts?: {
    view?: string;
    focusPx?: { minX: number; minY: number; maxX: number; maxY: number };
    /** Return null instead of SWITCHING the app into 3D when the 3D canvas isn't mounted. A button press
     *  may reasonably take the user to 3D to answer it; the live Snapshot node, which fires on its own
     *  whenever the drawing changes, must never yank them out of the plan. */
    mountedOnly?: boolean;
  }) => Promise<string | null>;
  /** The host's current view mode ("2d" | "3d" | "both" | …). Only the live Snapshot reads it, and only as a
   *  CHANGE SIGNAL: opening the 3D view is the one thing that makes a 3D capture start succeeding without any
   *  geometry moving, so without this the 3D image would not appear until the next unrelated edit. */
  viewMode?: string;
  /** Capture the 2D PLAN as a content-cropped PNG data URL — the Agent node's feedback loop looks at this
   *  to review the geometry its parameters actually drew. Same snapshot the canvas agents self-review with.
   *  Called bare it frames the whole drawing; `focusPx` (plan pixels) frames a chosen box instead and
   *  `padPx` overrides the margin around it — the Snapshot node's "Selected" scope. */
  onCaptureCanvas?: (opts?: {
    focusPx?: { minX: number; minY: number; maxX: number; maxY: number };
    padPx?: number;
  }) => { dataUrl: string; widthM: number; heightM: number } | null;
  /** Stored Flow graph to seed the editor with on open (null/empty → fresh Source-only graph). */
  initialGraph?: SerializedFlow | null;
  /** Emitted whenever the graph changes, so the host can persist it onto the selected Space. */
  onGraphChange?: (graph: SerializedFlow) => void;
  /** Emits the drawing TYPES (segment + node, with icons) from an active "Schema to Drawing Tools" node,
   *  derived from the live graph — for the host's Add Segment / Add Node dropdowns. `undefined` = none. */
  onDrawingToolsChange?: (tools: { segments: { value: string; label: string; icon?: string }[]; nodes: { value: string; label: string; icon?: string }[]; spaces: { value: string; label: string; icon?: string }[] } | undefined) => void;
  /** Display ids (e.g. "Space001") of every Space node whose eye is toggled off — the host hides those
   *  spaces on the canvas. Emitted whenever the hidden set changes; empty array = nothing hidden. */
  onHiddenSpaceIdsChange?: (ids: string[]) => void;
  /** Colour filters of every Freehand-source node whose eye is toggled off — the host hides the matching
   *  canvas freehand strokes. Lowercased hex, or "*" for a blank filter (hide every stroke). Empty array =
   *  nothing hidden. Mirrors onHiddenSpaceIdsChange. */
  onHiddenFreehandColorsChange?: (colors: string[]) => void;
  /** Display ids (e.g. "Grid001") of every Grid-source node whose eye is toggled off — the host hides those
   *  construction grids on the canvas. Empty array = nothing hidden. Mirrors onHiddenSpaceIdsChange. */
  onHiddenGridIdsChange?: (ids: string[]) => void;
  /** Host-held bridge to set a node param from outside (e.g. the Properties tab) while the overlay is
   *  open, so both stay in sync. Assigned while mounted, cleared on unmount. */
  paramApiRef?: MutableRefObject<((nodeId: string, key: string, value: unknown) => void) | null>;
  /** Host-held bridge for the Properties tab's "Run": press Detect on every Object Detection node, exactly
   *  as the brief's own Run button does, with progress landing on the first Input Properties node so the
   *  status line reads the same in both places. Assigned while mounted, cleared on unmount. */
  runDetectAllApiRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** The twin of `runDetectAllApiRef` for a flow that COMPUTES onto the plan: commit every Set Object
   *  Param node. Lets a `button` parameter in the Properties tab do the same thing it does on the node. */
  runApplyAllApiRef?: MutableRefObject<(() => Promise<void>) | null>;
  /** Host-held bridge to inject a furniture object (placed on the canvas) into the live graph as a
   *  Space → Place Object chain while the overlay is open. Assigned while mounted, cleared on unmount. */
  injectObjectRef?: MutableRefObject<((spaceId: string, entry: AutoPlaceEntry) => void) | null>;
  /** Bridge to mirror a freshly-drawn door/window into the live graph as a Segment → Segment-to-Door/Window
   *  chain (set by the overlay while mounted; when closed the host edits liveFlowGraph directly). */
  injectOpeningRef?: MutableRefObject<((openingWallId: string, kind: OpeningKind) => void) | null>;
  /** Bridge to ensure the Canvas-Graph → Graph to Walls chain exists when a wall draw starts. */
  injectWallGraphRef?: MutableRefObject<(() => void) | null>;
  /** Bridge to mirror a freshly-placed furniture node as a Node → Node to Object chain. */
  injectNodeObjectRef?: MutableRefObject<((nodeId: string) => void) | null>;
  /** Bridge to mirror an object ATTACHED to a canvas node (Properties → Parametric Object) as a
   *  Node → Parametric Object chain, so attaching and wiring it up in the flow are the same act. */
  injectAttachedObjectRef?: MutableRefObject<((nodeDisplayId: string, pobj: Record<string, unknown>) => void) | null>;
  /** Called with the graph ids of flow node(s) the user just DELETED (Delete button or key). Lets the host
   *  drop a canvas attachment linked to a removed `pobj-source`. Fires only on real deletion — a graph
   *  import/clear replaces nodes without emitting these — so it can't wipe attachments on a flow swap. */
  onFlowNodesDeleted?: (nodeIds: string[]) => void;
  /** Called when the user wires a `pobj-source` OUTPUT into a Node source, so the host mirrors it as a
   *  canvas attachment on that node — the reverse of attaching from the Properties tab, giving the same
   *  linked, bidirectional pair. */
  onFlowObjectAttachedToNode?: (args: { flowNodeId: string; nodeDisplayId: string; objectId: string; definition: string; params: Record<string, number | string | boolean> }) => void;
  /** Called when a parametric object is imported in the flow (Import browser), so the host also registers it
   *  in the canvas object library — making it attachable on the canvas, exactly like importing via Properties. */
  onImportObjectToLibrary?: (pobj: Record<string, unknown>) => void;
  /** Host-held bridge for the Chat AI Flow agent: READ the live graph + APPLY a generated one (through the
   *  overlay's importFlowData, which normalises + re-attaches node callbacks). Assigned while mounted,
   *  cleared on unmount; when closed the host falls back to liveFlowGraph. */
  flowApiRef?: MutableRefObject<{
    getGraph: () => SerializedFlow;
    applyGraph: (g: { nodes?: unknown[]; edges?: unknown[] }) => number;
    /** Compile-check the LIVE graph (the same compileFlow the Run button uses). */
    compile: () => { ok: boolean; error?: string; opCount?: number; committedNodeIds: string[] };
    /** Press DETECT on an Object Detection node for real — the same async Gemini call as the button,
     *  awaited, with the result returned. `nodeId` defaults to the flow's only/first detection node;
     *  `apiKey` fills a node that ships with a blank key (workflow files never carry one). */
    runDetect: (a?: { nodeId?: string; apiKey?: string }) => Promise<DetectRun & { nodeId?: string }>;
    /** Run-commit the live pipeline into the canvas — exactly the panel's Run button (recipe engine +
     *  committedNodeIds), with the error returned instead of toasted so agents can react. */
    runCommit: () => { ok: boolean; error?: string; committedNodeIds?: string[] };
  } | null>;
  /** Host action: run the floorplan generator for a Layout Generation node (loads the editable canvas
   *  layout — draggable seeds, connections/repulsions). The node passes its id + params. */
  onRunLayoutGen?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Input Properties "Run": press DETECT on EVERY Object Detection node in the flow, in order. A brief that
   *  drives several detection families (openings, rooms, furniture) is one button's worth of intent, not
   *  four; the status line reports progress back onto the node that asked. */
  onRunAllDetect?: (nodeId: string) => void;
  /** Commit every Set Object Param node in the flow — what a `button` parameter fires. */
  onRunAllApply?: (nodeId: string) => void;
  onRunAllTune?: (nodeId: string) => void;
  /** Host action: run simulated annealing on the current generated layout. */
  onRunAnneal?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Host action: enter "Add Room" mode — the next canvas click drops a new room into the generated layout. */
  onAddRoom?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Host action for an Export to Canvas node's Commit button: write the given pieces onto the plan as
   *  ordinary Spaces + segments (world-pixel coords — the frame the preview items are already in). Unlike
   *  Live materialisation the result carries no `flowOwner`, so the flow never rewrites or reclaims it, and
   *  it lands as an undoable step. Returns what landed, for the node's status line. */
  onExportToCanvas?: (args: ExportCanvasRequest) => { spaces: number; segments: number; layers: number };
  /** Host action for the Canvas Encoder's Import button: load the plan document the node computed, by the
   *  same path a picked file takes. The flow hands over TEXT, not geometry — the node draws nothing, so
   *  there is no preview to commit and nothing for Run Flow to hand over. */
  onImportPlan?: (planJson: string) => void;
  /** Host action for a Set Object Param node's Apply button: write each `v` into the `paramKey` parameter of
   *  the object attached to the space at index `i` (indices into the Canvas node's spaces bundle). ONE
   *  undoable step, so Ctrl+Z restores every previous value together.
   *  so Ctrl+Z restores every previous value together. Returns what landed, for the node's status line. */
  onSetObjectParams?: (batch: { paramKey: string; writes: { kind?: "space" | "node" | "segment"; i: number; v: number | string }[] }[]) => { written: number; skipped: number };
  /** The eye-open preview for every Export to Canvas node, sent as a COMPLETE list (a node that is hidden,
   *  unwired or deleted simply drops out of it). The host materialises these as flow-owned canvas geometry
   *  that tracks the graph and never enters the drawing's history — the same geometry Commit would write,
   *  visible before you commit to it. */
  onExportCanvasPreview?: (requests: ExportCanvasRequest[]) => void;
}

/** One drawable the Export to Canvas node hands to the host — a Render row, or a plain 2D node's single
 *  output. World-pixel coords, exactly as the flow preview built them. */
export interface ExportCanvasPiece {
  polygons: Point[][];
  color: string;
  layer?: string;
  name: string;
  /** An open RUN (skeleton centreline, graph path): don't close the ring, and never make a Space. */
  openPath?: boolean;
  /** A closed ring the user chose not to fill: boundary segments only, no Space. */
  outlineOnly?: boolean;
}

/** A full "write this onto the canvas" request — shared verbatim by the eye preview and by Commit, so the
 *  two can never disagree about what the node produces. */
export interface ExportCanvasRequest {
  pieces: ExportCanvasPiece[];
  /** "single" → everything onto `layerName`; "row" → each piece onto its own row layer. */
  layerMode: "single" | "row";
  layerName: string;
  /** "replace" clears what a previous Commit from this node put on the target layer(s) first. */
  mode: "replace" | "append";
  /** Stamp key identifying THIS node's output, so replace only removes its own previous stamp. */
  stampKey: string;
  makeSpaces: boolean;
  makeWalls: boolean;
  /** Segment thickness in metres (converted host-side). */
  thickness: number;
  showLabel: boolean;
}

interface NodeCallbacks {
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  onRunRender: (nodeId: string, params: Record<string, unknown>) => void;
  onRunDetect: (nodeId: string, params: Record<string, unknown>) => void;
  onRunVectorTune: (nodeId: string, params: Record<string, unknown>) => void;
  onRunAgent: (nodeId: string, params: Record<string, unknown>) => void;
  onRunAnalyse: (nodeId: string, params: Record<string, unknown>) => void;
  onRunGenerate: (nodeId: string, params: Record<string, unknown>) => void;
  onRunLayoutGen: (nodeId: string, params: Record<string, unknown>) => void;
  onRunAnneal: (nodeId: string, params: Record<string, unknown>) => void;
  onAddRoom: (nodeId: string, params: Record<string, unknown>) => void;
  onExportDxf: (nodeId: string, params: Record<string, unknown>) => void;
  onExport3d: (nodeId: string, params: Record<string, unknown>) => void;
  onExportToCanvas: (nodeId: string, params: Record<string, unknown>) => void;
  onImportPlan: (nodeId: string) => void;
  onSetObjectParams: (nodeId: string, params: Record<string, unknown>) => void;
  // The two brief-level actions: press Detect on every detector, sweep every Vectorisation node.
  onRunAllDetect: (nodeId: string) => void;
  onRunAllApply: (nodeId: string) => void;
  onRunAllTune: (nodeId: string) => void;
  onToggleDecompile: (nodeId: string) => void;
  onToggleGroup: (nodeId: string) => void;
}

/** Plan metrics of a polygon (world-pixel coords) in metres — what an Agent node sends the model as its
 *  description of the Space wired in. Shared by the Run action and the staleness check so both fingerprint
 *  the same numbers. */
export const agentContextOf = (poly: Point[], ppm: number): SuggestContext => {
  // A Node (a single point) or a Segment (an open 2-point line) has NO area — the agent still runs, tuning its
  // targets from the prompt + each target's schema, just without a Space's area/perimeter context. Compute
  // whatever the geometry supports: bbox width/height + path length once there are ≥2 points, and area only for
  // a closed ring of ≥3. An empty/1-point poly returns a zero context (the object-only brief case).
  if (poly.length < 2) return { areaM2: 0, widthM: 0, heightM: 0, perimeterM: 0, aspect: 1, vertexCount: poly.length };
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const wM = (Math.max(...xs) - Math.min(...xs)) / ppm;
  const hM = (Math.max(...ys) - Math.min(...ys)) / ppm;
  const closed = poly.length >= 3;
  let perimPx = 0;
  let area2 = 0; // shoelace ×2
  const segs = closed ? poly.length : poly.length - 1; // open path: don't wrap the last→first edge
  for (let i = 0; i < segs; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    perimPx += Math.hypot(b.x - a.x, b.y - a.y);
    if (closed) area2 += a.x * b.y - b.x * a.y;
  }
  return {
    areaM2: Math.abs(area2 / 2) / (ppm * ppm),
    widthM: wM,
    heightM: hM,
    perimeterM: perimPx / ppm,
    aspect: hM > 0 ? wM / hM : 1,
    vertexCount: poly.length,
  };
};

/** The footprint an Agent reasons about, taken from ANY node it is directly wired to, in EITHER direction —
 *  so an Agent can simply hang off a Space (or an op) instead of being spliced into the geometry chain:
 *   • Agent → Space: a Space is a canvas-fed root, skipped by the evaluator, so it publishes no preview
 *     item — its footprint comes from the resolved source map instead.
 *   • Agent ↔ any op (Inset, BSP, Optimise …): read that node's evaluated output off the preview.
 *  (Space → Agent needs none of this: the geometry passes through onto the agent's OWN preview item, which
 *  the caller checks first.)
 *
 *  Only a closed ring of 3+ points qualifies, because that's what the agent's context describes (area /
 *  perimeter / aspect). A Node source emits bare points and a Segment source open polylines — neither has
 *  an area, so neither can serve as the brief here. */
export const agentGeometryPolyOf = (
  nodeId: string,
  edges: Edge[],
  preview: FlowPreviewItem[],
  sourcePolys: Map<string, Point[][]>,
): Point[] | undefined => {
  const usable = (polys: Point[][] | undefined): Point[] | undefined => polys?.find((p) => p.length >= 3);
  const geomOf = (otherId: string): Point[] | undefined =>
    usable(sourcePolys.get(otherId)) ?? usable(preview.find((it) => it.nodeId === otherId)?.polygons);
  // Prefer the INPUT endpoint — the geometry wired INTO the agent is the context it reasons about:
  // (Space | Segment | Node) → Agent → Input Properties reads the SPACE, not the object the brief then
  // generates on the output side. Only plain geometry inputs count (valin-/gin- carry values / stamps).
  for (const e of edges) {
    if (e.target !== nodeId || e.targetHandle?.startsWith("valin-") || e.targetHandle?.startsWith("gin-")) continue;
    const poly = geomOf(e.source);
    if (poly) return poly;
  }
  // Fallback — the OUTPUT endpoint: the older hang-off shape (Agent → Space) puts the geometry on the node
  // the agent points at, so read that when nothing feeds the input. Skip the agent's own val-* republish wires.
  for (const e of edges) {
    if (e.source !== nodeId || e.sourceHandle?.startsWith("val-")) continue;
    if (e.targetHandle?.startsWith("valin-") || e.targetHandle?.startsWith("gin-")) continue;
    const poly = geomOf(e.target);
    if (poly) return poly;
  }
  return undefined;
};

/** The nodes an Agent may tune, with their tunable parameter schema. Resolution order:
 *  (0) DIRECT NEIGHBOURS, ALWAYS — everything the agent is wired to AND everything wired into it, on any
 *      handle. This is what lets the agent sit ANYWHERE in the flow rather than only at the front hanging
 *      off a source: drop it between two ops and it tunes both.
 *  (1) EXPLICIT — the node(s) wired off the agent's geometry OUTPUT ((Space|Segment|Node) → Agent → Input
 *      Properties → primitives): the agent tunes exactly what it points at, no graph-walking, and that
 *      node's val-* wires drive the rest of the object for free.
 *  (2) FALLBACK (only when nothing explicit is wired) — infer from the graph: ops reachable downstream AND
 *      upstream, PLUS the parameter sources feeding any node in the agent's connected component.
 *  (3) Plus anything wired directly off one of the agent's own `val-<key>` outputs, in either topology.
 *
 *  (0) and (2)'s backward walk are what make placement free. Both are additive — `consider` still refuses
 *      other Agents and the geometry WIRING sources, so a broader reach never turns "which Space am I
 *      pointing at" into a design parameter.
 *
 *  Only range/number/select/checkbox fields are offered — free text and secrets are never model-set. And
 *  `showIf` is deliberately NOT applied: a field hidden by the CURRENT params may become relevant once the
 *  agent changes the param that gates it (e.g. Corridoor's `offset` once `shape` becomes "insetted"), so
 *  the model sees the whole schema and can set both together. */
export const agentTargetsOf = (nodeId: string, nodes: Node[], edges: Edge[]): SuggestTarget[] => {
  const TUNABLE = new Set(["range", "number", "select", "checkbox"]);
  // Geometry SOURCES the agent merely hangs off (Space / Node / Segment / Canvas / Graph / Grid): their
  // params are WIRING (which element, grab-from-selection, output mode), never design — never tune them, and
  // never let one count as an explicit output target. pobj-source / input-props / grab-object are NOT here:
  // those carry the real design brief in their `props` array, and remain tunable.
  const WIRING_SOURCES = new Set(["source", "node-source", "segment-source", "canvas-source", "graph-source", "grid-source"]);
  const found = new Map<string, SuggestTarget>();
  // A param fed by a `valin-<key>` wire is driven by its SOURCE node: evaluateFlow's resolveValueInputs
  // OVERRIDES the node's own param with the wired value. Setting it here would be silently masked on the
  // next eval, so it isn't offered — the agent tunes the source (e.g. a Parametric Site's brief) instead.
  const wired = new Set<string>();
  for (const e of edges) {
    if (e.targetHandle?.startsWith("valin-")) wired.add(`${e.target}::${e.targetHandle.slice(6)}`);
  }
  // ── (0) DIRECT NEIGHBOURS — always, in BOTH directions ────────────────────────────────────────────
  // The agent may sit ANYWHERE in the flow: whatever it is wired TO (forward) and whatever is wired
  // FROM into it (backward) is a tuning target, whichever handle the edge uses. Declared after
  // `consider` below and run first, so an agent dropped mid-chain sees its immediate neighbours without
  // any special topology — no need to hang it off a source or point it at an Input Properties node.
  //
  // This is additive and can't broaden the classic topologies: `consider` already refuses other Agents
  // and the geometry WIRING sources, so "which Space am I pointing at" still never becomes a design
  // parameter, and a brief node wired off the output was already offered by (1).
  const consider = (id: string) => {
    if (id === nodeId || found.has(id)) return;
    const nd = nodes.find((n) => n.id === id)?.data as FlowNodeData | undefined;
    const def = nd && FLOW_TOOLS[nd.tool];
    // Never tune another Agent node's readout, nor a geometry SOURCE the agent just hangs off: a wire to a
    // Space / Node / Segment source puts it in this walk, but its params (id / grab-from-selection / output
    // mode) are WIRING, not design — the model could repoint or unpin the very element it just measured.
    if (!nd || !def || nd.tool === "agent" || WIRING_SOURCES.has(nd.tool)) return;
    // PROPS-DRIVEN nodes (Parametric Site / Input Properties / Grab Object) keep their parameters in a
    // `props` ARRAY, not in def.fields (which is empty for them) — and that array is usually the real
    // design brief, feeding the ops downstream through val-* wires. Offer those; they're the values that
    // actually move the geometry. Their own def.fields (e.g. Grab Object's host picker) are wiring, not
    // design, so they're deliberately left alone.
    const props = inputProps(nd.params);
    const params: SuggestParamSpec[] = props.length
      ? props
          .filter((p) => TUNABLE.has(p.type))
          .map((p) => {
            const s: SuggestParamSpec = { key: p.id, label: p.name || p.id, kind: p.type, current: p.value };
            if (p.type === "range") { s.min = p.min; s.max = p.max; s.step = p.step; }
            if (p.options.length) s.options = p.options;
            return s;
          })
      : def.fields
          .filter((f) => TUNABLE.has(f.kind) && !f.secret && !wired.has(`${id}::${f.key}`))
          .map((f) => {
            const s: SuggestParamSpec = {
              key: f.key,
              label: f.label,
              kind: f.kind,
              current: (nd.params[f.key] ?? "") as string | number | boolean,
            };
            if (f.min != null) s.min = f.min;
            if (f.max != null) s.max = f.max;
            if (f.step != null) s.step = f.step;
            if (f.unit != null) s.unit = f.unit;
            if (f.options?.length) s.options = f.options.map((o) => o.value);
            return s;
          });
    if (params.length) found.set(id, { nodeId: id, tool: nd.tool, label: def.label, instructions: def.instructions, params });
  };
  // Defined here (after `consider`) and called immediately, so declaration order is never in doubt.
  const considerNeighbours = () => {
    for (const e of edges) {
      if (e.source === nodeId) consider(e.target);
      else if (e.target === nodeId) consider(e.source);
    }
  };
  considerNeighbours();

  // ── (1) EXPLICIT output target — the preferred, unambiguous wiring ────────────────────────────────
  //   (Space | Segment | Node) → Agent → Input Properties → 2D/3D primitives + Expressions.
  // When the agent points its geometry OUTPUT at a design-BRIEF node (pobj-source / input-props / grab-object),
  // THAT node is the thing to tune: its `props` are the brief, and its own val-* wires drive the rest of the
  // object for free. The agent reads geometry on its INPUT (agentGeometryPolyOf) and writes that one node's
  // params — no graph-walking, no guessing. Only a plain geometry-output edge counts (val-* republish wires
  // are handled in (3); valin-/gin- are value/stamp inputs, not tuning targets). Pointing at an OP instead,
  // or hanging off a Space/Node source, is NOT an explicit brief → drop to the inference in (2), which still
  // offers that op via the downstream chain. So this is purely ADDITIVE: it makes the agent more precise for
  // the brief-node topology and can't change how any existing hang-off / inline-op flow resolves.
  const BRIEF_TOOLS = new Set(["pobj-source", "input-props", "grab-object"]);
  let explicit = false;
  for (const e of edges) {
    if (e.source !== nodeId || e.sourceHandle?.startsWith("val-")) continue;
    if (e.targetHandle?.startsWith("valin-") || e.targetHandle?.startsWith("gin-")) continue;
    const tgt = nodes.find((n) => n.id === e.target)?.data as FlowNodeData | undefined;
    if (tgt && BRIEF_TOOLS.has(tgt.tool)) { consider(e.target); explicit = true; }
  }

  // ── (2) FALLBACK: infer the tunable set from the graph (only when nothing explicit was wired) ──────
  // Geometry chain downstream (value wires aren't the chain): on a hand-built flow the ops on this chain ARE
  // the design, so offer their params directly. PLUS the parameter sources feeding any node in the whole
  // connected component — a decompiled Staircase keeps its brief in a pobj-source that reaches the terminal
  // Node only through val-* wires + a gin-stamp (invisible to a directed walk), so treat edges as UNDIRECTED
  // to find every node the object is built from; a disjoint object shares no edge, so it stays unreached.
  if (!explicit) {
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (e.targetHandle?.startsWith("valin-")) continue;
      const l = adj.get(e.source);
      if (l) l.push(e.target); else adj.set(e.source, [e.target]);
    }
    const seen = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      for (const nxt of adj.get(queue.shift()!) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        queue.push(nxt);
        consider(nxt);
      }
    }
    // …and the same walk BACKWARD. An agent placed at the END of a chain (or anywhere mid-chain) must
    // still see the ops that BUILT its input — downstream-only would leave everything upstream untunable,
    // which is why the agent used to be pinned to the front of a flow.
    const radj = new Map<string, string[]>();
    for (const e of edges) {
      if (e.targetHandle?.startsWith("valin-")) continue;
      const l = radj.get(e.target);
      if (l) l.push(e.source); else radj.set(e.target, [e.source]);
    }
    const upSeen = new Set<string>([nodeId]);
    const upQueue = [nodeId];
    while (upQueue.length) {
      for (const nxt of radj.get(upQueue.shift()!) ?? []) {
        if (upSeen.has(nxt)) continue;
        upSeen.add(nxt);
        upQueue.push(nxt);
        consider(nxt);
      }
    }
    const undirected = new Map<string, string[]>();
    const link = (a: string, b: string) => { const l = undirected.get(a); if (l) l.push(b); else undirected.set(a, [b]); };
    for (const e of edges) { link(e.source, e.target); link(e.target, e.source); }
    const reached = new Set<string>([nodeId]);
    const rq = [nodeId];
    while (rq.length) {
      for (const nxt of undirected.get(rq.shift()!) ?? []) {
        if (reached.has(nxt)) continue;
        reached.add(nxt);
        rq.push(nxt);
      }
    }
    for (const e of edges) {
      if (!e.targetHandle?.startsWith("valin-")) continue;
      if (reached.has(e.target)) consider(e.source);
    }
  }

  // ── (3) The agent's own val-<key> output consumers — explicit links in either topology ────────────
  for (const e of edges) if (e.source === nodeId && e.sourceHandle?.startsWith("val-")) consider(e.target);
  return [...found.values()];
};

/** The downstream nodes an Agent should GENERATE a JSON payload for: every node whose `valin-<key>` value
 *  input the agent's output is wired into. This is the "producer" half — the agent authors the whole data
 *  payload (a graph, a point list …) rather than tuning params, and the TARGET node's own declaration
 *  instructions are the format contract. The wired `valin-<key>` names both the input to satisfy and the
 *  `val-<key>` the agent must publish, so the existing value-wire resolution carries the result across. */
export const agentGenTargetsOf = (nodeId: string, nodes: Node[], edges: Edge[]): GenTarget[] => {
  const out: GenTarget[] = [];
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.source !== nodeId || !e.targetHandle?.startsWith("valin-")) continue;
    // Skip the agent's own `val-<key>` republish wires (a tuned param piped into an input) — those are the
    // param-tuning path, not a request to GENERATE. Only the agent's primary output (no val- source handle)
    // wired into a value input is a generator target.
    if (e.sourceHandle?.startsWith("val-")) continue;
    const inputKey = e.targetHandle.slice(6);
    const key = `${e.target}::${inputKey}`;
    if (seen.has(key)) continue;
    const nd = nodes.find((n) => n.id === e.target)?.data as FlowNodeData | undefined;
    const def = nd && FLOW_TOOLS[nd.tool];
    if (!nd || !def) continue;
    seen.add(key);
    const field = def.valueInputs?.find((v) => v.key === inputKey);
    if (inputKey === "params") {
      // PARAM-BAG target: the contract is the node's own FIELD SCHEMA, not its usage docs. Describe every
      // tunable field (kind / range / options) so the agent emits a valid { key: value } parameter object.
      const TUNABLE = new Set(["range", "number", "select", "checkbox", "text"]);
      const lines = (def.fields as ParamField[])
        .filter((f) => TUNABLE.has(f.kind) && f.key !== "params" && f.key !== "polygon" && f.key !== "vertices" && !f.secret)
        .map((f) => {
          const bits = [`kind=${f.kind}`];
          if (f.options?.length) bits.push(`options=${f.options.map((o) => o.value).join("|")}`);
          if (f.min != null || f.max != null) bits.push(`range=${f.min ?? "-inf"}..${f.max ?? "inf"}`);
          if (f.unit) bits.push(f.unit);
          return `  - ${f.key} (${f.label}): ${bits.join(", ")}`;
        });
      out.push({ nodeId: e.target, tool: nd.tool, label: def.label, inputKey, fieldLabel: field?.label, formatDoc: lines.join("\n"), isParams: true });
    } else {
      out.push({ nodeId: e.target, tool: nd.tool, label: def.label, inputKey, fieldLabel: field?.label, formatDoc: def.instructions });
    }
  }
  return out;
};

/** The boundary an Agent generates INSIDE, in the exact frame a payload travels on the wire: metres relative
 *  to the flow `anchor` (identical to `val-points`, see polysToMetreListJson in evaluateFlow). Feeding this
 *  frame to the model and rebuilding the result at the same anchor in Network lands the geometry on the
 *  Space it was drawn from. */
export const agentBoundaryMetres = (poly: Point[], anchor: Point, ppm: number): number[][] => {
  if (!poly.length || ppm <= 0) return [];
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return poly.map((p) => [r((p.x - anchor.x) / ppm), r((p.y - anchor.y) / ppm)]);
};

/** Shift a boundary so its min corner sits at the origin — a clean top-left [0..W]×[0..H] frame (all coords
 *  ≥ 0). The model generates in this frame far more reliably than the centroid-relative one Network draws in
 *  (that one is centred on the Space centroid, so its coords are negative and the model, defaulting to a 0,0
 *  origin, lands its drawing offset by ~half the Space). Returns the normalised boundary plus the `offset` to
 *  add back to the agent's output (via runAgentGenerate) so it lands in the original anchor-relative frame. */
export const normalizeBoundaryFrame = (boundary: number[][]): { boundary: number[][]; offset: { x: number; y: number } } => {
  if (!boundary.length) return { boundary, offset: { x: 0, y: 0 } };
  const bx = Math.min(...boundary.map((p) => p[0]));
  const by = Math.min(...boundary.map((p) => p[1]));
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return { boundary: boundary.map((p) => [r(p[0] - bx), r(p[1] - by)]), offset: { x: bx, y: by } };
};

/** Let a param write flow all the way to PIXELS before the Agent photographs the canvas. The chain is
 *  long: onParamChange → React commit → the `preview` memo re-evaluating the graph → onPreview lifting the
 *  result to the host → the host's own commit → Konva's redraw. Snapshot too early and you photograph the
 *  PREVIOUS round's geometry, so the reviewer critiques a stale image and the loop can never converge —
 *  the worst kind of bug, because it still looks like it's working. Several frames is a heuristic, not a
 *  guarantee; there's no single event that means "the canvas now reflects this write". */
/** FNV-1a over a point set, folded into a running 32-bit hash. Coordinates are quantised to 1/8 px — finer
 *  than anything the eye (or a PNG capture) resolves, coarse enough that float noise doesn't churn.
 *  Used to decide when a LIVE Snapshot must re-photograph the canvas: a string of every coordinate would be
 *  megabytes on a real plan, and comparing two of them per render is the cost this avoids. */
const hashPoints = (h: number, polys: readonly Point[][] | undefined): number => {
  if (!polys) return Math.imul(h ^ 0x9e37, 16777619);
  for (const poly of polys) {
    h = Math.imul(h ^ poly.length, 16777619);
    for (const p of poly) {
      h = Math.imul(h ^ Math.round(p.x * 8), 16777619);
      h = Math.imul(h ^ Math.round(p.y * 8), 16777619);
    }
  }
  return h;
};

const hashText = (h: number, s: string): number => {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h;
};

/** Fingerprint of everything the FLOW draws, MINUS the Snapshot nodes' own items. That exclusion is
 *  load-bearing, not tidiness: a live Snapshot writes its PNG back onto its own node, which re-runs the graph
 *  and yields a new preview — so a signature covering snapshot items would retrigger the capture that
 *  produced it, forever. See the live-snapshot effect. */
const previewGeometrySig = (items: readonly FlowPreviewItem[]): string => {
  let h = 2166136261;
  for (const it of items) {
    if (it.tool === "snapshot") continue;
    h = hashText(h, it.nodeId);
    h = hashPoints(h, it.polygons);
  }
  return (h >>> 0).toString(36);
};

/** Fingerprint of the COMMITTED canvas — the half a live Snapshot must also notice, since the user can draw
 *  a wall or move a room without the flow changing at all. */
const canvasContentSig = (
  content: { spaces: Point[][]; nodes: Point[][]; segments: Point[][]; graphs: Point[][][]; images: Point[][] } | undefined,
  strokes: readonly { points: Point[]; color: string }[] | undefined,
): string => {
  let h = 2166136261;
  if (content) {
    h = hashPoints(h, content.spaces);
    h = hashPoints(h, content.nodes);
    h = hashPoints(h, content.segments);
    for (const g of content.graphs) h = hashPoints(h, g);
    h = hashPoints(h, content.images);
  }
  if (strokes) for (const s of strokes) { h = hashPoints(h, [s.points]); h = hashText(h, s.color); }
  return (h >>> 0).toString(36);
};

/** Fingerprint of the 3D solids the viewport is drawing. The plan hashes above cannot stand in for it:
 *  a Cuboid's HEIGHT changes the 3D snapshot and nothing on the plan at all. */
const masses3dSig = (masses: readonly ExportMass3D[] | undefined): string => {
  let h = 2166136261;
  if (masses) for (const m of masses) {
    h = hashText(h, `${m.id}|${m.shape}|${m.color}`);
    const nums = [m.length, m.breadth, m.height, m.radius, m.radiusTop ?? 0, m.topLength ?? 0, m.topBreadth ?? 0, m.tubeRadius ?? 0, m.arcDeg ?? 0];
    const t = m.transform;
    if (t) nums.push(t.tx, t.ty, t.tz, t.rx, t.ry, t.rz, t.mx, t.my, t.mz);
    for (const v of nums) h = Math.imul(h ^ Math.round(v * 8), 16777619);
    if (m.faces) for (const f of m.faces) h = Math.imul(h ^ f.length, 16777619);
  }
  return (h >>> 0).toString(36);
};

const settleCanvas = (frames = 8): Promise<void> =>
  new Promise((resolve) => {
    let n = 0;
    const tick = () => (++n >= frames ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

const makeNode = (
  tool: FlowToolType,
  pos: { x: number; y: number },
  cb: NodeCallbacks,
  opts?: { singleton?: boolean },
): Node => {
  const def = FLOW_TOOLS[tool];
  // The seed Space (source) node is the primary pipeline input — fixed id "source", un-deletable. Extra
  // Space nodes added from the palette get unique ids and ARE deletable, so several spaces can be wired
  // up side by side (each Space node drives its own chain by its entered id).
  const primarySource = tool === "source" && opts?.singleton;
  return {
    id: primarySource ? "source" : nextId(tool),
    type: "op",
    position: pos,
    // Every node (Space included) is deletable, so the canvas can be emptied completely.
    deletable: true,
    data: { tool, params: { ...def.defaultParams }, onParamChange: cb.onParamChange, onRunRender: cb.onRunRender, onRunDetect: cb.onRunDetect, onRunVectorTune: cb.onRunVectorTune, onRunAnalyse: cb.onRunAnalyse, onRunGenerate: cb.onRunGenerate, onRunAgent: cb.onRunAgent, onRunLayoutGen: cb.onRunLayoutGen, onRunAnneal: cb.onRunAnneal, onAddRoom: cb.onAddRoom, onExportDxf: cb.onExportDxf, onExport3d: cb.onExport3d, onExportToCanvas: cb.onExportToCanvas, onImportPlan: cb.onImportPlan, onSetObjectParams: cb.onSetObjectParams, onRunAllDetect: cb.onRunAllDetect, onRunAllTune: cb.onRunAllTune, onRunAllApply: cb.onRunAllApply, onToggleDecompile: cb.onToggleDecompile } as FlowNodeData,
  };
};

// ── Import-dropdown file tree ─────────────────────────────────────────────────────────────────────
/** One node in the Library browser tree — a folder (`children`, no `path`) or a file leaf (`path`). */
interface LibNode { name: string; key: string; path?: string; children: LibNode[] }
/** Build a single-root foldable tree from flat paths, nesting by folder. One call per Library root
 *  ("Objects" / "Tools" / "Workflows") — the on-disk folder hierarchy IS the grouping. */
const buildFolderTree = (files: string[], rootName: string): LibNode[] => {
  if (files.length === 0) return [];
  const root: LibNode = { name: rootName, key: rootName, children: [] };
  for (const f of files) {
    const parts = f.split("/").filter(Boolean);
    let cur = root;
    let keyPath = rootName;
    parts.forEach((part, i) => {
      keyPath = `${keyPath}/${part}`;
      const isLeaf = i === parts.length - 1;
      let child = cur.children.find((c) => c.name === part && (isLeaf ? !!c.path : !c.path));
      if (!child) { child = { name: part, key: keyPath, children: [], path: isLeaf ? f : undefined }; cur.children.push(child); }
      cur = child;
    });
  }
  const sortRec = (n: LibNode) => {
    n.children.sort((a, b) => ((a.path ? 1 : 0) - (b.path ? 1 : 0)) || a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return [root];
};
/** Files in a folder's whole SUBTREE. The badge used to show `children.length`, so a root that lists 39
 *  objects in 6 category folders read "6" — a folder count where a file count is expected, which is the
 *  main reason this browser reads as though it were listing something other than the Library it lists. */
const libFileCount = (n: LibNode): number => (n.path ? 1 : n.children.reduce((t, c) => t + libFileCount(c), 0));

/** Strip the file extension for display (`.node.json` / `.json` / `.pobj.json`). */
const libLeafLabel = (name: string) => name.replace(/\.pobj\.json$/i, "").replace(/\.node\.json$/i, "").replace(/\.json$/i, "");

/** Recursive row for the Library import tree: foldable folders + clickable file leaves. `basePath` is the
 *  Library ROOT the paths are relative to ("Objects" / "Tools" / "Workflows") — it drives the tooltip and
 *  the leaf icon (a Tools file drops ONE node; an Objects/Workflows file is an object / a whole graph). */
const LibTreeNode = ({ node, depth, expanded, onToggle, onPick, basePath = LIB_WORKFLOWS }: {
  node: LibNode; depth: number; expanded: Set<string>;
  onToggle: (key: string) => void; onPick: (path: string) => void; basePath?: string;
}) => {
  if (node.path) {
    const isNodeFile = basePath === LIB_TOOLS || /\.node\.json$/i.test(node.path);
    return (
      <button
        type="button"
        onClick={() => onPick(node.path!)}
        title={`${basePath}/${node.path}`}
        className="flex w-full items-center gap-1.5 rounded py-0.5 pr-1 text-left text-[11px] text-slate-600 hover:bg-slate-100"
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
      >
        {isNodeFile ? <Boxes className="h-3 w-3 shrink-0 text-fuchsia-500" /> : <FilePlus className="h-3 w-3 shrink-0 text-sky-500" />}
        <span className="truncate">{libLeafLabel(node.name)}</span>
      </button>
    );
  }
  const open = expanded.has(node.key);
  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.key)}
        className="flex w-full items-center gap-1 rounded py-0.5 pr-1 text-left text-[11px] font-medium text-slate-600 hover:bg-slate-100"
        style={{ paddingLeft: `${depth * 12 + 2}px` }}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <Folder className="h-3 w-3 shrink-0 text-slate-400" />
        <span className="truncate">{node.name}</span>
        <span className="ml-auto text-[9px] tabular-nums text-slate-300">{libFileCount(node)}</span>
      </button>
      {open && node.children.map((c) => (
        <LibTreeNode key={c.key} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} onPick={onPick} basePath={basePath} />
      ))}
    </div>
  );
};

export const FlowOverlay = (props: FlowOverlayProps) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Wrap React Flow's node-change handler so a DELETE (Delete/Backspace key) also tells the host, which drops
  // any canvas attachment linked to the removed node. Programmatic replaces (import/clear) go through setNodes
  // directly and emit no 'remove' change, so this fires only on genuine user deletion.
  const onFlowNodesDeleted = props.onFlowNodesDeleted;
  const handleNodesChange = useCallback((changes: Parameters<typeof onNodesChange>[0]) => {
    if (onFlowNodesDeleted) {
      const removed = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
      if (removed.length) onFlowNodesDeleted(removed);
    }
    onNodesChange(changes);
  }, [onNodesChange, onFlowNodesDeleted]);
  // Always-current mirrors so injected node callbacks (captured at node creation) can read live graph state
  // without going stale — used by the Object Node's decompile toggle to walk the downstream subgraph.
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  // Ref to importFlowData (defined lower down) so the Object Node's decompile button can EXPLODE a lone
  // pobj-source into its primitive graph on demand — for ANY imported object, not just flagged ones.
  const importFlowDataRef = useRef<((g: { nodes?: unknown[]; edges?: unknown[] }) => number) | null>(null);
  // The name of the workflow currently loaded, prettified from its FILE name ("inset_with_math.json" →
  // "Inset with Math"). Arrange titles its group box with it, so a folded operation still says which flow it
  // is. A ref, not state: nothing re-renders on it, and a hand-built flow simply leaves it empty.
  const flowTitleRef = useRef<string>("");
  // Mirror of the latest evaluated preview (the `preview` memo is defined lower down) so the Agent node's
  // Run action can read the polygon arriving on its input — same forward-ref trick as importFlowDataRef.
  const previewRef = useRef<FlowPreviewItem[]>([]);
  // Mirror of the resolved Space-source footprints (the `sourcePolys` map is built lower down) so the Agent
  // node's Run action can read the Space it is wired INTO (Agent → Space) — that direction leaves nothing on
  // the agent's own input, because a Space ignores incoming geometry. Same forward-ref trick as previewRef.
  const sourcePolysRef = useRef<Map<string, Point[][]>>(new Map());
  // The host's resolved 3D solids, mirrored so the Export 3D action reads the CURRENT set on click without
  // making the callback (and every node's data) churn whenever the 3D view recomputes.
  const masses3DRef = useRef<ExportMass3D[]>([]);
  masses3DRef.current = props.masses3D ?? [];
  const [jsonOpen, setJsonOpen] = useState(false);
  const [initialised, setInitialised] = useState(false);
  // Toolbar "Fold" toggle: when on, collapse every node to its title bar; when off, expand all. Drives
  // the transient `_collapsed` param the nodes read, so it stays in sync with each node's own chevron.
  const [foldAll, setFoldAll] = useState(false);
  // Collapsed palette categories (by title) — the left "Add" rail's foldable blocks.
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const toggleCat = useCallback((title: string) => {
    setCollapsedCats((prev) => { const next = new Set(prev); if (next.has(title)) next.delete(title); else next.add(title); return next; });
  }, []);
  const toggleFoldAll = useCallback(() => {
    setFoldAll((prev) => {
      const next = !prev;
      setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, params: { ...(n.data as FlowNodeData).params, _collapsed: next } } })));
      return next;
    });
  }, [setNodes]);

  // Stable param-edit callback injected into every node's data.
  // Retarget a GEOMETRY node onto another source kernel — the whole mechanism behind the single Geometry
  // node. Only `tool` and `params` change: the node keeps its id, position, name and wires, so a chain
  // built against it survives the node changing what it reads. The new kind's defaults fill in what the
  // old one lacked while the ENTIRE previous param bag is kept, because dropping the params the new kind
  // doesn't declare loses identity on a round trip (Freehand has no `id`, so Space → Freehand → Space
  // would come back blank). A few unread keys resting on the node cost nothing: every consumer reads only
  // what its own tool declares.
  //
  // VALUE WIRES ARE KEPT even when the new kind doesn't publish that endpoint. A `val-points` consumer is
  // the whole reason this node exists — selecting a Graph for a moment must not destroy the wire that
  // anchors an object. A wire to an endpoint the current kind lacks simply reads as unwired (the consumer
  // falls back to its own typed value) and comes back to life the moment a kind that publishes it returns.
  // Only a GEOMETRY input the new kind structurally cannot accept (the Stamp endpoint) is dropped.
  const retargetGeometryNode = useCallback((nodeId: string, nextTool: FlowToolType) => {
    const def = FLOW_TOOLS[nextTool];
    setNodes((ns) => ns.map((n) => {
      if (n.id !== nodeId) return n;
      const data = n.data as FlowNodeData;
      return { ...n, data: { ...n.data, tool: nextTool, params: { ...def.defaultParams, ...data.params } } };
    }));
    const geomIn = new Set((def.geomInputs ?? []).map((g) => `gin-${g.key}`));
    setEdges((es) => es.filter((e) => {
      if (e.target === nodeId && e.targetHandle?.startsWith("gin-") && !geomIn.has(e.targetHandle)) return false;
      if (e.target === nodeId && e.targetHandle == null && !def.hasInput) return false;
      return true;
    }));
  }, [setNodes, setEdges]);

  const onParamChange = useCallback((nodeId: string, key: string, value: unknown) => {
    // Folding a node that has DOCKED children (an Output Metrics node parked inside a decompiled brief) folds
    // them away with it — they are React Flow children, so they would otherwise float over its title bar.
    // Their edges follow, exactly as a group box's collapse does. Group boxes are driven by onToggleGroup and
    // their own `collapsed` param, so they are left alone here.
    if (key === "_collapsed") {
      const self = nodesRef.current.find((n) => n.id === nodeId);
      const kidIds = new Set(self?.type === "group" ? [] : nodesRef.current.filter((n) => n.parentId === nodeId).map((n) => n.id));
      if (kidIds.size) {
        const hide = Boolean(value);
        setNodes((ns) => ns.map((n) => (kidIds.has(n.id) ? { ...n, hidden: hide } : n)));
        setEdges((es) => es.map((e) => (kidIds.has(e.source) || kidIds.has(e.target) ? { ...e, hidden: hide } : e)));
      }
    }
    setNodes((ns) =>
      ns.map((n) => {
        if (n.id !== nodeId) return n;
        const data = n.data as FlowNodeData;
        const params: Record<string, unknown> = { ...data.params, [key]: value };
        // Generate node: switching the media Kind swaps in that kind's default model and clears the
        // previous result, so the model field always matches the selected image/video/music endpoint.
        if (data.tool === "generate" && key === "kind") {
          params.model = GENERATE_DEFAULT_MODEL[String(value)] ?? params.model;
          params._resultUrl = undefined;
          params._resultName = undefined;
          params._resultText = undefined;
        }
        return { ...n, data: { ...n.data, params } };
      }),
    );
  }, [setNodes, setEdges]);

  // Object Node "decompile" toggle: hide (or re-show) every node + edge DOWNSTREAM of `nodeId` — the
  // materialised Inset / Circle Packing / Cylinder … chain — collapsing the graph back to the lone Object
  // Node. Walks the outgoing-edge graph from the current edges (via refs so it never reads stale state), sets
  // React Flow's `hidden` on the reachable nodes + their edges, and records the state as `_decompileHidden`
  // on the Object Node so its button icon reflects it.
  const onToggleDecompile = useCallback((nodeId: string) => {
    // UNDIRECTED reachability: the decomposed primitives point INTO the Merge / Display-3D sinks, so a
    // downstream-only walk misses constant parts (e.g. chair legs, which only have an outgoing edge to a
    // sink). Walk undirected from the Object Node and hide everything reachable EXCEPT the Object Node itself
    // and any source node — so the whole decompile collapses back to the Object Node + its host source.
    const adj = new Map<string, string[]>();
    const add = (a: string, b: string) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
    for (const e of edgesRef.current) { add(e.source, e.target); add(e.target, e.source); }
    const SOURCE_TOOLS = new Set(["source", "node-source", "segment-source", "canvas-source", "graph-source", "grid-source", "image"]);
    const toolOf = (id: string) => (nodesRef.current.find((n) => n.id === id)?.data as FlowNodeData | undefined)?.tool ?? "";
    const hideSet = new Set<string>();
    // Output Metrics nodes are the folded unit's OUTPUT FACE: they stay VISIBLE and dock INSIDE the brief (as
    // React Flow children), so a folded operation still reads as "parameters in, metrics out" and its
    // `val-<slotId>` endpoints remain wireable. Hiding them left nothing to connect a folded operation to.
    const dockSet = new Set<string>();
    const seen = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        queue.push(nxt);
        const t = toolOf(nxt);
        if (t === "output") dockSet.add(nxt);           // keep + dock
        else if (!SOURCE_TOOLS.has(t)) hideSet.add(nxt); // keep sources visible; hide the rest
      }
    }
    const start = nodesRef.current.find((n) => n.id === nodeId);
    // Not yet decomposed (nothing reachable but sources) → EXPLODE this Object Node into its primitive graph
    // ON DEMAND, from its stored `definition` — so ANY imported object decompiles on click, not just flagged
    // ones. (Replaces the current flow with the decompiled graph — do it on a freshly-imported object.)
    if (hideSet.size === 0 && dockSet.size === 0) {
      const defText = (start?.data as FlowNodeData | undefined)?.params?.definition;
      if (typeof defText === "string" && defText) {
        try {
          const pobj = JSON.parse(defText) as ParametricObjectFile;
          // A PIPELINE / FLOW object explodes into its OPERATION nodes (inset / split / optimise-rect …); a
          // rule-based object (box / circle) explodes into 2D + 3D PRIMITIVE nodes. Pick the mode by content so
          // pipeline-only objects (no box/circle rules) decompile into their operations instead of failing the
          // primitives path.
          const pl = (pobj.geometry as { pipeline?: unknown } | undefined)?.pipeline;
          const hasPipeline = Array.isArray(pl) && pl.length > 0;
          const hasFlow = Array.isArray(pobj.flow?.nodes) && (pobj.flow?.nodes?.length ?? 0) > 0;
          const graph = hasPipeline || hasFlow ? pobjToAttachedFlow(pobj, {}) : pobjToAttachedFlow({ ...pobj, decompile: "primitives" }, {});
          if ((graph.nodes?.length ?? 0) > 2) { importFlowDataRef.current?.(graph); toast.success(`Decompiled "${pobj.meta?.name ?? "object"}"`); }
          else toast.error("Nothing to decompile in this object");
        } catch { toast.error("Couldn't decompile this object"); }
      }
      return;
    }
    const willHide = !((start?.data as FlowNodeData | undefined)?.params._decompileHidden);
    // DOCK the reachable Output Metrics node(s) INSIDE the brief while folded: each becomes a real React Flow
    // CHILD of it (`parentId` + `extent: "parent"`), sitting in the dock strip the brief reserves at its
    // bottom (`_dockH`, see OpNode). Being a child is what makes the pair behave as ONE node — dragging,
    // folding and deleting the brief take the metrics with it — while each metric keeps its own id and its
    // `val-<key>` handles, so existing edges, evaluateFlow and compileFlow are untouched.
    // Only nodes sharing the brief's coordinate frame are docked: a node inside an Arrange group box has
    // parent-RELATIVE coordinates, so mixing frames would fling it across the canvas. Mismatched ones simply
    // stay put — still visible, still wireable. `_dockedFrom` remembers the spot to return to on unfold.
    const briefFrame = start?.parentId ?? null;
    // Height of the brief BEFORE the strip exists — the dock's offset inside it. Measured now, so it is the
    // node's own body; adding the strip grows the node below this line.
    const briefBody = start?.measured?.height ?? 180;
    // A brief that is itself folded to its title bar draws no dock strip, so anything docked into it rides
    // hidden — the same rule the fold chevron applies (see onParamChange) — and reappears when released.
    const briefCollapsed = Boolean((start?.data as FlowNodeData | undefined)?.params._collapsed);
    const briefW = start?.measured?.width ?? 240;
    const dockKids = nodesRef.current.filter((n) => dockSet.has(n.id)
      && (willHide ? (n.parentId ?? null) === briefFrame : n.parentId === nodeId));
    const kidIds = new Set(dockKids.map((n) => n.id));
    // The strip is exactly as tall as what sits in it (+2px so `extent: "parent"` doesn't clamp the last row),
    // and the docked nodes stack flush from the bottom of the brief's body — no gaps, full width. The
    // dock-fit effect re-seats both from measured sizes once React Flow has laid them out.
    const dockH = dockKids.reduce((h, n) => h + (n.measured?.height ?? 110), 2);
    let dockY = briefBody;
    setNodes((ns) => {
      const mapped = ns.map((n) => {
        if (n.id === nodeId) {
          const p = { ...(n.data as FlowNodeData).params, _decompileHidden: willHide, _dockH: dockH };
          if (!willHide || !kidIds.size) delete p._dockH;
          return { ...n, data: { ...n.data, params: p } };
        }
        if (hideSet.has(n.id)) return { ...n, hidden: willHide };
        if (!kidIds.has(n.id)) return n;
        const p = (n.data as FlowNodeData).params;
        if (willHide) {
          const from = (p._dockedFrom as { x: number; y: number } | undefined) ?? { ...n.position };
          const pos = { x: 0, y: dockY };
          dockY += (n.measured?.height ?? 110);
          // `draggable: false` while docked — it is part of the brief's card now, so it must not be nudged
          // out of alignment; the width is pinned to the brief's so the two read as one node.
          return {
            ...n, parentId: nodeId, extent: "parent" as const, hidden: briefCollapsed, draggable: false,
            position: pos, style: { ...(n.style ?? {}), width: briefW },
            data: { ...n.data, params: { ...p, _dockedFrom: from } },
          };
        }
        // Unfold — release the child back to the brief's own frame, at the spot it came from. That frame is
        // the Arrange group box when the brief lives inside one, so re-attach there rather than to the root.
        const from = (p._dockedFrom as { x: number; y: number } | undefined)
          ?? { x: (start?.position.x ?? 0), y: (start?.position.y ?? 0) + briefBody + 12 };
        const rest = { ...p };
        delete rest._dockedFrom;
        const { parentId: _p, extent: _e, ...bare } = n;
        void _p; void _e;
        // Back to its own size and free to drag again (both were pinned while it sat in the dock).
        const style = { ...(n.style ?? {}) } as { width?: number };
        delete style.width;
        const released = { ...bare, hidden: false, draggable: true, style, position: { ...from }, data: { ...n.data, params: rest } } as Node;
        if (briefFrame) { released.parentId = briefFrame; released.extent = "parent"; }
        return released;
      });
      if (!willHide || !kidIds.size) return mapped;
      // React Flow requires a parent to precede its children — move the freshly docked nodes after the brief.
      const kids = mapped.filter((n) => kidIds.has(n.id));
      const others = mapped.filter((n) => !kidIds.has(n.id));
      const at = others.findIndex((n) => n.id === nodeId);
      return at < 0 ? mapped : [...others.slice(0, at + 1), ...kids, ...others.slice(at + 1)];
    });
    setEdges((es) => es.map((e) => (hideSet.has(e.source) || hideSet.has(e.target) ? { ...e, hidden: willHide } : e)));
  }, [setNodes, setEdges]);

  // Group box chevron: fold the box down to its title bar. Children — and any edge touching one — get React
  // Flow's `hidden`, exactly as the decompile toggle above does; the expanded height is stashed on the box so
  // expanding restores it. `hidden` never reaches the serialized graph (buildGraph rebuilds each node from
  // scratch), but `collapsed` is a real param, so a flow saved folded reopens folded.
  const onToggleGroup = useCallback((groupId: string) => {
    // Descendants, not just direct children: a brief inside the box can itself hold DOCKED Output Metrics
    // (decompile dock), and those grandchildren must fold away with the box instead of floating over it.
    const kids = new Set<string>();
    const collect = (pid: string) => {
      for (const n of nodesRef.current) if (n.parentId === pid && !kids.has(n.id)) { kids.add(n.id); collect(n.id); }
    };
    collect(groupId);
    const gParams = (nodesRef.current.find((n) => n.id === groupId)?.data as FlowNodeData | undefined)?.params ?? {};
    const willCollapse = !gParams.collapsed;
    setNodes((ns) => ns.map((n) => {
      if (n.id === groupId) {
        const style = (n.style ?? {}) as { width?: number; height?: number };
        const curH = typeof style.height === "number" ? style.height : n.measured?.height ?? 160;
        const params: Record<string, unknown> = { ...(n.data as FlowNodeData).params, collapsed: willCollapse };
        if (willCollapse) params.expandedHeight = curH;
        const h = willCollapse
          ? GROUP_HEADER
          : (typeof gParams.expandedHeight === "number" ? gParams.expandedHeight : curH);
        return { ...n, data: { ...n.data, params } as FlowNodeData, style: { ...style, height: h } };
      }
      return kids.has(n.id) ? { ...n, hidden: willCollapse } : n;
    }));
    setEdges((es) => es.map((e) => (kids.has(e.source) || kids.has(e.target) ? { ...e, hidden: willCollapse } : e)));
  }, [setNodes, setEdges]);

  // Keep every EXPANDED group box fitted to its children ("docked"). React Flow only knows real node sizes
  // after it has measured them, so a box authored in JSON — or one whose children were collapsed/expanded,
  // changing their heights — is re-fitted here from the measured bounds. Children are parent-relative with
  // `extent: "parent"`, so their offsets never go below the pad and the box only has to cover the far edge.
  // Also stamps `_childCount` for the collapsed title bar. Guarded on a >1px delta so it cannot loop
  // against its own setNodes.
  useEffect(() => {
    const groups = nodes.filter((n) => n.type === "group");
    if (!groups.length) return;
    const upd = new Map<string, { w?: number; h?: number; count: number }>();
    for (const g of groups) {
      const kids = nodes.filter((n) => n.parentId === g.id);
      const params = (g.data as FlowNodeData).params ?? {};
      const cur = (g.style ?? {}) as { width?: number; height?: number };
      let w: number | undefined; let h: number | undefined;
      if (!params.collapsed && kids.length) {
        let maxX = 0; let maxY = 0;
        for (const k of kids) {
          maxX = Math.max(maxX, k.position.x + (k.measured?.width ?? 200));
          maxY = Math.max(maxY, k.position.y + (k.measured?.height ?? 120));
        }
        const wantW = maxX + GROUP_PAD; const wantH = maxY + GROUP_PAD;
        if (Math.abs((cur.width ?? 0) - wantW) > 1) w = wantW;
        if (Math.abs((cur.height ?? 0) - wantH) > 1) h = wantH;
      }
      if (w != null || h != null || params._childCount !== kids.length) upd.set(g.id, { w, h, count: kids.length });
    }
    if (!upd.size) return;
    setNodes((ns) => ns.map((n) => {
      const u = upd.get(n.id);
      if (!u) return n;
      const style = { ...(n.style ?? {}) } as { width?: number; height?: number };
      if (u.w != null) style.width = u.w;
      if (u.h != null) style.height = u.h;
      const d = n.data as FlowNodeData;
      return { ...n, style, data: { ...d, params: { ...d.params, _childCount: u.count } } as FlowNodeData };
    }));
  }, [nodes, setNodes]);

  // Keep every DOCKED Output Metrics node seated in its brief: pinned to the brief's WIDTH and stacked flush
  // under the brief's body, with the reserved strip (`_dockH`) exactly as tall as what sits in it. Positions
  // are set once when folding, but both cards resize afterwards — a parameter row added above, a metric added
  // below — so the pair is re-fitted here from React Flow's measured sizes. `body` is the brief's measured
  // height MINUS the strip it is currently drawing, i.e. its own content. Guarded on a >1px delta so it
  // cannot loop against its own setNodes; a collapsed brief draws no strip and is skipped.
  useEffect(() => {
    const kidsByBrief = new Map<string, Node[]>();
    for (const n of nodes) {
      if (!n.parentId || n.hidden || (n.data as FlowNodeData).params?._dockedFrom == null) continue;
      const l = kidsByBrief.get(n.parentId);
      if (l) l.push(n); else kidsByBrief.set(n.parentId, [n]);
    }
    if (!kidsByBrief.size) return;
    const seat = new Map<string, { y: number; w: number }>();
    const strip = new Map<string, number>();
    for (const [briefId, kids] of kidsByBrief) {
      const brief = nodes.find((n) => n.id === briefId);
      const bp = (brief?.data as FlowNodeData | undefined)?.params;
      if (!brief || !bp || bp._collapsed) continue;
      const w = brief.measured?.width ?? 0;
      const body = (brief.measured?.height ?? 0) - (Number(bp._dockH) || 0);
      if (w <= 0 || body <= 0) continue;
      let y = body;
      let total = 0;
      for (const k of [...kids].sort((a, b) => a.position.y - b.position.y)) {
        const kw = ((k.style ?? {}) as { width?: number }).width ?? 0;
        if (Math.abs(k.position.x) > 1 || Math.abs(k.position.y - y) > 1 || Math.abs(kw - w) > 1) seat.set(k.id, { y, w });
        const h = k.measured?.height ?? 0;
        y += h;
        total += h;
      }
      if (total > 0 && Math.abs((Number(bp._dockH) || 0) - (total + 2)) > 1) strip.set(briefId, total + 2);
    }
    if (!seat.size && !strip.size) return;
    setNodes((ns) => ns.map((n) => {
      const s = seat.get(n.id);
      if (s) return { ...n, position: { x: 0, y: s.y }, style: { ...(n.style ?? {}), width: s.w } };
      const h = strip.get(n.id);
      if (h == null) return n;
      const d = n.data as FlowNodeData;
      return { ...n, data: { ...d, params: { ...d.params, _dockH: h } } as FlowNodeData };
    }));
  }, [nodes, setNodes]);

  // ---- Folded-node edge view -------------------------------------------------------------------------
  // A folded node hides its per-param `valin-*`/`val-*` handles, so every edge anchored to one would
  // vanish with it and the node would look disconnected. Instead, all edges between the same ordered pair
  // collapse into ONE representative edge on the nodes' main handles, tagged with how many it stands for
  // (props→Frame's Length/Breadth/Height becomes a single "×3"). Unfolding restores the real per-param
  // edges. This is strictly a VIEW transform feeding <ReactFlow> — `nodes`/`edges` state is untouched, so
  // compileFlow, the evaluator and buildGraph always see the true graph.
  const foldedIds = useMemo(
    () => new Set(nodes.filter((n) => n.type !== "group" && (n.data as FlowNodeData).params?._collapsed).map((n) => n.id)),
    [nodes],
  );

  // Folded nodes that need a main handle purely to anchor merged edges (see `_foldIn`/`_foldOut` in OpNode).
  const viewNodes = useMemo(() => {
    if (!foldedIds.size) return nodes;
    const inc = new Set<string>(); const outg = new Set<string>();
    for (const e of edges) {
      if (e.hidden) continue;
      if (foldedIds.has(e.target)) inc.add(e.target);
      if (foldedIds.has(e.source)) outg.add(e.source);
    }
    return nodes.map((n) => {
      if (!foldedIds.has(n.id)) return n;
      const needIn = inc.has(n.id); const needOut = outg.has(n.id);
      if (!needIn && !needOut) return n;
      const d = n.data as FlowNodeData;
      return { ...n, data: { ...d, params: { ...d.params, _foldIn: needIn, _foldOut: needOut } } as FlowNodeData };
    });
  }, [nodes, edges, foldedIds]);

  const viewEdges = useMemo(() => {
    if (!foldedIds.size) return edges;
    const out: Edge[] = [];
    const merged = new Map<string, { e: Edge; n: number }>();
    for (const e of edges) {
      const sc = foldedIds.has(e.source); const tc = foldedIds.has(e.target);
      if (!sc && !tc) { out.push(e); continue; }
      // Already hidden by a collapsed GROUP box — stays hidden; don't resurrect it as a merged edge.
      if (e.hidden) continue;
      const key = `${e.source}->${e.target}`;
      const m = merged.get(key);
      if (m) { m.n += 1; continue; }
      merged.set(key, {
        // Merged edges are synthetic (their ids don't exist in `edges`), so make them inert to
        // selection/delete — acting on one couldn't map back to the real edges it stands for.
        e: { ...e, id: `fold:${e.source}->${e.target}`, sourceHandle: sc ? null : e.sourceHandle, targetHandle: tc ? null : e.targetHandle, selectable: false, deletable: false },
        n: 1,
      });
    }
    for (const { e, n } of merged.values()) out.push(n > 1 ? { ...e, label: `×${n}`, style: { ...(e.style ?? {}), strokeWidth: 2 } } : e);
    return out;
  }, [edges, foldedIds]);

  // Render node "Generate": capture ONE view of the 3D scene — framed on whatever Space is wired into
  // the node — send it + the prompt to the Google AI image model, and bake the result (or busy/error
  // state) back onto the node. Stable identity (reads onCapture3dView via a ref) so it can be injected
  // once at node creation.
  const capture3dRef = useRef(props.onCapture3dView);
  capture3dRef.current = props.onCapture3dView;
  const onRunRender = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    // No hardcoded fallback: an empty Model field is the author's mistake to see, not one to paper over
    // with whichever id happened to be current when this was written.
    const model = String(params.model ?? "").trim();
    if (!model) { toast.error("Name a model on the Render node"); return; }
    const prompt = String(params.prompt ?? "");
    const systemPrompt = String(params.systemPrompt ?? "").trim();
    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_resultUrl", undefined);
    try {
      // THE WIRED IMAGES ARE THE ONLY IMAGES. `valin-image` is the picture to work from — a Snapshot's
      // plan, or an Image node's underlay bytes — and `valin-image3d` the same subject in 3D; when both
      // are wired both are sent, plan first, because the plan says what the geometry IS and the 3D shot
      // how it stands. Neither wired is an ERROR. It used to capture the 3D view instead, which meant a
      // run could succeed having sent a picture the author never chose and may not have known existed.
      const asDataUrl = (v: unknown) => (typeof v === "string" && v.startsWith("data:") ? v : "");
      const wired = [asDataUrl(params._image), asDataUrl(params._image3d)].filter(Boolean);
      if (!wired.length) { toast.error("Wire an image into the Render node's Image input"); return; }
      const imageParts = wired.map((url) => ({
        inline_data: {
          mime_type: url.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png",
          data: url.split(",")[1] ?? "",
        },
      }));
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, ...imageParts] }],
          // The system prompt goes in Gemini's OWN systemInstruction field rather than being prepended
          // to the prompt: standing rules stated there are not competing for attention with the per-run
          // instruction. Omitted entirely when blank, so a model that does not accept it is never sent one.
          ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      if (!res.ok) {
        // Surface the API's OWN message, as the Analyse node does. The status alone is not actionable:
        // a 429 is the quota rejection, and only the body says WHICH limit — requests-per-minute (wait
        // a moment and retry) or the daily/project quota (waiting will not help today).
        const errText = await res.text();
        let msg = errText;
        try { msg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
        const hint = res.status === 429 ? " — rate limit or quota; check the model's free-tier limits" : "";
        toast.error(`Render failed (${res.status})${hint}: ${String(msg).slice(0, 160)}`);
        console.error("Render error response:", errText);
        return;
      }
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: { inline_data?: { data?: string }; inlineData?: { data?: string } }) => p.inline_data?.data || p.inlineData?.data);
      if (!imgPart) { toast.error("Model returned no image"); console.error("Render response:", json); return; }
      const inline = imgPart.inline_data ?? imgPart.inlineData;
      const m = inline.mime_type ?? inline.mimeType ?? "image/png";
      const resultUrl = `data:${m};base64,${inline.data}`;
      onParamChange(nodeId, "_resultUrl", resultUrl);
      // ONTO THE CANVAS, REGISTERED ON WHAT WAS SENT. `wired[0]` is the picture the model was given, so
      // the new overlay takes that picture's exact box and the two can be cross-faded — which is the
      // only way to see what the model moved. Every render lands: a run you would have discarded leaves
      // an overlay to delete, and that is the trade for never having to press a second button.
      props.onAddImageOverlay?.(resultUrl, wired[0]);
      toast.success("Render complete");
    } catch (e) {
      toast.error("Render error");
      console.error(e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange, props]);

  // Object Detection action: run Gemini on the imported image, convert each bounding box (normalised
  // 0–1000) into a world-space Space rectangle via the underlay box, and bake them under `_boxes`.
  // The button ignores the return value; the agent bridge's `runDetect` reads it.
  const imageDataRef = useRef(props.imageData);
  imageDataRef.current = props.imageData;
  const overlayImagesRef = useRef(props.overlayImages);
  overlayImagesRef.current = props.overlayImages;
  /** Which picture an ACTION node works on — the mirror of evaluateFlow's `imageOfNode`, for the
   *  buttons. Detect and Auto-Tune run outside the evaluator, so without this they would always read the
   *  base drawing even when their chain hangs off an Image node pointing at an overlay: you would tune
   *  the trace against one picture and get the trace of another. Walks upstream through geometry edges
   *  to the nearest Image node and reads its `id`. */
  const imageForNode = useCallback((nodeId: string) => {
    const seen = new Set<string>([nodeId]);
    const stack = [nodeId];
    while (stack.length) {
      const cur = stack.pop()!;
      const n = nodesRef.current.find((x) => x.id === cur);
      if (n && (n.data as FlowNodeData).tool === "image") {
        const wanted = String((n.data as FlowNodeData).params?.id ?? "").trim();
        return (wanted ? overlayImagesRef.current?.[wanted] : undefined) ?? imageDataRef.current;
      }
      for (const e of edgesRef.current) {
        if (e.target !== cur || seen.has(e.source)) continue;
        if (e.targetHandle && e.targetHandle.startsWith("valin-")) continue;
        seen.add(e.source);
        stack.push(e.source);
      }
    }
    return imageDataRef.current;
  }, []);
  const onRunDetect = useCallback(async (nodeId: string, params: Record<string, unknown>): Promise<DetectRun> => {
    const img = imageForNode(nodeId);
    if (!img) { toast.error("Load an image first (drop a PNG/JPG onto the canvas)."); return { ok: false, error: "no image underlay on the canvas — place the drawing first", detected: 0, labels: [] }; }
    // The node's own key first, then the app's single Gemini key (Preferences ▸ Chat AI). Without the
    // fallback a flow carrying several detection nodes needs the same key pasted into every one of them
    // before Run All can work, which is the same key the rest of the app already holds.
    const apiKey = String(params.api_key ?? "").trim() || (props.aiApiKey ?? "").trim();
    if (!apiKey) { toast.error("Enter a Gemini API key (here, or in Preferences ▸ Chat AI)."); return { ok: false, error: "no Gemini API key on the Object Detection node or in Preferences", detected: 0, labels: [] }; }
    const model = String(params.model ?? "").trim() || (props.aiVisionModel ?? "").trim() || "gemini-robotics-er-2-preview";
    onParamChange(nodeId, "_busy", true);
    try {
      const { mimeType, base64 } = splitDataUrl(img.key);
      // The Shape param IS the ask: Gemini's spatial models return boxes or points natively, so we
      // request the form the flow author wants rather than deriving one from the other.
      const shape = String(params.shape ?? "polygon");
      // The "Add object" rows ARE the ask: every row name goes into ONE prompt, so N targets still cost
      // one call. With no rows the free-text `targets` field is used, exactly as before.
      const rows = detectionObjects(params).map((o) => o.name.trim()).filter(Boolean);
      const perObject = Math.max(1, Math.round(Number(params.maxItems) || 20));
      const dets = await detectObjects({
        model, apiKey, mode: shape === "point" ? "point" : shape === "both" ? "both" : "box",
        targets: rows.length ? rows.join(", ") : String(params.targets ?? ""),
        // Max items is PER OBJECT once rows exist — a shared total would let the first class eat the cap
        // and make the later ones look like the model found nothing.
        maxItems: rows.length ? Math.min(200, perObject * rows.length) : perObject,
        imageBase64: base64, mimeType,
      });
      const { x: ox, y: oy, scale: s } = img.box;
      const toWorld = (nx: number, ny: number) => ({ x: ox + (nx / 1000) * img.w * s, y: oy + (ny / 1000) * img.h * s });
      const boxes = dets
        .filter((d) => Array.isArray(d.box2d))
        .map((d) => {
          const [ymin, xmin, ymax, xmax] = d.box2d!;
          return [toWorld(xmin, ymin), toWorld(xmax, ymin), toWorld(xmax, ymax), toWorld(xmin, ymax)];
        });
      // Points arrive as [y, x] normalised — swap on the way into world coords.
      const points = dets.filter((d) => Array.isArray(d.point)).map((d) => toWorld(d.point![1], d.point![0]));
      // Labels stay in DETECTION order, so index i lines up with box i / point i for the "both" shape.
      const labels = dets.map((d) => d.label);
      onParamChange(nodeId, "_boxes", boxes);
      onParamChange(nodeId, "_points", points);
      onParamChange(nodeId, "_labels", labels);
      // Per-row hit counts + the unclaimed tally, for the node's own readout. The eval does the same
      // split for the endpoints; this is only what the card shows, so a row that matched nothing is
      // visible without opening the wiring.
      const objRows = detectionObjects(params);
      let rowCounts: Record<string, number> | undefined;
      let unmatched: number | undefined;
      if (objRows.length) {
        const hits = (l: string, n: string) => {
          const a = l.toLowerCase().trim(), b = n.toLowerCase().trim();
          return !!a && !!b && (a.includes(b) || b.includes(a));
        };
        const counts: Record<string, number> = {};
        const claimed = new Set<number>();
        for (const o of objRows) {
          const idx = labels.map((_, i) => i).filter((i) => o.name.trim() && hits(labels[i], o.name));
          idx.forEach((i) => claimed.add(i));
          counts[o.id] = idx.length;
        }
        rowCounts = counts;
        unmatched = labels.length - claimed.size;
        onParamChange(nodeId, "_rowCounts", counts);
        onParamChange(nodeId, "_unmatched", unmatched);
      }
      if (dets.length === 0) toast.warning("No objects detected — try a broader target or a different model.");
      else toast.success(`Detected ${dets.length} object${dets.length === 1 ? "" : "s"}`);
      // The per-row tally is also the RETURN value: the agent-facing `run_detect` awaits this call, and a
      // baked param can't be read back reliably in the same tick (onParamChange is a state update).
      return {
        ok: true, detected: dets.length, labels,
        ...(rowCounts ? { rows: objRows.map((o) => ({ name: o.name, found: rowCounts![o.id] ?? 0 })) } : {}),
        ...(unmatched === undefined ? {} : { unmatched }),
      };
    } catch (e) {
      const msg = (e as Error)?.message ?? "unknown error";
      toast.error(`Object detection failed: ${msg}`);
      console.error(e);
      return { ok: false, error: msg, detected: 0, labels: [] };
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange, props]);

  // Auto-Tune action (Vectorisation): coordinate-descent over the tracing parameters against the loaded
  // underlay — every candidate runs the REAL vectorise → faces pipeline and is scored on closed spaces
  // found (minus noise faces / open ends). Progress streams into the node's `_tuneStatus` line; the best
  // combo is baked back into the node's sliders, so the live preview lands on the winning trace.
  // RUN ALL — press Detect on every Object Detection node, in order. SEQUENTIAL rather than parallel on
  // purpose: each press is a billed call against the same picture and the provider rate-limits them, so a
  // serial run both behaves and lets the status line name the family currently in flight. Progress is baked
  // onto the Input Properties node that asked, which is what lets the same line appear on the node and in
  // the Properties tab without either one owning it.
  const onRunAllDetect = useCallback(async (nodeId: string) => {
    const dets = nodesRef.current.filter((n) => (n.data as FlowNodeData).tool === "object-detection");
    if (!dets.length) { toast.error("This flow has no Object Detection node."); return; }
    const say = (msg: string) => { if (nodeId) onParamChange(nodeId, "_runStatus", msg); };
    if (nodeId) onParamChange(nodeId, "_runBusy", true);
    let found = 0;
    const failures: string[] = [];
    for (let i = 0; i < dets.length; i++) {
      const d = dets[i].data as FlowNodeData;
      const label = String(d.params.nodeLabel ?? "").trim() || dets[i].id;
      say(`Detecting ${i + 1}/${dets.length} — ${label}…`);
      try {
        const res = await onRunDetect(dets[i].id, { ...d.params });
        if (res.ok) found += res.detected; else failures.push(label);
      } catch { failures.push(label); }
    }
    if (nodeId) onParamChange(nodeId, "_runBusy", false);
    say(failures.length
      ? `✔ ${found} detected · failed: ${failures.join(", ")}`
      : `✔ ${found} detected across ${dets.length} node${dets.length === 1 ? "" : "s"}`);
    if (!failures.length) toast.success(`Detected ${found} item${found === 1 ? "" : "s"} across ${dets.length} node${dets.length === 1 ? "" : "s"}`);
  }, [onParamChange, onRunDetect]);

  /** RUN + APPLY — the twin of Run-detect-all, for a flow that COMPUTES onto the plan rather than drawing
   *  a new one. One press commits every Set Object Param node in the graph as ONE undoable edit each.
   *
   *  It waits for the graph to catch up first, and that wait is the whole point of the button. The press
   *  bumped a run counter, a Math Engine gated on that counter only now does the expensive work, and the
   *  writes are read off the PREVIEW — so applying in the same tick would commit the previous evaluation,
   *  which on a first press is the one where the solve had not run at all. */
  const onRunAllApply = useCallback(async (nodeId: string) => {
    const apply = props.onSetObjectParams;
    const setters = nodesRef.current.filter((n) => (n.data as FlowNodeData).tool === "set-object-param");
    if (!setters.length) { toast.error("This flow has no Set Object Param node to apply."); return; }
    if (!apply) return;
    const say = (msg: string) => { if (nodeId) onParamChange(nodeId, "_applyStatus", msg); };
    if (nodeId) onParamChange(nodeId, "_applyBusy", true);
    say("Solving…");

    // A TIMER, not requestAnimationFrame: rAF does not fire while the tab is hidden or the panel is
    // backgrounded, and the wait would never finish — the press would silently do nothing.
    const frame = () => new Promise<void>((r) => setTimeout(r, 25));
    const writesOf = (id: string) => {
      const vals = previewRef.current.find((it) => it.nodeId === id)?.values as { writes?: unknown; paramKey?: unknown } | undefined;
      const key = typeof vals?.paramKey === "string" ? vals.paramKey : "";
      let w: { kind?: "space" | "node" | "segment"; i: number; v: number | string }[] = [];
      try { w = JSON.parse(String(vals?.writes ?? "[]")) as typeof w; } catch { w = []; }
      return { key, w };
    };
    // Up to ~1 s for the re-evaluation to land. Proceeding anyway after that is deliberate: a flow whose
    // setters legitimately have nothing to write must still report "nothing to write", not hang.
    for (let i = 0; i < 40; i++) {   // ~1 s
      await frame();
      if (setters.some((n) => writesOf(n.id).w.length > 0)) break;
    }

    // ONE call with every writer's assignments. Applying them one at a time would have each edit built
    // from the same state snapshot, so the last writer would discard the rest.
    const batch: { paramKey: string; writes: { kind?: "space" | "node" | "segment"; i: number; v: number | string }[] }[] = [];
    const keys: string[] = [];
    for (const n of setters) {
      const { key, w } = writesOf(n.id);
      if (!key || !w.length) continue;
      batch.push({ paramKey: key, writes: w });
      keys.push(key);
      onParamChange(n.id, "_applyStatus", `✔ ${w.length} value${w.length === 1 ? "" : "s"} queued`);
    }
    const res = batch.length ? apply(batch) : { written: 0, skipped: 0 };
    const written = res.written, skipped = res.skipped;
    if (nodeId) onParamChange(nodeId, "_applyBusy", false);
    if (!written) {
      say("Nothing to write — check the assignment matrices");
      toast.error("Nothing to write — check the assignment matrices and the Host setting");
      return;
    }
    say(`✔ ${written} value${written === 1 ? "" : "s"} written · ${keys.join(", ")}${skipped ? ` · ${skipped} skipped` : ""}`);
    toast.success(`Wrote ${written} value${written === 1 ? "" : "s"} onto the canvas`);
  }, [onParamChange, props.onSetObjectParams]);

  const onRunVectorTune = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const img = imageForNode(nodeId);
    if (!img) { toast.error("Load an image first (drop a PNG/JPG onto the canvas) — the Image node feeds the tuner."); return; }
    const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    // Same param→VectorizeParams mapping the flow eval uses, so tuning starts from what's previewing.
    const base: VectorizeParams = {
      colorMode: (typeof params.colorMode === "string" ? params.colorMode : "black") as VectorizeColorMode,
      tolerance: n(params.tolerance, 50),
      despeckle: Math.max(0, n(params.despeckle, 0)),
      dilate: Math.max(1, Math.round(n(params.dilate, 3))),
      spurLength: Math.max(0, Math.round(n(params.spurLength, 0))),
      simplifyEpsilon: n(params.simplifyEpsilon, 1.5),
      minLength: n(params.minLength, 30),
      snapTolerance: n(params.snapTolerance, 6),
      connectGap: Math.max(0, n(params.connectGap, 0)),
      mergeAngle: Math.max(0, n(params.mergeAngle, 0)),
      orthoSnap: !!params.orthoSnap,
      orthoTol: n(params.orthoTol, 10),
    };
    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_tuneStatus", "starting…");
    try {
      const res = await tuneVectorise({
        img, ppm: props.pixelsPerMeter, base,
        minAreaM2: Math.max(0, n(params.tuneMinArea, 1)),
        tuneColour: params.tuneColour === true,
        pathEdges: props.pathEdges ?? [],
        onProgress: (msg, frac) => onParamChange(nodeId, "_tuneStatus", `${Math.round(frac * 100)}% · ${msg}`),
      });
      for (const [k, v] of Object.entries({
        colorMode: res.params.colorMode, tolerance: res.params.tolerance, despeckle: res.params.despeckle,
        dilate: res.params.dilate, spurLength: res.params.spurLength, snapTolerance: res.params.snapTolerance,
        connectGap: res.params.connectGap,
      })) onParamChange(nodeId, k, v);
      onParamChange(nodeId, "_tuneStatus", `✔ ${res.spaces} space${res.spaces === 1 ? "" : "s"} · ${res.openEnds} open ends · ${res.lines} lines · score ${res.score.toFixed(1)} (${res.tried} runs)`);
      if (res.spaces === 0) toast.warning("Auto-tune found no closed spaces — try Tune colour (the drawing's line colour may differ) or lower Min space area.");
      else toast.success(`Auto-tune done — ${res.spaces} space${res.spaces === 1 ? "" : "s"} found`);
    } catch (e) {
      onParamChange(nodeId, "_tuneStatus", "✖ tuning failed");
      toast.error("Auto-tune failed");
      console.error("Vectorise auto-tune failed:", e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange, props.pixelsPerMeter, props.pathEdges]);

  // AUTO-TUNE ALL — the same sweep, pressed from the BRIEF instead of from the Vectorisation node. The
  // twin of Run ▸ detect all, and it exists for the same reason: when a flow puts the whole tuning set on
  // one Input Properties node, the sliders that decide the trace are no longer on the node that performs
  // it, so a button that bakes its winners onto the vectorise node would write them somewhere nothing
  // reads. This reads the BRIEF's rows as the starting point and writes the winners straight back into
  // those rows, which is what the wires actually carry.
  const onRunAllTune = useCallback(async (nodeId: string) => {
    const vecs = nodesRef.current.filter((n) => (n.data as FlowNodeData).tool === "vectorise");
    if (!vecs.length) { toast.error("This flow has no Vectorisation node."); return; }
    const brief = nodesRef.current.find((n) => n.id === nodeId);
    const rows = inputProps((brief?.data as FlowNodeData | undefined)?.params ?? {});
    if (!rows.length) { toast.error("This brief has no parameters to tune."); return; }
    const img = imageForNode(vecs[0].id);
    if (!img) { toast.error("Load an image first (drop a PNG/JPG onto the canvas) — the Image node feeds the tuner."); return; }
    // The rows ARE the parameters: a brief row is named for the vectorise key it drives, so the bag reads
    // exactly like the node's own params and the mapping below is the one the eval and the tuner share.
    const bag: Record<string, unknown> = Object.fromEntries(rows.map((r) => [r.id, r.value]));
    const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const base: VectorizeParams = {
      colorMode: (typeof bag.colorMode === "string" && bag.colorMode ? bag.colorMode : "black") as VectorizeColorMode,
      tolerance: n(bag.tolerance, 50),
      despeckle: Math.max(0, n(bag.despeckle, 0)),
      dilate: Math.max(1, Math.round(n(bag.dilate, 3))),
      spurLength: Math.max(0, Math.round(n(bag.spurLength, 0))),
      simplifyEpsilon: n(bag.simplifyEpsilon, 1.5),
      minLength: n(bag.minLength, 30),
      snapTolerance: n(bag.snapTolerance, 6),
      connectGap: Math.max(0, n(bag.connectGap, 0)),
      mergeAngle: Math.max(0, n(bag.mergeAngle, 0)),
      orthoSnap: bag.orthoSnap === true || Number(bag.orthoSnap) === 1,
      orthoTol: n(bag.orthoTol, 10),
    };
    onParamChange(nodeId, "_tuneBusy", true);
    onParamChange(nodeId, "_tuneStatus", "starting…");
    try {
      const res = await tuneVectorise({
        img, ppm: props.pixelsPerMeter, base,
        minAreaM2: Math.max(0, n(bag.tuneMinArea, 1)),
        tuneColour: bag.tuneColour === true || Number(bag.tuneColour) === 1,
        pathEdges: props.pathEdges ?? [],
        onProgress: (msg, frac) => onParamChange(nodeId, "_tuneStatus", `${Math.round(frac * 100)}% · ${msg}`),
      });
      // Exactly the keys the single-node tuner bakes — the sweep does not vary the others, and writing
      // back a value it never moved would look like a decision it did not make.
      const won: Record<string, unknown> = {
        colorMode: res.params.colorMode, tolerance: res.params.tolerance, despeckle: res.params.despeckle,
        dilate: res.params.dilate, spurLength: res.params.spurLength, snapTolerance: res.params.snapTolerance,
        connectGap: res.params.connectGap,
      };
      onParamChange(nodeId, "props", rows.map((r) => (r.id in won ? { ...r, value: won[r.id] as never } : r)));
      onParamChange(nodeId, "_tuneStatus", `✔ ${res.spaces} space${res.spaces === 1 ? "" : "s"} · ${res.openEnds} open ends · ${res.lines} lines · score ${res.score.toFixed(1)} (${res.tried} runs)`);
      if (res.spaces === 0) toast.warning("Auto-tune found no closed spaces — try Tune colour (the drawing's line colour may differ) or lower Min space area.");
      else toast.success(`Auto-tune done — ${res.spaces} space${res.spaces === 1 ? "" : "s"} found`);
    } catch (e) {
      onParamChange(nodeId, "_tuneStatus", "✖ tuning failed");
      toast.error("Auto-tune failed");
      console.error("Vectorise auto-tune (from brief) failed:", e);
    } finally {
      onParamChange(nodeId, "_tuneBusy", false);
    }
  }, [onParamChange, imageForNode, props.pixelsPerMeter, props.pathEdges]);

  /** Save a Blob to disk under `name` — the shared tail of both export actions. */
  const downloadBlob = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, []);

  /** The node feeding an export sink, plus the frame its geometry is in. Exports read the SOURCE's live
   *  preview (an export node evaluates to nothing of its own), so this is the whole resolution step. */
  const exportSourceOf = useCallback((nodeId: string): { id: string; label: string; tool: string; params: Record<string, unknown> } | null => {
    const e = edgesRef.current.find((ed) => ed.target === nodeId);
    const src = e ? nodesRef.current.find((n) => n.id === e.source) : undefined;
    if (!src) return null;
    const d = src.data as FlowNodeData;
    const named = typeof d.params.name === "string" && d.params.name.trim() ? d.params.name.trim() : "";
    return { id: src.id, label: named || FLOW_TOOLS[d.tool]?.label || d.tool, tool: d.tool, params: d.params };
  }, []);

  // Export DXF: rebuild the wired node's pieces from the live preview and write an R12 DXF. A 2D Render
  // source contributes one PIECE PER ROW (`${id}__${rowId}` preview items), so the row's layer, colour and
  // kind survive into the drawing; any other 2D node contributes its single item. Coordinates leave in the
  // node's chosen unit, measured from the flow anchor — the same frame the preview items were built in.
  const onExportDxf = useCallback((nodeId: string, params: Record<string, unknown>) => {
    const src = exportSourceOf(nodeId);
    if (!src) { toast.error("Nothing wired in — connect a 2D node (e.g. 2D Render) to the Export DXF input."); return; }
    // Row metadata by row id, so a Render row's kind/layer/colour reach the writer (a Circle row can then
    // go out as a true CIRCLE entity instead of the 64-gon the preview draws).
    const rows = new Map<string, RenderPrim>(src.tool === "render-2d" ? renderPrims(src.params).map((r) => [r.id, r] as const) : []);
    const pieces: FlowDxfPiece[] = [];
    for (const it of previewRef.current) {
      if (it.nodeId !== src.id && !it.nodeId.startsWith(`${src.id}__`)) continue;
      if (!it.polygons.length) continue;
      const row = rows.get(it.nodeId.slice(src.id.length + 2));
      pieces.push({
        polygons: it.polygons,
        color: row?.color ?? it.color,
        layer: row?.layer ?? it.layer,
        kind: row?.kind ?? "polygon",
        name: row?.name?.trim() || src.label,
      });
    }
    if (!pieces.length) { toast.error(`${src.label} has no geometry to export — check the flow previews first.`); return; }
    const anchor = nodesRef.current.some((n) => (n.data as FlowNodeData).tool === "point") ? { x: 0, y: 0 } : (props.createAnchor ?? { x: 0, y: 0 });
    const units = (typeof params.units === "string" ? params.units : "m") as DxfUnit;
    const res = flowPiecesToDxf(pieces, props.pixelsPerMeter, anchor, {
      units: DXF_UNIT_SCALE[units] ? units : "m",
      yUp: params.yUp !== false,
      layerMode: params.layerMode === "node" || params.layerMode === "single" ? params.layerMode : "row",
      layerName: typeof params.layerName === "string" && params.layerName.trim() ? params.layerName.trim() : "FLOW",
      circleEntities: params.circleEntities !== false,
    });
    const base = (typeof params.fileName === "string" && params.fileName.trim() ? params.fileName.trim() : "flow-export").replace(/\.dxf$/i, "");
    downloadBlob(new Blob([res.dxf], { type: "application/dxf" }), `${base}.dxf`);
    onParamChange(nodeId, "_exportStatus", `✔ ${res.polylines} polyline${res.polylines === 1 ? "" : "s"}${res.circles ? ` · ${res.circles} circle${res.circles === 1 ? "" : "s"}` : ""} · ${res.layers.length} layer${res.layers.length === 1 ? "" : "s"}`);
    toast.success(`Exported ${base}.dxf`);
  }, [exportSourceOf, downloadBlob, onParamChange, props.createAnchor, props.pixelsPerMeter]);

  // Export to Canvas: the third route from flow to plan. Live materialisation writes tracked, flow-owned
  // geometry for the WHOLE graph; Run replays recipe OPERATIONS against a selected Space. This one takes the
  // polygons the flow has ALREADY computed and writes them as canvas geometry — which is the only way nodes
  // with no recipe equivalent (Boolean 2D, Mitered Join, Graph to Openings, a Math-Engine face list) can land
  // on the plan at all. Piece resolution is identical to Export DXF (a 2D Render source contributes one piece
  // per row via its `${id}__${rowId}` preview items), so the two sinks always write the same drawing — one to
  // a file, one to the canvas.
  //
  // Shared by BOTH of the node's outputs: the eye's live preview (host-owned, tracks the flow) and the Commit
  // button (handed over to the drawing). Returns null when there is nothing to write; `reason` is only worth
  // surfacing for the button, since the preview effect runs constantly and must stay silent.
  const exportCanvasPayload = useCallback((nodeId: string, params: Record<string, unknown>): ExportCanvasRequest | { reason: string } => {
    const src = exportSourceOf(nodeId);
    if (!src) return { reason: "Nothing wired in — connect a 2D node (e.g. 2D Render) to the Export to Canvas input." };
    const rows = new Map<string, RenderPrim>(src.tool === "render-2d" ? renderPrims(src.params).map((r) => [r.id, r] as const) : []);
    const pieces: ExportCanvasPiece[] = [];
    for (const it of previewRef.current) {
      if (it.nodeId !== src.id && !it.nodeId.startsWith(`${src.id}__`)) continue;
      if (!it.polygons.length) continue;
      const row = rows.get(it.nodeId.slice(src.id.length + 2));
      pieces.push({
        polygons: it.polygons,
        color: row?.color ?? it.color,
        layer: row?.layer ?? it.layer,
        name: row?.name?.trim() || src.label,
        // Open geometry (skeleton centrelines, graph paths, dimension lines) is an open RUN: the host must
        // not close it back to its first point, and it has no interior to become a Space. A 2D Render row
        // says so with kind "stroke".
        openPath: row ? row.kind === "stroke" : it.openPath === true,
        // A closed ring the user chose not to fill ("outlined") stamps as its boundary segments only —
        // still closed, just no Space. Distinct from `openPath`, which also drops the closing edge.
        outlineOnly: row ? row.fillMode === "outlined" : false,
      });
    }
    if (!pieces.length) return { reason: `${src.label} has no geometry to write — check the flow previews first.` };
    return {
      pieces,
      layerMode: params.layerMode === "row" ? "row" : "single",
      layerName: typeof params.layerName === "string" && params.layerName.trim() ? params.layerName.trim() : "Flow Export",
      mode: params.mode === "append" ? "append" : "replace",
      stampKey: nodeId,
      makeSpaces: params.makeSpaces !== false,
      makeWalls: params.makeWalls !== false,
      thickness: typeof params.thickness === "number" && params.thickness > 0 ? params.thickness : 0.1,
      showLabel: params.showLabel === true,
    };
  }, [exportSourceOf]);

  // Commit: hand the previewed geometry over to the drawing as ordinary canvas data (an undoable step, no
  // longer flow-owned). The host also drops this node's live preview so the two copies don't overlap.
  const onExportToCanvas = useCallback((nodeId: string, params: Record<string, unknown>) => {
    const stamp = props.onExportToCanvas;
    if (!stamp) return;
    const req = exportCanvasPayload(nodeId, params);
    if ("reason" in req) { toast.error(req.reason); return; }
    const res = stamp(req);
    onParamChange(nodeId, "_exportStatus", `✔ committed ${res.spaces} space${res.spaces === 1 ? "" : "s"} · ${res.segments} segment${res.segments === 1 ? "" : "s"} · ${res.layers} layer${res.layers === 1 ? "" : "s"}`);
    toast.success(`Committed ${res.spaces + res.segments} item${res.spaces + res.segments === 1 ? "" : "s"} to the canvas`);
  }, [exportCanvasPayload, onParamChange, props.onExportToCanvas]);

  // Import: load the plan this node computed. Its JSON is an evaluated VALUE rather than a param, so it
  // is read from the live preview — `previewRef` because the preview is built further down the file and
  // this callback is assembled before it.
  //
  // TWO NODES REACH HERE. A Canvas Encoder publishes the document under the fixed key `json`; an Output
  // Metrics node collects it into whichever SLOT the flow author wired it to, so there is no key to look
  // up — the plan is found by its shape instead. `json` is still tried first, so the encoder's own button
  // never depends on the sniff.
  const onImportPlan = useCallback((nodeId: string) => {
    const load = props.onImportPlan;
    if (!load) return;
    const values = previewRef.current.find((it) => it.nodeId === nodeId)?.values;
    const planJson = isPlanDocument(values?.json) ? values.json : Object.values(values ?? {}).find(isPlanDocument);
    if (typeof planJson !== "string" || !planJson) { toast.error("Nothing to import — the encoder produced no plan"); return; }
    load(planJson);
    onParamChange(nodeId, "_importStatus", `✔ imported ${(planJson.length / 1024).toFixed(1)} kB`);
  }, [onParamChange, props.onImportPlan]);

  // Apply: hand the computed parameter writes to the host as ONE undoable edit. The writes were worked out
  // during evaluation (evaluateFlow's set-object-param kernel) and read back off the preview item here —
  // deliberately, so the button applies exactly what the node has been showing, not a fresh recomputation
  // that could differ from what the user just read.
  const onSetObjectParams = useCallback((nodeId: string, _params: Record<string, unknown>) => {
    const apply = props.onSetObjectParams;
    if (!apply) return;
    const vals = previewRef.current.find((it) => it.nodeId === nodeId)?.values as
      { writes?: unknown; paramKey?: unknown } | undefined;
    const key = typeof vals?.paramKey === "string" ? vals.paramKey : "";
    let writes: { kind?: "space" | "node" | "segment"; i: number; v: number | string }[] = [];
    try { writes = JSON.parse(String(vals?.writes ?? "[]")) as typeof writes; } catch { writes = []; }
    if (!key) { toast.error("Set a Parameter key first"); return; }
    if (!writes.length) { toast.error("Nothing to write — check the assignment matrix and the value map"); return; }
    const res = apply([{ paramKey: key, writes }]);
    onParamChange(nodeId, "_applyStatus", `✔ wrote ${key} on ${res.written} object${res.written === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} skipped` : ""}`);
    toast.success(`Wrote ${key} on ${res.written} object${res.written === 1 ? "" : "s"}`);
  }, [onParamChange, props.onSetObjectParams]);

  // Export 3D: the solids the viewport built for the wired node (`masses3D`, resolved host-side from the 3D
  // Render rows and the 3D primitive chain) are rebuilt as a THREE group and written through one of three's
  // own exporters. Async — the exporter module is imported on demand, so no format is in the main bundle.
  const onExport3d = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const src = exportSourceOf(nodeId);
    if (!src) { toast.error("Nothing wired in — connect a 3D node (e.g. 3D Render) to the Export 3D input."); return; }
    const masses = (masses3DRef.current ?? []).filter((m) => m.id === src.id || m.id.startsWith(`${src.id}__`));
    if (!masses.length) { toast.error(`${src.label} has no 3D geometry to export — check the 3D view first.`); return; }
    const format = (typeof params.format === "string" && params.format in MESH3D_FORMATS ? params.format : "glb") as Mesh3DFormat;
    const base = (typeof params.fileName === "string" && params.fileName.trim() ? params.fileName.trim() : "flow-export").replace(/\.(glb|gltf|obj|stl|ply)$/i, "");
    onParamChange(nodeId, "_busy", true);
    try {
      const { blob, meshes, triangles } = await exportMassesToBlob(masses, format, {
        units: typeof params.units === "string" && MESH3D_UNIT_SCALE[params.units] ? params.units : "m",
        axis: params.axis === "y-up" ? "y-up" : "z-up",
      });
      downloadBlob(blob, `${base}.${MESH3D_FORMATS[format].ext}`);
      onParamChange(nodeId, "_exportStatus", `✔ ${meshes} solid${meshes === 1 ? "" : "s"} · ${Math.round(triangles)} triangles`);
      toast.success(`Exported ${base}.${MESH3D_FORMATS[format].ext}`);
    } catch (e) {
      onParamChange(nodeId, "_exportStatus", "✖ export failed");
      toast.error(`3D export failed: ${(e as Error)?.message ?? "unknown error"}`);
      console.error("Flow 3D export failed:", e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [exportSourceOf, downloadBlob, onParamChange]);

  // Analyse action: send a media file (PDF / image / audio / video) to Gemini with a system prompt and
  // bake the model's text answer onto the node. Media source: the File input (a data URL, baked under
  // `_file` from a File Upload's val-data → inlined), a YouTube link in the Url field (passed via
  // file_data.file_uri — Gemini ingests it server-side), or any other URL (fetched + inlined).
  const onRunAnalyse = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    const model = String(params.model ?? "gemini-2.5-flash").trim() || "gemini-2.5-flash";
    const systemPrompt = String(params.systemPrompt ?? "");
    const fileData = String(params._file ?? "").trim();  // a data URL wired from File Upload's val-data
    const url = String(params.url ?? "").trim();          // an http(s) link (field or wired Url input)
    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_result", undefined);
    try {
      // Build the Gemini media part (https://ai.google.dev/gemini-api/docs). Three source kinds:
      //  1) File input = a data URL (data:<mime>;base64,…) → inline_data with the decoded bytes.
      //  2) A YouTube link → file_data.file_uri: Gemini ingests public YouTube URLs server-side, so we
      //     pass the URL straight through (no client fetch — YouTube blocks that, and it's video anyway).
      //  3) Any other http(s) URL → fetch the bytes in the browser and inline them (subject to CORS/COEP).
      const isYouTube = /(?:youtube\.com|youtu\.be)\//i.test(url);
      let mediaPart: Record<string, unknown> | null = null;
      if (fileData.startsWith("data:")) {
        const m = fileData.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
        if (!m) { toast.error("File input isn't a valid data URL"); return; }
        const mime = m[1] || "application/octet-stream";
        const base64 = m[2] ? m[3] : btoa(decodeURIComponent(m[3]));
        mediaPart = { inline_data: { mime_type: mime, data: base64 } };
      } else if (isYouTube) {
        mediaPart = { file_data: { file_uri: url } };
      } else if (url) {
        const resp = await fetch(url);
        if (!resp.ok) { toast.error(`Couldn't fetch URL (${resp.status})`); return; }
        const blob = await resp.blob();
        const mime = blob.type || "application/octet-stream";
        const base64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        mediaPart = { inline_data: { mime_type: mime, data: base64 } };
      } else {
        toast.error("Wire a File (data URL) or enter a Url to analyse");
        return;
      }
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }, mediaPart] }],
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        let msg = errText;
        try { msg = JSON.parse(errText)?.error?.message ?? errText; } catch { /* keep raw */ }
        toast.error(`Analyse failed (${res.status}): ${String(msg).slice(0, 160)}`);
        console.error("Analyse error response:", errText);
        return;
      }
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
      if (!text) { toast.error("Model returned no text"); console.error("Analyse response:", json); return; }
      onParamChange(nodeId, "_result", text);
      toast.success("Analysis complete");
    } catch (e) {
      toast.error(`Analyse error: ${(e as Error)?.message ?? "unknown"}`);
      console.error(e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange, props]);

  // Agent action: analyse the Space wired into the node and bake parameter suggestions into the nodes
  // connected to it, optionally refining over several rounds by LOOKING at what it drew (see the loop).
  // Model calls happen only here — evaluateFlow stays pure and synchronous, so once the values are baked
  // the graph re-runs identically forever and the agent node can be deleted without losing them.
  // Targets come off the live graph via refs, so this callback depends only on onParamChange + ppm/key and
  // can't churn `nodeCb` (which would rewrite every node's data on each graph edit).
  const captureCanvasRef = useRef(props.onCaptureCanvas);
  captureCanvasRef.current = props.onCaptureCanvas;
  const onRunAgent = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    // Key + model come from the Chat AI preferences, not from the node — one setting for every model call.
    const apiKey = (props.aiApiKey ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key in the Chat AI settings"); return; }
    const model = (props.aiModel ?? "").trim() || "gemini-3.8-flash";
    // The geometry this agent reasons about: whatever arrived on its own input (Space → Agent passes it
    // through), else the footprint of any node it's wired to in either direction (see agentGeometryPolyOf).
    // A Space wired in gives an area brief; a Node or Segment has none — that's fine, the agent tunes its
    // targets from the prompt + their schemas (an empty context). So a missing poly is NOT an error here.
    const poly = previewRef.current.find((it) => it.nodeId === nodeId)?.polygons.find((p) => p.length >= 3)
      ?? agentGeometryPolyOf(nodeId, edgesRef.current, previewRef.current, sourcePolysRef.current);

    // GENERATOR MODE: when the agent's output is wired into a node's value INPUT (Agent → Network valin-graph),
    // it AUTHORS that input's whole JSON payload — the "no algorithm, the agent invents the geometry" path —
    // instead of tuning params. The payload is baked as the agent's `val-<inputKey>` output; the same vision
    // critique loop refines it against the drawing. Takes priority: a gen wire is an explicit request to produce.
    const genTargets = agentGenTargetsOf(nodeId, nodesRef.current, edgesRef.current);
    if (genTargets.length) {
      const anchor = nodesRef.current.some((n) => (n.data as FlowNodeData).tool === "point") ? { x: 0, y: 0 } : (props.createAnchor ?? { x: 0, y: 0 });
      // Normalise to a top-left [0..W] frame the model respects; `offset` maps its output back to the
      // anchor-relative frame Network actually draws in (createAnchor = the Space centroid, so it's negative).
      const { boundary, offset } = normalizeBoundaryFrame(agentBoundaryMetres(poly ?? [], anchor, props.pixelsPerMeter));
      const instructions = String(params.instructions ?? "");
      const prompt = String(params.prompt ?? "");
      const rounds = Math.max(1, Math.min(5, Math.round(Number(params.rounds) || 1)));
      const context = agentContextOf(poly ?? [], props.pixelsPerMeter);
      // A fingerprint of the generated nodes' preview geometry, so the wait below can tell when the NEW payload
      // has actually been evaluated (not just wait a fixed, race-prone number of frames).
      const previewSig = (ids: string[]): string => ids.map((nid) => {
        const it = previewRef.current.find((i) => i.nodeId === nid);
        if (!it) return `${nid}:x`;
        const total = it.polygons.reduce((a, p) => a + p.length, 0);
        const p0 = it.polygons[0]?.[0];
        return `${nid}:${it.polygons.length}:${total}:${p0 ? `${Math.round(p0.x)},${Math.round(p0.y)}` : "-"}`;
      }).join("|");
      // Wait until the baked payload is BOTH computed AND painted before snapshotting. The host canvas is fed
      // through an 80 ms DEBOUNCED onPreview (see the effect ~L4380), so a fixed frame count races it and the
      // reviewer photographs a blank stage. Poll our own previewRef for the change (compute), then wait out the
      // debounce + host re-render + Konva repaint (paint).
      const waitForAgentPaint = async (ids: string[], beforeSig: string): Promise<void> => {
        for (let i = 0; i < 180; i++) { // ~3 s cap — the compute is usually 1–3 frames
          if (previewSig(ids) !== beforeSig) break;
          await new Promise<void>((r) => requestAnimationFrame(r));
        }
        await new Promise<void>((r) => window.setTimeout(r, 160)); // clear the 80 ms onPreview debounce (+ margin)
        await settleCanvas(6); // host render + Konva batchDraw
      };
      // Bake each generated payload as a TEXT prop keyed by the target input — evaluateFlow republishes it as
      // val-<inputKey>, which the wired valin-<inputKey> then resolves (by name, even with no source handle).
      const bakeGen = (byKey: Map<string, string>) => {
        onParamChange(nodeId, "props", [...byKey.entries()].map(([id, value]) => ({
          id, name: genTargets.find((g) => g.inputKey === id)?.fieldLabel ?? id,
          type: "text", value, min: 0, max: 10, step: 1, options: [] as string[],
        })));
      };
      onParamChange(nodeId, "_busy", true);
      onParamChange(nodeId, "_critique", undefined);
      onParamChange(nodeId, "_snapshot", undefined);
      try {
        let critique = "";
        let rationale = "";
        let stoppedBecause = "";
        const outByKey = new Map<string, string>();
        for (let round = 1; round <= rounds; round++) {
          const label = rounds > 1 ? `round ${round}/${rounds} · ` : "";
          onParamChange(nodeId, "_status", `${label}generating for ${genTargets.length} node${genTargets.length === 1 ? "" : "s"}…`);
          for (const gt of genTargets) {
            const res = await runAgentGenerate({ apiKey, model, instructions, prompt, boundary, offset, target: gt, critique, round, rounds });
            outByKey.set(gt.inputKey, res.payload);
            rationale = res.rationale || rationale;
          }
          const beforeSig = previewSig(genTargets.map((g) => g.nodeId));
          bakeGen(outByKey);
          if (round === rounds) { stoppedBecause = rounds > 1 ? "round limit reached" : ""; break; }
          onParamChange(nodeId, "_status", `${label}drawing…`);
          await waitForAgentPaint(genTargets.map((g) => g.nodeId), beforeSig);
          const snap = captureCanvasRef.current?.() ?? null;
          if (!snap?.dataUrl) { stoppedBecause = "couldn't capture the canvas"; break; }
          onParamChange(nodeId, "_snapshot", snap.dataUrl);
          onParamChange(nodeId, "_status", `${label}reviewing the drawing…`);
          let verdict;
          try {
            verdict = await runAgentCritique({ apiKey, model, instructions, prompt, imageDataUrl: snap.dataUrl, applied: [...outByKey.keys()].map((k) => ({ nodeId, key: k, value: "generated" })), context });
          } catch (e) { stoppedBecause = "review failed"; console.error("Agent critique failed:", e); break; }
          onParamChange(nodeId, "_critique", `${verdict.ok ? "✔" : "✎"} ${verdict.score.toFixed(0)}/10 · ${verdict.critique}`);
          if (verdict.ok) { stoppedBecause = `reviewer satisfied (${verdict.score.toFixed(0)}/10)`; break; }
          critique = verdict.critique;
          await settleCanvas(2);
        }
        onParamChange(nodeId, "rationale", rationale);
        onParamChange(nodeId, "_stale", false);
        const tail = stoppedBecause ? ` · ${stoppedBecause}` : "";
        onParamChange(nodeId, "_status", `✔ generated ${outByKey.size} payload${outByKey.size === 1 ? "" : "s"}${tail}`);
        toast.success(`Agent generated ${outByKey.size} payload${outByKey.size === 1 ? "" : "s"}`);
      } catch (e) {
        onParamChange(nodeId, "_status", "✖ generation failed");
        toast.error(`Agent failed: ${(e as Error)?.message ?? "unknown"}`);
        console.error("Agent generate failed:", e);
      } finally {
        onParamChange(nodeId, "_busy", false);
      }
      return;
    }

    const targets = agentTargetsOf(nodeId, nodesRef.current, edgesRef.current);
    if (!targets.length) { toast.error("Wire the Agent to a node with parameters — e.g. (Node/Segment/Space) → Agent → Input Properties, or Corridoor → Core Racking"); return; }

    const context = agentContextOf(poly ?? [], props.pixelsPerMeter);
    const instructions = String(params.instructions ?? "");
    const prompt = String(params.prompt ?? "");
    const rounds = Math.max(1, Math.min(5, Math.round(Number(params.rounds) || 1)));

    // Write one round's values into their target nodes. Grouped BY NODE because a props-driven node's
    // array must be rewritten in ONE call — a per-value rewrite would re-read `props` from state React
    // hasn't flushed yet and keep only the last value.
    const bake = (values: SuggestedValue[]) => {
      const byNode = new Map<string, SuggestedValue[]>();
      for (const v of values) {
        const l = byNode.get(v.nodeId);
        if (l) l.push(v); else byNode.set(v.nodeId, [v]);
      }
      for (const [nid, vals] of byNode) {
        const nd = nodesRef.current.find((n) => n.id === nid)?.data as FlowNodeData | undefined;
        const nProps = nd ? inputProps(nd.params) : [];
        const propIds = new Set(nProps.map((p) => p.id));
        const propVals = new Map(vals.filter((v) => propIds.has(v.key)).map((v) => [v.key, v.value]));
        if (propVals.size) {
          onParamChange(nid, "props", nProps.map((p) => (propVals.has(p.id) ? { ...p, value: propVals.get(p.id)! } : p)));
        }
        for (const v of vals) if (!propIds.has(v.key)) onParamChange(nid, v.key, v.value);
      }
    };

    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_critique", undefined);
    onParamChange(nodeId, "_snapshot", undefined);
    try {
      // FEEDBACK LOOP: propose → bake → let it draw → photograph the plan → review the DRAWING → feed the
      // critique into the next proposal. Metrics alone can't catch geometry that is individually plausible
      // but plainly wrong (cores overhanging the corridor, a band that misses half the plate) — only the
      // picture can. Bounded by `rounds`, and it stops early the moment the reviewer is satisfied.
      let critique = "";
      let applied: SuggestedValue[] = [];
      let rationale = "";
      let liveTargets = targets;
      let stoppedBecause = "";
      for (let round = 1; round <= rounds; round++) {
        const label = rounds > 1 ? `round ${round}/${rounds} · ` : "";
        onParamChange(nodeId, "_status", `${label}analysing ${context.areaM2 > 0 ? `${context.areaM2.toFixed(0)} m² · ` : ""}${liveTargets.length} connected node${liveTargets.length === 1 ? "" : "s"}…`);
        const res = await runAgentSuggest({ apiKey, model, instructions, prompt, context, targets: liveTargets, critique, round, rounds });
        if (!res.values.length) {
          if (round === 1) {
            onParamChange(nodeId, "_status", "✖ no confident suggestions");
            toast.warning("The agent returned no values it was confident about — try a more specific prompt.");
            return;
          }
          stoppedBecause = "nothing left to change"; // converged: the critique produced no further edits
          break;
        }
        bake(res.values);
        applied = res.values;
        rationale = res.rationale;
        if (round === rounds) { stoppedBecause = rounds > 1 ? "round limit reached" : ""; break; }

        // Look at what it actually drew. Without the settle we'd photograph the PREVIOUS round.
        onParamChange(nodeId, "_status", `${label}drawing…`);
        await settleCanvas();
        const snap = captureCanvasRef.current?.() ?? null;
        if (!snap?.dataUrl) { stoppedBecause = "couldn't capture the canvas"; break; }
        onParamChange(nodeId, "_snapshot", snap.dataUrl);
        onParamChange(nodeId, "_status", `${label}reviewing the drawing…`);
        let verdict;
        try {
          verdict = await runAgentCritique({ apiKey, model, instructions, prompt, imageDataUrl: snap.dataUrl, applied: res.values, context });
        } catch (e) {
          // A failed review shouldn't throw away a good round — keep what's baked and stop refining.
          stoppedBecause = "review failed";
          console.error("Agent critique failed:", e);
          break;
        }
        onParamChange(nodeId, "_critique", `${verdict.ok ? "✔" : "✎"} ${verdict.score.toFixed(0)}/10 · ${verdict.critique}`);
        if (verdict.ok) { stoppedBecause = `reviewer satisfied (${verdict.score.toFixed(0)}/10)`; break; }
        critique = verdict.critique;
        // The next round must see where it actually IS, not where it started — re-read the targets so the
        // `current=` values it reasons from are the ones it just set.
        await settleCanvas(2);
        liveTargets = agentTargetsOf(nodeId, nodesRef.current, edgesRef.current);
      }

      // Record what was set on the agent node itself — read-only rows + one `val-<key>` output each.
      const specOf = new Map(liveTargets.flatMap((t) => t.params.map((s) => [`${t.nodeId}::${s.key}`, s] as const)));
      const used = new Set<string>();
      const propsOut = applied.map((v) => {
        const spec = specOf.get(`${v.nodeId}::${v.key}`);
        // val-<id> handle ids must be unique on the node; suffix a key set on more than one target node.
        let id = v.key;
        while (used.has(id)) id = `${v.key}-${used.size + 1}`;
        used.add(id);
        return {
          id,
          name: spec?.label ?? v.key,
          type: typeof v.value === "boolean" ? "checkbox" : typeof v.value === "number" ? "range" : "text",
          value: v.value,
          min: spec?.min ?? 0,
          max: spec?.max ?? 10,
          step: spec?.step ?? 1,
          options: spec?.options ?? [],
        };
      });
      // `props` / `rationale` / `inputHash` are NOT `_`-prefixed on purpose: those are stripped on export,
      // and a suggestion must survive a save with the provenance needed to re-check it. Staleness matters
      // most on reopening a flow whose Space has since moved.
      onParamChange(nodeId, "props", propsOut);
      onParamChange(nodeId, "rationale", rationale);
      onParamChange(nodeId, "inputHash", suggestInputHash(instructions, prompt, context, liveTargets));
      onParamChange(nodeId, "_stale", false);
      const nodeCount = new Set(applied.map((v) => v.nodeId)).size;
      const tail = stoppedBecause ? ` · ${stoppedBecause}` : "";
      onParamChange(nodeId, "_status", `✔ set ${applied.length} parameter${applied.length === 1 ? "" : "s"} on ${nodeCount} node${nodeCount === 1 ? "" : "s"}${tail}`);
      toast.success(`Agent set ${applied.length} parameter${applied.length === 1 ? "" : "s"}`);
    } catch (e) {
      onParamChange(nodeId, "_status", "✖ analysis failed");
      toast.error(`Agent failed: ${(e as Error)?.message ?? "unknown"}`);
      console.error("Agent node run failed:", e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange, props.pixelsPerMeter, props.aiApiKey, props.aiModel, props.createAnchor]);

  // Snapshot nodes: photograph the canvas via the SAME host capture the Agent uses (onCaptureCanvas →
  // snapshotCanvas), and bake the PNG data URLs into each node's `_snapshot` / `_snapshot3d` for its inline
  // images + its `val-image` / `val-image-3d` outputs. A pure diagnostic — no model, and it draws nothing.
  // Driven by the live-snapshot effect further down; there is no Capture button.
  //
  // SCOPE decides the framing. "whole" is the canvas-wide zoom-to-extent every agent self-review uses.
  // "selected" frames the box of whatever geometry is wired into the node, grown by its Margin — the same
  // box is handed to BOTH captures, so the plan and the 3D view close in together.
  //
  // Nodes that want the SAME framing share ONE photograph, keyed by that framing. The host capture is
  // expensive (a flushSync un-cull, two full stage redraws and a PNG encode), so two Whole nodes must not
  // cost two shots — while two differently-framed Selected nodes genuinely need their own.
  //
  // An unchanged image is NOT written back: a settled canvas would otherwise re-run the graph on every tick
  // for a byte-identical result.
  const lastSnapRef = useRef(new Map<string, { plan: string; iso: string }>());
  const ppmRef = useRef(props.pixelsPerMeter);
  ppmRef.current = props.pixelsPerMeter;

  /** The plan-pixel box a "Selected" Snapshot frames: everything wired into its geometry input, grown by its
   *  Margin. Null for "whole" — and ALSO null when nothing usable is wired in, so an unconnected Selected
   *  node falls back to the whole-canvas shot instead of framing an empty box and photographing nothing. */
  const snapshotFocusOf = useCallback((nodeId: string, params: Record<string, unknown>) => {
    if (String(params.scope ?? "whole") !== "selected") return undefined;
    const pts: Point[] = [];
    for (const e of edgesRef.current) {
      if (e.target !== nodeId || e.targetHandle?.startsWith("valin-") || e.targetHandle?.startsWith("gin-")) continue;
      // A Space source's polygon lives outside the preview list; everything else is whatever that node drew.
      // Suffixed preview items (`<id>__join` / `<id>__1`) belong to their base node, so match on that.
      const src = sourcePolysRef.current.get(e.source);
      if (src?.length) { for (const poly of src) pts.push(...poly); continue; }
      for (const it of previewRef.current) {
        if (it.nodeId.split("__")[0] !== e.source) continue;
        for (const poly of it.polygons) pts.push(...poly);
      }
    }
    // …or the region as a LIST on `valin-points`, in metres. The wired value is baked into the node's own
    // params by the generic value-input merge (the same path `margin` takes), so it is read from there
    // rather than chased back along the wire. Metres → plan pixels through the SAME anchor the evaluator
    // uses, or the box would sit a room's width away from the geometry it names.
    if (!pts.length) {
      const anchor = nodesRef.current.some((n) => (n.data as FlowNodeData).tool === "point")
        ? { x: 0, y: 0 } : (props.createAnchor ?? { x: 0, y: 0 });
      const ppm = ppmRef.current || 1;
      const raw = params.points;
      let parsed: unknown = null;
      if (typeof raw === "string" && raw.trim()) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }
      else if (Array.isArray(raw)) parsed = raw;
      // One outline `[[x,y],…]` or a list of them — the two shapes a `points` value ever takes here.
      const rings: unknown[] = Array.isArray(parsed) && Array.isArray((parsed as unknown[])[0]) && Array.isArray(((parsed as unknown[])[0] as unknown[])[0])
        ? (parsed as unknown[])
        : (Array.isArray(parsed) ? [parsed] : []);
      for (const ring of rings) {
        if (!Array.isArray(ring)) continue;
        for (const q of ring) {
          if (!Array.isArray(q) || q.length < 2) continue;
          const x = Number(q[0]), y = Number(q[1]);
          if (isFinite(x) && isFinite(y)) pts.push({ x: anchor.x + x * ppm, y: anchor.y + y * ppm });
        }
      }
    }
    if (pts.length < 2) return undefined;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (!(maxX > minX && maxY > minY)) return undefined; // a point or a straight line — nothing to frame
    // `?? 0`, not the declared default of 1: a node RESTORED from a saved flow only carries the params the
    // file holds, so an older Snapshot (or a hand-written one) has no `margin` at all — and its slider then
    // renders at its minimum. Defaulting to 1 here would frame a metre the control says is zero.
    const padPx = Math.max(0, Number(params.margin ?? 0) || 0) * (ppmRef.current || 1);
    return { focusPx: { minX, minY, maxX, maxY }, padPx };
  }, [props.createAnchor]);

  const captureSnapshotInto = useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    for (const id of [...lastSnapRef.current.keys()]) if (!ids.includes(id)) lastSnapRef.current.delete(id);

    type Shot = { plan: string; iso: string; widthM: number; heightM: number; scoped: boolean };
    const shoot = async (opts?: { focusPx: { minX: number; minY: number; maxX: number; maxY: number }; padPx: number }): Promise<Shot> => {
      const snap = captureCanvasRef.current?.(opts) ?? null;
      // The 3D half, shot from straight above so it registers with the plan beside it. With no focus box
      // captureOne falls back to the whole building — the 3D equivalent of the plan capture's
      // zoom-to-extent; with one it frames the same piece the plan shot does.
      //
      // `mountedOnly` is load-bearing. Without it the host switches the app into 3D and waits up to 4 s for
      // the lazy chunk — acceptable for a button press, intolerable for a node that fires by itself: drawing
      // a wall would throw the user out of the plan. No 3D view open → no 3D image, and the node says so.
      let iso = "";
      try { iso = (await capture3dRef.current?.({ view: "top", focusPx: opts?.focusPx, mountedOnly: true })) ?? ""; }
      catch (e) { console.error("Snapshot 3D capture failed:", e); }
      return { plan: snap?.dataUrl ?? "", iso, widthM: snap?.widthM ?? NaN, heightM: snap?.heightM ?? NaN, scoped: Boolean(opts) };
    };

    const byFraming = new Map<string, Shot>();
    for (const id of ids) {
      const params = (nodesRef.current.find((n) => n.id === id)?.data as FlowNodeData | undefined)?.params ?? {};
      const focus = snapshotFocusOf(id, params);
      const f = focus?.focusPx;
      const key = f ? `${Math.round(f.minX)},${Math.round(f.minY)},${Math.round(f.maxX)},${Math.round(f.maxY)},${Math.round(focus!.padPx)}` : "whole";
      let shot = byFraming.get(key);
      if (!shot) { shot = await shoot(focus); byFraming.set(key, shot); }

      const prev = lastSnapRef.current.get(id);
      if (!shot.plan && !shot.iso) {
        // Clear rather than leave the last good frame standing: a Snapshot exists to show what IS on the
        // canvas, and a stale image that looks fine is the failure this node is meant to catch. No toast —
        // this runs unattended, and an empty canvas is a normal state, not an error.
        if (!prev) continue;
        lastSnapRef.current.delete(id);
        onParamChange(id, "_snapshot", undefined);
        onParamChange(id, "_snapshot3d", undefined);
        onParamChange(id, "_status", "✖ nothing to photograph — the frame is empty");
        continue;
      }
      if (prev && prev.plan === shot.plan && prev.iso === shot.iso) continue;
      lastSnapRef.current.set(id, { plan: shot.plan, iso: shot.iso });
      const dims = Number.isFinite(shot.widthM) && Number.isFinite(shot.heightM) ? ` · ${shot.widthM.toFixed(1)} × ${shot.heightM.toFixed(1)} m` : "";
      const scopeTag = shot.scoped ? " · selected" : "";
      const tail = shot.iso ? " · plan + 3D" : " · plan only (3D view not open)";
      onParamChange(id, "_snapshot", shot.plan || undefined);
      onParamChange(id, "_snapshot3d", shot.iso || undefined);
      onParamChange(id, "_status", `● live${scopeTag}${dims}${tail}`);
    }
  }, [onParamChange, snapshotFocusOf]);

  // Generate action: text-to-media via the Google AI / Gemini API. Branches on the "Kind" dropdown:
  //  • image → models/<model>:generateContent with responseModalities IMAGE → inline image (data URL).
  //  • video → Veo models/<model>:predictLongRunning → poll the operation → download the result file.
  //  • music → Lyria RealTime live websocket → capture ~15s of streamed PCM → encode WAV.
  // The result (data/object URL + filename) is baked under `_resultUrl`/`_resultName` for the download link.
  const onRunGenerate = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    const kind = String(params.kind ?? "image");
    const model = String(params.model ?? "").trim()
      || (kind === "image" ? (props.aiImageModel ?? "").trim() : "")
      || GENERATE_DEFAULT_MODEL[kind] || "gemini-2.5-flash-image";
    const prompt = String(params.prompt ?? "").trim();
    if (!prompt) { toast.error("Enter a prompt"); return; }
    const base = "https://generativelanguage.googleapis.com/v1beta";
    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_resultUrl", undefined);
    onParamChange(nodeId, "_resultName", undefined);
    const apiError = async (res: Response, label: string) => {
      const t = await res.text();
      let msg = t; try { msg = JSON.parse(t)?.error?.message ?? t; } catch { /* raw */ }
      toast.error(`${label} (${res.status}): ${String(msg).slice(0, 160)}`);
      console.error(`${label} response:`, t);
    };
    try {
      if (kind === "text") {
        // Plain text generation — standard generateContent; the answer is in the text parts. When "Search
        // web" is on, attach Gemini's google_search tool so the answer is grounded in live web results.
        const body: Record<string, unknown> = { contents: [{ parts: [{ text: prompt }] }] };
        if (params.searchWeb) body.tools = [{ google_search: {} }];
        const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) { await apiError(res, "Text generation failed"); return; }
        const json = await res.json();
        const parts = json?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
        if (!text) { toast.error("Model returned no text"); console.error("Text response:", json); return; }
        onParamChange(nodeId, "_resultText", text);
        onParamChange(nodeId, "_resultUrl", `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
        onParamChange(nodeId, "_resultName", "generated.txt");
        toast.success("Text generated");
      } else if (kind === "image") {
        // Gemini 2.5 Flash Image ("Nano Banana") returns the image inline on generateContent.
        const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
        });
        if (!res.ok) { await apiError(res, "Image generation failed"); return; }
        const json = await res.json();
        const parts = json?.candidates?.[0]?.content?.parts ?? [];
        const img = parts.find((p: { inline_data?: { data?: string }; inlineData?: { data?: string } }) => p.inline_data?.data || p.inlineData?.data);
        const inline = img?.inline_data ?? img?.inlineData;
        if (!inline?.data) { toast.error("Model returned no image"); console.error("Image response:", json); return; }
        const mime = inline.mime_type ?? inline.mimeType ?? "image/png";
        onParamChange(nodeId, "_resultUrl", `data:${mime};base64,${inline.data}`);
        onParamChange(nodeId, "_resultName", `generated.${mime.includes("jpeg") ? "jpg" : "png"}`);
        toast.success("Image generated");
      } else if (kind === "video") {
        // Veo 3 is async: kick off a long-running operation, then poll until the video is ready.
        const startRes = await fetch(`${base}/models/${encodeURIComponent(model)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: "16:9" } }),
        });
        if (!startRes.ok) { await apiError(startRes, "Video generation failed"); return; }
        const opName = (await startRes.json())?.name;
        if (!opName) { toast.error("Veo returned no operation"); return; }
        // Poll the operation (Veo takes ~1–3 min). Up to ~5 min total.
        let videoUri = "";
        for (let i = 0; i < 30; i++) {
          await sleep(10000);
          const pollRes = await fetch(`${base}/${opName}?key=${encodeURIComponent(apiKey)}`);
          if (!pollRes.ok) { await apiError(pollRes, "Video poll failed"); return; }
          const op = await pollRes.json();
          if (op?.error) { toast.error(`Video failed: ${op.error?.message ?? "unknown"}`); console.error(op.error); return; }
          if (op?.done) {
            const sample = op?.response?.generateVideoResponse?.generatedSamples?.[0];
            videoUri = sample?.video?.uri ?? sample?.video?.fileUri ?? "";
            break;
          }
        }
        if (!videoUri) { toast.error("Video timed out — try again"); return; }
        // The file URI needs the API key to download; fetch the bytes and hold them as an object URL.
        const dl = videoUri.includes("key=") ? videoUri : `${videoUri}${videoUri.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
        const vidRes = await fetch(dl);
        if (!vidRes.ok) { await apiError(vidRes, "Video download failed"); return; }
        const blobUrl = URL.createObjectURL(await vidRes.blob());
        onParamChange(nodeId, "_resultUrl", blobUrl);
        onParamChange(nodeId, "_resultName", "generated.mp4");
        toast.success("Video generated");
      } else {
        // Music: Lyria 3 Pro is a synchronous generateContent call (not realtime) that returns the audio
        // inline. responseModalities must include AUDIO. https://ai.google.dev/gemini-api/docs/music-generation
        const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["AUDIO"] } }),
        });
        if (!res.ok) { await apiError(res, "Music generation failed"); return; }
        const json = await res.json();
        const parts = json?.candidates?.[0]?.content?.parts ?? [];
        const aud = parts.find((p: { inline_data?: { data?: string }; inlineData?: { data?: string } }) => p.inline_data?.data || p.inlineData?.data);
        const inline = aud?.inline_data ?? aud?.inlineData;
        if (!inline?.data) { toast.error("Model returned no audio"); console.error("Music response:", json); return; }
        const mime = inline.mime_type ?? inline.mimeType ?? "audio/mp3";
        const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "mp3";
        onParamChange(nodeId, "_resultUrl", `data:${mime};base64,${inline.data}`);
        onParamChange(nodeId, "_resultName", `generated.${ext}`);
        toast.success("Music generated");
      }
    } catch (e) {
      toast.error(`Generate error: ${(e as Error)?.message ?? "unknown"}`);
      console.error(e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange, props]);

  const layoutGenCb = props.onRunLayoutGen;
  const annealCb = props.onRunAnneal;
  const addRoomCb = props.onAddRoom;
  const nodeCb = useMemo<NodeCallbacks>(() => ({
    onParamChange, onRunRender, onRunDetect, onRunVectorTune, onRunAnalyse, onRunGenerate, onRunAgent,
    onRunLayoutGen: (nodeId, params) => layoutGenCb?.(nodeId, params),
    onRunAnneal: (nodeId, params) => annealCb?.(nodeId, params),
    onAddRoom: (nodeId, params) => addRoomCb?.(nodeId, params),
    onExportDxf, onExport3d, onExportToCanvas, onImportPlan, onSetObjectParams, onRunAllDetect, onRunAllTune, onRunAllApply,
    onToggleDecompile, onToggleGroup,
  }), [onParamChange, onRunRender, onRunDetect, onRunVectorTune, onRunAnalyse, onRunGenerate, onRunAgent, layoutGenCb, annealCb, addRoomCb, onExportDxf, onExport3d, onExportToCanvas, onImportPlan, onSetObjectParams, onRunAllDetect, onRunAllTune, onRunAllApply, onToggleDecompile, onToggleGroup]);

  // Keep every Space (source) node with "Grab ID from selection" on synced to ALL currently-selected
  // spaces' ids (comma-separated), so one Space node can output several spaces at once. Falls back to the
  // single selected id. Only writes when the value changes, so it doesn't fight user edits or loop.
  const selectedRoomIdList = (props.selectedRoomIds && props.selectedRoomIds.length
    ? props.selectedRoomIds
    : (props.selectedRoomId ? [props.selectedRoomId] : [])).join(", ");
  // Signature of which source nodes currently have grab on — so flipping the toggle re-syncs even when
  // the selection itself hasn't changed.
  // Plan JSON grabs the same way: it is a ROOT with no geometry input, so the canvas selection is the
  // only thing that can scope it (blank id = the whole canvas).
  const GRAB_SPACE_TOOLS = new Set<string>(["source", "plan-json"]);
  const grabSig = nodes.filter((n) => GRAB_SPACE_TOOLS.has((n.data as FlowNodeData).tool) && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (!GRAB_SPACE_TOOLS.has(data.tool)) return n;
        if (!data.params.grabFromSelection) return n;
        if (data.params.id === selectedRoomIdList) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: selectedRoomIdList } } };
      });
      return changed ? next : ns;
    });
  }, [selectedRoomIdList, grabSig, setNodes]);

  // Per-Space attachment parameters (id → props), supplied by the host. The Space (source) node itself stays a
  // plain geometry source — these feed the Grab Object nodes downstream (Space → Grab Object → op), which read
  // the attachment of the Space wired into their input. See the pipeline-grab effect below.
  const spaceAttProps = props.spaceAttachmentProps ?? {};
  const spaceAttSig = JSON.stringify(spaceAttProps);

  // Same grab-sync for Graph (graph-source) nodes → keep a grabbing node's id on the selected graph.
  const selectedGraphIdStr = props.selectedGraphId ?? "";
  const graphGrabSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "graph-source" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "graph-source") return n;
        if (!data.params.grabFromSelection) return n;
        if (data.params.id === selectedGraphIdStr) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: selectedGraphIdStr } } };
      });
      return changed ? next : ns;
    });
  }, [selectedGraphIdStr, graphGrabSig, setNodes]);

  // Image nodes with Grab from selection follow the selected picture, exactly as the Graph / Segment /
  // Node sources follow theirs. `null` means NOTHING is selected, and the node then keeps the id it has:
  // clicking off the canvas must not silently repoint a traced chain at a different picture. "" is a
  // real id here — the base underlay — so only null is treated as "no news".
  const selectedImageIdStr = props.selectedImageId;
  const imageGrabSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "image" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    if (selectedImageIdStr == null) return;
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "image" || !data.params.grabFromSelection) return n;
        if (data.params.id === selectedImageIdStr) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: selectedImageIdStr } } };
      });
      return changed ? next : ns;
    });
  }, [selectedImageIdStr, imageGrabSig, setNodes]);

  // For each Grab Object, the Space id feeding its geometry INPUT (a Source node wired in) — lets it reflect
  // THAT space's attached object (Space → Grab Object → Inset) instead of the canvas selection. Empty when
  // nothing is wired in (it then falls back to the selection / its own id).
  const grabInputSourceId = new Map<string, string>();
  for (const gn of nodes) {
    if ((gn.data as FlowNodeData).tool !== "grab-object") continue;
    const inEdge = edges.find((e) => e.target === gn.id && !(e.targetHandle && (e.targetHandle.startsWith("valin-") || e.targetHandle.startsWith("gin-"))));
    if (!inEdge) continue;
    const up = nodes.find((m) => m.id === inEdge.source);
    if (up && (up.data as FlowNodeData).tool === "source") grabInputSourceId.set(gn.id, String((up.data as FlowNodeData).params.id ?? "").trim());
  }

  // Grab-sync for "Grab Object" nodes → bake the selected element's attached-object params (+ its id) into a
  // grabbing node whose hostKind matches the selection. Mismatched-kind (or no attached object) nodes keep
  // their last grabbed props, so selecting something else doesn't wipe them. Read-only readout on the node.
  // Input-fed nodes are skipped — the pipeline effect below owns their props (Space → Grab Object → op).
  const grabObjSel = props.grabObjectSelection ?? null;
  const grabObjSig = grabObjSel ? `${grabObjSel.hostKind}:${grabObjSel.id}:${JSON.stringify(grabObjSel.props)}` : "";
  const grabObjNodesSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "grab-object" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    if (!grabObjSel) return;
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "grab-object" || !data.params.grabFromSelection) return n;
        if (grabInputSourceId.has(n.id)) return n; // input-fed → owned by the pipeline effect below
        if (data.params.hostKind !== grabObjSel.hostKind) return n;
        if (data.params.id === grabObjSel.id && JSON.stringify(data.params.props) === JSON.stringify(grabObjSel.props)) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: grabObjSel.id, props: grabObjSel.props } } };
      });
      return changed ? next : ns;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabObjSig, grabObjNodesSig, setNodes]);

  // Pipeline grab (Space → Grab Object → op): reflect the attached object of the Space wired into each Grab
  // Object's INPUT, resolved BY ID from the host — so the incoming Space's parameters drive the chain and the
  // Space node itself needs none. Also stamps `_hasInput` so the node hides its id/selection fields. A Grab
  // Object with nothing wired in clears `_hasInput` and falls back to the selection effect above.
  const grabInputSig = [...grabInputSourceId.entries()].map(([k, v]) => `${k}:${v}`).join(",");
  const grabAllIdsSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "grab-object").map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "grab-object") return n;
        const srcId = grabInputSourceId.get(n.id);
        if (srcId !== undefined) {
          const wanted = (srcId && !srcId.includes(",") ? spaceAttProps[srcId] : undefined) ?? [];
          if (data.params._hasInput === true && JSON.stringify(data.params.props ?? []) === JSON.stringify(wanted)) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, _hasInput: true, props: wanted } } };
        }
        if (!data.params._hasInput) return n; // no input and flag already clear → nothing to do
        changed = true;
        const { _hasInput: _drop, ...rest } = data.params;
        return { ...n, data: { ...n.data, params: rest } };
      });
      return changed ? next : ns;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabInputSig, grabAllIdsSig, spaceAttSig, setNodes]);

  // Same grab-sync for Grid (grid-source) nodes → keep a grabbing node's id on the selected grid.
  const selectedGridIdStr = props.selectedGridId ?? "";
  const gridGrabSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "grid-source" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "grid-source") return n;
        if (!data.params.grabFromSelection) return n;
        if (data.params.id === selectedGridIdStr) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: selectedGridIdStr } } };
      });
      return changed ? next : ns;
    });
  }, [selectedGridIdStr, gridGrabSig, setNodes]);

  // Same grab-sync for Segment (segment-source) nodes → keep a grabbing node's id on the selected segment(s).
  const selectedSegmentIdStr = props.selectedSegmentId ?? "";
  const segmentGrabSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "segment-source" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "segment-source") return n;
        if (!data.params.grabFromSelection) return n;
        if (data.params.id === selectedSegmentIdStr) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: selectedSegmentIdStr } } };
      });
      return changed ? next : ns;
    });
  }, [selectedSegmentIdStr, segmentGrabSig, setNodes]);

  // Same grab-sync for Node (node-source) nodes → keep a grabbing node's id on the selected node(s).
  const selectedNodeIdStr = props.selectedNodeId ?? "";
  const nodeGrabSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "node-source" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "node-source") return n;
        if (!data.params.grabFromSelection) return n;
        if (data.params.id === selectedNodeIdStr) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, id: selectedNodeIdStr } } };
      });
      return changed ? next : ns;
    });
  }, [selectedNodeIdStr, nodeGrabSig, setNodes]);

  // AUTO-KIND — a grabbing GEOMETRY node IS whatever the canvas has selected. Select a node and it becomes
  // a Point source, a segment and it becomes a Segment source, a graph or a space likewise: there is no kind
  // control because the selection is the control. That is what lets ONE input carry a host whose TYPE
  // changes — a parametric object's anchor stays wired while you switch from a node to a wall to a room,
  // and the consumer (a Math Engine dispatching on `rows(P)`) reads whichever arrives.
  // Priority follows the canvas Select scope, which already makes node/segment mutually exclusive.
  // Nothing selected → the node keeps what it is, so wires never thrash on a click into empty space.
  // Freehand is deliberately not reachable this way: its strokes are matched by COLOUR, not selected.
  // Only nodes with "Grab ID from selection" ON follow; switch it off (and type an id) to pin one down.
  const autoGeomKind = props.selectedNodeId ? "point"
    : props.selectedSegmentId ? "segment"
    : props.selectedGraphId ? "graph"
    : (props.selectedRoomId || (props.selectedRoomIds?.length ?? 0) > 0) ? "space"
    // LAST, and tested for null rather than truthiness: "" is a real image id (an underlay imported
    // before pictures carried one), so a falsy check would read the base image as "nothing selected".
    // Last in the chain because the Image scope is exclusive anyway — selecting a picture clears the
    // node/segment/space selection — so ordering only matters if a stale id outlives its scope.
    : props.selectedImageId != null ? "image"
    : null;
  const geomGrabSig = nodes
    .filter((n) => isGeometryTool((n.data as FlowNodeData).tool) && (n.data as FlowNodeData).params.grabFromSelection)
    .map((n) => `${n.id}:${(n.data as FlowNodeData).tool}`).join(",");
  useEffect(() => {
    if (!autoGeomKind) return;
    const nextTool = GEOMETRY_TOOL_BY_KIND[autoGeomKind];
    for (const n of nodesRef.current) {
      const d = n.data as FlowNodeData;
      if (!isGeometryTool(d.tool) || d.tool === nextTool || d.params.grabFromSelection !== true) continue;
      retargetGeometryNode(n.id, nextTool);
    }
  }, [autoGeomKind, geomGrabSig, retargetGeometryNode]);

  const addToolNode = useCallback((tool: FlowToolType) => {
    setNodes((ns) => {
      const x = 320 + (ns.length % 3) * 240;
      const y = 120 + Math.floor(ns.length / 3) * 180;
      const node = makeNode(tool, { x, y }, nodeCb);
      // Auto-name each new Polygon's render layer "Polygon1", "Polygon2", … (past the highest existing one,
      // so deletions don't cause a silent shared layer) — it then lands on its own canvas layer with Live on.
      if (tool === "polygon") {
        let max = 0;
        for (const m of ns) {
          if ((m.data as FlowNodeData).tool !== "polygon") continue;
          const lm = String((m.data as FlowNodeData).params.layer ?? "").match(/^Polygon(\d+)$/);
          if (lm) max = Math.max(max, parseInt(lm[1], 10));
        }
        (node.data as FlowNodeData).params.layer = `Polygon${max + 1}`;
      }
      return [...ns, node];
    });
  }, [setNodes, nodeCb]);

  const onFlowObjectAttachedToNode = props.onFlowObjectAttachedToNode;
  const onConnect = useCallback((c: Connection) => {
    setEdges((es) => addEdge({ ...c, animated: true }, es));
    // A Parametric Object's OUTPUT wired into a Node source is the reverse of attaching from the Properties
    // tab — tell the host so it mirrors the object as a linked canvas attachment (render + two-way sync).
    if (!onFlowObjectAttachedToNode) return;
    const src = nodesRef.current.find((n) => n.id === c.source);
    const tgt = nodesRef.current.find((n) => n.id === c.target);
    const sd = src?.data as FlowNodeData | undefined;
    const td = tgt?.data as FlowNodeData | undefined;
    if (sd?.tool !== "pobj-source" || td?.tool !== "node-source") return;
    // A Node source may pin several ids ("Node002, Node004"); attach to the first (one object → one node).
    const nodeDisplayId = String(td.params.id ?? "").split(",")[0]?.trim() ?? "";
    const objectId = String(sd.params.objectId ?? "");
    const definition = String(sd.params.definition ?? "");
    if (!nodeDisplayId || !objectId || !definition) return;
    const params: Record<string, number | string | boolean> = {};
    for (const p of inputProps(sd.params)) params[p.id] = p.value;
    onFlowObjectAttachedToNode({ flowNodeId: src!.id, nodeDisplayId, objectId, definition, params });
  }, [setEdges, onFlowObjectAttachedToNode]);

  // Params introspection: for any `acceptsParams` node (the Loop), read the parameter list of whatever
  // node is wired into its params input (`pin`) and bake it into `_paramOptions`, so the node's parameter
  // dropdown reflects the connected node's fields. Keyed on `edges` — the Loop produces no preview to
  // react to, so the connection itself is what drives this.
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const byId = new Map(ns.map((n) => [n.id, n]));
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (!FLOW_TOOLS[data.tool]?.acceptsParams) return n;
        const e = edges.find((ed) => ed.target === n.id && ed.targetHandle === "pin");
        const srcTool = e ? (byId.get(e.source)?.data as FlowNodeData | undefined)?.tool : undefined;
        const opts = srcTool && FLOW_TOOLS[srcTool]
          ? FLOW_TOOLS[srcTool].fields.map((f) => ({ value: f.key, label: f.label }))
          : [];
        if (JSON.stringify(data.params._paramOptions ?? []) === JSON.stringify(opts)) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, _paramOptions: opts } } };
      });
      return changed ? next : ns;
    });
  }, [edges, setNodes]);

  // Grab Parameters sync: for each `param-grab` node, read the definition of the Parametric Object wired
  // into its `valin-def` and bake an interactive control list into `props` (preserving the user's current
  // values across re-syncs). Keyed on nodes+edges; the changed-guard keeps it idempotent (no loop).
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const byId = new Map(ns.map((n) => [n.id, n]));
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "param-grab") return n;
        const e = edges.find((ed) => ed.target === n.id && ed.targetHandle === "valin-def");
        const srcDef = e ? String((byId.get(e.source)?.data as FlowNodeData | undefined)?.params.definition ?? "") : "";
        const desired = paramGrabProps(srcDef, inputProps(data.params));
        if (JSON.stringify(inputProps(data.params)) === JSON.stringify(desired)) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, props: desired } } };
      });
      return changed ? next : ns;
    });
  }, [nodes, edges, setNodes]);

  // Grab Geometry / Grab Output Metrics sync: for each inspector node, resolve the EFFECTIVE definition wired
  // into its `valin-def` — directly from a Parametric Object, or baked through a Grab Input Parameters (so the
  // chosen values apply) — then bake the evaluated read-only result into a transient param for inline display:
  // `_inspection` (geometry formulas + values) or `_outputs` (declared + derived output metrics). The
  // changed-guard keeps it idempotent (no render loop); `_`-prefixed params are stripped on export.
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const byId = new Map(ns.map((n) => [n.id, n]));
      const resolveDef = (node: typeof ns[number]): string => {
        const e = edges.find((ed) => ed.target === node.id && ed.targetHandle === "valin-def");
        if (!e) return "";
        const src = byId.get(e.source);
        if (!src) return "";
        const sd = src.data as FlowNodeData;
        if (sd.tool === "param-grab") {
          const e2 = edges.find((ed) => ed.target === src.id && ed.targetHandle === "valin-def");
          const base = e2 ? String((byId.get(e2.source)?.data as FlowNodeData | undefined)?.params.definition ?? "") : "";
          return bakeParamDefaults(base, inputProps(sd.params));
        }
        return String(sd.params.definition ?? "");
      };
      const bake = (n: typeof ns[number], key: string, value: unknown): typeof n => {
        const data = n.data as FlowNodeData;
        if (JSON.stringify(data.params[key]) === JSON.stringify(value)) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, [key]: value } } };
      };
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool === "param-geometry") return bake(n, "_inspection", inspectParametricGeometry(resolveDef(n)));
        if (data.tool === "param-output-metrics") return bake(n, "_outputs", evalParametricOutputs(resolveDef(n)));
        return n;
      });
      return changed ? next : ns;
    });
  }, [nodes, edges, setNodes]);

  // "New" — clear the whole graph and reseed a lone Source node (a fresh, empty flow).
  const newFlow = useCallback(() => {
    if (nodes.length > 0 && !window.confirm("Start a new flow? This clears all nodes and connections.")) return;
    setFoldAll(false);
    setEdges([]);
    setNodes([]); // start empty — add a Space node from the palette to begin
  }, [nodes.length, setNodes, setEdges]);

  // Output node auto-grow: always keep one free metric endpoint. When every slot of an Output node is
  // wired, append a fresh empty slot so there's always somewhere to drop the next value.
  useEffect(() => {
    const wiredSlots = (nodeId: string) => new Set(
      edges.filter((e) => e.target === nodeId && e.targetHandle?.startsWith("valin-")).map((e) => e.targetHandle!.slice(6)),
    );
    const needsGrow = nodes.some((n) => {
      if ((n.data as FlowNodeData).tool !== "output") return false;
      const slots = outputSlots((n.data as FlowNodeData).params);
      const w = wiredSlots(n.id);
      return slots.length > 0 && slots.every((s) => w.has(s.id));
    });
    if (!needsGrow) return;
    setNodes((ns) => ns.map((n) => {
      if ((n.data as FlowNodeData).tool !== "output") return n;
      const slots = outputSlots((n.data as FlowNodeData).params);
      const w = wiredSlots(n.id);
      if (!(slots.length > 0 && slots.every((s) => w.has(s.id)))) return n;
      return { ...n, data: { ...n.data, params: { ...(n.data as FlowNodeData).params, slots: [...slots, { id: nextSlotId(), label: "" }] } } };
    }));
  }, [nodes, edges, setNodes]);

  // ── Export / Import the flow GRAPH (nodes + edges) as JSON. Distinct from "view JSON", which
  //    shows the COMPILED recipe. Injected callbacks (onParamChange/onRunRender) and transient baked
  //    params (the "_"-prefixed keys: _busy/_resultUrl/_pass/_value/vertexCount) are stripped on
  //    export and re-injected/recomputed on import. ──
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Serialize the live graph to the export/import shape (transient `_`-prefixed params stripped). Shared
  // by file export, the per-Space persistence callback, and (indirectly) commit.
  const buildGraph = useCallback((): SerializedFlow => {
    // Persist group container boxes (type/width/height) and grouped children (parentId + their
    // parent-RELATIVE position), so groups round-trip through export/import. Transient `_`-params stripped.
    return {
      version: 1,
      nodes: nodes.map((n) => {
        const d = n.data as FlowNodeData;
        const params: Record<string, unknown> = {};
        // `_`-prefixed params are transient runtime state (busy flags, live counts, previews) and are
        // dropped — EXCEPT the fold flag, which is a deliberate authoring choice: a flow saved with its
        // nodes folded should reopen folded, the same way a group box's `collapsed` round-trips.
        for (const [k, v] of Object.entries(d.params ?? {})) if (!k.startsWith("_") || PERSISTED_VIEW_PARAMS.has(k)) params[k] = v;
        const out: SerializedFlowNode = { id: n.id, position: n.position, data: { tool: d.tool, params } };
        if (n.parentId) out.parentId = n.parentId;
        if (n.type === "group") {
          out.type = "group";
          const style = (n.style ?? {}) as { width?: number; height?: number };
          const w = typeof style.width === "number" ? style.width : n.measured?.width;
          const h = typeof style.height === "number" ? style.height : n.measured?.height;
          if (typeof w === "number") out.width = w;
          if (typeof h === "number") out.height = h;
        }
        return out;
      }),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
    };
  }, [nodes, edges]);

  // Export → show the JSON in a textarea first (copy-paste), then save to a file on demand.
  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState("");
  const openExport = useCallback(() => {
    setExportText(JSON.stringify(buildGraph(), null, 2));
    setExportOpen(true);
  }, [buildGraph]);
  const copyExport = useCallback(() => {
    navigator.clipboard?.writeText(exportText).then(
      () => toast.success("Flow JSON copied"),
      () => toast.error("Couldn't copy to clipboard"),
    );
  }, [exportText]);
  const saveExportFile = useCallback(() => {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flow.json";
    a.click();
    URL.revokeObjectURL(url);
    // Library convention: whole flow graphs live under Workflows/ in the shared Library. In dev the bridge
    // writes the file there directly (timestamped, no overwrites); otherwise fall back to the download + hint.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    void saveLibraryFile(`${LIB_WORKFLOWS}/flow-${stamp}.json`, exportText).then((r) =>
      r.ok
        ? toast.success(`Flow saved to the Library — ${r.path}`)
        : toast.success("Flow exported — shared flows belong under Workflows/ in the Library"),
    );
  }, [exportText]);


  // Build live nodes/edges from a parsed flow object and load them into the graph. Throws on a bad
  // shape so callers can surface an error. Shared by file import and AI "Generate JSON".
  //
  // `merge` ADDS the parsed graph to what is already on the canvas instead of replacing it — what every
  // user-facing Import does, so importing a second workflow builds up a canvas rather than wiping the
  // first. Colliding node ids are renamed (edges + group parents follow) and the incoming graph is placed
  // clear of the existing one. The internal callers (opening the overlay, the inject/decompile bridges,
  // the Flow agent) pass nothing and keep replacing, because each of those already hands over a WHOLE
  // graph built from the current one.
  const importFlowData = useCallback((parsed: { nodes?: unknown[]; edges?: unknown[] }, opts?: { merge?: boolean }) => {
    if (!Array.isArray(parsed.nodes)) throw new Error("missing nodes array");
    const importedNodes: Node[] = parsed.nodes.map((raw) => {
      const n = raw as { id?: unknown; position?: { x: number; y: number }; type?: unknown; parentId?: unknown; width?: unknown; height?: unknown; data?: { tool?: FlowToolType; params?: Record<string, unknown> } };
      const tool = (n.data?.tool ?? "inset") as FlowToolType;
      const isGroup = n.type === "group" || tool === "group";
      const node: Node = {
        id: typeof n.id === "string" ? n.id : nextId(tool),
        type: isGroup ? "group" : "op",
        position: n.position ?? { x: 0, y: 0 },
        // Every node is deletable (including the Space node) so the canvas can be cleared completely.
        deletable: true,
        data: isGroup
          ? ({ tool: "group", params: { ...(n.data?.params ?? {}) }, onParamChange: nodeCb.onParamChange, onToggleGroup: nodeCb.onToggleGroup } as unknown as FlowNodeData)
          : ({ tool, params: { ...(n.data?.params ?? {}) }, onParamChange: nodeCb.onParamChange, onRunRender: nodeCb.onRunRender, onRunDetect: nodeCb.onRunDetect, onRunVectorTune: nodeCb.onRunVectorTune, onRunAnalyse: nodeCb.onRunAnalyse, onRunGenerate: nodeCb.onRunGenerate, onRunAgent: nodeCb.onRunAgent, onRunLayoutGen: nodeCb.onRunLayoutGen, onRunAnneal: nodeCb.onRunAnneal, onAddRoom: nodeCb.onAddRoom, onExportDxf: nodeCb.onExportDxf, onExport3d: nodeCb.onExport3d, onExportToCanvas: nodeCb.onExportToCanvas, onImportPlan: nodeCb.onImportPlan, onSetObjectParams: nodeCb.onSetObjectParams, onRunAllDetect: nodeCb.onRunAllDetect, onRunAllTune: nodeCb.onRunAllTune, onRunAllApply: nodeCb.onRunAllApply, onToggleDecompile: nodeCb.onToggleDecompile } as FlowNodeData),
      };
      // Grouped child → reattach to its parent (position stays parent-relative, constrained to the box).
      if (typeof n.parentId === "string") { node.parentId = n.parentId; node.extent = "parent"; }
      // Group container → restore its box size.
      if (isGroup) node.style = { width: typeof n.width === "number" ? n.width : 240, height: typeof n.height === "number" ? n.height : 160 };
      return node;
    });
    // React Flow requires a parent node to precede its children in the array — group boxes AND a decompiled
    // brief holding docked Output Metrics children. Groups lead, then every node once its parent is out.
    const orderByParent = (list: Node[]): Node[] => {
      const byId = new Map(list.map((n) => [n.id, n] as const));
      const out: Node[] = [];
      const done = new Set<string>();
      const emit = (n: Node) => {
        if (done.has(n.id)) return;
        done.add(n.id); // marked BEFORE recursing, so a self/cyclic parentId can't loop forever
        const parent = n.parentId ? byId.get(n.parentId) : undefined;
        if (parent) emit(parent);
        out.push(n);
      };
      for (const n of list) if (n.type === "group") emit(n);
      for (const n of list) emit(n);
      return out;
    };
    const importedEdges: Edge[] = Array.isArray(parsed.edges) ? parsed.edges.map((raw) => {
      const e = raw as { id?: unknown; source?: unknown; target?: unknown; sourceHandle?: unknown; targetHandle?: unknown };
      const sourceHandle = e.sourceHandle != null ? String(e.sourceHandle) : null;
      return {
        id: typeof e.id === "string" ? e.id : `e-${String(e.source)}-${sourceHandle ?? ""}-${String(e.target)}`,
        source: String(e.source),
        target: String(e.target),
        sourceHandle,
        targetHandle: e.targetHandle != null ? String(e.targetHandle) : null,
        animated: true,
      };
    }) : [];
    // Seed data-derived output counts (Voronoi vertexCount / Convex-Decomp pieceCount) from the
    // edges so the edge-prune effect doesn't drop "out-i" connections before the live count is baked.
    const maxOutIdx = new Map<string, number>();
    for (const e of importedEdges) {
      if (typeof e.sourceHandle === "string" && e.sourceHandle.startsWith("out-")) {
        const idx = parseInt(e.sourceHandle.slice(4), 10);
        if (Number.isFinite(idx)) maxOutIdx.set(e.source, Math.max(maxOutIdx.get(e.source) ?? -1, idx));
      }
    }
    for (const node of importedNodes) {
      const need = maxOutIdx.get(node.id);
      if (need == null) continue;
      const data = node.data as FlowNodeData;
      const key = data.tool === "voronoi" ? "vertexCount" : data.tool === "convex-decomp" ? "pieceCount" : (data.tool === "inset" || data.tool === "optimise-rect" || data.tool === "floor-massing" || data.tool === "smoothing" || data.tool === "densify") ? "inputCount" : (data.tool === "split" || data.tool === "bsp" || data.tool === "skeleton" || data.tool === "mitered-join" || data.tool === "graph-source" || data.tool === "segment-source" || data.tool === "node-source" || data.tool === "separate" || data.tool === "segment-split" || data.tool === "graph-to-spaces" || data.tool === "voronoi-bloom" || data.tool === "mesh" || data.tool === "circle-packing" || data.tool === "visibility" || data.tool === "treemap" || data.tool === "rect-pack") ? "handleCount" : null;
      if (key) data.params[key] = Math.max(Number(data.params[key]) || 0, need + 1);
    }
    // A group saved COLLAPSED reopens collapsed: re-apply `hidden` to everything under it and to their edges
    // (the flag itself isn't serialized — only the box's `collapsed` param is). The auto-fit effect leaves
    // collapsed boxes at their stored title-bar height. A FOLDED op node counts too: it can hold Output
    // Metrics docked inside it (decompile dock), which must reopen folded away with it. Descendants are
    // resolved by fixpoint, so a dock inside a box inside a collapsed box is covered.
    const foldedParents = new Set(importedNodes
      .filter((n) => (n.type === "group" ? (n.data as FlowNodeData).params?.collapsed : (n.data as FlowNodeData).params?._collapsed))
      .map((n) => n.id));
    if (foldedParents.size) {
      const hidden = new Set<string>();
      for (let pass = 0; pass < 8; pass++) {
        let grew = false;
        for (const n of importedNodes) {
          if (n.hidden || !n.parentId) continue;
          if (foldedParents.has(n.parentId) || hidden.has(n.parentId)) { n.hidden = true; hidden.add(n.id); grew = true; }
        }
        if (!grew) break;
      }
      for (const e of importedEdges) if (hidden.has(e.source) || hidden.has(e.target)) e.hidden = true;
    }
    // MERGE — keep what is on the canvas and add this graph beside it. Ids are made unique first (an edge or
    // a group child referring to a renamed node must follow it), then every TOP-LEVEL node is shifted to the
    // right of the existing content. Children of a group keep their positions: those are parent-relative.
    const existing = opts?.merge ? nodesRef.current : [];
    if (existing.length) {
      const taken = new Set(existing.map((n) => n.id));
      const remap = new Map<string, string>();
      for (const n of importedNodes) {
        if (!taken.has(n.id)) { taken.add(n.id); continue; }
        let k = 2, id = `${n.id}_${k}`;
        while (taken.has(id)) id = `${n.id}_${++k}`;
        remap.set(n.id, id);
        taken.add(id);
        n.id = id;
      }
      if (remap.size) {
        for (const n of importedNodes) if (n.parentId && remap.has(n.parentId)) n.parentId = remap.get(n.parentId)!;
        for (const e of importedEdges) {
          if (remap.has(e.source)) e.source = remap.get(e.source)!;
          if (remap.has(e.target)) e.target = remap.get(e.target)!;
          e.id = `e-${e.source}-${e.sourceHandle ?? ""}-${e.target}-${e.targetHandle ?? ""}`;
        }
      }
      const widthOf = (n: Node): number => n.measured?.width ?? (typeof n.width === "number" ? n.width : 240);
      const oldRoots = existing.filter((n) => !n.parentId);
      const roots = importedNodes.filter((n) => !n.parentId);
      if (oldRoots.length && roots.length) {
        const right = oldRoots.reduce((m, n) => Math.max(m, n.position.x + widthOf(n)), -Infinity);
        const top = oldRoots.reduce((m, n) => Math.min(m, n.position.y), Infinity);
        const minX = roots.reduce((m, n) => Math.min(m, n.position.x), Infinity);
        const minY = roots.reduce((m, n) => Math.min(m, n.position.y), Infinity);
        const dx = right + 120 - minX;   // clear of the widest existing node, with a gap
        const dy = top - minY;           // tops aligned, so the two blocks read as columns
        for (const n of roots) n.position = { x: n.position.x + dx, y: n.position.y + dy };
      }
    }
    // Advance the id counter past any imported "<tool>_<n>" ids so new nodes don't collide.
    for (const n of importedNodes) {
      const m = /_(\d+)$/.exec(n.id);
      if (m) nodeSeq = Math.max(nodeSeq, parseInt(m[1], 10) + 1);
    }
    // Guarantee a primary source node exists (pipeline input) — but ANY source-family node counts (a Node /
    // Segment / Canvas object decompiles from its own source), so we don't force a stray Space `source` onto
    // a graph that already has, say, a `node-source`. On a merge the graph already on the canvas counts too.
    const SOURCE_TOOLS = new Set<FlowToolType>(["source", "node-source", "segment-source", "canvas-source", "graph-source", "grid-source", "image"]);
    const hasSource = [...existing, ...importedNodes].some((n) => SOURCE_TOOLS.has((n.data as FlowNodeData).tool));
    if (!hasSource) {
      importedNodes.unshift(makeNode("source", { x: 80, y: 200 }, nodeCb, { singleton: true }));
    }
    // React Flow needs a parent node to precede its children — existing nodes are already ordered, and the
    // imported block is ordered here (after the source node was prepended), so concatenating preserves both.
    const orderedNodes = orderByParent(importedNodes);
    setNodes(existing.length ? [...existing, ...orderedNodes] : orderedNodes);
    setEdges(existing.length ? [...edgesRef.current, ...importedEdges] : importedEdges);
    setInitialised(true);
    return importedNodes.length;
  }, [nodeCb, setNodes, setEdges]);
  importFlowDataRef.current = importFlowData;

  // Seed the graph when the overlay opens: from the Space's stored flow if present, else a lone Source.
  useEffect(() => {
    if (!props.open || initialised) return;
    const g = props.initialGraph;
    if (g && Array.isArray(g.nodes) && g.nodes.length) {
      try { importFlowData(g); return; } catch { /* fall through to an empty canvas */ }
    }
    // First load with no stored flow → empty canvas. Add a Space node from the palette to begin.
    setNodes([]);
    setInitialised(true);
  }, [props.open, props.initialGraph, initialised, importFlowData, setNodes]);

  // Emit graph changes so the host can persist them onto the selected Space.
  const onGraphChangeRef = useRef(props.onGraphChange);
  onGraphChangeRef.current = props.onGraphChange;
  useEffect(() => {
    if (!initialised) return;
    onGraphChangeRef.current?.(buildGraph());
  }, [buildGraph, initialised]);

  // Drawing TYPES from an active "Schema to Drawing Tools" node — derived straight from the live nodes
  // (always current, unlike the mirrored graph) and emitted to the host for the drawing dropdowns.
  const drawingTools = useMemo(() => {
    const toolsNode = nodes.find((n) => (n.data as FlowNodeData)?.tool === "schema-to-drawing");
    if (!toolsNode) return undefined;
    const schemaNode = nodes.find((n) => (n.data as FlowNodeData)?.tool === "schema" && edges.some((e) => e.source === n.id && e.target === toolsNode.id))
      ?? nodes.find((n) => (n.data as FlowNodeData)?.tool === "schema");
    if (!schemaNode) return undefined;
    const label = (s: string) => s.split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const toolsFor = (param: "segmentProps" | "nodeProps" | "spaceProps", roles: readonly string[]) => {
      const entries = schemaEntries((schemaNode.data as FlowNodeData)?.params ?? {}, param);
      const disc = entries.find((e) => roles.includes(e.role)) ?? entries.find((e) => e.kind === "select" && e.key === "type");
      return disc ? disc.options.map((v) => ({ value: v, label: label(v), icon: disc.optionIcons?.[v] })) : [];
    };
    const segments = toolsFor("segmentProps", ["seg-type"]);
    const nodeTools = toolsFor("nodeProps", ["node-type"]);
    const spaces = toolsFor("spaceProps", ["space-type"]);
    return (segments.length || nodeTools.length || spaces.length) ? { segments, nodes: nodeTools, spaces } : undefined;
  }, [nodes, edges]);
  const onDrawingToolsChangeRef = useRef(props.onDrawingToolsChange);
  onDrawingToolsChangeRef.current = props.onDrawingToolsChange;
  const drawToolsSigRef = useRef<string>("");
  useEffect(() => {
    const sig = JSON.stringify(drawingTools ?? null);
    if (sig === drawToolsSigRef.current) return;
    drawToolsSigRef.current = sig;
    onDrawingToolsChangeRef.current?.(drawingTools);
  }, [drawingTools]);

  // Expose a param-setter so the Properties tab can edit a node param while the overlay is open; the
  // edit flows through the overlay's own state (single source of truth) and mirrors back out.
  const runDetectAllApiRef = props.runDetectAllApiRef;
  useEffect(() => {
    if (!runDetectAllApiRef) return;
    runDetectAllApiRef.current = async () => {
      // Report onto the first brief, which is where the button in the Properties tab is rendered from.
      const brief = nodesRef.current.find((n) => (n.data as FlowNodeData).tool === "input-props");
      await onRunAllDetect(brief?.id ?? "");
    };
    return () => { runDetectAllApiRef.current = null; };
  }, [runDetectAllApiRef, onRunAllDetect]);
  const runApplyAllApiRef = props.runApplyAllApiRef;
  useEffect(() => {
    if (!runApplyAllApiRef) return;
    runApplyAllApiRef.current = async () => {
      const brief = nodesRef.current.find((n) => (n.data as FlowNodeData).tool === "input-props");
      await onRunAllApply(brief?.id ?? "");
    };
    return () => { runApplyAllApiRef.current = null; };
  }, [runApplyAllApiRef, onRunAllApply]);
  const paramApiRef = props.paramApiRef;
  useEffect(() => {
    if (!paramApiRef) return;
    paramApiRef.current = (nodeId, key, value) => onParamChange(nodeId, key, value);
    return () => { paramApiRef.current = null; };
  }, [paramApiRef, onParamChange]);

  // Expose an object-injector so assigning a Space id to a canvas furniture node mirrors it into the
  // live graph as a Space → Place Object chain. Merge the current graph, then re-import to apply (which
  // re-attaches node callbacks); buildGraph captures live positions so existing nodes don't jump.
  const injectObjectRef = props.injectObjectRef;
  useEffect(() => {
    if (!injectObjectRef) return;
    injectObjectRef.current = (spaceId, entry) => importFlowData(mergeObjectIntoFlow(buildGraph(), spaceId, entry));
    return () => { injectObjectRef.current = null; };
  }, [injectObjectRef, buildGraph, importFlowData]);

  // Same bridge for a freshly-drawn door/window: mirror it into the graph as a Segment → Segment-to-Door/
  // Window chain while the overlay is open (when closed the host edits liveFlowGraph directly).
  const injectOpeningRef = props.injectOpeningRef;
  useEffect(() => {
    if (!injectOpeningRef) return;
    injectOpeningRef.current = (openingWallId, kind) => importFlowData(mergeOpeningIntoFlow(buildGraph(), openingWallId, kind));
    return () => { injectOpeningRef.current = null; };
  }, [injectOpeningRef, buildGraph, importFlowData]);

  // Bridge for starting a wall draw: ensure the Canvas-Graph → Graph to Walls chain exists (idempotent).
  const injectWallGraphRef = props.injectWallGraphRef;
  useEffect(() => {
    if (!injectWallGraphRef) return;
    injectWallGraphRef.current = () => importFlowData(mergeWallGraphIntoFlow(buildGraph()));
    return () => { injectWallGraphRef.current = null; };
  }, [injectWallGraphRef, buildGraph, importFlowData]);

  // Bridge for a freshly-placed furniture node: mirror it as a Node → Node to Object chain.
  const injectNodeObjectRef = props.injectNodeObjectRef;
  useEffect(() => {
    if (!injectNodeObjectRef) return;
    injectNodeObjectRef.current = (nodeId) => importFlowData(mergeNodeObjectIntoFlow(buildGraph(), nodeId));
    return () => { injectNodeObjectRef.current = null; };
  }, [injectNodeObjectRef, buildGraph, importFlowData]);

  // Bridge for an object attached to a canvas node: mirror it as a Node → Parametric Object chain, so the
  // flow holds the parameter values and the Properties panel renders that node's props.
  const injectAttachedObjectRef = props.injectAttachedObjectRef;
  useEffect(() => {
    if (!injectAttachedObjectRef) return;
    injectAttachedObjectRef.current = (nodeDisplayId, pobj) => importFlowData(mergeAttachedObjectIntoFlow(buildGraph(), nodeDisplayId, pobj));
    return () => { injectAttachedObjectRef.current = null; };
  }, [injectAttachedObjectRef, buildGraph, importFlowData]);

  // Bridge for the Chat AI Flow agent: read the live graph (buildGraph) + apply a generated one
  // (importFlowData normalises + re-attaches node callbacks). Assigned while mounted; the host reads
  // liveFlowGraph when the overlay is closed.
  // (flowApiRef registration lives further down, after `compiled` + `sourcesReady` exist — the bridge
  //  exposes compile/runCommit which close over them.)
  const flowApiRef = props.flowApiRef;

  const importFlow = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        // Imports ADD to the canvas (see importFlowData's `merge`) — importing a second flow keeps the first.
        const n = importFlowData(JSON.parse(String(reader.result)), { merge: true });
        flowTitleRef.current = prettyFlowName(file.name);
        toast.success(`Imported flow — added ${n} node${n === 1 ? "" : "s"}`);
      } catch (err) {
        toast.error("Invalid flow JSON");
        console.error("Flow import failed:", err);
      }
    };
    reader.readAsText(file);
  }, [importFlowData]);

  // Drop a single `pobj-source` node for an already-parsed parametric object: geometry output = footprint,
  // each parameter = a `val-<key>` output. Used by the Import browser's "Objects" folder.
  const dropPobjSourceNode = useCallback((pobj: Record<string, unknown>) => {
    if (pobj.kind !== "parametric-object") throw new Error("not a parametric-object file");
    // Also register it in the CANVAS object library (idempotent host-side), so importing an object in the
    // flow makes it available on the canvas too — attachable from the Properties "Attach object" dropdown,
    // and resolvable by any attachment that references it. Mirrors importing via the Properties tab.
    props.onImportObjectToLibrary?.(pobj);
    // An object that declares an explicit `flow` decompilation (a wired Inset / Circle Packing / Cylinder …
    // chain) OR opts into `decompile: "primitives"` (its geometry rules exploded into Rectangle / Circle
    // primitive nodes) materialises the WHOLE graph instead of dropping a lone node. Same derive-on-load path
    // as the Space "Edit in Flow" button (shared pobjToFlow).
    const flow = pobj.flow as { nodes?: unknown[] } | undefined;
    const wantsGraph = (flow && Array.isArray(flow.nodes) && flow.nodes.length) || pobj.decompile === "primitives";
    if (wantsGraph) {
      // Positions are LOCAL — the decompile is anchored to the host node DYNAMICALLY at render time (2D via
      // createAnchor, 3D via the `_nodeFollow` offset), so it follows when the node is dragged.
      const n = importFlowData(pobjToAttachedFlow(pobj as unknown as ParametricObjectFile, {}), { merge: true });
      const nm = (pobj.meta as { name?: string } | undefined)?.name ?? "object";
      toast.success(`Loaded "${nm}" as a Flow — added ${n} node${n === 1 ? "" : "s"}`);
      return;
    }
    const name = (pobj.meta as { name?: string } | undefined)?.name ?? "site";
    const node = makeNode("pobj-source", { x: 120, y: 220 }, nodeCb);
    // `nodeLabel` titles the node with the OBJECT's name ("Site", "Chair") rather than the generic tool
    // label, so several imported objects stay tellable apart. Deliberately not `_`-prefixed: those keys are
    // stripped on export (buildGraph), and the name has to survive a save/reload. `objectId` identifies WHICH
    // library object this is, so the attach-from-Properties bridge can stay idempotent per (node, object).
    (node.data as FlowNodeData).params = {
      ...(node.data as FlowNodeData).params,
      definition: JSON.stringify(pobj),
      objectId: String((pobj.meta as { id?: string } | undefined)?.id ?? ""),
      props: pobjPropList(pobj),
      nodeLabel: name,
    };
    setNodes((ns) => [...ns, node]);
    toast.success(`Loaded "${name}" as a Parametric Object node`);
  }, [setNodes, nodeCb, importFlowData]);

  // ── Import via paste: drop flow JSON straight into a textarea (no file needed). ──
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const importPasted = useCallback(() => {
    const text = pasteText.trim();
    if (!text) { toast.error("Paste flow JSON first"); return; }
    try {
      const n = importFlowData(JSON.parse(text), { merge: true });
      toast.success(`Imported flow — added ${n} node${n === 1 ? "" : "s"}`);
      setImportOpen(false);
      setPasteText("");
    } catch (err) {
      toast.error("Invalid flow JSON");
      console.error("Flow paste import failed:", err);
    }
  }, [pasteText, importFlowData]);

  // ── Bundled Library workflows (Workflows/) — listed live via the dev Library bridge so
  // the Import dropdown loads them in one click. Replaces the old built-in workflow-templates rail: the
  // templates now ship as JSON files in that folder. Null/empty = bridge unavailable (production
  // build) → the section hides; the same files still import via "Upload .json file". ──
  const [libraryFlows, setLibraryFlows] = useState<string[] | null>(null);
  useEffect(() => {
    if (!importOpen) return;
    let cancelled = false;
    void listWorkflowFiles().then((files) => { if (!cancelled) setLibraryFlows(files); });
    return () => { cancelled = true; };
  }, [importOpen]);
  /** Fetch a Library JSON and import it AS WHAT IT IS, deciding from its CONTENT rather than from the folder
   *  that listed it.
   *
   *  The listings are rooted at different folders — `Objects`, `Tools` and `Workflows` — and it used to be
   *  the folder that chose the loader. That holds only while every file sits where its type says it should,
   *  and the object folders are exactly where a hand-organised library stops obeying: `listParametricObjectFiles`
   *  filters on `.json`, not `.pobj.json`, so a WORKFLOW filed next to the object it models (window.json beside
   *  window.pobj.json) was listed under Objects and then handed to the pobj loader, which rejects
   *  anything without `kind: "parametric-object"` — "Couldn't load window.json", with nothing wrong with the file.
   *
   *  Content is the honest discriminator: a `nodes` array is a workflow, `kind: "parametric-object"` is an
   *  object, a lone `tool` is a node template. Any of the three now imports from either listing. */
  const importLibraryJson = useCallback(async (rel: string, file: string) => {
    const parsed = await fetchLibraryJson<{ nodes?: unknown[]; edges?: unknown[]; title?: unknown; kind?: unknown; tool?: unknown; label?: unknown; params?: unknown; parameters?: unknown; geometry?: unknown; meta?: { label?: unknown } }>(rel);
    if (!parsed) throw new Error(`not found in the Library: ${rel}`);
    // A PARAMETRIC OBJECT — drops a pobj-source node (or materialises its declared decompile).
    const isPobj = parsed.kind === "parametric-object"
      || (!Array.isArray(parsed.nodes) && Array.isArray(parsed.parameters) && !!parsed.geometry);
    if (isPobj) {
      dropPobjSourceNode(parsed as Record<string, unknown>);
      return;
    }
    // A NODE TEMPLATE file (Tools/**/*.node.json — a single "flow-node" tool with
    // no nodes[]) is ADDED as one node to the current graph. Treating it as a whole workflow would throw
    // "missing nodes array" (→ "Couldn't load"). Everything else is a workflow → replaces the graph.
    const isNodeFile = !Array.isArray(parsed.nodes) && (parsed.kind === "flow-node" || typeof parsed.tool === "string");
    if (isNodeFile) {
      const tool = parsed.tool as FlowToolType;
      if (!FLOW_TOOLS[tool]) throw new Error(`unknown tool "${String(parsed.tool)}"`);
      // Node declarations carry a params SCHEMA (no presets); agent-saved templates carry preset `params`.
      const preset = parsed.params && typeof parsed.params === "object" ? (parsed.params as Record<string, unknown>) : undefined;
      const label =
        (typeof parsed.label === "string" && parsed.label) ||
        (parsed.meta && typeof parsed.meta.label === "string" ? parsed.meta.label : undefined) ||
        FLOW_TOOLS[tool].label;
      setNodes((ns) => {
        const pos = { x: 160 + (ns.length % 5) * 48, y: 120 + (ns.length % 7) * 40 };
        const node = makeNode(tool, pos, nodeCb);
        if (preset) node.data = { ...(node.data as FlowNodeData), params: { ...(node.data as FlowNodeData).params, ...preset } };
        return [...ns, node];
      });
      toast.success(`Added ${label} node`);
      return;
    }
    // A workflow file is ADDED beside whatever is already on the canvas, exactly like a node template is.
    const n = importFlowData(parsed, { merge: true });
    flowTitleRef.current = prettyFlowName(file);
    toast.success(`Imported ${typeof parsed.title === "string" && parsed.title ? parsed.title : file} — added ${n} node${n === 1 ? "" : "s"}`);
  }, [importFlowData, setNodes, nodeCb, dropPobjSourceNode]);

  /** Import one Library file by its ROOT ("Objects" / "Tools" / "Workflows") + root-relative path. The
   *  root only locates the file — {@link importLibraryJson} still routes by CONTENT, so a workflow filed
   *  beside the object it models (window.json next to window.pobj.json) imports as a workflow. */
  const importLibraryFile = useCallback(async (root: string, file: string) => {
    try {
      await importLibraryJson(`${root}/${file}`, file);
      setImportOpen(false);
    } catch (err) {
      toast.error(`Couldn't load ${file}`);
      console.error(`Library ${root} import failed:`, err);
    }
  }, [importLibraryJson]);
  const importLibraryFlow = useCallback((file: string) => importLibraryFile(LIB_WORKFLOWS, file), [importLibraryFile]);

  // ── Bundled Objects + Tools (Objects/, Tools/) — listed live so the Import
  // browser exposes them as foldable groups beside Workflows. Picking an OBJECT leaf drops a single
  // pobj-source node (geometry footprint output + a val-<key> output per parameter); picking a TOOL leaf
  // adds that one node. Both list LIVE in dev and fall back to their bundled manifest in production, so the
  // groups populate in both. Empty = nothing on disk → the group hides. ──
  const [libraryPobjs, setLibraryPobjs] = useState<string[] | null>(null);
  const [libraryTools, setLibraryTools] = useState<string[] | null>(null);
  useEffect(() => {
    if (!importOpen) return;
    let cancelled = false;
    void listParametricObjectFiles().then((files) => { if (!cancelled) setLibraryPobjs(files); });
    void listFlowNodeFiles().then((files) => { if (!cancelled) setLibraryTools(files); });
    return () => { cancelled = true; };
  }, [importOpen]);

  // Import browser: one foldable tree per Library root (Objects / Tools / Workflows) + a fuzzy search box.
  // `importExpanded` holds the open folder keys (the three roots start open); `importSearch` switches the
  // panel to a flat ranked list across all three.
  const [importSearch, setImportSearch] = useState("");
  // The three roots start CLOSED. They used to start open, which put 171 rows (15 objects + 111 tools +
  // 45 workflows) into a max-h-64 scroller — so Workflows, rendered third, sat ~126 rows below the fold and
  // read as "not there". Closed, all three headers are visible at once and the search box covers the case
  // where you already know the file name.
  const [importExpanded, setImportExpanded] = useState<Set<string>>(() => new Set<string>());
  const toggleImportFolder = useCallback((key: string) => {
    setImportExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);
  const importTree = useMemo(() => buildFolderTree(libraryFlows ?? [], LIB_WORKFLOWS), [libraryFlows]);
  const pobjTree = useMemo(() => buildFolderTree(libraryPobjs ?? [], LIB_OBJECTS), [libraryPobjs]);
  const toolTree = useMemo(() => buildFolderTree(libraryTools ?? [], LIB_TOOLS), [libraryTools]);
  // Fuzzy search → a flat ranked list (basename prefix > basename substring > path substring) across all
  // three roots, each match keeping the root it came from. Null when the box is empty (the tree shows).
  const importMatches = useMemo(() => {
    const q = importSearch.trim().toLowerCase();
    if (!q) return null;
    const rank = (f: string): number => {
      const base = (f.split("/").pop() ?? f).toLowerCase();
      if (base.startsWith(q)) return 0;
      if (base.includes(q)) return 1;
      if (f.toLowerCase().includes(q)) return 2;
      return 99;
    };
    const all = [
      ...(libraryPobjs ?? []).map((f) => ({ root: LIB_OBJECTS, f })),
      ...(libraryTools ?? []).map((f) => ({ root: LIB_TOOLS, f })),
      ...(libraryFlows ?? []).map((f) => ({ root: LIB_WORKFLOWS, f })),
    ];
    return all
      .map((x) => ({ ...x, r: rank(x.f) }))
      .filter((x) => x.r < 99)
      .sort((a, b) => a.r - b.r || (a.f.split("/").pop() ?? a.f).localeCompare(b.f.split("/").pop() ?? b.f))
      .slice(0, 50);
  }, [importSearch, libraryPobjs, libraryTools, libraryFlows]);
  // Clear the search whenever the dropdown closes so it reopens clean.
  useEffect(() => { if (!importOpen) setImportSearch(""); }, [importOpen]);

  // When a Split node's piece count shrinks, drop edges that referenced a now-gone output handle
  // (e.g. an edge from "out-4" after Pieces dropped to 3) so they don't dangle.
  useEffect(() => {
    setEdges((es) => {
      const next = es.filter((e) => {
        if (!e.sourceHandle || !e.sourceHandle.startsWith("out-")) return true;
        const src = nodes.find((n) => n.id === e.source);
        if (!src) return true;
        const def = FLOW_TOOLS[(src.data as FlowNodeData).tool];
        const n = def.outputCount ? def.outputCount((src.data as FlowNodeData).params) : def.hasOutput ? 1 : 0;
        const idx = parseInt(e.sourceHandle.slice(4), 10);
        return Number.isFinite(idx) && idx < n;
      });
      return next.length === es.length ? es : next;
    });
  }, [nodes, setEdges]);

  // Delete the currently-selected connection(s) and/or node(s). The Source node is protected
  // (deletable: false). Dangling edges of removed nodes are dropped too.
  const hasSelection = nodes.some((n) => n.selected) || edges.some((e) => e.selected);
  const deleteSelected = useCallback(() => {
    // Group boxes: deleting one dissolves the group — its children survive (re-anchored to absolute
    // coords), only the box is removed. Other selected nodes (and their edges) are deleted as usual.
    const groupIds = new Set(nodes.filter((n) => n.selected && n.type === "group").map((n) => n.id));
    const removedOps = new Set(nodes.filter((n) => n.selected && n.type !== "group" && n.deletable !== false).map((n) => n.id));
    // Tell the host so a canvas attachment linked to a deleted node is dropped too (this path sets state
    // directly, bypassing onNodesChange, so it must notify explicitly).
    if (removedOps.size) props.onFlowNodesDeleted?.([...removedOps]);
    // Children of a dissolved group — or of a deleted node that had Output Metrics DOCKED inside it — must be
    // re-anchored to absolute coords and lose the `hidden` the collapse toggle put on them (and their edges);
    // otherwise deleting a COLLAPSED box leaves its nodes alive but invisible, and a deleted brief leaves its
    // docked child pointing at a parent that no longer exists.
    const dissolved = new Set([...groupIds, ...removedOps]);
    const orphaned = new Set(nodes.filter((n) => n.parentId && dissolved.has(n.parentId)).map((n) => n.id));
    setEdges((es) => es
      .filter((e) => !e.selected && !removedOps.has(e.source) && !removedOps.has(e.target))
      .map((e) => (e.hidden && (orphaned.has(e.source) || orphaned.has(e.target)) ? { ...e, hidden: false } : e)));
    if (groupIds.size || removedOps.size) {
      setNodes((ns) => {
        const gpos = new Map(ns.filter((n) => dissolved.has(n.id)).map((n) => [n.id, n.position]));
        return ns
          .filter((n) => !groupIds.has(n.id) && !removedOps.has(n.id))
          .map((n) => {
            if (n.parentId && dissolved.has(n.parentId)) {
              const gp = gpos.get(n.parentId)!;
              const { parentId: _p, extent: _e, ...rest } = n;
              void _p; void _e;
              const p = { ...(n.data as FlowNodeData).params };
              delete p._dockedFrom;
              return { ...rest, hidden: false, position: { x: n.position.x + gp.x, y: n.position.y + gp.y }, data: { ...n.data, params: p } } as Node;
            }
            return n;
          });
      });
    }
  }, [nodes, setNodes, setEdges]);

  // Wrap the selected (ungrouped, non-source) op nodes in a container box so they move together. The
  // box becomes their parent; children switch to parent-relative coords with `extent: "parent"`.
  const canGroup = nodes.filter((n) => n.selected && n.type !== "group" && !n.parentId && (n.data as FlowNodeData).tool !== "source").length >= 2;
  const groupSelected = useCallback(() => {
    setNodes((ns) => {
      const sel = ns.filter((n) => n.selected && n.type !== "group" && !n.parentId && (n.data as FlowNodeData).tool !== "source");
      if (sel.length < 2) return ns;
      const dim = (n: Node) => ({ w: n.measured?.width ?? n.width ?? 200, h: n.measured?.height ?? n.height ?? 120 });
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of sel) {
        const { w, h } = dim(n);
        minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y);
        maxX = Math.max(maxX, n.position.x + w); maxY = Math.max(maxY, n.position.y + h);
      }
      const gx = minX - GROUP_PAD, gy = minY - GROUP_PAD - GROUP_HEADER;
      const groupNode: Node = {
        id: nextId("group"),
        type: "group",
        position: { x: gx, y: gy },
        // Chevron/rename callbacks ride on the box's data exactly as they do for op nodes.
        data: { tool: "group", params: { label: "Group" }, onParamChange: nodeCb.onParamChange, onToggleGroup: nodeCb.onToggleGroup } as unknown as FlowNodeData,
        style: { width: (maxX - minX) + GROUP_PAD * 2, height: (maxY - minY) + GROUP_PAD * 2 + GROUP_HEADER },
        selectable: true,
        draggable: true,
        deletable: true,
      };
      const selIds = new Set(sel.map((n) => n.id));
      // Parent MUST precede its children in the array (React Flow requirement) → prepend the box.
      const rest = ns.map((n) => (selIds.has(n.id)
        ? { ...n, parentId: groupNode.id, extent: "parent" as const, selected: false, position: { x: n.position.x - gx, y: n.position.y - gy } }
        : n));
      return [groupNode, ...rest];
    });
  }, [setNodes, nodeCb]);

  // "Arrange" — collapse the whole OPERATION into one named, foldable box, leaving only what reads the canvas
  // outside it.
  //   • IN the box, each folded to its title bar and stacked: Input Properties, the Math Engine, the Output
  //     Metrics collector, the 2D and 3D primitives, and every other op — the operation's whole body. Folding
  //     hides their per-parameter endpoints, but the folded-edge view transform (see `viewNodes`) collapses
  //     the wires between two folded nodes into one "×N" edge on their title bars, so nothing looks
  //     disconnected and the real graph is untouched.
  //   • OUT of the box, unfolded, positions untouched: the canvas READERS — every source, Grab Object, and
  //     the Agent, whose Run button has to stay reachable.
  // Idempotent: existing groups are flattened first, so pressing it twice gives the same result.
  const arrangeFlow = useCallback(() => {
    // What stays outside. Everything NOT listed here is part of the operation and gets boxed, so a tool added
    // later is folded away by default rather than silently left loose on the canvas.
    const KEEP_OUT = new Set<string>([
      "source", "node-source", "segment-source", "canvas-source", "graph-source", "grid-source",
      "freehand-source", "image", "grab-object", "agent",
    ]);
    setNodes((ns) => {
      // 1. Flatten every parenting → children back to ABSOLUTE coords; drop the group boxes. Covers a group
      //    box AND a decompiled brief with Output Metrics docked inside it (possibly nested inside a box), so
      //    Arrange always starts from a flat, unfolded graph — the decompile-fold params go with it.
      const byId = new Map(ns.map((n) => [n.id, n] as const));
      const absPos = (n: Node) => {
        let { x, y } = n.position;
        let p = n.parentId ? byId.get(n.parentId) : undefined;
        for (let i = 0; p && i < 8; i++) { x += p.position.x; y += p.position.y; p = p.parentId ? byId.get(p.parentId) : undefined; }
        return { x, y };
      };
      const flat: Node[] = ns.filter((n) => n.type !== "group").map((n) => {
        const { parentId: _p, extent: _e, ...rest } = n; void _p; void _e;
        const params = { ...(n.data as FlowNodeData).params };
        delete params._dockedFrom; delete params._dockH; delete params._decompileHidden;
        return { ...rest, hidden: false, position: absPos(n), data: { ...n.data, params } } as Node;
      });
      // 2. Split into the interface (kept, unfolded) and the internals (boxed, folded).
      const kept: Node[] = [], inner: Node[] = [];
      for (const n of flat) (KEEP_OUT.has((n.data as FlowNodeData).tool) ? kept : inner).push(n);
      // Unfold the interface — Arrange is deterministic, so a hand-folded brief comes back open.
      const keptOut = kept.map((n) => {
        const p = (n.data as FlowNodeData).params;
        return p._collapsed ? ({ ...n, data: { ...n.data, params: { ...p, _collapsed: false } } } as Node) : n;
      });
      if (!inner.length) return keptOut;
      // 3. One group box, to the right of everything kept and level with the topmost of them. It is titled
      //    after the WORKFLOW it came from ("inset_with_math.json" → "Inset with Math"), so a folded operation
      //    still says which one it is; a hand-built flow falls back to its Math Engine's Name, then "Operation".
      //    The header's label is editable either way.
      const gx = Math.max(0, ...keptOut.map((n) => n.position.x + (n.measured?.width ?? 260))) + 60;
      const gy = keptOut.length ? Math.min(...keptOut.map((n) => n.position.y)) : 40;
      const mathName = inner
        .map((n) => (n.data as FlowNodeData))
        .find((d) => d.tool === "expr" && typeof d.params.name === "string" && d.params.name.trim())?.params.name;
      const label = flowTitleRef.current.trim()
        || (typeof mathName === "string" && mathName.trim() ? mathName.trim() : "")
        || "Operation";
      const gid = nextId("group");
      const box: Node = {
        id: gid, type: "group", position: { x: gx, y: gy },
        data: { tool: "group", params: { label },
          onParamChange: nodeCb.onParamChange, onToggleGroup: nodeCb.onToggleGroup } as unknown as FlowNodeData,
        style: { width: 256, height: GROUP_HEADER + GROUP_PAD + inner.length * 44 + GROUP_PAD },
        selectable: true, draggable: true, deletable: true,
      };
      const children = inner.map((m, i) => ({
        ...m, parentId: gid, extent: "parent" as const, selected: false, hidden: false,
        position: { x: GROUP_PAD, y: GROUP_HEADER + GROUP_PAD + i * 44 },
        data: { ...m.data, params: { ...(m.data as FlowNodeData).params, _collapsed: true } } as FlowNodeData,
      }));
      // Parent boxes MUST precede their children (React Flow); kept nodes can sit anywhere between.
      return [box, ...keptOut, ...children];
    });
  }, [setNodes, nodeCb]);

  // Commit compilation (Run Flow) — uses `on` so each step targets the previous step's
  // committed output rooms. Also drives the status line + JSON view.
  const compiled = useMemo(() => compileFlow(nodes, edges, "commit"), [nodes, edges]);

  // Live PURE preview: evaluate the DAG as pure function composition (no engine, no refs) and
  // hand the resulting per-node output polygons up for canvas overlay rendering. Deterministic
  // and order-independent — this is the sequential pipeline the user expects.
  const { open, selectedRoomLabel } = props;
  const ppm = props.pixelsPerMeter;
  // Resolve EACH Space (source) node's id LIST → its own polygons via the host (display id "Space001" /
  // room id / label). A Space node may reference several spaces (comma/newline separated), so it outputs
  // them all as a bundle on its single endpoint. Independent of the current canvas selection.
  const resolveSpacePolygon = props.resolveSpacePolygon;
  // A "source" Space node, or a "Grab Object" node set to Host = Space, both feed a Space's footprint into the
  // pipeline (Grab Object additionally publishes the attached object's params as val-<key>). Both resolve
  // their id via the host, so both are treated as Space sources here → geometry + run-readiness.
  const sourceEntries = nodes
    .filter((n) => { const d = n.data as FlowNodeData; return d.tool === "source" || d.tool === "plan-json" || (d.tool === "grab-object" && d.params.hostKind === "space"); })
    .map((n) => {
      const idStr = String((n.data as FlowNodeData).params.id ?? "").trim();
      const ids = idStr.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
      const polys = (resolveSpacePolygon ? ids.map((sid) => resolveSpacePolygon(sid)) : [])
        .filter((p): p is Point[] => !!p && p.length >= 3);
      return { nodeId: n.id, idStr, ids, polys };
    });
  // Per-source polygon LISTS keyed by source NODE id — evaluateFlow reads each source's own space(s).
  const sourcePolys = new Map(sourceEntries.map((e) => [e.nodeId, e.polys]));
  sourcePolysRef.current = sourcePolys;
  // A Space node is GENUINELY broken only if it has a typed id that matches no space — that blocks the
  // run. An EMPTY-id Space node (grab on, nothing selected) is just unconfigured and must NOT block other
  // roots (Selected Graph / Space Creator). Drives the footer.
  const badSource = sourceEntries.find((e) => e.idStr !== "" && e.polys.length < e.ids.length);
  const anySpaceReady = sourceEntries.some((e) => e.ids.length > 0 && e.polys.length === e.ids.length);
  // A Space Creator is a self-sufficient root (always generates geometry), so a creator-only flow is ready.
  const hasCreator = nodes.some((n) => (n.data as FlowNodeData).tool === "space-creator");
  // Resolve EACH Graph (graph-source) node's referenced graph(s): the live selection while grabbing, else
  // its typed id list resolved via the host. One node may reference several graphs (comma-separated ids).
  const graphSegments = props.selectedGraphSegments ?? [];
  const resolveGraphSegments = props.resolveGraphSegments;
  const segmentSegments = props.selectedSegmentSegments ?? [];
  const resolveSegmentSegments = props.resolveSegmentSegments;
  const nodeSegments = props.selectedNodeSegments ?? [];
  const resolveNodeSegments = props.resolveNodeSegments;
  const gridSegments = props.selectedGridSegments ?? [];
  const resolveGridSegments = props.resolveGridSegments;
  // graph-source, segment-source, node-source and grid-source share the same downstream machinery (all emit
  // polylines; a node is a single-point polyline). They differ only in their selection source and, for
  // segment/node, that each selected element is its own graph (so "Per …" yields one handle each).
  const graphEntries = nodes
    .filter((n) => { const t = (n.data as FlowNodeData).tool; return t === "graph-source" || t === "segment-source" || t === "node-source" || t === "grid-source"; })
    .map((n) => {
      const d = n.data as FlowNodeData;
      const isSeg = d.tool === "segment-source";
      const isNode = d.tool === "node-source";
      const isGrid = d.tool === "grid-source";
      const perElement = isSeg || isNode;
      const liveSel = isGrid ? gridSegments : isNode ? nodeSegments : isSeg ? segmentSegments : graphSegments;
      const resolver = isGrid ? resolveGridSegments : isNode ? resolveNodeSegments : isSeg ? resolveSegmentSegments : resolveGraphSegments;
      let graphs: Point[][][];
      if (d.params.grabFromSelection !== false) {
        // Segments/Nodes: each selected element is its own graph. Graph: the whole network is one.
        graphs = liveSel.length ? (perElement ? liveSel.map((s) => [s]) : [liveSel]) : [];
      } else {
        const ids = String(d.params.id ?? "").split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
        graphs = (resolver ? ids.map((gid) => resolver(gid)) : [])
          .filter((g): g is Point[][] => !!g && g.length > 0);
      }
      return { nodeId: n.id, graphs };
    });
  // Freehand nodes: emit every canvas freehand stroke matching the node's `color` param (blank = all) as ONE
  // polyline network. Freehand is already vector, so it plugs straight into the graph-source machinery.
  const freehandStrokes = props.freehandStrokes ?? [];
  const freehandEntries = nodes
    .filter((n) => (n.data as FlowNodeData).tool === "freehand-source")
    .map((n) => {
      const col = String((n.data as FlowNodeData).params.color ?? "").trim().toLowerCase();
      const matched = freehandStrokes.filter((s) => !col || (s.color ?? "").trim().toLowerCase() === col).map((s) => s.points).filter((p) => p.length >= 2);
      return { nodeId: n.id, graphs: (matched.length ? [matched] : []) as Point[][][] };
    });
  const graphsBySourceNode = new Map([...graphEntries, ...freehandEntries].map((e) => [e.nodeId, e.graphs]));
  const hasGraphRoot = graphEntries.some((e) => e.graphs.length > 0) || freehandEntries.some((e) => e.graphs.length > 0);
  // Grid (grid-source) nodes also publish a typed grid-field (grabbed selection, or resolved by id) so the
  // grid pipeline (Grid Threshold, …) can read per-cell values.
  const selectedGridField = props.selectedGridField ?? null;
  const resolveGridField = props.resolveGridField;
  const gridFieldsBySourceNode = new Map<string, GridField>();
  for (const n of nodes) {
    const d = n.data as FlowNodeData;
    if (d.tool !== "grid-source") continue;
    let field: GridField | null = null;
    if (d.params.grabFromSelection !== false) field = selectedGridField;
    else { const gid = String(d.params.id ?? "").trim(); field = gid && resolveGridField ? resolveGridField(gid) : null; }
    if (field) gridFieldsBySourceNode.set(n.id, field);
  }
  // An Image node is a root once an underlay image is loaded.
  const imageData = props.imageData;
  const hasImageRoot = !!imageData && nodes.some((n) => (n.data as FlowNodeData).tool === "image");
  // A Canvas node is a root once the canvas has any content.
  const canvasContent = props.canvasContent;
  const canvasHasContent = !!canvasContent &&
    (canvasContent.spaces.length > 0 || canvasContent.nodes.length > 0 || canvasContent.segments.length > 0 || canvasContent.graphs.length > 0 || canvasContent.images.length > 0);
  const hasCanvasRoot = canvasHasContent && nodes.some((n) => (n.data as FlowNodeData).tool === "canvas-source");
  // Plan JSON is a root on exactly the same terms as the Canvas node: it reads the canvas itself and needs
  // no wire, so a flow whose only root is a Plan JSON must still evaluate. Without this it fails the
  // readiness gate, evaluateFlow is never called, and the node sits empty until some OTHER root happens to
  // be present — which is not obvious from looking at it. It is deliberately NOT gated on a selection:
  // with nothing selected the node reports the WHOLE canvas, which is a valid, useful answer.
  const hasPlanJsonRoot = canvasHasContent && nodes.some((n) => (n.data as FlowNodeData).tool === "plan-json");
  // The overlay's twin of evaluateFlow's own data-root admission, and it has to be kept in step with it:
  // evaluateFlow bails when no root can speak, and THIS decides whether evaluateFlow is called at all, so
  // admitting a root there and not here leaves the flow silently unevaluated with nothing to say why.
  // A Graph Interpreter reads the canvas payload, so a flow containing one is canvas-driven for exactly
  // the reason a Plan JSON node is — and unlike a Space source it does not need a selection first.
  const hasGraphInterpreterRoot = canvasHasContent && nodes.some((n) => (n.data as FlowNodeData).tool === "graph-interpreter");
  // A Canvas Encoder needs NO canvas at all — it computes a plan and hands it over as text — so unlike
  // the reader above it is admitted whether or not anything is drawn. Same pairing rule: evaluateFlow
  // admits it too, and admitting it in only one of the two leaves the flow silently unevaluated.
  const hasEncoderRoot = nodes.some((n) => (n.data as FlowNodeData).tool === "canvas-encoder"
    // A Math Engine with a decode or encode section is the same kind of root, and this gate has to agree
    // with evaluateFlow's or the flow evaluates to nothing with no error to read — the failure that cost
    // several rounds on BOQ v2, when only one of the two knew about Graph Interpreter.
    || ((n.data as FlowNodeData).tool === "expr" && (!!(n.data as FlowNodeData).params.decode || !!(n.data as FlowNodeData).params.encode)));
  // Bake live per-kind counts onto every Canvas node so each output endpoint can display "(n)".
  const canvasCountsSig = canvasContent
    ? `${canvasContent.spaces.length},${canvasContent.nodes.length},${canvasContent.segments.length},${canvasContent.graphs.length},${canvasContent.images.length}`
    : "";
  // Also re-run when the SET of Canvas nodes changes — adding a Canvas node AFTER content already
  // exists doesn't change the counts signature, so without this a freshly-added node would never get
  // its `_counts` baked and would show 0 for every kind until the canvas changed again.
  const canvasNodeIdsSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "canvas-source").map((n) => n.id).join(",");
  useEffect(() => {
    if (!canvasContent) return;
    const counts = [canvasContent.spaces.length, canvasContent.nodes.length, canvasContent.segments.length, canvasContent.graphs.length, canvasContent.images.length];
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "canvas-source") return n;
        const cur = data.params._counts as number[] | undefined;
        if (cur && cur.length === 5 && cur.every((v, i) => v === counts[i])) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...data.params, _counts: counts } } };
      });
      return changed ? next : ns;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasCountsSig, canvasNodeIdsSig, setNodes]);
  // 2D primitive GENERATORS (Rectangle / Circle / Polygon / Polyline) are self-sufficient roots exactly like
  // a Space Creator — they synthesise geometry from params with no canvas input — so a flow built purely from
  // Rectangle → Loop → … (the general-node staircase) is ready without a Space/Graph/Canvas root.
  // The 2D / 3D RENDER nodes are roots for the same reason, and must stay in step with evaluateFlow's own
  // `hasPrim` list: a computed flow (Input Properties → Math Engine → Render — floorplan.v5.json) contains
  // no primitive node at all, so without them the whole graph reads as "not ready" and previews nothing
  // until a space happens to be selected, with no error to say why.
  const hasPrimRoot = nodes.some((n) => { const t = (n.data as FlowNodeData).tool; return t === "rectangle" || t === "circle" || t === "polygon" || t === "polyline" || t === "network" || t === "line" || t === "ngon" || t === "ellipse" || t === "rounded-rect" || t === "sector" || t === "arc" || t === "render-2d" || t === "render-3d"; });
  // Ready once ≥1 root is actually usable (a resolved Space, a Creator, a Selected Graph, an Image, the
  // Canvas, or a primitive generator) and no Space node has a typed-but-unmatched id.
  const sourcesReady = (anySpaceReady || hasCreator || hasGraphRoot || hasImageRoot || hasCanvasRoot || hasPlanJsonRoot || hasGraphInterpreterRoot || hasEncoderRoot || hasPrimRoot) && !badSource;
  // Bridge for the Chat-AI agents (the Flow agent + the canvas agent's flow_* gateway): read the live
  // graph, apply a generated one, compile-check it, and RUN-COMMIT the evaluated pipeline into the
  // canvas — the exact same compiled JSON + committedNodeIds path as the panel's Run button.
  const onRunCommitProp = props.onRunCommit;
  useEffect(() => {
    if (!flowApiRef) return;
    flowApiRef.current = {
      getGraph: buildGraph,
      applyGraph: importFlowData,
      compile: () => ({ ok: !compiled.error, error: compiled.error || undefined, opCount: compiled.opCount, committedNodeIds: compiled.committedNodeIds ?? [] }),
      // The Detect button, pressed programmatically. Params come from the LIVE graph (not from the
      // caller) so the rows the flow actually carries are the ones detected; only the API key is
      // injected, because shared workflow files ship it blank on purpose.
      runDetect: async (a) => {
        const g = buildGraph();
        const cands = (g.nodes ?? []).filter((n) => n.data?.tool === "object-detection");
        if (!cands.length) return { ok: false, error: "this flow has no Object Detection node", detected: 0, labels: [] };
        const node = a?.nodeId ? cands.find((n) => n.id === a.nodeId) : cands[0];
        if (!node) return { ok: false, error: `no Object Detection node "${a?.nodeId}" — this flow has: ${cands.map((n) => n.id).join(", ")}`, detected: 0, labels: [] };
        const params: Record<string, unknown> = { ...(node.data?.params ?? {}) };
        const key = String(a?.apiKey ?? "").trim() || String(params.api_key ?? "").trim();
        // Bake the key into the node too, so a later manual press works without re-entering it.
        if (key && key !== params.api_key) { params.api_key = key; onParamChange(node.id, "api_key", key); }
        return { nodeId: node.id, ...(await onRunDetect(node.id, params)) };
      },
      runCommit: () => {
        if (compiled.error) return { ok: false, error: `flow does not compile: ${compiled.error}` };
        // No source gate — a coordinate-list flow runs without any canvas root (matches the Run button).
        if (badSource?.idStr) return { ok: false, error: `no space matches "${badSource.idStr}" — set a valid id on the source node` };
        onRunCommitProp(compiled.json, compiled.committedNodeIds);
        return { ok: true, committedNodeIds: compiled.committedNodeIds };
      },
    };
    return () => { flowApiRef.current = null; };
  }, [flowApiRef, buildGraph, importFlowData, compiled, badSource, onRunCommitProp, onRunDetect, onParamChange]);
  const createAnchor = props.createAnchor ?? { x: 0, y: 0 };
  // Key over all per-source polygons so the heavy eval only re-runs when some space's geometry changes.
  const sourcesKey = sourceEntries.map((e) => `${e.nodeId}:${e.polys.map((poly) => poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")).join("&")}`).join("|");
  const anchorKey = `${createAnchor.x.toFixed(1)},${createAnchor.y.toFixed(1)}`;
  const pathEdges = props.pathEdges ?? [];
  const graphKey = graphSegments.length + ":" + graphSegments.flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    + "|s:" + segmentSegments.length + ":" + segmentSegments.flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    + "|n:" + nodeSegments.length + ":" + nodeSegments.flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    // Resolved graph COORDINATES matter, not just counts: a chain anchored at a Node source (chainAnchorByNode)
    // must re-evaluate when that canvas node MOVES, or the anchored drawing stays behind.
    + "|" + graphEntries.map((e) => `${e.nodeId}=${e.graphs.map((g) => g.length).join(",")}:${e.graphs.flat(2).reduce((s, p) => s + p.x + p.y, 0).toFixed(1)}`).join(";")
    // Freehand strokes live on the canvas, not in the node graph, so fold their fingerprint in too — else
    // redrawing / moving / recolouring a stroke wouldn't re-run the eval.
    + "|fh:" + freehandEntries.map((e) => { const pts = e.graphs.flat(2); return `${e.nodeId}=${pts.length}:${pts.reduce((s, p) => s + p.x + p.y, 0).toFixed(1)}`; }).join(";")
    + "|p:" + pathEdges.map((e) => `${e.a.x.toFixed(0)},${e.a.y.toFixed(0)},${e.b.x.toFixed(0)},${e.b.y.toFixed(0)},${e.halfPx.toFixed(1)}`).join(";");
  const overlayImages = props.overlayImages;
  const imageKey = (imageData ? `${imageData.key}:${imageData.w}x${imageData.h}:${imageData.box.x.toFixed(1)},${imageData.box.y.toFixed(1)},${imageData.box.scale.toFixed(3)}` : "")
    + Object.entries(overlayImages ?? {}).map(([id, im]) => `|${id}:${im.key}:${im.box.x.toFixed(1)},${im.box.y.toFixed(1)},${im.box.scale.toFixed(3)}`).join("");
  const canvasKey = canvasContent
    ? `sp${canvasContent.spaces.length}-nd${canvasContent.nodes.length}-sg${canvasContent.segments.length}-gr${canvasContent.graphs.length}-im${canvasContent.images.length}:` +
      [...canvasContent.spaces, ...canvasContent.segments, ...canvasContent.nodes].flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    : "";
  const pipeGraph = props.pipeGraph;
  // A graph-rooted processor (Pipe Network Solver / Frame Builder) is a root once the canvas graph
  // has edges — it evaluates from the canvas graph even with no Space wired.
  const hasPipeRoot = !!pipeGraph && pipeGraph.edges.length > 0 && nodes.some((n) => {
    const t = (n.data as FlowNodeData).tool;
    return t === "pipe-solver" || t === "frame-builder" || t === "wall-builder";
  });
  const pipeKey = pipeGraph?.key ?? "";
  // Per-cell values of grid-source fields (min/max/delta/random changes don't move any segment, so they
  // must be keyed explicitly or Grid Threshold would never re-evaluate).
  const gridFieldKey = [...gridFieldsBySourceNode.entries()]
    .map(([nid, f]) => `${nid}:${f.cols}x${f.rows}:${f.values.map((v) => v.toFixed(2)).join(",")}`).join("|");

  // ── IR fast path ─────────────────────────────────────────────────────────────────────────────────
  // A pure "params → primitive-array" object (Rectangle/Cuboid → Loop/Loop 3D, driven by an expr/math value
  // plane) is BAKED once into a flat IR — topological order + every input binding resolved — then RE-RUN
  // cheaply on each parameter change, instead of re-interpreting the whole graph (topo-sort + edge scanning)
  // every time. Gated to graphs the IR fully models; ANY other graph (a Space source, Inset, canvas-source…)
  // takes the untouched evaluateFlow path. The bake is memoised on TOPOLOGY only (`irStructureKey`), so
  // dragging a slider re-runs the IR but does NOT re-bake.
  // `agent` is whitelisted even though it is never baked: it is a pure authoring-time param tuner that emits
  // no geometry of its own (bakeFlowToIR ignores it, exactly as evaluateFlow treats it as a see-through), so
  // its presence must NOT knock a params-driven object off the fast path — otherwise adding an Agent node
  // silently drops the graph to the full evaluateFlow preview, which draws every intermediate node's boxes.
  // `point` is whitelisted as an anchor: it carries no geometry (bakeFlowToIR ignores it) but the 2D anchor
  // and the 3D primitiveMasses read its (x, y) to PLACE the object at an explicit coordinate with no Node.
  const IR_SAFE_TOOLS = "pobj-source input-props expr math match conditional rectangle circle cuboid loop loop-3d transform node-source output grab-object agent point node-geometry segment-source segment-geometry";
  const irStructureKey = nodes.map((n) => `${n.id}:${(n.data as FlowNodeData).tool}`).join(",")
    + "|" + edges.map((e) => `${e.source}>${e.target}:${e.sourceHandle ?? ""}>${e.targetHandle ?? ""}`).join(",")
    // Point x/y are const-baked into the IR (a Point → expr placement wire), so a drag must re-bake to move.
    + "|" + nodes.filter((n) => (n.data as FlowNodeData).tool === "point").map((n) => { const p = (n.data as FlowNodeData).params; return `${n.id}=${p.x},${p.y}`; }).join(";");
  // IR fast path DISABLED for now (kept passive): force EVERY flow through evaluateFlow so there is a single
  // evaluator. The IR bake / run / preview code below stays in place but never activates — flip USE_IR back to
  // true to re-enable the fast path. Primitive-object flows (Rectangle/Loop/…) still evaluate because they
  // satisfy the `sourcesReady` gate via `hasPrimRoot`. (Typed `boolean`, not the literal `false`, so the IR
  // branch stays type-checked live code rather than being narrowed to dead code.)
  const USE_IR: boolean = false;
  const irOk = USE_IR && nodes.length > 0 && nodes.every((n) => IR_SAFE_TOOLS.includes((n.data as FlowNodeData).tool));
  const bakedIR = useMemo(
    () => (irOk ? bakeFlowToIR({ version: 1, nodes: nodes.map((n) => ({ id: n.id, data: { tool: (n.data as FlowNodeData).tool, params: (n.data as FlowNodeData).params } })), edges: edges.map((e) => ({ source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle })) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [irStructureKey, irOk],
  );

  const preview = useMemo(
    () => {
      if (bakedIR) {
        // Live parameter values (the params source's props) override the baked defaults.
        const src = nodes.find((n) => n.id === bakedIR.srcId);
        const overrides: Record<string, number | string> = {};
        if (src) for (const p of inputProps((src.data as FlowNodeData).params)) overrides[p.id] = p.value as number | string;
        // Anchor at the wired Node's point when the chain feeds a Node source (matching evaluateFlow's
        // chainAnchorByNode), else the flow anchor. Keeps the fast-path 2D placement identical.
        let anchor = createAnchor;
        const nodeSrc = nodes.find((n) => (n.data as FlowNodeData).tool === "node-source");
        const npt = nodeSrc ? (graphsBySourceNode.get(nodeSrc.id) ?? []).flat().find((pl) => pl.length >= 1)?.[0] : undefined;
        if (npt) anchor = npt;
        // A Point drives ABSOLUTE placement — its coordinate (metres from the world origin) IS where the
        // object goes, because the expr offsets every position by it. So anchor at the origin; otherwise that
        // offset would stack on top of createAnchor OR a node-source's own point and DOUBLE-place the object
        // (the bug: bed landing at ~2× the node's position instead of on it).
        if (nodes.some((n) => (n.data as FlowNodeData).tool === "point")) anchor = { x: 0, y: 0 };
        return irToPreviewItems(bakedIR, runFlowIR(bakedIR, overrides), ppm, anchor);
      }
      // A Point drives ABSOLUTE placement (positions are metres from the world origin), so anchor primitives
      // at the origin — the evaluateFlow twin of the IR-path anchor guard (else they'd stack on createAnchor).
      const evalAnchor = nodes.some((n) => (n.data as FlowNodeData).tool === "point") ? { x: 0, y: 0 } : createAnchor;
      return (sourcesReady || hasPipeRoot) ? evaluateFlow(nodes, edges, sourcePolys, ppm, evalAnchor, graphSegments, graphsBySourceNode, pathEdges, imageData, canvasContent, pipeGraph, gridFieldsBySourceNode, overlayImages) : [];
    },
    // sourcesKey captures per-source polygon changes without depending on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, sourcesKey, ppm, sourcesReady, hasPipeRoot, anchorKey, graphKey, imageKey, canvasKey, pipeKey, gridFieldKey, bakedIR],
  );
  previewRef.current = preview;

  // Node Geometry → Point "grab": a Point whose X / Y is wired from a Node Geometry adopts the wired Node's
  // canvas position (metres), resolved straight from the node-source's point. We sync it into the Point's
  // params — which the placement const-bakes into the IR and re-bakes on change — so the object tracks the
  // node while staying on the clean fast path. `nodePosSig` re-runs it when a canvas node moves; the write is
  // guarded to only fire on change, so it can't loop.
  const nodePosSig = [...graphsBySourceNode].map(([k, gs]) => { const pl = gs.flat().find((p) => p.length >= 1); return pl ? `${k}:${pl[0].x.toFixed(1)},${pl[0].y.toFixed(1)},${pl[pl.length - 1].x.toFixed(1)},${pl[pl.length - 1].y.toFixed(1)}` : k; }).join("|");
  useEffect(() => {
    const nodeGeomCoord = (ngId: string): { x: number; y: number } | null => {
      const ge = edges.find((e) => e.target === ngId && !(e.targetHandle?.startsWith("valin-") || e.targetHandle?.startsWith("gin-")));
      const pl = ge ? (graphsBySourceNode.get(ge.source) ?? []).flat().find((p) => p.length >= 1) : undefined;
      if (!pl || !ppm) return null;
      // A Segment (≥2 points) → its MIDPOINT; a Node (1 point) → the point itself.
      const q = pl.length >= 2 ? { x: (pl[0].x + pl[pl.length - 1].x) / 2, y: (pl[0].y + pl[pl.length - 1].y) / 2 } : pl[0];
      return { x: q.x / ppm, y: q.y / ppm };
    };
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        if ((n.data as FlowNodeData).tool !== "point") return n;
        const grab = (axis: "x" | "y"): number | null => {
          const e = edges.find((ed) => ed.target === n.id && ed.targetHandle === `valin-${axis}`);
          const src = e && ns.find((m) => m.id === e.source);
          if (!src || ((src.data as FlowNodeData).tool !== "node-geometry" && (src.data as FlowNodeData).tool !== "segment-geometry")) return null;
          const c = nodeGeomCoord(src.id);
          return c ? c[axis] : null;
        };
        const gx = grab("x"), gy = grab("y");
        const p = (n.data as FlowNodeData).params;
        const setX = gx != null && Math.abs(Number(p.x) - gx) > 1e-6;
        const setY = gy != null && Math.abs(Number(p.y) - gy) > 1e-6;
        if (!setX && !setY) return n;
        changed = true;
        return { ...n, data: { ...n.data, params: { ...p, ...(setX ? { x: gx } : {}), ...(setY ? { y: gy } : {}) } } };
      });
      return changed ? next : ns;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, nodePosSig, ppm, setNodes]);

  // Agent staleness: a baked suggestion is derived from the space metrics, instructions, prompt and the
  // connected nodes at Run time (fingerprinted into `inputHash`). Re-check it whenever any of those move,
  // so an out-of-date suggestion is flagged in the node instead of silently standing as if still valid.
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const d = n.data as FlowNodeData;
        if (d.tool !== "agent" || !d.params.inputHash) return n;
        // No Space poly (a Node/Segment brief) is NOT automatically stale — fingerprint the same empty context
        // the Run baked, so the hash still matches until the instructions / prompt / targets actually change.
        const poly = preview.find((it) => it.nodeId === n.id)?.polygons.find((p) => p.length >= 3);
        const stale = suggestInputHash(
          String(d.params.instructions ?? ""),
          String(d.params.prompt ?? ""),
          agentContextOf(poly ?? [], ppm),
          agentTargetsOf(n.id, ns, edges),
        ) !== d.params.inputHash;
        if (stale === Boolean(d.params._stale)) return n;
        changed = true;
        return { ...n, data: { ...d, params: { ...d.params, _stale: stale } } };
      });
      return changed ? next : ns;
    });
  }, [preview, edges, ppm, setNodes]);

  // Voronoi seeds = the input polygon's vertices, so each Voronoi node emits one cell (and one
  // output handle) per vertex of whatever polygon feeds it. The vertex count isn't knowable from
  // params alone, so bake each Voronoi node's live cell count into `vertexCount` — read by
  // outputCount (handle rendering) and by the compiler (produces list). No feedback loop:
  // evalVoronoi ignores params, so baking can't change the preview's cell count.
  useEffect(() => {
    const cellCountByNode = new Map(
      preview.filter((it) => it.tool === "voronoi" || it.tool === "convex-decomp" || it.tool === "inset" || it.tool === "optimise-rect" || it.tool === "split" || it.tool === "bsp" || it.tool === "skeleton" || it.tool === "smoothing" || it.tool === "densify" || it.tool === "floor-massing" || it.tool === "mitered-join" || it.tool === "graph-source" || it.tool === "segment-source" || it.tool === "node-source" || it.tool === "separate" || it.tool === "segment-split" || it.tool === "graph-to-spaces" || it.tool === "voronoi-bloom" || it.tool === "mesh" || it.tool === "circle-packing" || it.tool === "visibility" || it.tool === "treemap" || it.tool === "rect-pack").map((it) => [it.nodeId, it.cellCount ?? it.polygons.length]),
    );
    // Space Creator: bake its generated polygon (in METRES) so commit's `create` op can rebuild it.
    const createPtsByNode = new Map(
      preview.filter((it) => (it.tool === "space-creator" || it.tool === "pobj-source") && (it.polygons[0]?.length ?? 0) >= 3).map((it) => [it.nodeId, it.polygons[0]]),
    );
    // Conditional nodes: surface the live result on the node (read-only badge fields). Safe like
    // vertexCount — evalConditional reads only metric/op/value, never these baked fields.
    const condByNode = new Map(
      preview.filter((it) => it.tool === "conditional" && it.condition).map((it) => [it.nodeId, it.condition!]),
    );
    // Scalar value outputs (e.g. Inset area) → bake under params._values for the node's readout. Summarised
    // on the way in (see `readoutValues`), so a matrix or a long point list is baked as its shape and the
    // payload stays on the wire instead of in every node's params.
    const valuesByNode = new Map(
      preview.filter((it) => it.values).map((it) => [it.nodeId, readoutValues(it.values!)]),
    );
    // Resolved value INPUT overrides (e.g. Massing floors from a wired value) → bake under _vin so the
    // compiler/commit uses the same number as the live preview.
    const vinByNode = new Map(
      preview.filter((it) => it.valueInputs).map((it) => [it.nodeId, it.valueInputs!]),
    );
    // Optimise Rectangle auto-tilt → bake the chosen angle into axisAngle (slider + commit follow it).
    const tiltByNode = new Map(
      preview.filter((it) => typeof it.optimisedTilt === "number").map((it) => [it.nodeId, it.optimisedTilt!]),
    );
    // Output node: the live resolved metric values, baked under _metrics so the node shows them per slot.
    const metricsByNode = new Map(
      preview.filter((it) => it.metrics).map((it) => [it.nodeId, it.metrics!]),
    );
    // Pipe Network Solver: the live solve status line, baked under _pipeStatus for the node badge.
    const pipeStatusByNode = new Map(
      preview.filter((it) => it.pipeStatus != null).map((it) => [it.nodeId, it.pipeStatus!]),
    );
    const pipeSchemaByNode = new Map(
      preview.filter((it) => it.pipeSchemaName != null).map((it) => [it.nodeId, it.pipeSchemaName!]),
    );
    // Dimension: the input Space's edge count → drives the Edgewise per-edge checkbox grid.
    const edgeCountByNode = new Map(
      preview.filter((it) => it.tool === "dimension" && typeof it.edgeCount === "number").map((it) => [it.nodeId, it.edgeCount!]),
    );
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (n.type === "group" || !FLOW_TOOLS[data.tool]) return n; // container box — not an op
        if (data.tool === "pipe-solver") {
          // Bake status + schema source + values together so none is dropped by an early return.
          const st = pipeStatusByNode.get(n.id);
          const sn = pipeSchemaByNode.get(n.id);
          const v = valuesByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (st != null && merged._pipeStatus !== st) { merged._pipeStatus = st; ch = true; }
          if (sn != null && merged._schemaName !== sn) { merged._schemaName = sn; ch = true; }
          if (v && JSON.stringify(merged._values) !== JSON.stringify(v)) { merged._values = v; ch = true; }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "input-props") {
          // How many detection nodes the Run button would press. Baked rather than counted in the card so
          // the node stays a pure function of its own params — and so the count is identical on the node
          // and in the Properties tab, which read the same bag.
          const dc = ns.filter((m2) => (m2.data as FlowNodeData).tool === "object-detection").length;
          // Same bookkeeping for the tracing half: how many Vectorisation nodes Auto-Tune would sweep.
          const tc = ns.filter((m2) => (m2.data as FlowNodeData).tool === "vectorise").length;
          if (data.params._detectCount !== dc || data.params._tuneCount !== tc) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, _detectCount: dc, _tuneCount: tc } } };
          }
          return n;
        }
        if (data.tool === "output") {
          const m = metricsByNode.get(n.id);
          if (m && JSON.stringify(data.params._metrics) !== JSON.stringify(m)) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, _metrics: m } } };
          }
          return n;
        }
        // Analyse: bake the wired File (data URL) / Url value inputs so the "Analyse" button reads the
        // same media the live graph resolved. The file data URL goes under `_file` (transient, stripped on
        // export so big files don't bloat saved flows); a wired Url overrides the `url` field.
        if (data.tool === "analyse") {
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (vin && "file" in vin && merged._file !== vin.file) { merged._file = vin.file; ch = true; }
          if (vin && "url" in vin && merged.url !== vin.url) { merged.url = vin.url; ch = true; }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        // Render: bake a wired Prompt onto the `prompt` field so the Generate button sends the same
        // text the live graph resolved. Exactly the Analyse branch above, one field instead of two —
        // this is what lets a Text / Math Engine / Analyse node compose the prompt in the flow, which
        // the Agent node cannot do (it only ever writes range/number/select/checkbox params).
        // Plan JSON: bake a short preview of the payload so the node visibly HOLDS the plan rather than
        // just reporting a byte count. Truncated on purpose — a whole-canvas plan is tens of KB, and the
        // full string already travels on `val-json`. `_`-prefixed, so it never reaches a saved flow.
        if (data.tool === "plan-json") {
          const full = preview.find((it) => it.nodeId === n.id)?.values?.json;
          const prev = typeof full === "string" && full ? (full.length > 600 ? `${full.slice(0, 600)}…` : full) : undefined;
          if (data.params._preview === prev) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, _preview: prev } } };
        }
        if (data.tool === "render") {
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (vin && "prompt" in vin && merged.prompt !== vin.prompt) { merged.prompt = vin.prompt; ch = true; }
          if (vin && "systemPrompt" in vin && merged.systemPrompt !== vin.systemPrompt) { merged.systemPrompt = vin.systemPrompt; ch = true; }
          // A wired IMAGE goes under `_image` — `_`-prefixed so it is stripped on export, the same reason
          // Analyse keeps its wired file under `_file`: these are full PNG data URLs and would otherwise
          // bloat every saved flow with one canvas's pixels.
          const img = vin && typeof vin.image === "string" ? vin.image : undefined;
          if (merged._image !== img) { merged._image = img; ch = true; }
          const img3d = vin && typeof vin.image3d === "string" ? vin.image3d : undefined;
          if (merged._image3d !== img3d) { merged._image3d = img3d; ch = true; }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        // Object Detection: a wired API key / Model / Max items lands on params, because DETECT is an
        // asynchronous button that reads params — it never sees the live graph. Same shape as Voronoi's
        // merge below and Analyse's `_file` bake above.
        if (data.tool === "object-detection") {
          const vin = vinByNode.get(n.id);
          if (!vin) return n;
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "voronoi") {
          // Bake the live cell count (vertexCount → output handles) AND surface any wired/swept Seeds value
          // back onto the slider, so the Seeds control reflects the value driven into it.
          const vc = cellCountByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (vc != null && merged.vertexCount !== vc) { merged.vertexCount = vc; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "convex-decomp") {
          // Value-only node now: no output handles, so `pieceCount` is vestigial. This block previously
          // baked only that and RETURNED EARLY, so a wired `polygon` never reached the param box and the
          // live wire looked dead — the exact trap the Inset block below warns about.
          const vin = vinByNode.get(n.id);
          if (!vin) return n;
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "fill-depressions" || data.tool === "flow-direction" || data.tool === "flow-accumulation" || data.tool === "watershed" || data.tool === "grid-threshold") {
          // Value node: surface the resolved INPUT matrix onto the Matrix textbox (mirrors convex-decomp /
          // inset baking vin) so the wired matrix is visible, and bake the OUTPUT matrix under _values for the
          // val-matrix output readout.
          const vin = vinByNode.get(n.id);
          const v = valuesByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (v && JSON.stringify(merged._values) !== JSON.stringify(v)) { merged._values = v; ch = true; }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "inset") {
          // Inset bakes three things at once (handled here so none are dropped by an early return):
          //  • inputCount — one output handle per inset space (multi-space),
          //  • _values    — the total area readout,
          //  • valueInputs — wired offset overrides surfaced back onto the sliders.
          const ic = cellCountByNode.get(n.id);
          const v = valuesByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (ic != null && merged.inputCount !== ic) { merged.inputCount = ic; ch = true; }
          if (v && JSON.stringify(merged._values) !== JSON.stringify(v)) { merged._values = v; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "optimise-rect") {
          // Optimise Rectangle bakes inputCount (one handle per packed rect), _values (total area), wired
          // value overrides, and the auto-axis-tilt — all together so none is dropped by an early return.
          const ic = cellCountByNode.get(n.id);
          const v = valuesByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const tilt = tiltByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (ic != null && merged.inputCount !== ic) { merged.inputCount = ic; ch = true; }
          if (v && JSON.stringify(merged._values) !== JSON.stringify(v)) { merged._values = v; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (typeof tilt === "number" && merged.axisAngle !== tilt) { merged.axisAngle = tilt; ch = true; }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "space-creator" || data.tool === "pobj-source") {
          const poly = createPtsByNode.get(n.id);
          if (!poly) return n;
          const ptsM = poly.map((p) => ({ x: p.x / ppm, y: p.y / ppm }));
          if (JSON.stringify(data.params._pointsM) === JSON.stringify(ptsM)) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, _pointsM: ptsM } } };
        }
        if (data.tool === "floor-massing") {
          // Massing bakes inputCount (one handle per tagged space), _values (floor count) and the wired
          // `n` (floors) override — together so none is dropped by an early return.
          const ic = cellCountByNode.get(n.id);
          const v = valuesByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (ic != null && merged.inputCount !== ic) { merged.inputCount = ic; ch = true; }
          if (v && JSON.stringify(merged._values) !== JSON.stringify(v)) { merged._values = v; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "smoothing") {
          // One output handle per smoothed space, baked from the live input count.
          const ic = cellCountByNode.get(n.id);
          if (ic == null || data.params.inputCount === ic) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, inputCount: ic } } };
        }
        if (data.tool === "densify") {
          // One handle per densified space + surface wired count/maxLength back onto the controls.
          const ic = cellCountByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (ic != null && merged.inputCount !== ic) { merged.inputCount = ic; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "split" || data.tool === "bsp" || data.tool === "skeleton" || data.tool === "mitered-join" || data.tool === "graph-source" || data.tool === "segment-source" || data.tool === "node-source" || data.tool === "separate" || data.tool === "segment-split" || data.tool === "graph-to-spaces" || data.tool === "voronoi-bloom" || data.tool === "mesh" || data.tool === "circle-packing" || data.tool === "visibility" || data.tool === "treemap" || data.tool === "rect-pack") {
          // handleCount = live output-handle count (per piece/segment for one space; per input space for
          // many). Split also surfaces wired value inputs (ratios/angle/target) back onto its controls.
          const hc = cellCountByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (hc != null && merged.handleCount !== hc) { merged.handleCount = hc; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { const v: unknown = k === "ratios" ? String(val) : val; if (merged[k] !== v) { merged[k] = v; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "dimension") {
          // Bake the input Space's edge count + surface a wired Offset back onto the slider.
          const ec = edgeCountByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (ec != null && merged.edgeCount !== ec) { merged.edgeCount = ec; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "conditional") {
          // Bake the live verdict (_pass/_value) AND surface any wired A / Compare values back onto the fields.
          const c = condByNode.get(n.id);
          const vin = vinByNode.get(n.id);
          const merged: Record<string, unknown> = { ...data.params };
          let ch = false;
          if (c && (merged._pass !== c.pass || merged._value !== c.value)) { merged._pass = c.pass; merged._value = c.value; ch = true; }
          if (vin) for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; ch = true; } }
          if (!ch) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: merged } };
        }
        if (data.tool === "input-props") {
          // Wired PARAMETER overrides go to `_wired` (a read-only readout in the editor), never into
          // `props[].value`: those values are the node's own data, and unwiring would otherwise leave the
          // last driven value behind. Handled before the generic bakes below so the whole-node value set —
          // which for this node includes the pass-through geometry JSON — is never written into flat params.
          // Summarised like `_values`: the Image node's matrix arrives on a text parameter and this readout
          // would otherwise hold the whole raster (see `readoutValue`). The wire still carries it in full to
          // the Math Engine — `_wired` only decides what the row shows.
          const vin = vinByNode.get(n.id);
          const next = vin && Object.keys(vin).length ? readoutValues(vin) : undefined;
          if (JSON.stringify(data.params._wired) === JSON.stringify(next)) return n;
          changed = true;
          const merged: Record<string, unknown> = { ...data.params };
          if (next) merged._wired = next; else delete merged._wired;
          return { ...n, data: { ...n.data, params: merged } };
        }
        // An unknown/unregistered tool (stale type, malformed hand-authored graph) — leave the node
        // untouched rather than crashing on the unguarded FLOW_TOOLS lookups below.
        const toolDef = FLOW_TOOLS[data.tool];
        if (!toolDef) return n;
        if (toolDef.valueOutputs?.length) {
          const v = valuesByNode.get(n.id);
          if (v && JSON.stringify(data.params._values) !== JSON.stringify(v)) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, _values: v } } };
          }
        }
        if (toolDef.valueInputs?.length) {
          // Write each wired value into its actual param so the field/slider reflects the driven value.
          const vin = vinByNode.get(n.id);
          if (vin) {
            let diff = false;
            const merged: Record<string, unknown> = { ...data.params };
            for (const [k, val] of Object.entries(vin)) {
              // Split's `ratios` is a text list, so store the driven number as its string form. A wired
              // checkbox param bakes as a real BOOLEAN so the committed params match a hand-toggled node.
              const kind = toolDef.fields.find((f) => f.key === k)?.kind;
              const v: unknown = data.tool === "split" && k === "ratios" ? String(val)
                : kind === "checkbox" ? (typeof val === "string" ? val === "true" || val === "1" : Number(val) !== 0)
                : val;
              if (merged[k] !== v) { merged[k] = v; diff = true; }
            }
            if (diff) { changed = true; return { ...n, data: { ...n.data, params: merged } }; }
          }
        }
        if (data.tool === "optimise-rect") {
          const tilt = tiltByNode.get(n.id);
          if (typeof tilt === "number" && data.params.axisAngle !== tilt) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, axisAngle: tilt } } };
          }
        }
        return n;
      });
      return changed ? next : ns;
    });
  }, [preview, setNodes]);

  const onPreviewRef = useRef(props.onPreview);
  onPreviewRef.current = props.onPreview;
  // Nodes with the eye toggled off — their preview items are withheld from the canvas (downstream eval
  // is unaffected; only on-screen rendering is suppressed). Suffixed items (`<id>__join` / `<id>__1`)
  // map back to their base node id.
  const hiddenSig = nodes.filter((n) => (n.data as FlowNodeData).params._hidden).map((n) => n.id).sort().join(",");
  useEffect(() => {
    if (!open) return;
    const hidden = new Set(hiddenSig ? hiddenSig.split(",") : []);
    const visible = hidden.size === 0 ? preview : preview.filter((it) => !hidden.has(it.nodeId.split("__")[0]));
    const handle = window.setTimeout(() => onPreviewRef.current(visible), 80);
    return () => window.clearTimeout(handle);
  }, [open, preview, hiddenSig]);

  // ── Snapshot nodes are LIVE ─────────────────────────────────────────────────────────────────────────
  // No Capture button: a Snapshot re-photographs the canvas by itself whenever what the canvas DRAWS
  // changes. Four things make that workable.
  //   • THE SIGNATURE EXCLUDES SNAPSHOTS. Writing `_snapshot` back onto a node re-runs the graph and yields
  //     a new `preview`, so a signature over the whole preview would retrigger the capture that produced it
  //     — a permanent loop of full-stage redraws. `previewGeometrySig` skips snapshot items, cutting that
  //     edge; `captureSnapshotInto` additionally declines to write a byte-identical image.
  //   • IT WATCHES BOTH HALVES of what gets photographed: the flow's preview AND the committed canvas, since
  //     drawing a wall changes the picture without touching the graph. `hiddenSig` is in there because an
  //     eye toggle changes what is on the stage without changing any geometry.
  //   • IT RETRIES FOR THE 3D HALF while the 3D view is open but no 3D image has landed — see below.
  //   • IT IS DEBOUNCED. The host capture is expensive (flushSync un-cull → two full stage redraws → PNG
  //     encode), so a dragged slider must not fire one per frame; the timer restarts on every change and only
  //     the settled state is photographed. The delay also outlasts the host's own 80 ms onPreview debounce and
  //     the render behind it — snapshot before that and you photograph the PREVIOUS state, which is the
  //     stale-image bug `settleCanvas` exists for elsewhere. It is a plain TIMER and deliberately not
  //     `settleCanvas`: rAF is paused while the tab is hidden, which would stall the live capture exactly
  //     when it is cheapest to take. Waiting for Konva's own repaint isn't needed either — snapshotCanvas
  //     calls `stage.draw()` synchronously, and the node tree it draws was updated in React's commit.
  // Cost when the graph holds no Snapshot node: the memo short-circuits and nothing is hashed.
  const snapshotNodes = nodes.filter((n) => (n.data as FlowNodeData).tool === "snapshot");
  const snapshotIdSig = snapshotNodes.map((n) => n.id).join(",");
  // Scope / Margin are framing, not geometry, so nothing above notices them — but changing either must
  // re-photograph, or picking "Selected" would leave the old whole-canvas shot sitting in the node.
  const snapshotScopeSig = snapshotNodes
    .map((n) => { const p = (n.data as FlowNodeData).params; return `${n.id}:${String(p.scope ?? "whole")}:${String(p.margin ?? 1)}:${String(p.points ?? "")}`; })
    .join(",");
  const liveSnapshotSig = useMemo(
    () => (snapshotIdSig
      ? `${previewGeometrySig(preview)}|${canvasContentSig(props.canvasContent, props.freehandStrokes)}|${masses3dSig(props.masses3D)}|${hiddenSig}|${props.viewMode ?? ""}|${snapshotScopeSig}`
      : ""),
    [snapshotIdSig, snapshotScopeSig, preview, props.canvasContent, props.freehandStrokes, props.masses3D, hiddenSig, props.viewMode],
  );
  useEffect(() => {
    if (!open || !snapshotIdSig) return;
    const ids = snapshotIdSig.split(",");
    // The 3D view is a LAZY chunk, so an attempt made just after it opens lands before that canvas exists
    // and `mountedOnly` correctly comes back with nothing — and there may be no further event to wake us,
    // since the user need not touch the drawing again. Hence the RETRY, and hence its condition being the
    // STATE rather than the view-mode transition: retrying only on the transition looked right and failed
    // in practice, because the mount itself perturbs the scene, which re-runs this effect and cancels the
    // pending retries. So: keep going while the view says 3D and no 3D image has landed. Bounded, and each
    // effect run starts one chain, so a 3D capture that genuinely never works costs a handful of attempts
    // rather than polling for the life of the session.
    const want3d = props.viewMode === "3d" || props.viewMode === "both";
    let cancelled = false;
    let timer: number | null = null;
    let tries = 0;
    const tick = (delay: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void captureSnapshotInto(ids).then(() => {
          if (cancelled) return;
          const missing3d = want3d && ids.some((id) => !lastSnapRef.current.get(id)?.iso);
          if (missing3d && ++tries <= 8) tick(1200);
        });
      }, delay);
    };
    tick(420);
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); };
  }, [open, snapshotIdSig, liveSnapshotSig, captureSnapshotInto, props.viewMode]);

  // Export to Canvas nodes with the eye OPEN → materialise what they would commit, as real canvas geometry.
  // This is the node's preview: it belongs to the flow (host-owned, no history entry) and tracks the graph,
  // so you can see the result on the plan and only then press Commit to hand it over. Deliberately NOT gated
  // on the global Flow Live toggle — the eye on this node is its own switch, which is the whole point of the
  // node. Sent as a complete list, so a node that is hidden, unwired or deleted drops out of it and the host
  // clears its preview. Runs after `previewRef.current = preview` above, so the pieces are current.
  const onExportPreviewRef = useRef(props.onExportCanvasPreview);
  onExportPreviewRef.current = props.onExportCanvasPreview;
  const exportPreviewRequests = useMemo(() => {
    const out: ExportCanvasRequest[] = [];
    for (const n of nodes) {
      const d = n.data as FlowNodeData;
      if (d.tool !== "export-canvas" || d.params._hidden) continue;
      const req = exportCanvasPayload(n.id, d.params);
      if (!("reason" in req)) out.push(req);
    }
    return out;
    // `preview` is what makes the geometry current — exportCanvasPayload reads it through previewRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, preview, exportCanvasPayload]);
  useEffect(() => {
    // Closing the flow overlay leaves the preview standing (it is the node's output, not overlay chrome);
    // it clears when the eye closes or the node goes away.
    const handle = window.setTimeout(() => onExportPreviewRef.current?.(exportPreviewRequests), 80);
    return () => window.clearTimeout(handle);
  }, [exportPreviewRequests]);

  // Space (source) nodes whose eye is toggled off → tell the host to hide those spaces (by display id)
  // on the canvas. A source node's `id` param may list several ids ("Space001, Space002").
  const onHiddenSpaceIdsRef = useRef(props.onHiddenSpaceIdsChange);
  onHiddenSpaceIdsRef.current = props.onHiddenSpaceIdsChange;
  const hiddenSpaceIdsSig = nodes
    .filter((n) => { const d = n.data as FlowNodeData; return d.tool === "source" && Boolean(d.params._hidden); })
    .flatMap((n) => String((n.data as FlowNodeData).params.id ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    .sort().join(",");
  useEffect(() => {
    onHiddenSpaceIdsRef.current?.(hiddenSpaceIdsSig ? hiddenSpaceIdsSig.split(",") : []);
  }, [hiddenSpaceIdsSig]);

  // Same mechanism for Freehand-source nodes: a `_hidden` (eye toggled off) freehand node tells the host to
  // hide the matching canvas freehand strokes. A blank colour filter → "*" (hide every stroke) so an empty
  // string never collapses the signal to falsy. Colours lowercased to match the host's case-insensitive test.
  const onHiddenFreehandRef = useRef(props.onHiddenFreehandColorsChange);
  onHiddenFreehandRef.current = props.onHiddenFreehandColorsChange;
  const hiddenFreehandSig = nodes
    .filter((n) => { const d = n.data as FlowNodeData; return d.tool === "freehand-source" && Boolean(d.params._hidden); })
    .map((n) => String((n.data as FlowNodeData).params.color ?? "").trim().toLowerCase() || "*")
    .sort().join("|");
  useEffect(() => {
    onHiddenFreehandRef.current?.(hiddenFreehandSig ? hiddenFreehandSig.split("|") : []);
  }, [hiddenFreehandSig]);

  // Same mechanism for Grid (grid-source) nodes: a `_hidden` grid node tells the host to hide the matching
  // canvas construction grid (by display id, e.g. "Grid001"), so its eye hides the numbered lattice.
  const onHiddenGridRef = useRef(props.onHiddenGridIdsChange);
  onHiddenGridRef.current = props.onHiddenGridIdsChange;
  const hiddenGridIdsSig = nodes
    .filter((n) => { const d = n.data as FlowNodeData; return d.tool === "grid-source" && Boolean(d.params._hidden); })
    .flatMap((n) => String((n.data as FlowNodeData).params.id ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    .sort().join(",");
  useEffect(() => {
    onHiddenGridRef.current?.(hiddenGridIdsSig ? hiddenGridIdsSig.split(",") : []);
  }, [hiddenGridIdsSig]);

  const run = (mode: "commit") => {
    if (mode !== "commit") return;
    // No source gate: a coordinate-list flow (Polygon / Network / Vertices …) has no canvas root and is
    // still perfectly runnable. Only a typed-but-unmatched Space id is a real mistake worth blocking on.
    if (badSource?.idStr) { toast.error(`No space matches "${badSource.idStr}" — enter a valid id (e.g. Space001).`); return; }
    props.onRunCommit(compiled.json, compiled.committedNodeIds);
  };

  if (!props.open) return null;

  // Minimized: render a slim bar only. All hooks above (the eval `preview` useMemo + onPreview effect)
  // still run, so the flow engine keeps evaluating and pushing previews to the canvas while collapsed.
  if (props.minimized) {
    return (
      <div className="flex h-full w-full items-center justify-between gap-2 border-t border-slate-200 bg-white px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[12px] font-semibold text-slate-700">Flow — Operations Pipeline</span>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> running
          </span>
          <span className="truncate text-[11px] text-slate-400">
            {props.selectedRoomLabel ? <b className="text-slate-600">{props.selectedRoomLabel}</b> : "no space selected"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2" title="Maximize" onClick={props.onMaximize}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" title="Restore" onClick={props.onRestore}>
            <Minimize2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={props.onClose} title="Close the flow editor">
            <X className="h-3.5 w-3.5" /> Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white/90 px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">Flow — Operations Pipeline</span>
          <span className="text-[11px] text-slate-400">
            Input: {props.selectedRoomLabel ? <b className="text-slate-600">{props.selectedRoomLabel}</b> : "no space selected"}
          </span>
        </div>
        <div className="relative flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFlow(f); e.target.value = ""; }}
          />
          {/* Auto-arrange the whole flow into foldable blocks (2D / 3D Primitives, Math Engine, Canvas Import). */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-teal-600 hover:bg-teal-50"
            onClick={arrangeFlow}
            title="Arrange — fold the whole operation (Input Properties, Math Engine, Output Metrics, 2D & 3D primitives) into one named, collapsible group; sources and the Agent stay out"
          >
            <Wand2 className="h-3.5 w-3.5" /> Arrange
          </Button>
          {/* Delete / Group the current selection (also works via the Delete key). */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-red-600 hover:bg-red-50 disabled:text-slate-300"
            disabled={!hasSelection}
            onClick={deleteSelected}
            title="Delete selected connection or node (or press Delete)"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-violet-600 hover:bg-violet-50 disabled:text-slate-300"
            disabled={!canGroup}
            onClick={groupSelected}
            title="Group the selected nodes into a movable container (select 2+ nodes). Delete the box to ungroup."
          >
            <GroupIcon className="h-3.5 w-3.5" /> Group
          </Button>
          <div className="mx-0.5 h-5 w-px bg-slate-200" />
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={newFlow}
            title="New flow — clear all nodes and start fresh"
          >
            <FilePlus className="h-3.5 w-3.5" /> New
          </Button>
          <Button
            variant={foldAll ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={toggleFoldAll}
            title={foldAll ? "Unfold all nodes" : "Fold all nodes"}
          >
            {foldAll ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} Fold
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setImportOpen((v) => !v)} title="Import a flow — upload a .json file or paste JSON">
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={openExport} title="Export this flow — view/copy the JSON, then optionally save to a file">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <div className="mx-0.5 h-5 w-px bg-slate-200" />
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={props.onMinimize} title="Minimize — collapse to a bar; the flow keeps running and the canvas gets the space">
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={props.onMaximize} title="Maximize the flow editor">
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={props.onClose} title="Close the flow editor">
            <X className="h-3.5 w-3.5" /> Close
          </Button>

          {/* Import dropdown — the bundled Library browser grouped by its top-level folders
              (Objects / Tools / Workflows, one click each), upload a .json file, OR paste flow JSON. */}
          {importOpen && (
            <div className="absolute right-0 top-9 z-50 w-96 space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Import flow</span>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setImportOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Where the three trees below are listed FROM. The listing already comes from the bucket
                  (listLibraryFiles asks R2 first), but nothing on screen said so, and the folder badges
                  read as file counts — so a browser full of Library content looked like a stale local
                  copy. Every other import dialog names its source; this one now does too. */}
              <LibrarySourceNote label="Reading from" />
              {/* Search box — type to fuzzy-find any node or workflow by name (basename matches rank first). */}
              <div className="flex items-center gap-1.5 rounded border border-slate-200 px-1.5 focus-within:border-slate-400">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                  placeholder="Search objects, tools & workflows…"
                  className="h-7 w-full bg-transparent text-[11px] outline-none placeholder:text-slate-400"
                />
                {importSearch && (
                  <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setImportSearch("")} title="Clear">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* While searching → a flat ranked list across all three roots; otherwise → the foldable
                  Objects / Tools / Workflows trees, one per Library folder. */}
              {libraryFlows == null && libraryPobjs == null && libraryTools == null ? (
                <div className="py-3 text-center text-[10px] text-slate-400">Loading library…</div>
              ) : importMatches ? (
                importMatches.length === 0 ? (
                  <div className="py-3 text-center text-[10px] text-slate-400">No matches for “{importSearch.trim()}”.</div>
                ) : (
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {importMatches.map(({ root, f }) => {
                      const isNodeFile = root === LIB_TOOLS;
                      const folder = `${root}${f.includes("/") ? `/${f.replace(/\/[^/]*$/, "")}` : ""}`;
                      return (
                        <button
                          key={`${root}/${f}`}
                          type="button"
                          onClick={() => void importLibraryFile(root, f)}
                          title={`${root}/${f}`}
                          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-100"
                        >
                          {isNodeFile ? <Boxes className="h-3 w-3 shrink-0 text-fuchsia-500" /> : <FilePlus className="h-3 w-3 shrink-0 text-sky-500" />}
                          <span className="truncate">{libLeafLabel(f.split("/").pop() ?? f)}</span>
                          <span className="ml-auto shrink-0 truncate pl-2 text-[9px] text-slate-300">{folder}</span>
                        </button>
                      );
                    })}
                  </div>
                )
              ) : importTree.length > 0 || pobjTree.length > 0 || toolTree.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {pobjTree.map((g) => (
                    <LibTreeNode key={g.key} node={g} depth={0} expanded={importExpanded} onToggle={toggleImportFolder} onPick={(p) => void importLibraryFile(LIB_OBJECTS, p)} basePath={LIB_OBJECTS} />
                  ))}
                  {toolTree.map((g) => (
                    <LibTreeNode key={g.key} node={g} depth={0} expanded={importExpanded} onToggle={toggleImportFolder} onPick={(p) => void importLibraryFile(LIB_TOOLS, p)} basePath={LIB_TOOLS} />
                  ))}
                  {importTree.map((g) => (
                    <LibTreeNode key={g.key} node={g} depth={0} expanded={importExpanded} onToggle={toggleImportFolder} onPick={(p) => void importLibraryFlow(p)} basePath={LIB_WORKFLOWS} />
                  ))}
                </div>
              ) : (
                <div className="py-3 text-center text-[10px] text-slate-400">No objects, tools or workflows yet.</div>
              )}

              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[9px] uppercase tracking-wide text-slate-400">or upload</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <Button variant="outline" size="sm" className="h-7 w-full gap-1.5 text-[11px]" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> Upload .json file
              </Button>
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[9px] uppercase tracking-wide text-slate-400">or paste</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <textarea
                className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 font-mono text-[10px]"
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder='{ "version": 1, "nodes": [...], "edges": [...] }'
              />
              <Button size="sm" className="h-7 w-full gap-1.5 text-[11px]" disabled={!pasteText.trim()} onClick={importPasted}>
                <Upload className="h-3 w-3" /> Import pasted JSON
              </Button>
              <span className="block text-[9px] leading-tight text-slate-400">
                Replaces the current graph with the imported nodes &amp; connections.
              </span>
            </div>
          )}

          {/* Export dropdown — show the JSON to copy, then optionally save to a file. */}
          {exportOpen && (
            <div className="absolute right-0 top-9 z-50 w-96 space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Export flow</span>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setExportOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <textarea
                readOnly
                className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 font-mono text-[10px]"
                rows={10}
                value={exportText}
                onFocus={(e) => e.currentTarget.select()}
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 flex-1 gap-1.5 text-[11px]" onClick={copyExport}>
                  <Copy className="h-3.5 w-3.5" /> Copy JSON
                </Button>
                <Button size="sm" className="h-7 flex-1 gap-1.5 text-[11px]" onClick={saveExportFile}>
                  <Download className="h-3.5 w-3.5" /> Save .json file
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Body — canvas only. The left node palette ("Add" rail) was removed; nodes are added via the
          Import dropdown (searchable Nodes/Workflows tree). The palette helpers (PALETTE_CATEGORIES /
          addToolNode / toggleCat) are kept dormant so the rail can be restored if needed. */}
      <div className="flex min-h-0 flex-1">
        {/* Canvas */}
        <div className="relative flex-1">
          {/* Selected-edge highlight — React Flow's default selected stroke is too subtle; make it a
              clear thick blue line (covers focus + the animated dash). */}
          <style>{`
            .react-flow__edge.selected .react-flow__edge-path,
            .react-flow__edge:focus .react-flow__edge-path,
            .react-flow__edge:focus-visible .react-flow__edge-path { stroke: #3b82f6 !important; stroke-width: 3 !important; }
            .react-flow__edge.selected .react-flow__edge-path { filter: drop-shadow(0 0 2px rgba(59,130,246,0.6)); }
          `}</style>
          <ReactFlow
            nodes={viewNodes}
            edges={viewEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

      </div>

      {/* Footer — compile status + run */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-3 py-2">
        <div className="min-w-0 flex-1 text-[11px]">
          {/* No "needs a source" warning any more — a flow can run entirely from a coordinate list. Only a
              genuinely bad id (typed but matching no space) is still worth surfacing, since that IS a
              mistake rather than a missing root. */}
          {compiled.error ? (
            <span className="text-red-600">{compiled.error}</span>
          ) : badSource?.idStr ? (
            <span className="text-amber-600">
              {`One or more ids in "${badSource.idStr}" match no space — enter valid ids (e.g. Space001, Space002).`}
            </span>
          ) : (
            <span className="text-slate-500">
              {compiled.opCount > 0
                ? `${compiled.opCount} operation${compiled.opCount === 1 ? "" : "s"} · previewing live on canvas · `
                : "Previewing live on canvas · Run to commit · "}
              <button type="button" className="underline hover:text-slate-700" onClick={() => setJsonOpen((v) => !v)}>
                {jsonOpen ? "hide" : "view"} JSON
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Live: materialise space-producing nodes (Inset, Optimise Rectangle, …) as REAL editable
              Spaces that track their params, instead of a preview you must Run to commit. */}
          <Button
            variant={props.liveFlow ? "default" : "outline"}
            size="sm"
            className={`h-8 gap-1.5 px-3 text-[12px] ${props.liveFlow ? "bg-emerald-600 hover:bg-emerald-700" : "text-emerald-700"}`}
            onClick={props.onToggleLiveFlow}
            title="Live — draw each space-producing node's output (Inset, Optimise Rectangle, …) as a real, editable Space that updates as you change parameters (no Run needed). Toggle off to go back to preview."
          >
            <Radio className="h-3.5 w-3.5" /> Live{props.liveFlow ? " · on" : ""}
          </Button>
          {/* Live + Run Flow are ALWAYS enabled: a flow no longer needs a canvas Space / Segment / Graph
              root — a coordinate list (Polygon / Network / Vertices …) is a complete flow on its own. */}
          <Button
            size="sm"
            className="h-8 gap-1.5 px-3 text-[12px]"
            onClick={() => run("commit")}
          >
            <Play className="h-3.5 w-3.5" /> Run Flow
          </Button>
        </div>
      </div>

      {jsonOpen && !compiled.error && (
        <pre className="max-h-48 overflow-auto whitespace-pre border-t border-slate-200 bg-slate-900 px-3 py-2 font-mono text-[10px] leading-tight text-slate-100">
          {compiled.json}
        </pre>
      )}
    </div>
  );
};
