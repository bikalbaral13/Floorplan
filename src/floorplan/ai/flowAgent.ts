// Agentic Flow builder — the Vercel AI SDK tool-loop that lets the model BUILD / EDIT the node-graph "Flow"
// (Operations Pipeline) instead of blind one-shot JSON generation. The model reads the current graph
// (get_flow), designs the change, writes the whole graph back (replace_flow), and verifies it (compile_flow),
// iterating until the pipeline validates. It runs against a tiny host API (FlowAgentApi) that reads the live
// graph and applies a new one through the SAME importFlowData path the Flow overlay uses — so an AI-built
// flow is identical to a hand-drawn one. This supersedes the legacy one-shot "Generate flow with AI" panel.
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import type { Node, Edge } from "@xyflow/react";
import { FLOW_TOOLS } from "../flow/flowTypes";
import { compileFlow } from "../flow/compileFlow";
import type { SerializedFlow } from "../types";
import type { AgentEvent } from "./agentChat";

/** The live tool catalog (every node type: handles + params + defaults) — injected into the flow agent's
 *  system prompt so it only ever references real tools/params. Mirrors FlowOverlay's buildToolCatalog. */
export function buildFlowToolCatalog(): string {
  return Object.values(FLOW_TOOLS)
    .map((def) => {
      if (def.type === "source") return `- "source": pipeline input (the selected space). Exactly one, id "source", params {}.`;
      // The per-object editor template hides the ACTUAL param shape (an objects array) — spell it out,
      // including the parametric objectId path (dims auto-measured from the library object).
      if (def.type === "place-object") {
        return `- "place-object" (Place Object); 1 geometry output (sourceHandle null); params: { "objects": [ { "objectId"?: parametric library id (PREFERRED — e.g. "sofa.v2"; length/breadth/height are auto-measured from the object, and the commit places the real parametric object), "kind"?: 2D-symbol fallback for custom boxes, "length"?/"breadth"?/"height"?: m (override or custom box), "position": 0..100 along the boundary, "setback": m from the wall, "clearance": m above floor, "locked"?: boolean } ], "seed": number ≥1 } — one entry per object; seed randomises unlocked positions, the solver slides objects to avoid overlaps and corners; defaults: ${JSON.stringify(def.defaultParams)}`;
      }
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
      const geomIn = def.geomInputs?.length ? ` geom-IN: ${def.geomInputs.map((g) => `gin-${g.key}`).join(", ")};` : "";
      const outLabels = def.outputLabels?.length ? ` output endpoints: ${def.outputLabels.map((l, i) => `out-${i}=${l}`).join(", ")};` : "";
      const dynamic = def.type === "input-props"
        ? " DYNAMIC value-OUT: one val-<propId> per entry in params.props;"
        : def.type === "output"
        ? " DYNAMIC value-IN: one valin-<slotId> per entry in params.slots;"
        : "";
      return `- "${def.type}" (${def.label}); ${outN};${valOut}${valIn}${geomIn}${outLabels}${dynamic} params: ${fieldDesc || "none"}; defaults: ${JSON.stringify(def.defaultParams)}`;
    })
    .join("\n");
}

