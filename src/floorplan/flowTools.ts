/**
 * Flows as tools — ANY saved flow under the library's `Workflows/` is usable as one tool. Nothing extra is
 * authored: the tool's contract is read from the graph itself.
 *
 *   Input Properties fields (editable ones)  → the panel's controls (slider / number / checkbox / select / text / colour)
 *   Polygon nodes                            → an outline input: drawn, or the selected space, else the node's sample
 *   Space source (grabFromSelection)         → "uses the selected space" — the flow reads the selection itself
 *   Segment / Graph / Node / Freehand / Canvas / Image / Grid sources → read the canvas themselves; listed as needs
 *   output                                    → whatever the Flow editor's Run commits (same path, nothing re-implemented)
 *
 * Shared by the Drawing toolbar (Import Workflows → one glyph icon each) and the AI bridge
 * (list_flow_tools / run_flow_tool).
 */
import { fetchFromCloudLibrary } from "./cloudLibrary";
import { listWorkflowFiles, LIB_WORKFLOWS } from "./libraryFiles";
import { inputProps, type InputProp } from "./flow/flowTypes";

/** Legacy curated folder (its index.json) — still what the AI bridge lists. */
export const FLOW_TOOLS_DIR = "Workflows/Tools";

export type FlowFile = {
  title?: string;
  description?: string;
  /** Optional overrides — only when what is read from the graph is wrong. */
  tool?: { label?: string; glyph?: string; mcp?: boolean };
  /** Opt-in: expose this flow as its own MCP tool (`wf_<name>`) while an editor tab is connected. */
  mcp?: boolean;
  nodes?: { id: string; data?: { tool?: string; params?: Record<string, unknown> } }[];
  edges?: { source?: string; target?: string; sourceHandle?: string | null; targetHandle?: string | null }[];
};

/** One control or input of a tool. `name` is the Input Properties prop id, or the Polygon node id. */
export type FlowToolInput = {
  name: string;
  label: string;
  /** range → "number" (slider when min < max) · checkbox · select · text · color · polygon */
  type: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  showIf?: InputProp["showIf"];
};

/** What the flow reads from the canvas on its own (no value is written for these). */
export type FlowToolNeed = "space" | "segment" | "graph" | "node" | "freehand" | "canvas" | "image" | "grid" | "object" | "ai-key" | "manual";

export type FlowToolInfo = { fields: FlowToolInput[]; polygons: FlowToolInput[]; needs: FlowToolNeed[] };

/** A workflow the user imported into the toolbar. `name` is its path under Workflows/ without ".json"
 *  ("Operations/voronoi"); a bare name ("inset") is the legacy Workflows/Tools/ form. */
export type ImportedFlowTool = { name: string; title: string; glyph?: string };

/** A tool RUN linked to the space it ran on (plan key `toolAttachments`, by space id). Selecting the space shows
 *  the tool's controls; changing one deletes `walls` / `rooms` (what the last run created) and runs again. */
export type ToolAttachment = ImportedFlowTool & {
  id: string;
  values: Record<string, string | number | boolean>;
  walls: string[];
  rooms: string[];
};

const NEED_BY_TOOL: Record<string, FlowToolNeed> = {
  source: "space", "segment-source": "segment", "graph-source": "graph", "node-source": "node",
  "freehand-source": "freehand", "canvas-source": "canvas", "canvas-encoder": "canvas", image: "image",
  "grid-source": "grid", "pobj-source": "object", "grab-object": "object",
  "object-detection": "ai-key", analyse: "ai-key", generate: "ai-key", agent: "ai-key", render: "ai-key",
  // Nodes whose result only exists after a button on the node is pressed — a tool run cannot press it.
  "layout-gen": "manual",
};

export const NEED_LABEL: Record<FlowToolNeed, string> = {
  space: "the selected space", segment: "the selected segments", graph: "the selected graph", node: "the selected node",
  freehand: "freehand strokes on the canvas", canvas: "the whole plan", image: "the image underlay",
  grid: "a grid", object: "a parametric object", "ai-key": "an AI API key (Preferences)",
  manual: "a button inside the flow (open it in the Flow editor to press it)",
};

