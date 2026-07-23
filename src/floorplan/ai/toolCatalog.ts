import type { ChatAIMode } from "../components/ChatAIPanel";

/** One entry in the "Available Tools" help list — a tool the active agent mode can call. */
export interface ToolInfo {
  /** Tool name as the model sees it. */
  name: string;
  /** One-line, plain-language summary of what it does. */
  desc: string;
  /** Display group heading (tools are shown grouped, in the order below). */
  group: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent-family tools (Orchestrator / Design / Parametric).
// Names + membership MIRROR agentChat.ts (`allTools` + `SUBSETS`); keep in sync when tools change.
// Descriptions here are intentionally SHORT — the full descriptions live on the tool definitions.
// ─────────────────────────────────────────────────────────────────────────────
const AGENT_TOOLS: Record<string, ToolInfo> = {
  // Read / inspect
  get_state:          { name: "get_state",          group: "Read & inspect",          desc: "Canvas summary — counts, scale, layers, current selection." },
  get_plan:           { name: "get_plan",           group: "Read & inspect",          desc: "Full plan JSON: walls, openings and furniture." },
  get_selection:      { name: "get_selection",      group: "Read & inspect",          desc: "What is currently selected on the canvas." },
  list_spaces:        { name: "list_spaces",        group: "Read & inspect",          desc: "Every space with its label, area and centroid." },
  snapshot_canvas:    { name: "snapshot_canvas",    group: "Read & inspect",          desc: "Render the canvas to an image the agent can see." },
  // Draw & edit canvas
  draw_segment:       { name: "draw_segment",       group: "Draw & edit canvas",      desc: "Draw one typed wall / line segment between two points." },
  draw_freehand:      { name: "draw_freehand",      group: "Draw & edit canvas",      desc: "Sketch a freehand stroke from a list of points (Flow Freehand source reads it)." },
  place_opening:      { name: "place_opening",      group: "Draw & edit canvas",      desc: "Cut a door or window into the nearest wall." },
  place_object:       { name: "place_object",       group: "Draw & edit canvas",      desc: "Drop a node object (bed, sofa, staircase…) at a point." },
  attach_space_object:{ name: "attach_space_object",group: "Draw & edit canvas",      desc: "Attach a Floor / Massing / Site / Core object to a space." },
  set_flow_live:      { name: "set_flow_live",      group: "Draw & edit canvas",      desc: "Turn Flow Live on/off — materialise attached pipeline objects as real Spaces." },
  merge_spaces:       { name: "merge_spaces",       group: "Draw & edit canvas",      desc: "Merge adjacent spaces into one." },
  apply_model:        { name: "apply_model",        group: "Draw & edit canvas",      desc: "Replace the whole plan with edited JSON (primary write)." },
  clear_canvas:       { name: "clear_canvas",       group: "Draw & edit canvas",      desc: "Wipe walls / rooms / objects (keeps the image underlay)." },
  // Image underlay & tracing
  set_image_underlay: { name: "set_image_underlay", group: "Image underlay & tracing",desc: "Place the attached image as a scaled, locked underlay." },
  align_underlay:     { name: "align_underlay",     group: "Image underlay & tracing",desc: "Sync the underlay onto the drawn plan (scale + move)." },
  analyze_underlay:   { name: "analyze_underlay",   group: "Image underlay & tracing",desc: "Vectorise the underlay and return its extreme corners." },
  fit_plan_to_rect:   { name: "fit_plan_to_rect",   group: "Image underlay & tracing",desc: "Stretch the drawn plan to fill a target rectangle." },
  // Object library
  list_draw_tools:    { name: "list_draw_tools",    group: "Object library",          desc: "What can be drawn — segment / node / space types + objects." },
  import_objects:     { name: "import_objects",     group: "Object library",          desc: "Load parametric objects from disk — by category, by id, or all." },
  list_objects:       { name: "list_objects",       group: "Object library",          desc: "Object catalog: ids, params, host kind, category." },
  get_object:         { name: "get_object",         group: "Object library",          desc: "One object's complete .pobj definition." },
  save_object:        { name: "save_object",        group: "Object library",          desc: "Create or overwrite a parametric object." },
  delete_object:      { name: "delete_object",      group: "Object library",          desc: "Delete parametric-object definitions." },
  // Designs
  list_designs:       { name: "list_designs",       group: "Designs",                 desc: "List saved floor-plan design files." },
  import_design:      { name: "import_design",      group: "Designs",                 desc: "Load a saved design and replace the canvas." },
  // Flow engine
  flow_node_catalog:  { name: "flow_node_catalog",  group: "Flow engine",             desc: "The Flow engine's node-type catalog." },
  flow_apply:         { name: "flow_apply",         group: "Flow engine",             desc: "Load & live-evaluate a Flow graph (nothing committed yet)." },
  flow_commit:        { name: "flow_commit",        group: "Flow engine",             desc: "Commit the applied Flow into real canvas entities." },
  open_workflow:      { name: "open_workflow",      group: "Flow engine",             desc: "Open a saved workflow, apply it, and return its graph to tune." },
};

/** Orchestrator = every agent-family tool, in the grouped order declared above. */
const AGENT_ORDER: string[] = Object.keys(AGENT_TOOLS);

/** Design mode subset — mirrors SUBSETS.design in agentChat.ts. */
const DESIGN_NAMES = new Set([
  "get_state", "get_plan", "list_spaces", "get_selection", "merge_spaces", "list_draw_tools",
  "import_objects", "list_designs", "import_design", "draw_segment", "place_opening", "place_object",
  "attach_space_object", "set_image_underlay", "align_underlay", "analyze_underlay", "fit_plan_to_rect",
  "clear_canvas", "snapshot_canvas", "apply_model",
]);

/** Parametric mode subset — mirrors SUBSETS.parametric in agentChat.ts. */
const PARAMETRIC_NAMES = new Set([
  "get_state", "list_objects", "get_object", "save_object", "delete_object", "import_objects",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Flow-agent tools — a separate tool-loop (flowAgent.ts) that builds the node-graph Flow.
// ─────────────────────────────────────────────────────────────────────────────
const FLOW_TOOLS: Record<string, ToolInfo> = {
  get_flow:            { name: "get_flow",            group: "Read & inspect",  desc: "The current Flow graph as JSON. Call first." },
  list_flow_tools:     { name: "list_flow_tools",     group: "Read & inspect",  desc: "Node-type catalog — the only nodes / params allowed." },
  compile_flow:        { name: "compile_flow",        group: "Read & inspect",  desc: "Validate & compile the live graph (errors, order)." },
  replace_flow:        { name: "replace_flow",        group: "Build graph",     desc: "Replace the whole graph with new JSON." },
  import_node:         { name: "import_node",         group: "Build graph",     desc: "Add one node (from a template or by type) to the canvas." },
  list_node_files:     { name: "list_node_files",     group: "Node templates",  desc: "List saved node templates under Flows/Nodes." },
  read_node_file:      { name: "read_node_file",      group: "Node templates",  desc: "Read one node-template file's JSON." },
  save_node_file:      { name: "save_node_file",      group: "Node templates",  desc: "Create or overwrite a reusable node template." },
  delete_node_file:    { name: "delete_node_file",    group: "Node templates",  desc: "Delete a node-template file." },
  list_workflow_files: { name: "list_workflow_files", group: "Workflows",       desc: "List saved workflow graphs." },
  save_workflow_file:  { name: "save_workflow_file",  group: "Workflows",       desc: "Save the current graph as a reusable workflow." },
  import_workflow:     { name: "import_workflow",     group: "Workflows",       desc: "Load a saved workflow, replacing the graph." },
};
const FLOW_ORDER: string[] = Object.keys(FLOW_TOOLS);

/** Resolve an explicit list of tool NAMES (e.g. an agent's `accessibleTools`) to display info,
 *  looking across both the canvas and flow tool sets. Unknown names fall back to a bare entry. */
export function describeTools(names: string[]): ToolInfo[] {
  return names.map((n) => AGENT_TOOLS[n] ?? FLOW_TOOLS[n] ?? { name: n, group: "Other", desc: "" });
}

/** The tools the given Chat AI mode can call, in grouped display order. */
export function toolCatalogForMode(mode: ChatAIMode): ToolInfo[] {
  if (mode === "flow") return FLOW_ORDER.map((n) => FLOW_TOOLS[n]);
  const names =
    mode === "design"     ? AGENT_ORDER.filter((n) => DESIGN_NAMES.has(n))
    : mode === "parametric" ? AGENT_ORDER.filter((n) => PARAMETRIC_NAMES.has(n))
    : AGENT_ORDER; // "agent" = Orchestrator = all
  return names.map((n) => AGENT_TOOLS[n]);
}