/** Base flow-building instructions (schema + wiring rules). The live tool catalog is appended at runtime. */
export const FLOW_AGENT_SYSTEM_PROMPT = `You are the Flow Agent for a node-graph "Flow" (an Operations Pipeline) in a 2D architecture floor-plan tool. You BUILD and EDIT the graph with tools: read the current graph with get_flow, design the change, write the WHOLE graph back with replace_flow, then verify it with compile_flow — iterate until it compiles clean. The graph drives the canvas geometry (inset / split / massing / walls / doors / schemas …).

WORKFLOW (every request):
1) READ — call get_flow to see the current nodes/edges. Empty or Source-only means start fresh.
2) DESIGN — pick a ROOT, the middle algorithm/calculation chain, and the outputs; lay nodes left→right.
3) WRITE — call replace_flow with the COMPLETE graph JSON (it replaces the whole graph). To EDIT, start from get_flow's graph, keep every node/edge you aren't changing, and add/modify only what's needed.
4) VERIFY — call compile_flow; if it reports errors (unknown tool, dangling edge, cycle, empty), fix them and replace_flow again.
5) REPORT — 1–3 plain sentences on what the flow does. No JSON in chat.

GRAPH JSON (what replace_flow accepts) — { "version": 1, "nodes": [...], "edges": [...] }:
- node: { "id": string, "position": {"x":number,"y":number}, "data": {"tool":string,"params":object}, "type"?: "group", "parentId"?: string, "width"?: number, "height"?: number }
- edge: { "id": string, "source": nodeId, "target": nodeId, "sourceHandle": string|null, "targetHandle": string|null }
- Node ids are "<tool>_<n>" (e.g. "inset_1"); lay nodes left→right (x grows ~260 per stage, vary y). Use ONLY tools/params from the catalog below; start from each tool's "defaults" and change only what the request needs, staying within the stated ranges/options.

ROOTS (pick by request):
- SPACE flows (inset / split / massing / optimise-rect / bsp / voronoi …) root on ONE "source" node: {"id":"source","position":{"x":80,"y":200},"data":{"tool":"source","params":{}}} — the selected space. (replace_flow guarantees a Source exists, but include it explicitly.)
- GRAPH / FLOORPLAN flows (walls, doors, windows, objects, dimensions, pipe/frame solvers) root on "canvas-source" (whole canvas — out-0 Spaces, out-1 Nodes, out-2 Segments, out-3 Graph, out-4 Images) or "graph-source" / "segment-source" / "node-source". These do NOT need a "source" node.

CANONICAL SPACE-FLOW STRUCTURE (rooted on "source"): source → input-props → (algorithms + calculations) → output.
- INPUTS FIRST: exactly one "input-props" (Input Properties) node wired from "source"; put every adjustable parameter (setbacks, FSI rates, floor counts, ratios, angles, targets, toggles) there as props, and drive downstream nodes by wiring its val-<propId> outputs into their valin-* handles — do NOT hard-code tunable numbers in the consuming nodes.
- ALGORITHMS IN THE MIDDLE: the geometry tools (inset, split, optimise-rect, bsp, voronoi, massing …) plus the math chain (space-geometry to measure, math nodes for formulas).
- OUTPUTS LAST: exactly one "output" (Output Metrics) node; wire every important result into its slots (areas via val-area, values via val-result, floor counts via val-floors …) with clear labels.

EDGES — two kinds:
1. GEOMETRY (a space/polygon flows downstream): sourceHandle = null for a 1-output node, or "out-0"/"out-1"/… for a multi-geometry-output node (split, bsp, voronoi, conditional; conditional out-0 = TRUE, out-1 = FALSE). targetHandle = null.
2. VALUE (a single number/string into a parameter): sourceHandle = "val-<key>" (a value-OUT), targetHandle = "valin-<key>" (a value-IN). The catalog lists each node's value handles.

KEY VALUE-DRIVEN NODES:
- "math": result = a (op) b. Wire numbers into valin-a / valin-b; exposes val-result. op ∈ {add,subtract,multiply,divide}; round ∈ {none,ceil,floor,round}. Chain math nodes for multi-step formulas.
- "space-geometry": measures the input space → val-area (m²), val-perimeter (m), val-vertices; forwards the space.
- "floor-massing": value-IN valin-n (floor count); value-OUT val-floors. "inset"/"optimise-rect": value-OUT val-area; "split" takes valin-ratios/valin-angle/valin-target (target = first-piece area).

DYNAMIC nodes:
- "input-props": params = { "props": [ { "id", "name", "type": "range"|"select"|"checkbox"|"text", "value", "min", "max", "step", "options": string[] } ] }. Each prop exposes value-OUT "val-<propId>".
- "output": params = { "slots": [ { "id", "label" } ] }. Each slot is a value-IN "valin-<slotId>".

SCHEMAS + BUILDING nodes (graph/floorplan flows):
- "schema" (Input Schema): defines per-component properties. params = { "name"?, "nodeProps":[], "segmentProps":[], "spaceProps":[], "graphProps":[] }; each entry = { "id","key","label","kind":"number"|"select"|"checkbox"|"text"|"color","unit","def","min","max","step","options":string[],"role","showIf"?:{"when","equals"} }. Wire its OUTPUT (sourceHandle null) into a "canvas-source"/"graph-source"/…/"source" node OR a processor's "gin-schema". Properties then appear per component in the Properties tab, stored by "role".
- "output-schema": per-component RESULT rows (Metrics tab); wire a processor's OUTPUT into it; row keys match the processor's result keys.
- "frame-builder" (Graph in → columns+beams, gin-schema ← a schema), "wall-builder" (Graph → mitred walls, thickness/justification from segment schema via gin-schema), "segment-to-door"/"segment-to-window" (a Segment → symbol), "node-to-object" (a Node → furniture). Feed from canvas-source: out-2 Segments, out-1 Nodes, out-3 Graph.

FURNISH RECIPE (requests like "place a sofa, table and bed in the room"): ONE "place-object" node fed by the space — {"id":"place-object_1","data":{"tool":"place-object","params":{"objects":[{"objectId":"sofa.v2","position":10},{"objectId":"table.v2","position":40},{"objectId":"bed.v2","position":70}],"seed":3}}} with an edge source → place-object_1. Use objectIds from the PARAMETRIC OBJECTS catalog (dims auto-measure — never invent length/breadth for them); spread initial positions (or just re-roll seed) and the solver arranges the objects along the boundary without overlaps. Committing the flow places the REAL parametric objects as selectable nodes.

RASTER→SPACES RECIPE (requests like "trace this scanned plan / survey image into spaces"): image → vectorise → graph-to-spaces, plus an output for metrics — image-rooted, NO "source" node needed. Nodes: {"id":"image_1","data":{"tool":"image","params":{}}} → {"id":"vectorise_1","data":{"tool":"vectorise","params":{"colorMode":"black","tuneMinArea":1,"tuneColour":true}}} → {"id":"graph-to-spaces_1","data":{"tool":"graph-to-spaces","params":{"outputMode":"single","minArea":1}}} → {"id":"output_1","data":{"tool":"output","params":{"slots":[{"id":"s1","label":"Spaces"},{"id":"s2","label":"Total Area (m²)"},{"id":"s3","label":"Open Ends"}]}}}; value edges: graph-to-spaces val-spaces→valin-s1 + val-totalArea→valin-s2, vectorise val-openEnds→valin-s3. (The bundled public/Library/Flows/raster-to-spaces.json is this exact graph.) After building, TELL THE USER to press AUTO-TUNE on the Vectorisation node — it loops the tracing parameters, scores each combo on closed spaces found (− noise faces − open ends) with live progress, and bakes the best values into the sliders — then Run commits the faces as wall loops → Spaces. Do NOT hand-guess tolerance/despeckle values.

GROUPING (optional, VISUAL ONLY): a group container { "id":"g_<name>", "type":"group", "position":{abs}, "width", "height", "data":{"tool":"group","params":{"label":"Title"}} }; member nodes set "parentId" to it with RELATIVE positions (leave ~40px top for the label). List every group node BEFORE its children. Never group the "source" node.

TOOL NOTES:
- replace_flow's argument (graphJson) is the COMPLETE graph as a JSON string. compile_flow re-reads and validates the live graph.
- If a tool returns { "error" } or compile_flow lists errors, FIX the graph and replace_flow again — do not repeat the same broken graph.
- LIBRARY FOLDER: a flow kept as a FILE (an export or a bundled sample) ALWAYS belongs in the repo at public/Library/Flows/<name>.json — the Flow panel's Export → "Save .json file" writes it there automatically in dev; tell the user that destination (designs → public/Library/Designs, parametric objects → public/Library/Parametric Objects).`;