/** Read a flow's tool contract from its nodes. */
export function analyseFlowTool(f: FlowFile): FlowToolInfo {
  const fields: FlowToolInput[] = [];
  const polygons: FlowToolInput[] = [];
  const needs = new Set<FlowToolNeed>();
  // An Input Properties field fed by a wire (e.g. a Space source → its outline field) is not the user's to set.
  const wired = new Set((f.edges ?? []).map((e) => `${e.target}|${e.targetHandle ?? ""}`));
  for (const n of f.nodes ?? []) {
    const tool = n.data?.tool ?? "";
    const p = n.data?.params ?? {};
    if (tool === "input-props") {
      for (const q of inputProps(p)) {
        if (!q.editable || q.type === "button" || wired.has(`${n.id}|valin-${q.id}`)) continue;
        fields.push({
          name: q.id, label: q.name || q.id, type: q.type === "range" ? "number" : q.type, default: q.value,
          ...(q.type === "range" ? { min: q.min, max: q.max, step: q.step } : {}),
          ...(q.type === "select" ? { options: q.options } : {}),
          ...(q.showIf ? { showIf: q.showIf } : {}),
        });
      }
    } else if (tool === "polygon") {
      polygons.push({ name: n.id, label: "Outline", type: "polygon", default: (() => { try { return JSON.parse(String(p.points)); } catch { return p.points; } })() });
    } else if (NEED_BY_TOOL[tool]) {
      needs.add(NEED_BY_TOOL[tool]);
    }
  }
  return { fields, polygons, needs: [...needs] };
}

/** Back-compat for the AI bridge: fields + polygons as one list. */
export function flowToolInputs(f: FlowFile): FlowToolInput[] {
  const { fields, polygons } = analyseFlowTool(f);
  return [...fields, ...polygons];
}

/** Short glyph text for a toolbar icon: the flow's own `tool.glyph`, else from its title —
 *  "Voronoi (Algorithms.Voronoi)" → "Vo", "Straight skeleton" → "SS", "Inset to Segments — …" → "IS". */
