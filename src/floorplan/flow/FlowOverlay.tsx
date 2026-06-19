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
import { X, Play, Plus, Trash2, Download, Loader2, Wand2, Upload, Sparkles, ChevronDown, ChevronRight, Group as GroupIcon, FilePlus, Eye, EyeOff, Minus, Maximize2, Minimize2, Copy } from "lucide-react";
import { toast } from "sonner";
import type { Point, SerializedFlow, SerializedFlowNode } from "../types";
import { FLOW_TOOLS, outputSlots, inputProps, schemaEntries, GENERATE_DEFAULT_MODEL, type FlowNodeData, type FlowToolType, type OutputSlot } from "./flowTypes";
import { compileFlow } from "./compileFlow";
import { mergeObjectIntoFlow, mergeOpeningIntoFlow, mergeWallGraphIntoFlow, mergeNodeObjectIntoFlow, type AutoPlaceEntry, type OpeningKind } from "./autoFlow";
import { PlaceObjectEditor } from "./PlaceObjectEditor";
import { DimensionEdgesEditor } from "./DimensionEdgesEditor";
import { InputPropsEditor } from "./InputPropsEditor";
import { SchemaNodeEditor } from "./SchemaNodeEditor";
import { evaluateFlow, type FlowPreviewItem } from "./eval/evaluateFlow";
import type { GridField } from "./eval/evalNodes";
import { detectObjects, splitDataUrl } from "../algorithms/vision/geminiObjectDetection";
import { parseBspConnections, serializeBspConnections } from "../algorithms/partitioning/bspAdvanced";
import type { PipeGraphInput } from "../algorithms/network/pipeNetworkSolver";

let nodeSeq = 1;
const nextId = (tool: string) => `${tool}_${nodeSeq++}`;

/** Palette grouping — the left "Add" rail is split into foldable category blocks (in this order). */
const PALETTE_CATEGORIES: { title: string; tools: FlowToolType[] }[] = [
  { title: "Canvas", tools: ["canvas-source", "separate"] },
  { title: "Space", tools: ["source", "space-creator", "space-geometry", "pull", "transform", "hatching", "dimension", "area-dimension", "input-props", "schema", "output-schema", "schema-to-drawing", "schema-to-layers", "merge"] },
  { title: "Reshape", tools: ["inset", "optimise-rect", "smoothing", "densify", "bounding-shape", "convex-hull", "contour"] },
  { title: "Partition", tools: ["split", "bsp", "voronoi", "treemap", "rect-pack", "convex-decomp", "mesh", "circle-packing", "skeleton", "visibility"] },
  { title: "Segment", tools: ["segment-source", "segment-split", "display-segment"] },
  { title: "Node", tools: ["node-source", "bloom", "display-node"] },
  { title: "Graph", tools: ["graph-source", "mitered-join", "graph-smooth", "graph-metrics", "show-direction", "graph-to-spaces", "graph-reduce", "voronoi-bloom", "spring-layout", "pipe-solver"] },
  { title: "Grid", tools: ["grid-source", "graph-to-grid", "grid-field", "cellular-automaton", "laplace-solver", "fill-depressions", "flow-direction", "flow-accumulation", "watershed", "morphology", "grid-distance", "grid-threshold", "marching-squares"] },
  { title: "Image", tools: ["image", "vectorise", "object-detection"] },
  { title: "Logic", tools: ["conditional", "param-manip"] },
  { title: "Build", tools: ["floor-massing", "place-object", "frame-builder"] },
  { title: "Building", tools: ["wall-builder", "segment-to-door", "segment-to-window", "node-to-object", "node-to-staircase", "node-to-footing", "segment-to-3d", "space-to-3d"] },
  { title: "Floorplan Views", tools: ["floorplan-to-front-elevation", "floorplan-to-back-elevation", "floorplan-to-left-elevation", "floorplan-to-right-elevation", "views-layout"] },
  { title: "Footing", tools: ["footing", "footing-to-plan", "footing-to-elevation", "footing-to-3d-mesh", "mesh-to-3d"] },
  { title: "Staircase", tools: ["staircase", "staircase-to-plan", "staircase-to-left-elevation", "staircase-to-right-elevation", "staircase-to-front-elevation", "staircase-to-back-elevation", "staircase-to-3d-mesh"] },
  { title: "Calculate", tools: ["math", "random", "bua", "point", "file-upload", "text"] },
  { title: "Output", tools: ["output", "render", "analyse", "generate"] },
];

/** A reusable node-graph preset shown in the right "Workflow templates" rail. Stored with template-local
 *  node ids + relative positions; {@link insertWorkflow} remaps the ids and offsets the positions when
 *  it appends the cluster into the live graph. */
interface WorkflowTemplate {
  id: string;
  title: string;
  description: string;
  nodes: { id: string; tool: FlowToolType; x: number; y: number; params?: Record<string, unknown> }[];
  edges: { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }[];
}

// Build a SchemaPropEntry-shaped row (matches what the Schema node reads). Keeps the templates terse.
const sProp = (id: string, key: string, label: string, kind: "number" | "checkbox", def: number | boolean, role: string, unit = "", min = 0, max = 1000, step = 1) =>
  ({ id, key, label, kind, unit, def, min, max, step, options: [] as string[], role });