/** Compact single-line summary of a tool result for the transcript (the model still gets the full value). */
const short = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s == null ? "ok" : s.length > 700 ? `${s.slice(0, 700)}…` : s;
};

/** What the host must provide: read the live Flow graph, and apply a new one (through importFlowData). */
export interface FlowAgentApi {
  /** The current live graph ({ version, nodes, edges }). Empty graph when nothing is built yet. */
  getFlow: () => SerializedFlow;
  /** Replace the whole graph with `graph` (host normalises + loads it). Returns the node count applied. */
  applyFlow: (graph: { nodes?: unknown[]; edges?: unknown[]; version?: number }) => number | Promise<number>;
}

// SerializedFlow → the minimal React-Flow Node[]/Edge[] compileFlow needs (id + data.tool/params + edges).
const toRFNodes = (g: SerializedFlow): Node[] =>
  (g.nodes ?? []).map((n) => ({
    id: n.id,
    position: n.position ?? { x: 0, y: 0 },
    type: n.type === "group" ? "group" : "op",
    data: { tool: n.data?.tool, params: n.data?.params ?? {} },
  } as unknown as Node));
const toRFEdges = (g: SerializedFlow): Edge[] =>
  (g.edges ?? []).map((e, i) => ({
    id: e.id ?? `e${i}`, source: e.source, target: e.target,
    sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
  } as Edge));

