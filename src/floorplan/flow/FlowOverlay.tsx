import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
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
import { X, Play, Plus, Trash2, Download, Loader2, Wand2, Upload, Sparkles, ChevronDown, ChevronRight, Group as GroupIcon, FilePlus, Eye, EyeOff, Minus, Maximize2, Minimize2, Copy, Boxes, Radio, Folder, Search } from "lucide-react";
import { toast } from "sonner";
import type { Point, SerializedFlow, SerializedFlowNode, ParametricObjectFile } from "../types";
import { pobjToAttachedFlow } from "./pobjToFlow";
import { FLOW_TOOLS, outputSlots, inputProps, schemaEntries, GENERATE_DEFAULT_MODEL, type FlowNodeData, type FlowToolType, type OutputSlot, type InputProp, type InputPropType } from "./flowTypes";
import { compileFlow } from "./compileFlow";
import { mergeObjectIntoFlow, mergeOpeningIntoFlow, mergeWallGraphIntoFlow, mergeNodeObjectIntoFlow, mergeAttachedObjectIntoFlow, pobjPropList, type AutoPlaceEntry, type OpeningKind } from "./autoFlow";
import { PlaceObjectEditor } from "./PlaceObjectEditor";
import { DimensionEdgesEditor } from "./DimensionEdgesEditor";
import { InputPropsEditor } from "./InputPropsEditor";
import { LayoutRoomsEditor } from "./LayoutRoomsEditor";
import { SchemaNodeEditor } from "./SchemaNodeEditor";
import { evaluateFlow, type FlowPreviewItem } from "./eval/evaluateFlow";
import { bakeFlowToIR, runFlowIR, irToPreviewItems } from "./flowIR";
import { inspectParametricGeometry, evalParametricOutputs, type GeomInspection, type ParamOutputs } from "./eval/parametricObject";
import { exprInputs, exprOutputs } from "./eval/expr";
import type { GridField } from "./eval/evalNodes";
import { detectObjects, splitDataUrl } from "../algorithms/vision/geminiObjectDetection";
import { tuneVectorise } from "./vectorTune";
import { runAgentSuggest, runAgentCritique, suggestInputHash, type SuggestTarget, type SuggestParamSpec, type SuggestContext, type SuggestedValue } from "../ai/agentSuggest";
import type { VectorizeParams, VectorizeColorMode } from "../algorithms/vector/vectorizeImage";
import { saveLibraryFile, listLibraryFiles, listParametricObjectFiles, pobjFolderFor } from "../libraryFiles";
import { flowToPobj } from "./flowToPobj";
import { parseBspConnections, serializeBspConnections } from "../algorithms/partitioning/bspAdvanced";
import type { PipeGraphInput } from "../algorithms/network/pipeNetworkSolver";

let nodeSeq = 1;
const nextId = (tool: string) => `${tool}_${nodeSeq++}`;

/** Palette grouping — the left "Add" rail is split into foldable category blocks (in this order). */
const PALETTE_CATEGORIES: { title: string; tools: FlowToolType[] }[] = [
  { title: "Canvas", tools: ["canvas-source", "separate"] },
  { title: "Freehand", tools: ["freehand-source", "freehand-geometry"] },
  { title: "2D Primitives", tools: ["point", "vertices", "network", "rectangle", "circle"] },
  { title: "3D Primitives", tools: ["cuboid", "cylinder", "sphere", "cone", "loop-3d", "transform-3d", "boolean-3d", "display-3d"] },
  { title: "Space", tools: ["source", "space-creator", "space-geometry", "pull", "transform", "hatching", "dimension", "area-dimension", "input-props", "schema", "output-schema", "schema-to-drawing", "schema-to-layers", "boolean-2d", "layout-gen"] },
  { title: "Reshape", tools: ["inset", "optimise-rect", "smoothing", "densify", "bounding-shape", "convex-hull", "contour"] },
  { title: "Partition", tools: ["split", "loop", "bsp", "voronoi", "treemap", "rect-pack", "convex-decomp", "mesh", "circle-packing", "skeleton", "visibility"] },
  { title: "Segment", tools: ["segment-source", "segment-split", "display-segment"] },
  { title: "Node", tools: ["node-source", "bloom", "display-node"] },
  { title: "Graph", tools: ["graph-source", "mitered-join", "graph-smooth", "graph-metrics", "graph-geometry", "show-direction", "graph-to-spaces", "graph-reduce", "graph-simplify", "graph-clip", "graph-fit-lines", "graph-classify", "set-thickness", "merge-graph", "graph-to-openings", "voronoi-bloom", "spring-layout", "pipe-solver"] },
  { title: "Grid", tools: ["grid-source", "graph-to-grid", "grid-field", "cellular-automaton", "laplace-solver", "fill-depressions", "flow-direction", "flow-accumulation", "watershed", "morphology", "grid-distance", "grid-threshold", "marching-squares", "grid-geometry", "render-grid", "matrix-transpose", "matrix-inverse"] },
  { title: "Image", tools: ["image", "vectorise", "object-detection"] },
  { title: "Logic", tools: ["conditional", "param-manip"] },
  { title: "Build", tools: ["floor-massing", "place-object", "frame-builder"] },
  { title: "Building", tools: ["wall-builder", "graph-to-room", "segment-to-door", "segment-to-window", "node-to-object", "segment-to-3d", "space-to-3d"] },
  { title: "Mass", tools: ["mass", "inset-3d", "smooth-3d", "mesh-to-3d"] },
  { title: "Parametric", tools: ["pobj-source", "grab-object", "param-object", "param-grab", "param-output-metrics", "param-geometry"] },
  { title: "Calculate", tools: ["math", "match", "random", "expr", "bua", "file-upload", "text"] },
  { title: "Output", tools: ["output", "render", "analyse", "generate"] },
];

/** "Arrange" — the foldable blocks (in creation order) the tidy-up groups nodes into. */
const ARRANGE_BLOCKS: { key: string; label: string }[] = [
  { key: "canvas", label: "Canvas Import" },
  { key: "math", label: "Math Engine" },
  { key: "3d", label: "3D Primitives" },
  { key: "2d", label: "2D Primitives" },
];
/** Which block each tool belongs to. Tools NOT listed (Space / Graph / Partition / Output / Agent /
 *  Input Properties …) stay at the top level, ungrouped. */