const rProp = (id: string, key: string, label: string, unit: string, step: number) =>
  ({ id, key, label, kind: "number" as const, unit, def: 0, min: 0, max: 1000, step, options: [] as string[], role: "" });
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
const FLOORPLAN_SCHEMA_PARAMS = {
  name: "Element Schema",
  segmentProps: [
    xProp("s_type", "type", "Type", "select", "line", { role: "seg-type", options: ["wall", "door", "window", "line"], optionIcons: SEG_TYPE_ICONS }),
    xProp("s_wt", "wallThickness", "Wall Thickness", "number", 0.23, { unit: "m", min: 0.05, max: 0.6, step: 0.01, role: "wall-thickness", showIf: { when: "type", equals: "wall" } }),
    xProp("s_wjust", "wallJustification", "Justification", "select", "center", { role: "wall-justification", options: ["left", "center", "right"], showIf: { when: "type", equals: "wall" } }),
    xProp("s_wh", "wallHeight", "Wall Height", "number", 3, { unit: "m", min: 0, max: 10, step: 0.05, role: "wall-height", showIf: { when: "type", equals: "wall" } }),
    xProp("s_wodim", "showOuterDim", "Show Outer Dimension", "checkbox", true, { role: "show-outer-dim", showIf: { when: "type", equals: "wall" } }),
    xProp("s_widim", "showInnerDim", "Show Inner Dimension", "checkbox", true, { role: "show-inner-dim", showIf: { when: "type", equals: "wall" } }),
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

/** Built-in workflow templates, grouped into foldable categories on the right rail. */
const WORKFLOW_CATEGORIES: { title: string; workflows: WorkflowTemplate[] }[] = [
  {
    title: "Floorplan",
    workflows: [
      {
        id: "floorplan-tracer",
        title: "Floorplan Tracer",
        description: "Element Schema + Canvas → schema-driven Walls / Doors / Windows + Objects. Type-driven Segment (Wall/Door/Window/Line) and Node (Object/Junction) property schemas attach to the canvas; set a component's Type and edit its fields in the Properties tab and the matching wall / door / window / object symbol redraws. Roots on the whole canvas graph — no selection needed.",
        nodes: [
          { id: "schema", tool: "schema", x: 12, y: -1270, params: FLOORPLAN_SCHEMA_PARAMS },
          // Canvas — receives the Schema (attaches the type-driven Node/Segment schemas to the canvas
          // components) and feeds the pipeline from its Segments bundle (out-2).
          { id: "canvas", tool: "canvas-source", x: 540, y: -1160, params: {} },
          // Doors — schema-driven door symbols on door-typed segments (roles door-shape / door-hinge /
          // door-placement). Self-filters to "door"-typed segments. Fed from the canvas Segments bundle (out-2).
          { id: "doors", tool: "segment-to-door", x: 988, y: -1336, params: { shape: "arc", thickness: 0.05, hinge: "left", swing: "left", lintelHeight: 2.1, color: "#9333ea" } },
          // Windows — schema-driven window symbols on window-typed segments (roles window-shape /
          // window-thickness / window-panes). Self-filters to "window"-typed segments. Fed from out-2.
          { id: "windows", tool: "segment-to-window", x: 945, y: -1104, params: { shape: "lines", thickness: 0.1, panes: 2, sillHeight: 0.9, lintelHeight: 2.1, color: "#0891b2" } },
          // Walls — schema-driven mitred walls: the Wall Builder strokes the canvas graph's wall segments
          // into a mitred ribbon, taking each wall's THICKNESS from the Segment schema (role wall-thickness).
          { id: "walls", tool: "wall-builder", x: 912, y: -874, params: { thicknessMm: 230, justification: "center", height: 3, showOuterDim: true, showInnerDim: true, dimGap: 0.18 } },
          // Objects — schema-driven furniture symbols on object-typed nodes (roles object-kind / obj-width /
          // obj-height / obj-rotation / obj-anchor). Self-filters to "object"-typed nodes. Fed from Nodes (out-1).
          { id: "objects", tool: "node-to-object", x: 894, y: -764, params: { kind: "bed", width: 1.5, height: 2, rotation: 0, anchor: "center" } },
          // Staircases — schema-driven 2D plan stairs on staircase-typed nodes (self-filters to "staircase").
          // Fed from Nodes (out-1). Edit the stair shape on this node's params.
          { id: "staircases", tool: "node-to-staircase", x: 894, y: -560, params: { config: "straight", steps: 14, tread: 0.28, width: 1.0, direction: "ltr", color: "#0f766e" } },
          // Brings the schema's segment / node TYPES (with icons) into the Add Segment / Add Node drawing
          // dropdowns, so you can draw Wall / Door / Window and place Object / Junction / Staircase directly.
          { id: "schemaTools", tool: "schema-to-drawing", x: 540, y: -980, params: {} },
          // Brings the schema's segment / node TYPES into the Layers panel as foldable Segment / Node
          // layer blocks (Wall / Door / Window / Line · Junction / Object). Live — removes with the flow.
          { id: "schemaLayers", tool: "schema-to-layers", x: 540, y: -800, params: {} },
        ],
        edges: [
          { source: "schema", target: "canvas", sourceHandle: "out-0" },
          // Canvas Segments bundle (out-2) → doors / windows / walls (each self-filters by type).
          { source: "canvas", target: "doors", sourceHandle: "out-2" },
          { source: "canvas", target: "windows", sourceHandle: "out-2" },
          { source: "canvas", target: "walls", sourceHandle: "out-2" },
          // Canvas Nodes bundle (out-1) → objects (self-filters to "object"-typed nodes).
          { source: "canvas", target: "objects", sourceHandle: "out-1" },
          // Canvas Nodes bundle (out-1) → staircases (self-filters to "staircase"-typed nodes).
          { source: "canvas", target: "staircases", sourceHandle: "out-1" },
          // Schema → Drawing Tools: surface the schema's types in the drawing dropdowns.
          { source: "schema", target: "schemaTools", targetHandle: "gin-schema" },
          // Schema → Layers: surface the schema's types as foldable layer blocks in the Layers panel.
          { source: "schema", target: "schemaLayers", targetHandle: "gin-schema" },
        ],
      },
      {
        id: "parametric-floorplan",
        title: "Parametric Floorplan",
        description: "Floorplan Tracer PLUS all four elevations. The schema-driven plan (walls / doors / windows / objects) feeds Front / Back / Left / Right elevation projections (Tier-A schematic: outline rects + openings at sill/lintel + ground line), each stamped at its own Node — change the plan and every elevation updates. Draw walls / doors / windows from the Add Segment dropdown; point each placement Node at a sheet node id (or grab a selection).",
        nodes: [
          { id: "schema", tool: "schema", x: 12, y: -1270, params: FLOORPLAN_SCHEMA_PARAMS },
          { id: "canvas", tool: "canvas-source", x: 540, y: -1160, params: {} },
          { id: "doors", tool: "segment-to-door", x: 988, y: -1336, params: { shape: "arc", thickness: 0.05, hinge: "left", swing: "left", lintelHeight: 2.1, color: "#9333ea" } },
          { id: "windows", tool: "segment-to-window", x: 945, y: -1104, params: { shape: "lines", thickness: 0.1, panes: 2, sillHeight: 0.9, lintelHeight: 2.1, color: "#0891b2" } },
          { id: "walls", tool: "wall-builder", x: 912, y: -874, params: { thicknessMm: 230, justification: "center", height: 3, showOuterDim: true, showInnerDim: true, dimGap: 0.18 } },
          { id: "objects", tool: "node-to-object", x: 894, y: -764, params: { kind: "bed", width: 1.5, height: 2, rotation: 0, anchor: "center" } },
          { id: "schemaTools", tool: "schema-to-drawing", x: 540, y: -980, params: {} },
          // Elevations — project the wall / door / window graph onto each cardinal plane (Tier-A).
          { id: "elevFront", tool: "floorplan-to-front-elevation", x: 560, y: -640, params: { height: 3, color: "#0f172a" } },
          { id: "elevBack", tool: "floorplan-to-back-elevation", x: 560, y: -520, params: { height: 3, color: "#0f172a" } },
          { id: "elevLeft", tool: "floorplan-to-left-elevation", x: 560, y: -400, params: { height: 3, color: "#0f172a" } },
          { id: "elevRight", tool: "floorplan-to-right-elevation", x: 560, y: -280, params: { height: 3, color: "#0f172a" } },
          // Placement Nodes — stamp each elevation at a sheet node (edit the id, or switch to grab-from-selection).
          { id: "placeFront", tool: "node-source", x: 880, y: -640, params: { id: "Node001", grabFromSelection: false, outputMode: "single" } },
          { id: "placeBack", tool: "node-source", x: 880, y: -520, params: { id: "Node002", grabFromSelection: false, outputMode: "single" } },
          { id: "placeLeft", tool: "node-source", x: 880, y: -400, params: { id: "Node003", grabFromSelection: false, outputMode: "single" } },
          { id: "placeRight", tool: "node-source", x: 880, y: -280, params: { id: "Node004", grabFromSelection: false, outputMode: "single" } },
        ],
        edges: [
          { source: "schema", target: "canvas", sourceHandle: "out-0" },
          { source: "canvas", target: "doors", sourceHandle: "out-2" },
          { source: "canvas", target: "windows", sourceHandle: "out-2" },
          { source: "canvas", target: "walls", sourceHandle: "out-2" },
          { source: "canvas", target: "objects", sourceHandle: "out-1" },
          { source: "schema", target: "schemaTools", targetHandle: "gin-schema" },
          // Canvas Segments (out-2) feed each elevation; the schema (attached to Canvas) supplies heights.
          { source: "canvas", target: "elevFront", sourceHandle: "out-2" },
          { source: "canvas", target: "elevBack", sourceHandle: "out-2" },
          { source: "canvas", target: "elevLeft", sourceHandle: "out-2" },
          { source: "canvas", target: "elevRight", sourceHandle: "out-2" },
          // Each elevation → its placement Node (stamped at the node's point).
          { source: "elevFront", target: "placeFront", targetHandle: "gin-stamp" },
          { source: "elevBack", target: "placeBack", targetHandle: "gin-stamp" },
          { source: "elevLeft", target: "placeLeft", targetHandle: "gin-stamp" },
          { source: "elevRight", target: "placeRight", targetHandle: "gin-stamp" },
        ],
      },
    ],
  },
  {
    title: "Structure",
    workflows: [
      {
        id: "structural-template",
        title: "Structural Template",
        description: "Canvas (graph) → Frame Builder ← Schema → Output Schema. Columns at nodes (W×H), beams along segments, optional subtract. The Schema's node TYPE (Column) and segment TYPE (Beam) — with icons — surface in the Add Node / Add Segment drawing dropdowns. Edit per-component sizing/hatch in the Properties tab.",
        nodes: [
          {
            id: "schema", tool: "schema", x: -74, y: 188,
            params: {
              name: "Structural Schema",
              nodeProps: [
                // Node TYPE discriminator (drives the Add Node dropdown) + column sizing read by the Frame Builder.
                xProp("n_type", "type", "Type", "select", "column", { role: "node-type", options: ["column"], optionIcons: { column: svgIcon(`<rect x="6" y="6" width="12" height="12" rx="1" fill="#0f172a" stroke="none"/>`) } }),
                sProp("n_w", "width", "Width", "number", 300, "col-width", "mm", 0, 2000, 10),
                sProp("n_h", "height", "Height", "number", 450, "col-height", "mm", 0, 3000, 10),
                sProp("n_x", "hatch", "Hatch", "checkbox", false, "hatch"),
              ],
              segmentProps: [
                // Segment TYPE discriminator (drives the Add Segment dropdown) + beam sizing read by the Frame Builder.
                xProp("s_type", "type", "Type", "select", "beam", { role: "seg-type", options: ["beam"], optionIcons: { beam: svgIcon(`<rect x="3" y="9" width="18" height="6" rx="0.5"/><line x1="3" y1="12" x2="21" y2="12"/>`) } }),
                sProp("s_w", "width", "Width", "number", 230, "beam-width", "mm", 0, 1000, 10),
                sProp("s_x", "hatch", "Hatch", "checkbox", false, "hatch"),
              ],
              spaceProps: [],
              graphProps: [sProp("g_s", "subtract", "Subtract beams from columns", "checkbox", true, "subtract")],
            },
          },
          { id: "canvas", tool: "canvas-source", x: -20, y: -131, params: {} },
          { id: "frame", tool: "frame-builder", x: 580, y: 180, params: { columnWidthMm: 300, columnHeightMm: 450, beamWidthMm: 230, subtract: true } },
          {
            id: "out", tool: "output-schema", x: 840, y: 180,
            params: {
              name: "Frame Results",
              nodeProps: [rProp("r_cw", "columnWidth", "Column W", "mm", 1), rProp("r_ca", "columnArea", "Column area", "m²", 0.001)],
              segmentProps: [rProp("r_bl", "beamLength", "Beam length", "m", 0.001), rProp("r_ba", "beamArea", "Beam area", "m²", 0.001)],
              spaceProps: [], graphProps: [],
            },
          },
          // Brings the schema's Column / Beam types (with icons) into the Add Node / Add Segment dropdowns.
          { id: "schemaTools", tool: "schema-to-drawing", x: -74, y: 470, params: {} },
        ],
        edges: [
          { source: "schema", target: "frame", targetHandle: "gin-schema" },
          { source: "frame", target: "out" },
          // Canvas Segments bundle (out-3) feeds the Frame Builder's main geometry input.
          { source: "canvas", target: "frame", sourceHandle: "out-3" },
          // Schema → Drawing Tools: surface Column / Beam types in the drawing dropdowns.
          { source: "schema", target: "schemaTools", targetHandle: "gin-schema" },
        ],
      },
      {
        id: "parametric-staircase",
        title: "Parametric Staircase",
        description: "One Staircase definition (U-shape) → 2D Plan, all four elevations and a 3D Mesh. The Plan + elevations feed a Views Layout node, so they appear in the canvas \"Views\" mode (plan centre, Back top / Front bottom / Left / Right) — no node placement needed. The 3D Mesh feeds Mesh to 3D. Edit the Staircase node once and every view updates.",
        nodes: [
          // The single source of truth — a location-free staircase definition.
          { id: "staircase", tool: "staircase", x: 320, y: 120, params: { config: "u-shape", steps: 9, tread: 0.265, riser: 0.17, width: 1, direction: "ltr", midSteps: 0, landingWidth: 1, midSpace: 0.1, landingCuts: 2, rotation: 0, color: "#0f766e" } },
          // Views — origin-relative drawings / mesh built from the definition.
          { id: "plan", tool: "staircase-to-plan", x: 560, y: 60, params: { color: "#0f766e" } },
          { id: "elevFront", tool: "staircase-to-front-elevation", x: 560, y: 150, params: { color: "#0f766e" } },
          { id: "elevBack", tool: "staircase-to-back-elevation", x: 560, y: 240, params: { color: "#0f766e" } },
          { id: "elevLeft", tool: "staircase-to-left-elevation", x: 560, y: 330, params: { color: "#0f766e" } },
          { id: "elevRight", tool: "staircase-to-right-elevation", x: 560, y: 420, params: { color: "#0f766e" } },
          { id: "mesh", tool: "staircase-to-3d-mesh", x: 560, y: -40, params: { color: "#0f766e" } },
          // Views Layout — routes the plan + 4 elevations into the canvas "Views" mode panels (no Nodes).
          { id: "views", tool: "views-layout", x: 860, y: 200, params: {} },
          // 3D preview terminal.
          { id: "mesh3d", tool: "mesh-to-3d", x: 860, y: -40, params: {} },
        ],
        edges: [
          { source: "staircase", target: "plan" },
          { source: "staircase", target: "elevFront" },
          { source: "staircase", target: "elevBack" },
          { source: "staircase", target: "elevLeft" },
          { source: "staircase", target: "elevRight" },
          { source: "staircase", target: "mesh" },
          // Plan + elevations → Views Layout (shown in the canvas "Views" mode).
          { source: "plan", target: "views", targetHandle: "gin-plan" },
          { source: "elevFront", target: "views", targetHandle: "gin-front" },
          { source: "elevBack", target: "views", targetHandle: "gin-back" },
          { source: "elevLeft", target: "views", targetHandle: "gin-left" },
          { source: "elevRight", target: "views", targetHandle: "gin-right" },
          { source: "mesh", target: "mesh3d" },
        ],
      },
    ],
  },
  {
    title: "Networks",
    workflows: [
      {
        id: "pipe-network",
        title: "Pipe Network Solver",
        description: "Schema → Graph → Pipe Network Solver → Output Schema. Hydraulic solve (Todini). Edit per-node demand/elevation and per-segment diameter/roughness in the Properties tab; results in Metrics.",
        nodes: [
          {
            id: "schema", tool: "schema", x: 0, y: 120,
            params: {
              name: "Pipe Network",
              nodeProps: [
                sProp("n_d", "demand", "Demand", "number", 0, "demand", "L/s", 0, 1000, 0.1),
                sProp("n_e", "elevation", "Elevation", "number", 0, "elevation", "m", -100, 1000, 0.1),
                sProp("n_f", "fixedHead", "Fixed head (source)", "checkbox", false, "fixedHead"),
              ],
              segmentProps: [
                sProp("s_d", "diameter", "Diameter", "number", 100, "diameter", "mm", 0, 2000, 1),
                sProp("s_r", "roughness", "Roughness (C)", "number", 130, "roughness", "", 0, 1000, 1),
              ],
              spaceProps: [], graphProps: [],
            },
          },
          { id: "graph", tool: "graph-source", x: 250, y: 0, params: { id: "", grabFromSelection: true, outputMode: "single" } },
          { id: "pipe", tool: "pipe-solver", x: 500, y: 80, params: { formula: "hazen-williams", maxIter: 60, tolerance: 0.001 } },
          {
            id: "out", tool: "output-schema", x: 760, y: 80,
            params: {
              name: "Hydraulic Results",
              nodeProps: [rProp("r_h", "head", "Head", "m", 0.01), rProp("r_p", "pressure", "Pressure", "m", 0.01)],
              segmentProps: [rProp("r_q", "discharge", "Discharge", "L/s", 0.01), rProp("r_v", "velocity", "Velocity", "m/s", 0.01)],
              spaceProps: [], graphProps: [],
            },
          },
        ],
        edges: [
          { source: "schema", target: "graph" },
          { source: "schema", target: "pipe", targetHandle: "gin-schema" },
          { source: "graph", target: "pipe" },
          { source: "pipe", target: "out" },
        ],
      },
    ],
  },
];

// Unique id for an Output-node metric slot (unique within a node is enough; keep globally unique anyway).
let slotSeq = 1;
const nextSlotId = () => `s_${slotSeq++}_${Math.random().toString(36).slice(2, 6)}`;

// --- Generate-node helper (image / video / music via the Google AI API) ---
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Human-readable catalog of every node tool + its params, derived from FLOW_TOOLS. Fed to the AI
 *  "Generate JSON" feature so the model emits valid tools/params. */
const buildToolCatalog = (): string =>
  Object.values(FLOW_TOOLS)
    .map((def) => {
      if (def.type === "source") return `- "source": pipeline input (the selected space). Exactly one, id "source", params {}.`;
      const fieldDesc = def.fields
        .map((f) => {
          if (f.kind === "select") return `${f.key} ∈ {${(f.options ?? []).map((o) => o.value).join(", ")}}`;
          if (f.kind === "range" || f.kind === "number") return `${f.key}: number${f.min != null ? ` ${f.min}..${f.max}` : ""}`;
          if (f.kind === "checkbox") return `${f.key}: boolean`;
          return `${f.key}: string`;
        })
        .join("; ");
      const outN = def.outputCount ? "multi-geometry-output (out-0, out-1, …)" : def.hasOutput ? "1 geometry output (sourceHandle null)" : "no geometry output";
      const valOut = def.valueOutputs?.length ? ` value-OUT: ${def.valueOutputs.map((v) => `val-${v.key}`).join(", ")};` : "";
      const valIn = def.valueInputs?.length ? ` value-IN: ${def.valueInputs.map((v) => `valin-${v.key}`).join(", ")};` : "";
      // Extra geometry inputs (e.g. a Schema node into gin-schema) + named output endpoints (canvas-source).
      const geomIn = def.geomInputs?.length ? ` geom-IN: ${def.geomInputs.map((g) => `gin-${g.key}`).join(", ")};` : "";
      const outLabels = def.outputLabels?.length ? ` output endpoints: ${def.outputLabels.map((l, i) => `out-${i}=${l}`).join(", ")};` : "";
      // Dynamic-handle nodes don't list handles via valueInputs/valueOutputs — describe them inline.
      const dynamic = def.type === "input-props"
        ? " DYNAMIC value-OUT: one val-<propId> per entry in params.props;"
        : def.type === "output"
        ? " DYNAMIC value-IN: one valin-<slotId> per entry in params.slots;"
        : "";
      return `- "${def.type}" (${def.label}); ${outN};${valOut}${valIn}${geomIn}${outLabels}${dynamic} params: ${fieldDesc || "none"}; defaults: ${JSON.stringify(def.defaultParams)}`;
    })
    .join("\n");

/** System instruction for AI flow generation — schema rules + the live tool catalog. */
const FLOW_GEN_INSTRUCTION = `You generate a node-graph "Flow" for an architecture floor-plan tool. Respond with ONLY a JSON object — no prose, no markdown fences.

Schema:
{
  "version": 1,
  "nodes": [ {
    "id": string,
    "position": { "x": number, "y": number },
    "data": { "tool": string, "params": object },
    "type"?: "group",        // ONLY for group container boxes
    "parentId"?: string,     // ONLY for nodes placed inside a group
    "width"?: number, "height"?: number   // ONLY for group containers (box size)
  } ],
  "edges": [ { "id": string, "source": nodeId, "target": nodeId, "sourceHandle": string|null, "targetHandle": string|null } ]
}

General rules:
- Pick a ROOT for the geometry based on the request:
  • SPACE flows (inset / split / massing / optimise-rect …) root on ONE "source" node: {"id":"source","position":{"x":80,"y":200},"data":{"tool":"source","params":{}}} — the selected space.
  • GRAPH / FLOORPLAN flows (walls, doors, windows, objects, dimensions, pipe/frame solvers) root on "canvas-source" (the whole canvas, 5 typed outputs: out-0 Spaces, out-1 Nodes, out-2 Segments, out-3 Graph, out-4 Images) or "graph-source" / "segment-source" / "node-source". These do NOT need a "source" node and are independent of the current selection.
- Other node ids are "<tool>_<n>" (e.g. "inset_1"). Lay nodes left→right: x grows ~260 per stage, vary y.
- The first geometry tool connects from the chosen root. Use ONLY the tools/params in the catalog. Start from each tool's "defaults" and change only what the request needs; keep values within the stated ranges/options.

Required overall structure for SPACE flows (rooted on "source" — skip this for graph/floorplan flows, which use schemas + Building nodes instead):
- INPUTS FIRST: include exactly one "input-props" (Input Properties) node, wired from "source". Put every important/adjustable parameter the design depends on there (setbacks, FSI rates, floor counts, ratios, angles, target areas, toggles, …) as props, and drive the downstream nodes by wiring its val-<propId> outputs into their valin-* handles — do NOT hard-code those numbers directly in the consuming nodes when they are meant to be user-tunable.
- ALGORITHMS / CALCULATIONS IN THE MIDDLE: between inputs and outputs put the geometry tools (inset, split, optimise-rect, bsp, voronoi, massing, …) and the math chain (space-geometry to measure, math nodes for formulas) that transform the space and compute values.
- OUTPUTS LAST: include exactly one "output" (Output Metrics) node and wire every important result into its slots (areas via val-area, computed values via val-result, floor counts via val-floors, …), giving each slot a clear label. This is the single place the user reads results.
- So the canonical flow is: source → input-props → (algorithms + calculations) → output. Group these stages for clarity when the graph is large.

Connections — there are TWO kinds of edges:
1. GEOMETRY (a space/polygon flows downstream): sourceHandle = null for a 1-output node, or "out-0"/"out-1"/… for a multi-geometry-output node (split, bsp, voronoi, conditional; conditional out-0 = TRUE, out-1 = FALSE). targetHandle = null.
2. VALUE (a single number/string flows into a parameter): sourceHandle = "val-<key>" (a node's value-OUT), targetHandle = "valin-<key>" (the consumer's value-IN). Use these to feed computed numbers between nodes. The catalog lists each node's value-OUT / value-IN handle ids.

Key value-driven nodes:
- "math": result = a (op) b. Wire numbers into valin-a / valin-b; it exposes val-result. op ∈ {add, subtract, multiply, divide}; round ∈ {none, ceil, floor, round}. Chain several math nodes for a multi-step formula (one binary op each), e.g. plot×rate, then a−b, then ÷ area with round "ceil" to get floor counts.
- "space-geometry": measures the input space → value-OUT val-area (m²), val-perimeter (m), val-vertices (count); also forwards the space on its geometry output.
- "floor-massing": value-IN valin-n (floor count); value-OUT val-floors.
- "inset"/"optimise-rect": value-OUT val-area. "optimise-rect" also takes valin-axisAngle / valin-count / valin-optimiseAxisTilt. "split" takes valin-ratios / valin-angle / valin-target (target = first-piece area, only in Target sizing).

Special DYNAMIC nodes:
- "input-props" (Input Properties): the single place for the flow's adjustable inputs. Takes the Space and forwards it. params = { "props": [ { "id": string, "name": string, "type": "range"|"select"|"checkbox"|"text", "value": number|string|boolean, "min": number, "max": number, "step": number, "options": string[] } ] }. Each prop exposes a value-OUT "val-<propId>". Define your sliders/options/checkboxes/text here and wire their val-<propId> into downstream valin-* handles.
- "output" (Output Metrics): terminal collector shown in the Metrics tab. params = { "slots": [ { "id": string, "label": string } ] }. Each slot is a value-IN "valin-<slotId>"; wire any node's val-* output into it (give the slot a clear label).

Schemas (per-component properties — for graph/floorplan flows):
- "schema" (Input Schema): defines properties attached to canvas components. params = { "name"?: string, "nodeProps": [], "segmentProps": [], "spaceProps": [], "graphProps": [] }. Each entry = { "id": string, "key": string, "label": string, "kind": "number"|"select"|"checkbox"|"text"|"color", "unit": string, "def": number|string|boolean, "min": number, "max": number, "step": number, "options": string[], "role": string, "showIf"?: { "when": string, "equals": string|number|boolean } }. Wire its OUTPUT (sourceHandle null) into a "canvas-source"/"graph-source"/"segment-source"/"node-source"/"source" node OR into a processor's "gin-schema" handle — the properties then appear (and are editable per component) in the Properties tab, stored by their "role".
  • "showIf" makes a property type-driven (e.g. door fields only when a "type" select === "door"). The "role" is what processors read (see below).
- "output-schema": per-component RESULT rows (Metrics tab). Same four prop lists; wire a processor's OUTPUT into it. Row keys must match the result keys the processor writes (e.g. frame-builder: columnWidth/columnArea, beamLength/beamArea; wall-builder: wallThickness/wallLength; pipe-solver: head/pressure, discharge/velocity).

Building & floorplan nodes (consume a Graph/Canvas and read per-component schema values by ROLE):
- "frame-builder": Graph in → columns at each node (roles col-width/col-height) + beams along each segment (role beam-width), optional graph-level subtract. Wire a "schema" into its "gin-schema". Emits Spaces; wire its output into an "output-schema" for Metrics.
- "wall-builder" (Graph to Walls): Graph in → mitred walls; each wall's thickness/justification come from the segment schema (roles wall-thickness / wall-justification) via "gin-schema". Only "wall"-typed segments are drawn.
- "segment-to-door": a SEGMENT in → a door symbol. params: shape ∈ {polygon, arc, detailed}, thickness, hinge ∈ {left,right}, swing ∈ {left,right}.
- "segment-to-window": a SEGMENT in → a window symbol. params: shape ∈ {polygon, lines, detailed}, thickness, panes.
- "node-to-object": a NODE in → a furniture symbol. params: kind (bed/sofa/table/…), width, height, rotation, anchor.
- Feed these from canvas-source: out-2 = Segments → segment-to-door/window; out-1 = Nodes → node-to-object; out-3 = Graph → frame-builder/wall-builder. Doors/windows/objects can also be filtered from a graph's segments/nodes.

Display nodes (styling pass-throughs — restyle but keep the geometry flowing):
- "hatching" (Display Space): a Space in → colour/opacity, plus an optional hatch fill (hatch + hatchStyle ∈ {diagonal,dots} + spacing/angle/weight). Passes the space through.
- "display-segment": a SEGMENT in. mode ∈ {line, buffered}. line: lineStyle + color + showDirection (centerline pass-through). buffered: thickness + justification ∈ {left,center,right} + bufferStyle ∈ {capsule,square,flat} + optional hatch → a Space.
- "display-node": a NODE in → marker shape/style/color/size + optional hatch.

Floorplan example (no "source" node): "canvas-source" → "schema" (Node type {node|object} + Segment type {wall|door|window} with showIf-gated fields) attached to it, AND canvas out-3 → "wall-builder" (gin-schema ← the schema) → "dimension"; canvas out-2 filtered → "segment-to-door"/"segment-to-window"; canvas out-1 → "node-to-object".

Grouping (optional, VISUAL ONLY — never affects computation):
- To organize a busy graph, add group containers. A group node: { "id": "g_<name>", "type": "group", "position": {abs x,y}, "width": number, "height": number, "data": { "tool": "group", "params": { "label": "Group Title" } } }.
- Put member nodes inside by setting their "parentId" to the group id; their "position" is then RELATIVE to the group's top-left (small offsets inside the box, leaving ~40px top for the label). Size the box big enough to contain its children.
- List every group node BEFORE its child nodes in the array. Do NOT place the "source" node inside a group.

Available tools (handles + params + defaults):
${buildToolCatalog()}`;

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
  const propCount = d.tool === "input-props" ? inputProps(d.params).length : 0;
  const handleSig = `${outN}|${def.valueInputs?.length ?? 0}|${def.valueOutputs?.length ?? 0}|${slotCount}|${propCount}`;
  useEffect(() => { updateNodeInternals(id); }, [id, handleSig, updateNodeInternals]);
  // Align each side handle to the vertical centre of its row: stash a ref per row, then measure
  // offsetTop after layout. Keys are `field:<key>` (parameter rows) and `vout:<key>` (computed value-
  // output readout rows). `rowTops[key]` is the px offset (relative to the node); a row hidden by
  // showIf isn't measured, so its handle falls back to the default position.
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [rowTops, setRowTops] = useState<Record<string, number>>({});
  // File Upload node: a hidden <input type=file> driven by the "Choose File" button (OS open dialog).
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Fold the node down to its title bar. Stored as a transient `_collapsed` param so the toolbar's
  // "Fold" toggle can drive every node while the per-node chevron stays in sync. `_`-prefixed params
  // are stripped on export and ignored by eval, so this never affects geometry. When collapsed, only
  // the main in/out handles show (centred on the title bar).
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
    <div className={`relative rounded-md border bg-white shadow-md transition-shadow ${selected ? "border-blue-500 ring-2 ring-blue-400/70 shadow-lg" : "border-slate-300"} ${d.tool === "render" ? "min-w-[230px]" : "min-w-[180px]"}`}>
      {/* Main geometry input (Space / polygon): top-left below the title; centred when collapsed. */}
      {def.hasInput && <Handle type="target" position={Position.Left} style={{ top: collapsed ? "50%" : 30 }} className="!h-2.5 !w-2.5 !bg-slate-400" />}
      {/* Extra geometry inputs (emerald, left) — id `gin-<key>`, e.g. Mitered Join's clip Space. Stacked
          just below the main input handle; hidden when collapsed. */}
      {!collapsed && def.geomInputs?.map((gi, i) => (
        <Handle
          key={gi.key}
          id={`gin-${gi.key}`}
          type="target"
          position={Position.Left}
          style={{ top: 30 + (i + 1) * 16 }}
          className="!h-2.5 !w-2.5 !bg-emerald-500"
          title={gi.label}
        />
      ))}
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
      <div className={`flex items-center justify-between gap-1 px-2 py-1 text-[11px] font-semibold text-white ${collapsed ? "rounded-md" : "rounded-t-md"}`} style={{ background: def.color }}>
        <span className="truncate">{def.label}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Eye: toggle whether this node's output/preview shows on the canvas (transient `_hidden`). */}
          <button
            type="button"
            onClick={() => d.onParamChange?.(id, "_hidden", !hidden)}
            title={hidden ? "Show output on canvas" : "Hide output on canvas"}
            className={`nodrag flex h-4 w-4 items-center justify-center rounded hover:bg-white/20 ${hidden ? "opacity-60" : ""}`}
          >
            {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
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
        {def.fields.length === 0 && d.tool !== "place-object" && d.tool !== "output" && d.tool !== "input-props" && d.tool !== "canvas-source" && (
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
                      className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[10px] nodrag"
                      rows={3}
                      placeholder={f.placeholder}
                      value={str}
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
        {def.valueOutputs?.some((vo) => !vo.alignField) && d.tool !== "file-upload" && d.tool !== "text" && d.tool !== "analyse" ? (
          <div className="flex flex-col gap-0.5 pt-0.5">
            {def.valueOutputs.filter((vo) => !vo.alignField).map((vo) => {
              const v = (d.params._values as Record<string, number> | undefined)?.[vo.key];
              return (
                <div key={vo.key} ref={(el) => { rowRefs.current[`vout:${vo.key}`] = el; }} className="flex items-center justify-between rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                  <span>{vo.label}</span>
                  <span className="font-mono">{v != null ? `${v.toFixed(2)}${vo.unit ? ` ${vo.unit}` : ""}` : "—"}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      )}
      {/* Main geometry output: top-right below the title; centred (single handle) when collapsed. */}
      {collapsed
        ? def.hasOutput && <Handle type="source" position={Position.Right} style={{ top: "50%" }} className="!h-2.5 !w-2.5 !bg-slate-400" />
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
      {!collapsed && def.valueOutputs?.map((vo, i) => {
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
      {!collapsed && d.tool === "input-props" && inputProps(d.params).map((p) => {
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

/** A labelled container box drawn BEHIND its child nodes. Created by the "Group" button; its children
 *  carry `parentId` so dragging the box moves them together. Not a pipeline op — it has no handles and
 *  is stripped from the compiled recipe / serialized graph (a pure editor-organisation convenience). */
const GroupNode = ({ data, selected }: NodeProps) => {
  const d = data as { label?: string; params?: { label?: string } };
  const label = d.label ?? d.params?.label ?? "Group";
  return (
    <div className={`h-full w-full rounded-lg border-2 border-dashed ${selected ? "border-violet-500 bg-violet-500/10" : "border-violet-300 bg-violet-500/5"}`}>
      <span className="absolute left-2 top-1 select-none rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
        {label}
      </span>
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
  /** Pure live preview: the evaluated output polygons per node, for canvas overlay rendering. */
  onPreview: (items: FlowPreviewItem[]) => void;
  /** The selected space's vertices (pixel coords) — the pipeline input. */
  sourcePolygon: Point[];
  /** Pixels-per-metre, for the geometry algorithms. */
  pixelsPerMeter: number;
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
  /** Anchor (pixel coords) where a Space Creator centres its generated geometry — typically the selected
   *  space's centroid, else the centre of existing content. */
  createAnchor?: Point;
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
}

interface NodeCallbacks {
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  onRunRender: (nodeId: string, params: Record<string, unknown>) => void;
  onRunDetect: (nodeId: string, params: Record<string, unknown>) => void;
  onRunAnalyse: (nodeId: string, params: Record<string, unknown>) => void;
  onRunGenerate: (nodeId: string, params: Record<string, unknown>) => void;
}

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
    data: { tool, params: { ...def.defaultParams }, onParamChange: cb.onParamChange, onRunRender: cb.onRunRender, onRunDetect: cb.onRunDetect, onRunAnalyse: cb.onRunAnalyse, onRunGenerate: cb.onRunGenerate } as FlowNodeData,
  };
};

export const FlowOverlay = (props: FlowOverlayProps) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
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
  // Right "Workflow templates" rail — foldable category blocks (mirrors the left palette).
  const [collapsedWorkflowCats, setCollapsedWorkflowCats] = useState<Set<string>>(new Set());
  const toggleWorkflowCat = useCallback((title: string) => {
    setCollapsedWorkflowCats((prev) => { const next = new Set(prev); if (next.has(title)) next.delete(title); else next.add(title); return next; });
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

  const nodeCb = useMemo<NodeCallbacks>(() => ({ onParamChange, onRunRender, onRunDetect, onRunAnalyse, onRunGenerate }), [onParamChange, onRunRender, onRunDetect, onRunAnalyse, onRunGenerate]);

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
      return [...ns, makeNode(tool, { x, y }, nodeCb)];
    });
  }, [setNodes, nodeCb]);

  // Drop a workflow template into the graph: append its nodes/edges with FRESH ids (so re-inserting or
  // overlapping ids never collide) and positions offset to the right of the existing content.
  const insertWorkflow = useCallback((tpl: WorkflowTemplate) => {
    if (!tpl.nodes.length) return;
    const minTx = Math.min(...tpl.nodes.map((n) => n.x));
    const minTy = Math.min(...tpl.nodes.map((n) => n.y));
    setNodes((ns) => {
      const baseX = ns.length
        ? Math.max(...ns.map((n) => n.position.x + (n.measured?.width ?? n.width ?? 220))) + 80
        : 80;
      const baseY = 100;
      const idMap = new Map<string, string>();
      const newNodes: Node[] = tpl.nodes.map((tn) => {
        const newId = nextId(tn.tool);
        idMap.set(tn.id, newId);
        const def = FLOW_TOOLS[tn.tool];
        return {
          id: newId,
          type: "op",
          position: { x: baseX + (tn.x - minTx), y: baseY + (tn.y - minTy) },
          deletable: true,
          data: {
            tool: tn.tool,
            params: { ...def.defaultParams, ...(tn.params ?? {}) },
            onParamChange: nodeCb.onParamChange,
            onRunRender: nodeCb.onRunRender,
            onRunDetect: nodeCb.onRunDetect,
            onRunAnalyse: nodeCb.onRunAnalyse,
            onRunGenerate: nodeCb.onRunGenerate,
          } as FlowNodeData,
        };
      });
      // Edges reference template-local ids → remap to the freshly-minted node ids.
      setEdges((es) => [
        ...es,
        ...tpl.edges.map((te, i) => ({
          id: `wf-${idMap.get(te.source)}-${idMap.get(te.target)}-${i}`,
          source: idMap.get(te.source)!,
          target: idMap.get(te.target)!,
          sourceHandle: te.sourceHandle ?? null,
          targetHandle: te.targetHandle ?? null,
          animated: true,
        })),
      ]);
      return [...ns, ...newNodes];
    });
  }, [setNodes, setEdges, nodeCb]);

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, animated: true }, es)), [setEdges]);

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
        for (const [k, v] of Object.entries(d.params ?? {})) if (!k.startsWith("_")) params[k] = v;
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
  }, [exportText]);

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
          ? ({ tool: "group", params: { ...(n.data?.params ?? {}) } } as unknown as FlowNodeData)
          : ({ tool, params: { ...(n.data?.params ?? {}) }, onParamChange: nodeCb.onParamChange, onRunRender: nodeCb.onRunRender, onRunDetect: nodeCb.onRunDetect, onRunAnalyse: nodeCb.onRunAnalyse, onRunGenerate: nodeCb.onRunGenerate } as FlowNodeData),
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
    // Advance the id counter past any imported "<tool>_<n>" ids so new nodes don't collide.
    for (const n of importedNodes) {
      const m = /_(\d+)$/.exec(n.id);
      if (m) nodeSeq = Math.max(nodeSeq, parseInt(m[1], 10) + 1);
    }
    // Guarantee a primary Source node exists (pipeline input).
    if (!importedNodes.some((n) => (n.data as FlowNodeData).tool === "source")) {
      importedNodes.unshift(makeNode("source", { x: 80, y: 200 }, nodeCb, { singleton: true }));
    }
    setNodes(importedNodes);
    setEdges(importedEdges);
    setInitialised(true);
    return importedNodes.length;
  }, [nodeCb, setNodes, setEdges]);

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

  // ── AI "Generate JSON": describe a flow in plain language → Gemini emits flow JSON → import it. ──
  const [genOpen, setGenOpen] = useState(false);
  const [genApiKey, setGenApiKey] = useState<string>(() => {
    try { return localStorage.getItem("flow-gen-api-key") ?? ""; } catch { return ""; }
  });
  const [genModel, setGenModel] = useState<string>(() => {
    try { return localStorage.getItem("flow-gen-model") || "gemini-3-flash-preview"; } catch { return "gemini-3-flash-preview"; }
  });
  const [genPrompt, setGenPrompt] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const generateFlow = useCallback(async () => {
    const apiKey = genApiKey.trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    if (!genPrompt.trim()) { toast.error("Describe the flow to generate"); return; }
    const model = genModel.trim() || "gemini-3-flash-preview";
    setGenBusy(true);
    try {
      try { localStorage.setItem("flow-gen-api-key", apiKey); } catch { /* ignore */ }
      try { localStorage.setItem("flow-gen-model", model); } catch { /* ignore */ }
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: FLOW_GEN_INSTRUCTION }] },
          contents: [{ parts: [{ text: genPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
      });
      if (!res.ok) { toast.error(`Generation failed (${res.status})`); console.error(await res.text()); return; }
      const json = await res.json();
      const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("");
      // responseMimeType:"application/json" should yield pure JSON; fall back to extracting the first {…}.
      let parsed: { nodes?: unknown[]; edges?: unknown[] } | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        const a = text.indexOf("{"), b = text.lastIndexOf("}");
        if (a >= 0 && b > a) { try { parsed = JSON.parse(text.slice(a, b + 1)); } catch { /* ignore */ } }
      }
      if (!parsed) { toast.error("Model returned invalid JSON"); console.error("Gen response:", text); return; }
      const count = importFlowData(parsed);
      setGenOpen(false);
      toast.success(`Generated flow — ${count} node${count === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Generation error");
      console.error(e);
    } finally {
      setGenBusy(false);
    }
  }, [genApiKey, genModel, genPrompt, importFlowData]);

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
    setEdges((es) => es.filter((e) => !e.selected && !removedOps.has(e.source) && !removedOps.has(e.target)));
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
              return { ...rest, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } } as Node;
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
      const PAD = 28, HEADER = 26;
      const gx = minX - PAD, gy = minY - PAD - HEADER;
      const groupNode: Node = {
        id: nextId("group"),
        type: "group",
        position: { x: gx, y: gy },
        data: { tool: "group", params: { label: "Group" } } as unknown as FlowNodeData,
        style: { width: (maxX - minX) + PAD * 2, height: (maxY - minY) + PAD * 2 + HEADER },
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
  }, [setNodes]);

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
  const sourceEntries = nodes
    .filter((n) => (n.data as FlowNodeData).tool === "source")
    .map((n) => {
      const idStr = String((n.data as FlowNodeData).params.id ?? "").trim();
      const ids = idStr.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
      const polys = (resolveSpacePolygon ? ids.map((sid) => resolveSpacePolygon(sid)) : [])
        .filter((p): p is Point[] => !!p && p.length >= 3);
      return { nodeId: n.id, idStr, ids, polys };
    });
  // Per-source polygon LISTS keyed by source NODE id — evaluateFlow reads each source's own space(s).
  const sourcePolys = new Map(sourceEntries.map((e) => [e.nodeId, e.polys]));
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
  const graphsBySourceNode = new Map(graphEntries.map((e) => [e.nodeId, e.graphs]));
  const hasGraphRoot = graphEntries.some((e) => e.graphs.length > 0);
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
  // Ready once ≥1 root is actually usable (a resolved Space, a Creator, a Selected Graph, an Image, or the
  // Canvas) and no Space node has a typed-but-unmatched id.
  const sourcesReady = (anySpaceReady || hasCreator || hasGraphRoot || hasImageRoot || hasCanvasRoot) && !badSource;
  const createAnchor = props.createAnchor ?? { x: 0, y: 0 };
  // Key over all per-source polygons so the heavy eval only re-runs when some space's geometry changes.
  const sourcesKey = sourceEntries.map((e) => `${e.nodeId}:${e.polys.map((poly) => poly.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";")).join("&")}`).join("|");
  const anchorKey = `${createAnchor.x.toFixed(1)},${createAnchor.y.toFixed(1)}`;
  const pathEdges = props.pathEdges ?? [];
  const graphKey = graphSegments.length + ":" + graphSegments.flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    + "|s:" + segmentSegments.length + ":" + segmentSegments.flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    + "|n:" + nodeSegments.length + ":" + nodeSegments.flat().reduce((s, p) => s + p.x + p.y, 0).toFixed(1)
    + "|" + graphEntries.map((e) => `${e.nodeId}=${e.graphs.map((g) => g.length).join(",")}`).join(";")
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
  const preview = useMemo(
    () => ((sourcesReady || hasPipeRoot) ? evaluateFlow(nodes, edges, sourcePolys, ppm, createAnchor, graphSegments, graphsBySourceNode, pathEdges, imageData, canvasContent, pipeGraph, gridFieldsBySourceNode) : []),
    // sourcesKey captures per-source polygon changes without depending on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, sourcesKey, ppm, sourcesReady, hasPipeRoot, anchorKey, graphKey, imageKey, canvasKey, pipeKey, gridFieldKey],
  );
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
      preview.filter((it) => it.tool === "space-creator" && (it.polygons[0]?.length ?? 0) >= 3).map((it) => [it.nodeId, it.polygons[0]]),
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
          const pc = cellCountByNode.get(n.id);
          if (pc == null || data.params.pieceCount === pc) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, pieceCount: pc } } };
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
        if (data.tool === "space-creator") {
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
              // Split's `ratios` is a text list, so store the driven number as its string form.
              const v: unknown = data.tool === "split" && k === "ratios" ? String(val) : val;
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

  const run = (mode: "commit") => {
    if (compiled.error || mode !== "commit") return;
    if (!sourcesReady) { toast.error("The source node needs an id — select a Space/Segment/Graph or type one (e.g. Space001) to run."); return; }
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
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setGenOpen((v) => !v)} title="Generate a flow with AI">
            <Sparkles className="h-3.5 w-3.5" /> Generate Flow
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

          {/* Import dropdown — upload a .json file OR paste flow JSON directly. */}
          {importOpen && (
            <div className="absolute right-0 top-9 z-50 w-80 space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Import flow</span>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setImportOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
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

          {/* AI flow-generation dropdown */}
          {genOpen && (
            <div className="absolute right-0 top-9 z-50 w-80 space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Generate flow with AI</span>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setGenOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500">Model</span>
                <input
                  type="text"
                  className="h-7 w-full rounded border border-slate-200 px-1.5 text-[11px]"
                  value={genModel}
                  onChange={(e) => setGenModel(e.target.value)}
                  placeholder="gemini-3-flash-preview"
                />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500">API key</span>
                <input
                  type="password"
                  className="h-7 w-full rounded border border-slate-200 px-1.5 text-[11px]"
                  value={genApiKey}
                  onChange={(e) => setGenApiKey(e.target.value)}
                  placeholder="Google AI Studio key"
                />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500">Prompt</span>
                <textarea
                  className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                  rows={3}
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder="e.g. Inset 1 m, fit a rectangle, then massing 5 floors upward and render it"
                />
              </div>
              <Button size="sm" className="h-7 w-full gap-1.5 text-[11px]" disabled={genBusy} onClick={generateFlow}>
                {genBusy
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                  : <><Sparkles className="h-3 w-3" /> Generate &amp; Import</>}
              </Button>
              <span className="block text-[9px] leading-tight text-slate-400">
                Replaces the current graph with the generated nodes &amp; connections.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body — vertical palette (left) + canvas (right) */}
      <div className="flex min-h-0 flex-1">
        {/* Palette — vertical left rail */}
        <div className="flex w-44 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white/70 px-2 py-2">
          <span className="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400">Add</span>
          {PALETTE_CATEGORIES.map((cat) => {
            const catOpen = !collapsedCats.has(cat.title);
            return (
              <div key={cat.title} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => toggleCat(cat.title)}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {catOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  {cat.title}
                </button>
                {catOpen && cat.tools.map((t) => (
                  <Button
                    key={t}
                    variant="outline"
                    size="sm"
                    className="h-7 w-full justify-start gap-1.5 px-2 text-[11px]"
                    onClick={() => addToolNode(t)}
                  >
                    <Plus className="h-3 w-3 shrink-0" /> {FLOW_TOOLS[t].label}
                  </Button>
                ))}
              </div>
            );
          })}
        </div>

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
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
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

        {/* Workflow templates — vertical right rail (foldable categories, mirrors the left palette). Each
            entry drops a ready-wired cluster (Schema → Graph → processor → Output Schema) into the graph. */}
        <div className="flex w-48 flex-col gap-1 overflow-y-auto border-l border-slate-200 bg-white/70 px-2 py-2">
          <span className="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400">Workflow templates</span>
          {WORKFLOW_CATEGORIES.map((cat) => {
            const catOpen = !collapsedWorkflowCats.has(cat.title);
            return (
              <div key={cat.title} className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => toggleWorkflowCat(cat.title)}
                  className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                >
                  {catOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                  {cat.title}
                </button>
                {catOpen && cat.workflows.map((wf) => (
                  <Button
                    key={wf.id}
                    variant="outline"
                    size="sm"
                    className="h-7 w-full justify-start gap-1.5 px-2 text-[11px]"
                    title={wf.description}
                    onClick={() => insertWorkflow(wf)}
                  >
                    <Plus className="h-3 w-3 shrink-0" /> {wf.title}
                  </Button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer — compile status + run */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-3 py-2">
        <div className="min-w-0 flex-1 text-[11px]">
          {compiled.error ? (
            <span className="text-red-600">{compiled.error}</span>
          ) : !sourcesReady ? (
            <span className="text-amber-600">
              {badSource?.idStr
                ? `One or more ids in "${badSource.idStr}" match no space — enter valid ids (e.g. Space001, Space002).`
                : "Space node needs an id — type one (e.g. Space001) or grab it from a selection to preview & run."}
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
        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-[12px]"
          disabled={!!compiled.error || !sourcesReady}
          onClick={() => run("commit")}
        >
          <Play className="h-3.5 w-3.5" /> Run Flow
        </Button>
      </div>

      {jsonOpen && !compiled.error && (
        <pre className="max-h-48 overflow-auto whitespace-pre border-t border-slate-200 bg-slate-900 px-3 py-2 font-mono text-[10px] leading-tight text-slate-100">
          {compiled.json}
        </pre>
      )}
    </div>
  );
};