export interface FlowValidation { ok: boolean; errors: string[]; warnings: string[]; opCount?: number; order?: string[] }

/** Structural check (valid tools, edges reference nodes, a root exists) + a compile pass (cycles / topo /
 *  op count). Returns actionable errors the agent can fix. */
export function validateFlowGraph(g: SerializedFlow): FlowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodes = Array.isArray(g?.nodes) ? g.nodes : [];
  if (!nodes.length) errors.push("graph has no nodes");
  const toolSet = new Set(Object.keys(FLOW_TOOLS));
  const ids = new Set<string>();
  for (const n of nodes) {
    if (!n?.id) { errors.push("a node is missing an id"); continue; }
    if (ids.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    ids.add(n.id);
    const t = n.data?.tool;
    if (!t) errors.push(`node "${n.id}" has no data.tool`);
    else if (!toolSet.has(t)) errors.push(`node "${n.id}": unknown tool "${t}" (see the catalog)`);
  }
  for (const e of Array.isArray(g?.edges) ? g.edges : []) {
    if (!ids.has(e.source)) errors.push(`edge "${e.id ?? ""}": source "${e.source}" is not a node`);
    if (!ids.has(e.target)) errors.push(`edge "${e.id ?? ""}": target "${e.target}" is not a node`);
  }
  const ROOTS = ["source", "canvas-source", "graph-source", "segment-source", "node-source", "space-creator"];
  if (nodes.length && !nodes.some((n) => ROOTS.includes(String(n.data?.tool)))) {
    warnings.push("no root node (source / canvas-source / space-creator …) — the pipeline may have no input");
  }
  let opCount: number | undefined;
  let order: string[] | undefined;
  if (!errors.length) {
    try {
      const r = compileFlow(toRFNodes(g), toRFEdges(g), "commit");
      if (r.error) errors.push(r.error);
      opCount = r.opCount;
      order = r.order;
    } catch (e) {
      warnings.push(`compile check skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, opCount, order };
}

export interface RunFlowAgentParams {
  apiKey: string;
  model: string;
  prompt: string;
  api: FlowAgentApi;
  /** Override for FLOW_AGENT_SYSTEM_PROMPT (edited in the panel). Blank → default. */
  systemPrompt?: string;
  /** Live parametric-object catalog (buildDetailedObjectCatalog) — for flows that reference object ids
   *  (place-object / node-to-object). Optional. */
  objectCatalog?: string;
  onEvent?: (e: AgentEvent) => void;
  maxSteps?: number;
}

/** Run the flow-building loop: Gemini + tools over the live Flow graph until it stops calling tools (or the
 *  step cap). Returns the model's final plain-text summary and the number of steps. */
export async function runFlowAgent(p: RunFlowAgentParams): Promise<{ text: string; steps: number }> {
  if (!p.apiKey.trim()) throw new Error("Gemini API key required (set it in Preferences)");
  if (!p.model.trim()) throw new Error("Gemini model id required (set it in Preferences)");
  const google = createGoogleGenerativeAI({ apiKey: p.apiKey.trim() });

  // Every tool reports call + result to the transcript and returns { error } instead of throwing, so a failed
  // call becomes feedback the model reacts to rather than aborting the whole run.
  const wrap = <I,>(name: string, fn: (input: I) => unknown | Promise<unknown>) =>
    async (input: I): Promise<unknown> => {
      p.onEvent?.({ type: "tool-call", tool: name, input });
      try {
        const out = (await fn(input)) ?? "ok";
        p.onEvent?.({ type: "tool-result", tool: name, ok: true, summary: short(out) });
        return out;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        p.onEvent?.({ type: "tool-result", tool: name, ok: false, summary: msg });
        return { error: msg };
      }
    };

  const tools = {
    get_flow: tool({
      description: "The current Flow graph as JSON ({ version, nodes, edges }). Call FIRST — an empty or Source-only graph means build fresh; otherwise edit from it (keep the nodes/edges you aren't changing).",
      inputSchema: z.object({}),
      execute: wrap("get_flow", () => p.api.getFlow()),
    }),
    list_flow_tools: tool({
      description: "The full node-type catalog: every tool's handles (geometry / value / schema), params (ranges & options) and defaults. The ONLY tools/params you may use. (Also embedded in your instructions.)",
      inputSchema: z.object({}),
      execute: wrap("list_flow_tools", () => buildFlowToolCatalog()),
    }),
    replace_flow: tool({
      description: "Replace the WHOLE Flow graph with the given JSON (an object { version, nodes, edges } encoded as a STRING). The host normalises + loads it (a Source node is guaranteed). Returns the applied node count and a compile check — read the check and fix any errors.",
      inputSchema: z.object({
        graphJson: z.string().describe('The complete graph as a JSON string: {"version":1,"nodes":[...],"edges":[...]}'),
      }),
      execute: wrap("replace_flow", async (a: { graphJson: string }) => {
        let parsed: { nodes?: unknown[]; edges?: unknown[]; version?: number };
        try {
          const v = JSON.parse(a.graphJson) as unknown;
          if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
          parsed = v as { nodes?: unknown[]; edges?: unknown[]; version?: number };
        } catch {
          throw new Error(`graphJson is not a valid JSON object: ${a.graphJson.slice(0, 80)}`);
        }
        if (!Array.isArray(parsed.nodes)) throw new Error('graphJson must have a "nodes" array');
        const applied = await p.api.applyFlow(parsed);
        // Validate the graph the agent just authored (synchronous — the host's live graph updates on the
        // next React render, so re-reading it here would see the STALE pre-apply state). The compile_flow
        // tool re-reads the live graph on a later turn once it has settled.
        const check = validateFlowGraph(parsed as unknown as SerializedFlow);
        return { applied, ok: check.ok, opCount: check.opCount, errors: check.errors, warnings: check.warnings };
      }),
    }),
    compile_flow: tool({
      description: "Validate + compile the CURRENT live graph. Returns { ok, opCount, order, errors, warnings } — unknown tools, dangling edges, cycles and empty graphs are reported. Use it to confirm the flow is valid before finishing.",
      inputSchema: z.object({}),
      execute: wrap("compile_flow", () => validateFlowGraph(p.api.getFlow())),
    }),
  };

  const system =
    (p.systemPrompt?.trim() ? p.systemPrompt : FLOW_AGENT_SYSTEM_PROMPT) +
    `\n\nAVAILABLE TOOLS (node types — handles + params + defaults; the ONLY tools you may use):\n${buildFlowToolCatalog()}` +
    (p.objectCatalog?.trim()
      ? `\n\nPARAMETRIC OBJECTS (ids you may reference in place-object / node-to-object params):\n${p.objectCatalog}`
      : "");
  const result = await generateText({
    model: google(p.model.trim()),
    system,
    messages: [{ role: "user", content: [{ type: "text", text: `INSTRUCTION:\n${p.prompt}` }] }] as ModelMessage[],
    tools,
    stopWhen: stepCountIs(p.maxSteps ?? 16),
    temperature: 0.3,
    // The whole-graph JSON arrives as replace_flow OUTPUT tokens — give it headroom for large pipelines.
    maxOutputTokens: 65536,
  });
  return { text: result.text, steps: result.steps.length };
}