export function flowToolGlyph(f: FlowFile, fallbackName: string): string {
  if (f.tool?.glyph) return f.tool.glyph.slice(0, 3);
  const title = (f.tool?.label ?? f.title ?? fallbackName.split("/").pop() ?? "?")
    .replace(/\(.*?\)/g, " ").split(/[—–:|]/)[0];
  const words = title.split(/[\s_\-.]+/).filter((w) => /[A-Za-z0-9]/.test(w) && !/^(to|of|the|and|a|from|v\d+)$/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? "?";
  return w[0].toUpperCase() + (w[1] ?? "").toLowerCase();
}

/** The legacy curated list (Workflows/Tools/index.json) — used by the AI bridge. */
export async function listFlowToolNames(): Promise<string[]> {
  const index = await fetchFromCloudLibrary<{ tools?: string[] }>(`${FLOW_TOOLS_DIR}/index.json`);
  return index?.tools ?? [];
}

/** Every saved flow under Workflows/, as tool names ("Operations/voronoi"). */
export async function listAllFlowTools(): Promise<string[]> {
  const files = await listWorkflowFiles();
  return files
    .filter((f) => f.toLowerCase().endsWith(".json") && !/(^|\/)index\.json$/i.test(f))
    .map((f) => f.replace(/\.json$/i, ""))
    .sort((a, b) => a.localeCompare(b));
}

export async function loadFlowTool(name: string): Promise<FlowFile> {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  const rel = file.includes("/") ? `${LIB_WORKFLOWS}/${file}` : `${FLOW_TOOLS_DIR}/${file}`;
  const f = await fetchFromCloudLibrary<FlowFile>(rel);
  if (!f || !Array.isArray(f.nodes)) throw new Error(`no flow "${name}" in ${rel}`);
  return f;
}

/** Shoelace signed area of an [[x, y], …] ring (sign = winding). */
function signedArea(pts: number[][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i] ?? [0, 0], [x2, y2] = pts[(i + 1) % pts.length] ?? [0, 0];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** A copy of the flow with the given inputs written into its Input Properties / Polygon nodes, and every
 *  Space source set to follow the current selection. Throws on an input name the flow does not take. */
export function withFlowToolInputs(flow: FlowFile, inputs: Record<string, unknown>): FlowFile {
  const f = structuredClone(flow);
  const known = new Set(flowToolInputs(f).map((i) => i.name));
  const unknown = Object.keys(inputs).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`unknown input(s): ${unknown.join(", ")} — this tool takes ${[...known].join(", ")}`);
  for (const n of f.nodes ?? []) {
    const p = (n.data ??= {}).params ??= {};
    if (n.data.tool === "input-props") for (const q of (p.props as { id: string; value?: unknown }[]) ?? []) { if (q.id in inputs) q.value = inputs[q.id]; }
    if (n.data.tool === "polygon" && n.id in inputs) {
      const given = inputs[n.id];
      // Offsets, insets, normals… depend on WINDING. A canvas space can come either way round, so turn the
      // given outline to match the node's own sample — the orientation the flow was authored against.
      if (Array.isArray(given)) {
        let sample: unknown;
        try { sample = JSON.parse(String(p.points)); } catch { sample = null; }
        const pts = given as number[][];
        p.points = JSON.stringify(Array.isArray(sample) && signedArea(sample as number[][]) * signedArea(pts) < 0 ? [...pts].reverse() : pts);
      } else p.points = typeof given === "string" ? given : JSON.stringify(given);
    }
    // A saved flow may carry the id of a space from the plan it was authored on; as a tool it runs on THIS
    // plan's selection instead.
    if (n.data.tool === "source") { p.id = ""; p.grabFromSelection = true; }
  }
  return f;
}

/* ── Flows as MCP tools (opt-in: `"mcp": true` in the flow file) ─────────────────────────────────────────
 * Built here, in the editor, from the same graph reading the toolbar uses — the MCP servers ask the connected
 * tab for this list and forward each `wf_*` call back to it, so there is one reading of a flow, not two. */

export const isMcpFlow = (f: FlowFile) => f.mcp === true || f.tool?.mcp === true;

/** "Operations/double_inset" → "wf_double_inset" (MCP tool names: [a-z0-9_], ≤ 64 chars). */
export const mcpToolName = (name: string) =>
  "wf_" + (name.split("/").pop() ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56);

export type McpToolDef = { name: string; description: string; inputSchema: Record<string, unknown> };

export function mcpToolFor(name: string, f: FlowFile): McpToolDef {
  const info = analyseFlowTool(f);
  const props: Record<string, unknown> = {};
  for (const i of info.fields) {
    const d = i.label + (i.showIf ? ` (used when ${i.showIf.when} = ${String(i.showIf.equals)})` : "");
    if (i.type === "number") props[i.name] = { type: "number", description: d, default: i.default, ...(i.min != null && i.max != null && i.max > i.min ? { minimum: i.min, maximum: i.max } : {}) };
    else if (i.type === "checkbox") props[i.name] = { type: "boolean", description: d, default: i.default };
    else if (i.type === "select") props[i.name] = { type: "string", description: d, default: i.default, enum: i.options ?? [] };
    else props[i.name] = { type: "string", description: d + (i.type === "color" ? " (#rrggbb)" : ""), default: i.default };
  }
  const usesSpace = info.polygons.length > 0 || info.needs.includes("space");
  if (usesSpace) props.space_id = { type: "string", description: "Id of a space on the canvas to run on (list_spaces / get_selection). Its outline feeds the flow, and the result is LINKED to it (selecting the space shows these controls; a change re-runs the tool)." };
  if (info.polygons.length) props.outline = { type: "array", description: "Outline in plan metres [[x, y], …], used when no space_id is given; otherwise the flow's sample shape.", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 } };
  props.preview = { type: "boolean", description: "Only preview on the canvas (nothing committed). Default false: the result is committed.", default: false };
  const first = (f.description ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  const other = info.needs.filter((n) => n !== "space");
  return {
    name: mcpToolName(name),
    description: `${f.title ?? name}: ${first}`.slice(0, 600)
      + ` [Workflow tool Workflows/${name}.json, runs in the user's open editor tab${other.length ? `; also reads ${other.map((n) => NEED_LABEL[n]).join(", ")}` : ""}.]`,
    inputSchema: { type: "object", properties: props, additionalProperties: false },
  };
}