const ARRANGE_CLASS: Partial<Record<FlowToolType, string>> = {
  // 2D Primitives — the 2D shape/generator nodes.
  rectangle: "2d", circle: "2d", arc: "2d", polygon: "2d", polyline: "2d", line: "2d", ngon: "2d",
  ellipse: "2d", "rounded-rect": "2d", sector: "2d", vertices: "2d", network: "2d", point: "2d",
  // 3D Primitives — the 3D solids + their transform / boolean / display nodes.
  cuboid: "3d", cylinder: "3d", sphere: "3d", cone: "3d", frustum: "3d", "tapered-box": "3d",
  torus: "3d", capsule: "3d", "transform-3d": "3d", "boolean-3d": "3d", "display-3d": "3d", "loop-3d": "3d",
  // Math Engine — calculation nodes + the geometric-operation ("reshape") nodes.
  expr: "math", math: "math", random: "math", match: "math", bua: "math", text: "math", inset: "math",
  "optimise-rect": "math", smoothing: "math", densify: "math", contour: "math", "bounding-shape": "math",
  "convex-hull": "math", "boolean-2d": "math",
  // Canvas Import — the nodes that read entities off the canvas.
  "canvas-source": "canvas", source: "canvas", "space-geometry": "canvas", "node-source": "canvas",
  "node-geometry": "canvas", "segment-source": "canvas", "segment-geometry": "canvas", image: "canvas",
  "grab-object": "canvas", separate: "canvas",
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

// --- Generate-node helper (image / video / music via the Google AI API) ---
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** (The AI flow-generation catalog + one-shot instruction moved to ai/flowAgent.ts — the agentic Flow tab
 *  in Chat AI replaced the one-shot "Generate flow with AI" panel.) */

/** Generic op node — header + param fields + handles. Reads/writes graph state via
 *  the `onParamChange` callback the host injects into node data. */
const OpNode = ({ id, data, selected }: NodeProps) => {
  const d = data as FlowNodeData;
  const def = FLOW_TOOLS[d.tool];
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
  const handleSig = `${outN}|${def.valueInputs?.length ?? 0}|${def.valueOutputs?.length ?? 0}|${slotCount}|${propCount}|${exprInCount}|${exprOutCount}`;
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
      {/* Output node: one dynamic value-input endpoint per slot (id `valin-<slotId>`), anchored to its row. */}
      {!collapsed && d.tool === "output" && outputSlots(d.params).map((s) => {
        const top = rowTops[`slot:${s.id}`];
        return (
          <Handle
            key={s.id}
            id={`valin-${s.id}`}
            type="target"
            position={Position.Left}
            style={top != null ? { top } : undefined}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
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
              of this one — collapse the driven expr/primitives back to the brief node, or expand them again. */}
          {(d.tool === "pobj-source" || d.tool === "input-props") && (
            <button
              type="button"
              onClick={() => d.onToggleDecompile?.(id)}
              title={d.params._decompileHidden ? "Show decompiled nodes & connections" : "Hide decompiled nodes & connections"}
              className={`nodrag flex h-4 w-4 items-center justify-center rounded hover:bg-white/20 ${d.params._decompileHidden ? "opacity-60" : ""}`}
            >
              <Boxes className="h-3 w-3" />
            </button>
          )}
          {/* Eye: toggle whether this node's output/preview shows on the canvas (transient `_hidden`).
              Omitted for pure VALUE nodes (no geometry input and no geometry output — Expression, Math,
              Point, Vertices, Convex Decomposition …): they draw nothing, so there is nothing to hide and
              the control would only mislead. */}
          {(def.hasInput || def.hasOutput) && (
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
        {d.tool === "input-props" && (
          <InputPropsEditor
            params={d.params}
            onParamChange={(key, val) => d.onParamChange?.(id, key, val)}
            onRowRef={(pid, el) => { rowRefs.current[`prop:${pid}`] = el; }}
            nodrag
          />
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
          const Row = ({ name, value, unit }: { name: string; value: string; unit?: string }) => (
            <div className="flex items-baseline justify-between gap-2 leading-tight">
              <span className="truncate font-medium text-slate-600">{name}</span>
              <span className="shrink-0 font-mono font-semibold text-cyan-700">{value}{unit ? <span className="ml-0.5 font-normal text-slate-400">{unit}</span> : null}</span>
            </div>
          );
          return (
            <div className="nodrag max-h-64 space-y-1.5 overflow-y-auto pr-0.5 text-[10px]">
              {out.declared.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Outputs</div>
                  {out.declared.map((r, i) => <Row key={`o-${i}-${r.name}`} {...r} />)}
                </div>
              )}
              {out.derived.length > 0 && (
                <div>
                  <div className="mb-0.5 text-[8px] font-semibold uppercase tracking-wide text-slate-400">Derived</div>
                  {out.derived.map((r, i) => <Row key={`d-${i}-${r.name}`} {...r} />)}
                </div>
              )}
              {out.declared.length === 0 && (
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
                <div key={s.id} ref={(el) => { rowRefs.current[`slot:${s.id}`] = el; }} className="flex items-center gap-1">
                  <input
                    type="text"
                    className="h-6 min-w-0 flex-1 rounded border border-slate-200 px-1.5 text-[10px] nodrag"
                    placeholder={`Output ${i + 1}`}
                    value={s.label}
                    onChange={(e) => setSlots(slots.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                  />
                  <span className="w-14 shrink-0 text-right font-mono text-[10px] text-slate-700">{fmt(valueOf(s.id))}</span>
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
              ))}
              <button
                type="button"
                className="nodrag flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50"
                onClick={() => setSlots([...slots, { id: nextSlotId(), label: "" }])}
              >
                <Plus className="h-3 w-3" /> Add output
              </button>
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
              return (
                <div key={f.key} ref={(el) => { rowRefs.current[`field:${f.key}`] = el; }} className="space-y-0.5">
                  <span className="text-[10px] text-slate-500">{f.label}</span>
                  {f.kind === "textarea" ? (
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
            {Array.isArray(d.params._boxes) && (
              <p className="text-center text-[10px] text-slate-500">{(d.params._boxes as unknown[]).length} object(s) → Spaces</p>
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

/** The one `_`-prefixed param family that survives serialization (see buildGraph): node fold state is an
 *  authoring choice, not runtime scratch, so a flow saved folded reopens folded. */
const PERSISTED_VIEW_PARAMS = new Set(["_collapsed"]);

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
  /** The canvas graph with component identity + schema attribute values, for the Pipe Network Solver. */
  pipeGraph?: PipeGraphInput;
  /** Capture the 3D view's isometric snapshot as a PNG data URL (for the Render node). */
  onCaptureIsometric?: () => Promise<string | null>;
  /** Capture the 2D PLAN as a content-cropped PNG data URL — the Agent node's feedback loop looks at this
   *  to review the geometry its parameters actually drew. Same snapshot the canvas agents self-review with. */
  onCaptureCanvas?: () => { dataUrl: string; widthM: number; heightM: number } | null;
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
    /** Run-commit the live pipeline into the canvas — exactly the panel's Run button (recipe engine +
     *  committedNodeIds), with the error returned instead of toasted so agents can react. */
    runCommit: () => { ok: boolean; error?: string; committedNodeIds?: string[] };
  } | null>;
  /** Host action: run the floorplan generator for a Layout Generation node (loads the editable canvas
   *  layout — draggable seeds, connections/repulsions). The node passes its id + params. */
  onRunLayoutGen?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Host action: run simulated annealing on the current generated layout. */
  onRunAnneal?: (nodeId: string, params: Record<string, unknown>) => void;
  /** Host action: enter "Add Room" mode — the next canvas click drops a new room into the generated layout. */
  onAddRoom?: (nodeId: string, params: Record<string, unknown>) => void;
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

/** Let a param write flow all the way to PIXELS before the Agent photographs the canvas. The chain is
 *  long: onParamChange → React commit → the `preview` memo re-evaluating the graph → onPreview lifting the
 *  result to the host → the host's own commit → Konva's redraw. Snapshot too early and you photograph the
 *  PREVIOUS round's geometry, so the reviewer critiques a stale image and the loop can never converge —
 *  the worst kind of bug, because it still looks like it's working. Several frames is a heuristic, not a
 *  guarantee; there's no single event that means "the canvas now reflects this write". */
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
    data: { tool, params: { ...def.defaultParams }, onParamChange: cb.onParamChange, onRunRender: cb.onRunRender, onRunDetect: cb.onRunDetect, onRunVectorTune: cb.onRunVectorTune, onRunAnalyse: cb.onRunAnalyse, onRunGenerate: cb.onRunGenerate, onRunAgent: cb.onRunAgent, onRunLayoutGen: cb.onRunLayoutGen, onRunAnneal: cb.onRunAnneal, onAddRoom: cb.onAddRoom, onToggleDecompile: cb.onToggleDecompile } as FlowNodeData,
  };
};

// ── Import-dropdown file tree ─────────────────────────────────────────────────────────────────────
/** One node in the Library/Flows browser tree — a folder (`children`, no `path`) or a file leaf (`path`). */
interface LibNode { name: string; key: string; path?: string; children: LibNode[] }
/** Build a two-group (Nodes / Workflows) foldable tree from flat Library/Flows paths. Node templates live
 *  under `Nodes/…`; everything else is a Workflow. The leaf keeps the ORIGINAL path (for fetch/import); the
 *  group prefix ("Nodes/" / "Workflows/") is stripped from the DISPLAY segments so folders nest cleanly. */
const buildLibraryTree = (files: string[]): LibNode[] => {
  const groups: Record<string, LibNode> = {};
  for (const f of files) {
    const groupName = /(^|\/)Nodes\//i.test(f) ? "Nodes" : "Workflows";
    if (!groups[groupName]) groups[groupName] = { name: groupName, key: groupName, children: [] };
    const parts = f.replace(/^Nodes\//i, "").replace(/^Workflows\//i, "").split("/").filter(Boolean);
    let cur = groups[groupName];
    let keyPath = groupName;
    parts.forEach((part, i) => {
      keyPath = `${keyPath}/${part}`;
      const isLeaf = i === parts.length - 1;
      let child = cur.children.find((c) => c.name === part && (isLeaf ? !!c.path : !c.path));
      if (!child) { child = { name: part, key: keyPath, children: [], path: isLeaf ? f : undefined }; cur.children.push(child); }
      cur = child;
    });
  }
  const sortRec = (n: LibNode) => {
    n.children.sort((a, b) => ((a.path ? 1 : 0) - (b.path ? 1 : 0)) || a.name.localeCompare(b.name)); // folders first
    n.children.forEach(sortRec);
  };
  return ["Nodes", "Workflows"].filter((g) => groups[g]).map((g) => { sortRec(groups[g]); return groups[g]; });
};
/** Build a single-root foldable tree from flat paths, nesting by folder. Used for the "Parametric Objects"
 *  import group where there are no Nodes/Workflows semantics — just the on-disk folder hierarchy. */
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
/** Strip the file extension for display (`.node.json` / `.json` / `.pobj.json`). */
const libLeafLabel = (name: string) => name.replace(/\.pobj\.json$/i, "").replace(/\.node\.json$/i, "").replace(/\.json$/i, "");

/** Recursive row for the Library/Flows import tree: foldable folders + clickable file leaves. */
const LibTreeNode = ({ node, depth, expanded, onToggle, onPick, basePath = "Flows" }: {
  node: LibNode; depth: number; expanded: Set<string>;
  onToggle: (key: string) => void; onPick: (path: string) => void; basePath?: string;
}) => {
  if (node.path) {
    const isNodeFile = /(^|\/)Nodes\//i.test(node.path);
    return (
      <button
        type="button"
        onClick={() => onPick(node.path!)}
        title={`public/Library/${basePath}/${node.path}`}
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
        <span className="ml-auto text-[9px] tabular-nums text-slate-300">{node.children.length}</span>
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
  // Mirror of the latest evaluated preview (the `preview` memo is defined lower down) so the Agent node's
  // Run action can read the polygon arriving on its input — same forward-ref trick as importFlowDataRef.
  const previewRef = useRef<FlowPreviewItem[]>([]);
  // Mirror of the resolved Space-source footprints (the `sourcePolys` map is built lower down) so the Agent
  // node's Run action can read the Space it is wired INTO (Agent → Space) — that direction leaves nothing on
  // the agent's own input, because a Space ignores incoming geometry. Same forward-ref trick as previewRef.
  const sourcePolysRef = useRef<Map<string, Point[][]>>(new Map());
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
  const onParamChange = useCallback((nodeId: string, key: string, value: unknown) => {
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
  }, [setNodes]);

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
    const seen = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nxt of adj.get(cur) ?? []) {
        if (seen.has(nxt)) continue;
        seen.add(nxt);
        queue.push(nxt);
        if (!SOURCE_TOOLS.has(toolOf(nxt))) hideSet.add(nxt); // keep sources visible; hide the rest
      }
    }
    const start = nodesRef.current.find((n) => n.id === nodeId);
    // Not yet decomposed (nothing reachable but sources) → EXPLODE this Object Node into its primitive graph
    // ON DEMAND, from its stored `definition` — so ANY imported object decompiles on click, not just flagged
    // ones. (Replaces the current flow with the decompiled graph — do it on a freshly-imported object.)
    if (hideSet.size === 0) {
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
    setNodes((ns) => ns.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, params: { ...(n.data as FlowNodeData).params, _decompileHidden: willHide } } }
        : hideSet.has(n.id) ? { ...n, hidden: willHide } : n));
    setEdges((es) => es.map((e) => (hideSet.has(e.source) || hideSet.has(e.target) ? { ...e, hidden: willHide } : e)));
  }, [setNodes, setEdges]);

  // Group box chevron: fold the box down to its title bar. Children — and any edge touching one — get React
  // Flow's `hidden`, exactly as the decompile toggle above does; the expanded height is stashed on the box so
  // expanding restores it. `hidden` never reaches the serialized graph (buildGraph rebuilds each node from
  // scratch), but `collapsed` is a real param, so a flow saved folded reopens folded.
  const onToggleGroup = useCallback((groupId: string) => {
    const kids = new Set(nodesRef.current.filter((n) => n.parentId === groupId).map((n) => n.id));
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

  // Render node "Generate": capture the 3D isometric snapshot, send it + the prompt to the Google AI
  // image model, and bake the result (or busy/error state) back onto the node. Stable identity (reads
  // onCaptureIsometric via a ref) so it can be injected once at node creation.
  const captureIsoRef = useRef(props.onCaptureIsometric);
  captureIsoRef.current = props.onCaptureIsometric;
  const onRunRender = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    const model = String(params.model ?? "gemini-3.1-flash-image-preview").trim() || "gemini-3.1-flash-image-preview";
    const prompt = String(params.prompt ?? "");
    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_resultUrl", undefined);
    try {
      const snap = await captureIsoRef.current?.();
      if (!snap) { toast.error("Couldn't capture the 3D isometric view"); return; }
      const data = snap.split(",")[1] ?? "";
      const mime = snap.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      if (!res.ok) { toast.error(`Render failed (${res.status})`); console.error(await res.text()); return; }
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: { inline_data?: { data?: string }; inlineData?: { data?: string } }) => p.inline_data?.data || p.inlineData?.data);
      if (!imgPart) { toast.error("Model returned no image"); console.error("Render response:", json); return; }
      const inline = imgPart.inline_data ?? imgPart.inlineData;
      const m = inline.mime_type ?? inline.mimeType ?? "image/png";
      onParamChange(nodeId, "_resultUrl", `data:${m};base64,${inline.data}`);
      toast.success("Render complete");
    } catch (e) {
      toast.error("Render error");
      console.error(e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange]);

  // Object Detection action: run Gemini on the imported image, convert each bounding box (normalised
  // 0–1000) into a world-space Space rectangle via the underlay box, and bake them under `_boxes`.
  const imageDataRef = useRef(props.imageData);
  imageDataRef.current = props.imageData;
  const onRunDetect = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const img = imageDataRef.current;
    if (!img) { toast.error("Load an image first (drop a PNG/JPG onto the canvas)."); return; }
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Enter a Gemini API key."); return; }
    const model = String(params.model ?? "").trim() || "gemini-robotics-er-1.6-preview";
    onParamChange(nodeId, "_busy", true);
    try {
      const { mimeType, base64 } = splitDataUrl(img.key);
      const dets = await detectObjects({
        model, apiKey, mode: "box",
        targets: String(params.targets ?? ""),
        maxItems: Math.max(1, Math.round(Number(params.maxItems) || 20)),
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
      onParamChange(nodeId, "_boxes", boxes);
      if (boxes.length === 0) toast.warning("No objects detected — try a broader target or a different model.");
      else toast.success(`Detected ${boxes.length} object${boxes.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(`Object detection failed: ${(e as Error)?.message ?? "unknown error"}`);
      console.error(e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange]);

  // Auto-Tune action (Vectorisation): coordinate-descent over the tracing parameters against the loaded
  // underlay — every candidate runs the REAL vectorise → faces pipeline and is scored on closed spaces
  // found (minus noise faces / open ends). Progress streams into the node's `_tuneStatus` line; the best
  // combo is baked back into the node's sliders, so the live preview lands on the winning trace.
  const onRunVectorTune = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const img = imageDataRef.current;
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
  }, [onParamChange]);

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
    const model = (props.aiModel ?? "").trim() || "gemini-3-flash-preview";
    // The geometry this agent reasons about: whatever arrived on its own input (Space → Agent passes it
    // through), else the footprint of any node it's wired to in either direction (see agentGeometryPolyOf).
    // A Space wired in gives an area brief; a Node or Segment has none — that's fine, the agent tunes its
    // targets from the prompt + their schemas (an empty context). So a missing poly is NOT an error here.
    const poly = previewRef.current.find((it) => it.nodeId === nodeId)?.polygons.find((p) => p.length >= 3)
      ?? agentGeometryPolyOf(nodeId, edgesRef.current, previewRef.current, sourcePolysRef.current);
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
  }, [onParamChange, props.pixelsPerMeter, props.aiApiKey, props.aiModel]);

  // Generate action: text-to-media via the Google AI / Gemini API. Branches on the "Kind" dropdown:
  //  • image → models/<model>:generateContent with responseModalities IMAGE → inline image (data URL).
  //  • video → Veo models/<model>:predictLongRunning → poll the operation → download the result file.
  //  • music → Lyria RealTime live websocket → capture ~15s of streamed PCM → encode WAV.
  // The result (data/object URL + filename) is baked under `_resultUrl`/`_resultName` for the download link.
  const onRunGenerate = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    const kind = String(params.kind ?? "image");
    const model = String(params.model ?? "").trim() || GENERATE_DEFAULT_MODEL[kind] || "gemini-2.5-flash-image";
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
  }, [onParamChange]);

  const layoutGenCb = props.onRunLayoutGen;
  const annealCb = props.onRunAnneal;
  const addRoomCb = props.onAddRoom;
  const nodeCb = useMemo<NodeCallbacks>(() => ({
    onParamChange, onRunRender, onRunDetect, onRunVectorTune, onRunAnalyse, onRunGenerate, onRunAgent,
    onRunLayoutGen: (nodeId, params) => layoutGenCb?.(nodeId, params),
    onRunAnneal: (nodeId, params) => annealCb?.(nodeId, params),
    onAddRoom: (nodeId, params) => addRoomCb?.(nodeId, params),
    onToggleDecompile, onToggleGroup,
  }), [onParamChange, onRunRender, onRunDetect, onRunVectorTune, onRunAnalyse, onRunGenerate, onRunAgent, layoutGenCb, annealCb, addRoomCb, onToggleDecompile, onToggleGroup]);

  // Keep every Space (source) node with "Grab ID from selection" on synced to ALL currently-selected
  // spaces' ids (comma-separated), so one Space node can output several spaces at once. Falls back to the
  // single selected id. Only writes when the value changes, so it doesn't fight user edits or loop.
  const selectedRoomIdList = (props.selectedRoomIds && props.selectedRoomIds.length
    ? props.selectedRoomIds
    : (props.selectedRoomId ? [props.selectedRoomId] : [])).join(", ");
  // Signature of which source nodes currently have grab on — so flipping the toggle re-syncs even when
  // the selection itself hasn't changed.
  const grabSig = nodes.filter((n) => (n.data as FlowNodeData).tool === "source" && (n.data as FlowNodeData).params.grabFromSelection).map((n) => n.id).join(",");
  useEffect(() => {
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool !== "source") return n;
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
    // Library convention: flows live in public/Library/Flows. In dev the bridge writes the file
    // there directly (timestamped, no overwrites); otherwise fall back to the downloaded copy + hint.
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    void saveLibraryFile(`Flows/flow-${stamp}.json`, exportText).then((r) =>
      r.ok
        ? toast.success(`Flow saved to public/Library/${r.path}`)
        : toast.success("Flow exported — keep bundled flows in public/Library/Flows"),
    );
  }, [exportText]);

  // Bake this flow into a parametric object (.pobj) — input-props → parameters, the expr node → geometry.vars,
  // each 2D/3D primitive → a box/circle/poly/line rule, the Node/Segment/Space anchor → hostKind. See flowToPobj.
  const saveAsPobj = useCallback(() => {
    const name = window.prompt("Save this flow as a parametric object.\nName:", "My Object")?.trim();
    if (!name) return;
    let result;
    try {
      result = flowToPobj(buildGraph(), { name });
    } catch (e) {
      toast.error(`Couldn't bake this flow: ${(e as Error)?.message ?? "unknown error"}`);
      return;
    }
    if (!result.pobj) {
      toast.error("Nothing to bake — add primitive nodes (Rectangle / Cuboid / Arc …) that draw the object.");
      return;
    }
    const meta = result.pobj.meta as { id: string };
    const hostKind = result.pobj.hostKind as string | undefined;
    const folder = pobjFolderFor(String((result.pobj.meta as { category?: string }).category), hostKind);
    const rel = `Parametric Objects/${folder}/${meta.id}.pobj.json`;
    if (result.warnings.length) console.warn("Save as Parametric Object — notes:", result.warnings);
    void saveLibraryFile(rel, JSON.stringify(result.pobj, null, 2)).then((r) =>
      r.ok
        ? toast.success(`Saved “${name}” to public/Library/${r.path}${result.warnings.length ? ` · ${result.warnings.length} note${result.warnings.length > 1 ? "s" : ""} in console` : ""}`)
        : toast.error(`Couldn't save the object: ${r.error ?? "the library bridge is dev-only"}`),
    );
  }, [buildGraph]);

  // Build live nodes/edges from a parsed flow object and load them into the graph. Throws on a bad
  // shape so callers can surface an error. Shared by file import and AI "Generate JSON".
  const importFlowData = useCallback((parsed: { nodes?: unknown[]; edges?: unknown[] }) => {
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
          : ({ tool, params: { ...(n.data?.params ?? {}) }, onParamChange: nodeCb.onParamChange, onRunRender: nodeCb.onRunRender, onRunDetect: nodeCb.onRunDetect, onRunVectorTune: nodeCb.onRunVectorTune, onRunAnalyse: nodeCb.onRunAnalyse, onRunGenerate: nodeCb.onRunGenerate, onRunAgent: nodeCb.onRunAgent, onRunLayoutGen: nodeCb.onRunLayoutGen, onRunAnneal: nodeCb.onRunAnneal, onAddRoom: nodeCb.onAddRoom, onToggleDecompile: nodeCb.onToggleDecompile } as FlowNodeData),
      };
      // Grouped child → reattach to its parent (position stays parent-relative, constrained to the box).
      if (typeof n.parentId === "string") { node.parentId = n.parentId; node.extent = "parent"; }
      // Group container → restore its box size.
      if (isGroup) node.style = { width: typeof n.width === "number" ? n.width : 240, height: typeof n.height === "number" ? n.height : 160 };
      return node;
    });
    // React Flow requires a parent (group) node to precede its children in the array — groups first.
    importedNodes.sort((a, b) => (a.type === "group" ? 0 : 1) - (b.type === "group" ? 0 : 1));
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
      const key = data.tool === "voronoi" ? "vertexCount" : data.tool === "convex-decomp" ? "pieceCount" : (data.tool === "inset" || data.tool === "optimise-rect" || data.tool === "floor-massing" || data.tool === "smoothing" || data.tool === "densify") ? "inputCount" : (data.tool === "split" || data.tool === "bsp" || data.tool === "skeleton" || data.tool === "mitered-join" || data.tool === "graph-source" || data.tool === "segment-source" || data.tool === "node-source" || data.tool === "separate" || data.tool === "segment-split" || data.tool === "graph-to-spaces" || data.tool === "voronoi-bloom" || data.tool === "object-detection" || data.tool === "mesh" || data.tool === "circle-packing" || data.tool === "visibility" || data.tool === "treemap" || data.tool === "rect-pack") ? "handleCount" : null;
      if (key) data.params[key] = Math.max(Number(data.params[key]) || 0, need + 1);
    }
    // A group saved COLLAPSED reopens collapsed: re-apply `hidden` to its children and their edges (the flag
    // itself isn't serialized — only the box's `collapsed` param is). The auto-fit effect leaves collapsed
    // boxes at their stored title-bar height.
    const collapsedGroups = new Set(importedNodes.filter((n) => n.type === "group" && (n.data as FlowNodeData).params?.collapsed).map((n) => n.id));
    if (collapsedGroups.size) {
      const hidden = new Set<string>();
      for (const n of importedNodes) if (n.parentId && collapsedGroups.has(n.parentId)) { n.hidden = true; hidden.add(n.id); }
      for (const e of importedEdges) if (hidden.has(e.source) || hidden.has(e.target)) e.hidden = true;
    }
    // Advance the id counter past any imported "<tool>_<n>" ids so new nodes don't collide.
    for (const n of importedNodes) {
      const m = /_(\d+)$/.exec(n.id);
      if (m) nodeSeq = Math.max(nodeSeq, parseInt(m[1], 10) + 1);
    }
    // Guarantee a primary source node exists (pipeline input) — but ANY source-family node counts (a Node /
    // Segment / Canvas object decompiles from its own source), so we don't force a stray Space `source` onto
    // a graph that already has, say, a `node-source`.
    const SOURCE_TOOLS = new Set<FlowToolType>(["source", "node-source", "segment-source", "canvas-source", "graph-source", "grid-source", "image"]);
    if (!importedNodes.some((n) => SOURCE_TOOLS.has((n.data as FlowNodeData).tool))) {
      importedNodes.unshift(makeNode("source", { x: 80, y: 200 }, nodeCb, { singleton: true }));
    }
    setNodes(importedNodes);
    setEdges(importedEdges);
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
        const n = importFlowData(JSON.parse(String(reader.result)));
        toast.success(`Imported flow — ${n} node${n === 1 ? "" : "s"}`);
      } catch (err) {
        toast.error("Invalid flow JSON");
        console.error("Flow import failed:", err);
      }
    };
    reader.readAsText(file);
  }, [importFlowData]);

  // Drop a single `pobj-source` node for an already-parsed parametric object: geometry output = footprint,
  // each parameter = a `val-<key>` output. Used by the Import browser's "Parametric Objects" folder.
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
      const n = importFlowData(pobjToAttachedFlow(pobj as unknown as ParametricObjectFile, {}));
      const nm = (pobj.meta as { name?: string } | undefined)?.name ?? "object";
      toast.success(`Loaded "${nm}" as a Flow — ${n} node${n === 1 ? "" : "s"}`);
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
      const n = importFlowData(JSON.parse(text));
      toast.success(`Imported flow — ${n} node${n === 1 ? "" : "s"}`);
      setImportOpen(false);
      setPasteText("");
    } catch (err) {
      toast.error("Invalid flow JSON");
      console.error("Flow paste import failed:", err);
    }
  }, [pasteText, importFlowData]);

  // ── Bundled Library flows (public/Library/Flows) — listed live via the dev Library bridge so the
  // Import dropdown loads them in one click. Replaces the old built-in workflow-templates rail: the
  // templates now ship as JSON files in that folder. Null/empty = bridge unavailable (production
  // build) → the section hides; the same files still import via "Upload .json file". ──
  const [libraryFlows, setLibraryFlows] = useState<string[] | null>(null);
  useEffect(() => {
    if (!importOpen) return;
    let cancelled = false;
    void listLibraryFiles("Flows").then((files) => { if (!cancelled) setLibraryFlows(files); });
    return () => { cancelled = true; };
  }, [importOpen]);
  const importLibraryFlow = useCallback(async (file: string) => {
    try {
      const res = await fetch(encodeURI(`/Library/Flows/${file}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = (await res.json()) as { nodes?: unknown[]; edges?: unknown[]; title?: unknown; kind?: unknown; tool?: unknown; label?: unknown; params?: unknown; meta?: { label?: unknown } };
      // A NODE TEMPLATE file (public/Library/Flows/Nodes/**/*.node.json — a single "flow-node" tool with
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
        setImportOpen(false);
        return;
      }
      const n = importFlowData(parsed);
      toast.success(`Imported ${typeof parsed.title === "string" && parsed.title ? parsed.title : file} — ${n} node${n === 1 ? "" : "s"}`);
      setImportOpen(false);
    } catch (err) {
      toast.error(`Couldn't load ${file}`);
      console.error("Library flow import failed:", err);
    }
  }, [importFlowData, setNodes, nodeCb]);

  // ── Bundled Parametric Objects (public/Library/Parametric Objects) — listed live so the Import browser
  // can expose them as a foldable "Parametric Objects" group. Picking a leaf drops a single pobj-source node
  // (geometry footprint output + a val-<key> output per parameter), same as the "Load Parametric Site"
  // upload button. listParametricObjectFiles() lists LIVE in dev and falls back to the bundled manifest in
  // production, so the group populates in both. Empty = nothing on disk → the group hides. ──
  const [libraryPobjs, setLibraryPobjs] = useState<string[] | null>(null);
  useEffect(() => {
    if (!importOpen) return;
    let cancelled = false;
    void listParametricObjectFiles().then((files) => { if (!cancelled) setLibraryPobjs(files); });
    return () => { cancelled = true; };
  }, [importOpen]);
  const importLibraryPobj = useCallback(async (file: string) => {
    try {
      const res = await fetch(encodeURI(`/Library/Parametric Objects/${file}`));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      dropPobjSourceNode((await res.json()) as Record<string, unknown>);
      setImportOpen(false);
    } catch (err) {
      toast.error(`Couldn't load ${file}`);
      console.error("Library parametric object import failed:", err);
    }
  }, [dropPobjSourceNode]);

  // Import browser: a foldable Nodes/Workflows tree + a fuzzy search box. `importExpanded` holds the open
  // folder keys (the two top groups start open); `importSearch` switches the panel to a flat ranked list.
  const [importSearch, setImportSearch] = useState("");
  const [importExpanded, setImportExpanded] = useState<Set<string>>(() => new Set(["Nodes", "Workflows"]));
  const toggleImportFolder = useCallback((key: string) => {
    setImportExpanded((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);
  const importTree = useMemo(() => buildLibraryTree(libraryFlows ?? []), [libraryFlows]);
  const pobjTree = useMemo(() => buildFolderTree(libraryPobjs ?? [], "Parametric Objects"), [libraryPobjs]);
  // Fuzzy search → a flat ranked list (basename prefix > basename substring > path substring). Null when the
  // box is empty (the tree shows instead).
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
    return (libraryFlows ?? [])
      .map((f) => ({ f, r: rank(f) }))
      .filter((x) => x.r < 99)
      .sort((a, b) => a.r - b.r || (a.f.split("/").pop() ?? a.f).localeCompare(b.f.split("/").pop() ?? b.f))
      .slice(0, 50)
      .map((x) => x.f);
  }, [importSearch, libraryFlows]);
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
    // Children of a dissolved group must lose the `hidden` the collapse toggle put on them (and their
    // edges) — otherwise deleting a COLLAPSED box leaves its nodes alive but invisible.
    const orphaned = new Set(nodes.filter((n) => n.parentId && groupIds.has(n.parentId)).map((n) => n.id));
    setEdges((es) => es
      .filter((e) => !e.selected && !removedOps.has(e.source) && !removedOps.has(e.target))
      .map((e) => (e.hidden && (orphaned.has(e.source) || orphaned.has(e.target)) ? { ...e, hidden: false } : e)));
    if (groupIds.size || removedOps.size) {
      setNodes((ns) => {
        const gpos = new Map(ns.filter((n) => groupIds.has(n.id)).map((n) => [n.id, n.position]));
        return ns
          .filter((n) => !groupIds.has(n.id) && !removedOps.has(n.id))
          .map((n) => {
            if (n.parentId && groupIds.has(n.parentId)) {
              const gp = gpos.get(n.parentId)!;
              const { parentId: _p, extent: _e, ...rest } = n;
              void _p; void _e;
              return { ...rest, hidden: false, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } } as Node;
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

  // "Arrange" — tidy the whole flow into foldable blocks. Flattens any existing groups first (so it's
  // idempotent), ensures an Agent + Input Properties node exist, then buckets every classified node into its
  // block (Canvas Import / Math Engine / 3D Primitives / 2D Primitives), reparents each into a group box with
  // its children COLLAPSED and stacked, and lays the boxes out in a row. Uncategorised nodes (Space / Graph /
  // Output / Agent / Input Properties …) keep their positions. Mirrors the hand-arranged bed-flow.
  const arrangeFlow = useCallback(() => {
    const cur = nodesRef.current;
    const findTool = (t: string) => cur.find((n) => n.type !== "group" && (n.data as FlowNodeData).tool === t);
    // Decide additions UP FRONT (outside setNodes) so their ids are known for wiring.
    const newProps = findTool("input-props") ? null : makeNode("input-props", { x: -40, y: 40 }, nodeCb);
    const newAgent = findTool("agent") ? null : makeNode("agent", { x: -360, y: 40 }, nodeCb);
    const propsId = findTool("input-props")?.id ?? newProps?.id ?? null;

    setNodes((ns) => {
      // 1. Flatten existing groups → children back to ABSOLUTE coords; drop the group boxes.
      const gpos = new Map(ns.filter((n) => n.type === "group").map((n) => [n.id, n.position] as const));
      const flat: Node[] = ns.filter((n) => n.type !== "group").map((n) => {
        if (n.parentId && gpos.has(n.parentId)) {
          const gp = gpos.get(n.parentId)!;
          const { parentId: _p, extent: _e, ...rest } = n; void _p; void _e;
          return { ...rest, hidden: false, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } } as Node;
        }
        return n.hidden ? { ...n, hidden: false } : n;
      });
      if (newProps) flat.push(newProps);
      if (newAgent) flat.push(newAgent);
      // 2. Bucket every classified node; the rest stay ungrouped (positions untouched).
      const byBlock = new Map<string, Node[]>();
      const ungrouped: Node[] = [];
      for (const n of flat) {
        const b = ARRANGE_CLASS[(n.data as FlowNodeData).tool];
        if (b) (byBlock.get(b) ?? byBlock.set(b, []).get(b)!).push(n);
        else ungrouped.push(n);
      }
      // 3. One group box per non-empty block; reparent + collapse + stack its members.
      const groups: Node[] = [];
      const children: Node[] = [];
      let gx = 40;
      for (const { key, label } of ARRANGE_BLOCKS) {
        const members = byBlock.get(key);
        if (!members?.length) continue;
        const gid = nextId("group");
        groups.push({
          id: gid, type: "group", position: { x: gx, y: 300 },
          data: { tool: "group", params: { label }, onParamChange: nodeCb.onParamChange, onToggleGroup: nodeCb.onToggleGroup } as unknown as FlowNodeData,
          style: { width: 256, height: GROUP_HEADER + GROUP_PAD + members.length * 44 + GROUP_PAD },
          selectable: true, draggable: true, deletable: true,
        });
        members.forEach((m, i) => children.push({
          ...m, parentId: gid, extent: "parent" as const, selected: false, hidden: false,
          position: { x: GROUP_PAD, y: GROUP_HEADER + GROUP_PAD + i * 44 },
          data: { ...m.data, params: { ...(m.data as FlowNodeData).params, _collapsed: true } } as FlowNodeData,
        }));
        gx += 340;
      }
      // Parent boxes MUST precede their children (React Flow); ungrouped nodes can sit anywhere between.
      return [...groups, ...ungrouped, ...children];
    });
    // Wire a freshly-added Agent into Input Properties (the bed-flow control chain).
    if (newAgent && propsId) {
      const aId = newAgent.id, pId = propsId;
      setEdges((es) => es.some((e) => e.source === aId && e.target === pId)
        ? es
        : [...es, { id: `e_${aId}_${pId}`, source: aId, target: pId, sourceHandle: null, targetHandle: null, animated: true }]);
    }
  }, [setNodes, setEdges, nodeCb]);

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
    .filter((n) => { const d = n.data as FlowNodeData; return d.tool === "source" || (d.tool === "grab-object" && d.params.hostKind === "space"); })
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
  const hasCanvasRoot = !!canvasContent && nodes.some((n) => (n.data as FlowNodeData).tool === "canvas-source") &&
    (canvasContent.spaces.length > 0 || canvasContent.nodes.length > 0 || canvasContent.segments.length > 0 || canvasContent.graphs.length > 0 || canvasContent.images.length > 0);
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
  const hasPrimRoot = nodes.some((n) => { const t = (n.data as FlowNodeData).tool; return t === "rectangle" || t === "circle" || t === "polygon" || t === "polyline" || t === "network" || t === "line" || t === "ngon" || t === "ellipse" || t === "rounded-rect" || t === "sector" || t === "arc"; });
  // Ready once ≥1 root is actually usable (a resolved Space, a Creator, a Selected Graph, an Image, the
  // Canvas, or a primitive generator) and no Space node has a typed-but-unmatched id.
  const sourcesReady = (anySpaceReady || hasCreator || hasGraphRoot || hasImageRoot || hasCanvasRoot || hasPrimRoot) && !badSource;
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
      runCommit: () => {
        if (compiled.error) return { ok: false, error: `flow does not compile: ${compiled.error}` };
        // No source gate — a coordinate-list flow runs without any canvas root (matches the Run button).
        if (badSource?.idStr) return { ok: false, error: `no space matches "${badSource.idStr}" — set a valid id on the source node` };
        onRunCommitProp(compiled.json, compiled.committedNodeIds);
        return { ok: true, committedNodeIds: compiled.committedNodeIds };
      },
    };
    return () => { flowApiRef.current = null; };
  }, [flowApiRef, buildGraph, importFlowData, compiled, badSource, onRunCommitProp]);
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
  const imageKey = imageData ? `${imageData.key}:${imageData.w}x${imageData.h}:${imageData.box.x.toFixed(1)},${imageData.box.y.toFixed(1)},${imageData.box.scale.toFixed(3)}` : "";
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
      return (sourcesReady || hasPipeRoot) ? evaluateFlow(nodes, edges, sourcePolys, ppm, evalAnchor, graphSegments, graphsBySourceNode, pathEdges, imageData, canvasContent, pipeGraph, gridFieldsBySourceNode) : [];
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
      preview.filter((it) => it.tool === "voronoi" || it.tool === "convex-decomp" || it.tool === "inset" || it.tool === "optimise-rect" || it.tool === "split" || it.tool === "bsp" || it.tool === "skeleton" || it.tool === "smoothing" || it.tool === "densify" || it.tool === "floor-massing" || it.tool === "mitered-join" || it.tool === "graph-source" || it.tool === "segment-source" || it.tool === "node-source" || it.tool === "separate" || it.tool === "segment-split" || it.tool === "graph-to-spaces" || it.tool === "voronoi-bloom" || it.tool === "object-detection" || it.tool === "mesh" || it.tool === "circle-packing" || it.tool === "visibility" || it.tool === "treemap" || it.tool === "rect-pack").map((it) => [it.nodeId, it.cellCount ?? it.polygons.length]),
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
    // Scalar value outputs (e.g. Inset area) → bake under params._values for the node's readout.
    const valuesByNode = new Map(
      preview.filter((it) => it.values).map((it) => [it.nodeId, it.values!]),
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
        if (data.tool === "split" || data.tool === "bsp" || data.tool === "skeleton" || data.tool === "mitered-join" || data.tool === "graph-source" || data.tool === "segment-source" || data.tool === "node-source" || data.tool === "separate" || data.tool === "segment-split" || data.tool === "graph-to-spaces" || data.tool === "voronoi-bloom" || data.tool === "object-detection" || data.tool === "mesh" || data.tool === "circle-packing" || data.tool === "visibility" || data.tool === "treemap" || data.tool === "rect-pack") {
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
        if (FLOW_TOOLS[data.tool].valueOutputs?.length) {
          const v = valuesByNode.get(n.id);
          if (v && JSON.stringify(data.params._values) !== JSON.stringify(v)) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, _values: v } } };
          }
        }
        if (FLOW_TOOLS[data.tool].valueInputs?.length) {
          // Write each wired value into its actual param so the field/slider reflects the driven value.
          const vin = vinByNode.get(n.id);
          if (vin) {
            let diff = false;
            const merged: Record<string, unknown> = { ...data.params };
            for (const [k, val] of Object.entries(vin)) {
              // Split's `ratios` is a text list, so store the driven number as its string form. A wired
              // checkbox param bakes as a real BOOLEAN so the committed params match a hand-toggled node.
              const kind = FLOW_TOOLS[data.tool].fields.find((f) => f.key === k)?.kind;
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
            title="Arrange — tidy the flow into foldable blocks (2D Primitives, 3D Primitives, Math Engine, Canvas Import); adds an Agent + Input Properties node if missing"
          >
            <Wand2 className="h-3.5 w-3.5" /> Arrange
          </Button>
          {/* Bake the whole flow into a reusable parametric object (.pobj) saved to the Library. */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[11px] text-indigo-600 hover:bg-indigo-50"
            onClick={saveAsPobj}
            title="Save as Parametric Object — bake this flow into a reusable .pobj object in the Library"
          >
            <Boxes className="h-3.5 w-3.5" /> Save as Object
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

          {/* Import dropdown — the bundled Library/Flows list (one click), upload a .json file, OR
              paste flow JSON directly. */}
          {importOpen && (
            <div className="absolute right-0 top-9 z-50 w-96 space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Import flow</span>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setImportOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Search box — type to fuzzy-find any node or workflow by name (basename matches rank first). */}
              <div className="flex items-center gap-1.5 rounded border border-slate-200 px-1.5 focus-within:border-slate-400">
                <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                <input
                  autoFocus
                  value={importSearch}
                  onChange={(e) => setImportSearch(e.target.value)}
                  placeholder="Search nodes & workflows…"
                  className="h-7 w-full bg-transparent text-[11px] outline-none placeholder:text-slate-400"
                />
                {importSearch && (
                  <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setImportSearch("")} title="Clear">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* While searching → a flat ranked list; otherwise → the foldable Nodes / Workflows tree. */}
              {libraryFlows == null ? (
                <div className="py-3 text-center text-[10px] text-slate-400">Loading library…</div>
              ) : importMatches ? (
                importMatches.length === 0 ? (
                  <div className="py-3 text-center text-[10px] text-slate-400">No matches for “{importSearch.trim()}”.</div>
                ) : (
                  <div className="max-h-64 space-y-0.5 overflow-y-auto">
                    {importMatches.map((f) => {
                      const isNodeFile = /(^|\/)Nodes\//i.test(f);
                      const folder = f.includes("/") ? f.replace(/\/[^/]*$/, "") : "";
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => void importLibraryFlow(f)}
                          title={`public/Library/Flows/${f}`}
                          className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-100"
                        >
                          {isNodeFile ? <Boxes className="h-3 w-3 shrink-0 text-fuchsia-500" /> : <FilePlus className="h-3 w-3 shrink-0 text-sky-500" />}
                          <span className="truncate">{libLeafLabel(f.split("/").pop() ?? f)}</span>
                          {folder && <span className="ml-auto shrink-0 truncate pl-2 text-[9px] text-slate-300">{folder}</span>}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : importTree.length > 0 || pobjTree.length > 0 ? (
                <div className="max-h-64 overflow-y-auto">
                  {importTree.map((g) => (
                    <LibTreeNode key={g.key} node={g} depth={0} expanded={importExpanded} onToggle={toggleImportFolder} onPick={(p) => void importLibraryFlow(p)} />
                  ))}
                  {pobjTree.map((g) => (
                    <LibTreeNode key={g.key} node={g} depth={0} expanded={importExpanded} onToggle={toggleImportFolder} onPick={(p) => void importLibraryPobj(p)} basePath="Parametric Objects" />
                  ))}
                </div>
              ) : (
                <div className="py-3 text-center text-[10px] text-slate-400">No saved flows or nodes yet.</div>
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
