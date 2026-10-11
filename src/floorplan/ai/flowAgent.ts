// Agentic Flow builder — the Vercel AI SDK tool-loop that lets the model BUILD / EDIT the node-graph "Flow"
// (Operations Pipeline) instead of blind one-shot JSON generation. The model reads the current graph
// (get_flow), designs the change, writes the whole graph back (replace_flow), and verifies it (compile_flow),
// iterating until the pipeline validates. It runs against a tiny host API (FlowAgentApi) that reads the live
// graph and applies a new one through the SAME importFlowData path the Flow overlay uses — so an AI-built
// flow is identical to a hand-drawn one. This supersedes the legacy one-shot "Generate flow with AI" panel.
// The AI SDK loads on the first run, not with the editor: it is only needed once someone sends a message.
import type { ModelMessage } from "ai";
import { z } from "zod";
import type { Node, Edge } from "@xyflow/react";
import { FLOW_TOOLS } from "../flow/flowTypes";
import { compileFlow } from "../flow/compileFlow";
import { saveLibraryFile, listFlowNodeFiles, listLibraryFiles, deleteLibraryFile, fetchLibraryJson, LIB_TOOLS, LIB_WORKFLOWS } from "../libraryFiles";
import type { SerializedFlow, SerializedFlowNode } from "../types";
import type { AgentEvent } from "./agentChat";

/** FLOW_TOOLS indexed loosely by an arbitrary tool string (for label / hint / defaultParams lookup). */
type LooseToolDef = { label?: string; hint?: unknown; defaultParams?: Record<string, unknown> };
const looseTool = (t: string): LooseToolDef | undefined => (FLOW_TOOLS as Record<string, LooseToolDef>)[t];

/** Parse an optional JSON-object string (the Gemini-friendly way params travel — see replace_flow). */
const parseParamsJson = (s: string | undefined): Record<string, unknown> | undefined => {
  if (!s || !s.trim()) return undefined;
  const v = JSON.parse(s) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("paramsJson must be a JSON object");
  return v as Record<string, unknown>;
};

/** Fetch + parse a tool / node-template file (Library `Tools/<rel>`, R2 bucket first). */
const fetchNodeFile = async (path: string): Promise<{ tool?: string; params?: Record<string, unknown>; label?: string; category?: string; description?: string }> => {
  const rel = path.replace(/^\/+/, "").replace(/\\/g, "/");
  const parsed = await fetchLibraryJson<{ tool?: string; params?: Record<string, unknown> }>(`${LIB_TOOLS}/${rel}`);
  if (!parsed) throw new Error(`node file not found: ${rel}`);
  return parsed;
};

/** The live tool catalog (every node type: handles + params + defaults) — injected into the flow agent's
 *  system prompt so it only ever references real tools/params. Mirrors FlowOverlay's buildToolCatalog. */
export function buildFlowToolCatalog(): string {
  return Object.values(FLOW_TOOLS)
    .map((def) => {
      if (def.type === "source") return `- "source": pipeline input (the selected space). Exactly one, id "source", params {}.`;
      // The per-object editor template hides the ACTUAL param shape (an objects array) — spell it out,
      // including the parametric objectId path (dims auto-measured from the library object).
      if (def.type === "pobj-source") {
        return `- "pobj-source" (Parametric Site); 1 geometry output (sourceHandle null) = the object's FOOTPRINT polygon (a Space ROOT — no input needed); value-IN: valin-def (optional; a wired Parametric Object definition overrides the stored one); DYNAMIC value-OUT: one val-<paramKey> per parameter in the loaded object (e.g. a param "offset" → "val-offset"); wire those into downstream valin-* handles to drive the chain (e.g. val-offset → Inset's valin-inset). params: { "definition": pobj JSON string, "props": [ { "id","name","type","value",… } ] } — the user loads these via "Load Parametric Site"; defaults: ${JSON.stringify(def.defaultParams)}`;
      }
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
        : def.type === "expr"
        ? " DYNAMIC value-IN: one valin-<var> per INPUT variable of params.expr (plus valin-deps to merge a whole params node's values into scope by name); DYNAMIC value-OUT: one val-<name> per `name = expr` line (a single expression → val-result);"
        : "";
      const header = `- "${def.type}" (${def.label}); ${outN};${valOut}${valIn}${geomIn}${outLabels}${dynamic} params: ${fieldDesc || "none"}; defaults: ${JSON.stringify(def.defaultParams)}`;
      // Append the node's own usage guide (from its declaration's `instructions`) so the agent follows
      // the same param semantics the info panel documents. Indent continuation lines under the header.
      if (def.instructions) {
        const guide = def.instructions.trim().split("\n").map((l) => `    ${l}`).join("\n");
        return `${header}\n${guide}`;
      }
      return header;
    })
    .join("\n");
}

/** Base flow-building instructions (schema + wiring rules). The live tool catalog is appended at runtime. */
export const FLOW_AGENT_SYSTEM_PROMPT = `You are the Flow Agent for a node-graph "Flow" (an Operations Pipeline) in a 2D architecture floor-plan tool. You do TWO kinds of work:
A) BUILD & EDIT the live graph (a WORKFLOW = nodes + connections): read it with get_flow, design the change, write the WHOLE graph back with replace_flow, then verify with compile_flow — iterate until it compiles clean. The graph drives the canvas geometry (inset / split / massing / walls / doors / schemas …).
B) MANAGE the file-based LIBRARY: reusable TOOLS (node declarations / templates) live as files under Tools/<folder>/<name>.node.json (the old palette moved to files — the user adds nodes via "Import Nodes"), and WORKFLOWS live under Workflows/<folder>/<name>.json. You can list / read / create / edit / delete node templates, drop a saved node onto the canvas (import_node), and save / list / load whole workflows. Match the request: "add/place a node in the flow" → import_node or replace_flow; "create/save a new node type", "edit/rename/tweak a node", "delete a node" → the *_node_file tools; "save/load this workflow" → the *_workflow tools. File tools write to the repo (dev only) — real, persistent changes, so only create/edit/DELETE files the user asked you to.

WORKFLOW (every request):
1) READ — call get_flow to see the current nodes/edges. Empty or Source-only means start fresh.
2) DESIGN — pick a ROOT, the middle algorithm/calculation chain, and the outputs; lay nodes left→right.
3) WRITE — call replace_flow with the COMPLETE graph JSON (it replaces the whole graph). To EDIT, start from get_flow's graph, keep every node/edge you aren't changing, and add/modify only what's needed.
4) VERIFY — call compile_flow; if it reports errors (unknown tool, dangling edge, cycle, empty), fix them and replace_flow again.
5) LOOK — call snapshot_canvas and STUDY the image. compile_flow only proves the graph is well-formed; the snapshot is the only evidence the flow actually DREW what was asked. See the REFINE LOOP below.
6) REPORT — 1–3 plain sentences on what the flow does, and what the snapshot showed. No JSON in chat.

REFINE LOOP (this is the point of snapshot_canvas — a flow that compiles is not a flow that works):
- The snapshot renders the canvas INCLUDING the flow's live preview, framed to all visible content, top = NORTH (-y). So a generated-but-uncommitted result IS in the picture.
- After every replace_flow, look. Grade the picture against the request: is the geometry there at all, or is the canvas empty? Is it the right SHAPE, at the right SCALE, in the right PLACE? Are pieces missing, overlapping, inside-out, or collapsed to a dot?
- An empty or wrong picture is a PARAMETER or WIRING problem, not a reason to stop. Common causes, in the order worth checking: a value wire missing so a node fell back to its default; a magnitude off by a factor (metres vs pixels, a ratio typed as a percent); a geometry edge to the wrong output slot; a root that reads nothing because nothing is selected on canvas.
- Change ONE thing, replace_flow, look again. Iterate until the picture matches the request or you have tried three rounds — then say plainly what is still wrong and what you think causes it. Never report success on a graph you have not seen draw.
- Judge it on the drawing, not on the JSON. If the numbers look right and the picture does not, the picture wins.

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
- "input-props": params = { "props": [ { "id", "name", "type": "range"|"select"|"checkbox"|"text"|"color", "value", "min", "max", "step", "options": string[] } ] }. Each prop exposes value-OUT "val-<propId>". A "color" prop's value is a "#rrggbb" string (wire into "valin-color"); a "select" prop's choices are its "options" array.
- "output": params = { "slots": [ { "id", "label" } ] }. Each slot is a value-IN "valin-<slotId>".

SCHEMAS + BUILDING nodes (graph/floorplan flows):
- "schema" (Input Schema): defines per-component properties. params = { "name"?, "nodeProps":[], "segmentProps":[], "spaceProps":[], "graphProps":[] }; each entry = { "id","key","label","kind":"number"|"select"|"checkbox"|"text"|"color","unit","def","min","max","step","options":string[],"role","showIf"?:{"when","equals"} }. Wire its OUTPUT (sourceHandle null) into a "canvas-source"/"graph-source"/…/"source" node OR a processor's "gin-schema". Properties then appear per component in the Properties tab, stored by "role".
- "output-schema": per-component RESULT rows (Metrics tab); wire a processor's OUTPUT into it; row keys match the processor's result keys.
- "frame-builder" (Graph in → columns+beams, gin-schema ← a schema), "wall-builder" (Graph → mitred walls, thickness/justification from segment schema via gin-schema), "segment-to-door"/"segment-to-window" (a Segment → symbol), "node-to-object" (a Node → furniture). Feed from canvas-source: out-2 Segments, out-1 Nodes, out-3 Graph.

FURNISH RECIPE (requests like "place a sofa, table and bed in the room"): ONE "place-object" node fed by the space — {"id":"place-object_1","data":{"tool":"place-object","params":{"objects":[{"objectId":"sofa.v2","position":10},{"objectId":"table.v2","position":40},{"objectId":"bed.v2","position":70}],"seed":3}}} with an edge source → place-object_1. Use objectIds from the PARAMETRIC OBJECTS catalog (dims auto-measure — never invent length/breadth for them); spread initial positions (or just re-roll seed) and the solver arranges the objects along the boundary without overlaps. Committing the flow places the REAL parametric objects as selectable nodes.

RASTER→SPACES RECIPE (requests like "trace this scanned plan / survey image into spaces"): image → vectorise → graph-to-spaces, plus an output for metrics — image-rooted, NO "source" node needed. Nodes: {"id":"image_1","data":{"tool":"image","params":{}}} → {"id":"vectorise_1","data":{"tool":"vectorise","params":{"colorMode":"black","tuneMinArea":1,"tuneColour":true}}} → {"id":"graph-to-spaces_1","data":{"tool":"graph-to-spaces","params":{"outputMode":"single","minArea":1}}} → {"id":"output_1","data":{"tool":"output","params":{"slots":[{"id":"s1","label":"Spaces"},{"id":"s2","label":"Total Area (m²)"},{"id":"s3","label":"Open Ends"}]}}}; value edges: graph-to-spaces val-spaces→valin-s1 + val-totalArea→valin-s2, vectorise val-openEnds→valin-s3. (The bundled Workflows/raster-to-spaces.json is this exact graph.) After building, TELL THE USER to press AUTO-TUNE on the Vectorisation node — it loops the tracing parameters, scores each combo on closed spaces found (− noise faces − open ends) with live progress, and bakes the best values into the sliders — then Run commits the faces as wall loops → Spaces. Do NOT hand-guess tolerance/despeckle values.

GROUPING (optional, VISUAL ONLY): a group container { "id":"g_<name>", "type":"group", "position":{abs}, "width", "height", "data":{"tool":"group","params":{"label":"Title"}} }; member nodes set "parentId" to it with RELATIVE positions (leave ~40px top for the label). List every group node BEFORE its children. Never group the "source" node.

NODE LIBRARY & WORKFLOW FILES (the file tools):
- A NODE TEMPLATE file (Tools/<folder>/<tool>.node.json) is { "version":1, "kind":"flow-node", "tool", "label", "category", "description", "params" }. It only REFERENCES a node type from the catalog + presets its params — the node's behaviour stays in the app code; the file just names a tool and starting params. The folder is its display category (e.g. "Space", "Reshape", "Partition", or a custom folder like "Custom").
- CREATE / EDIT a node: save_node_file { path:"<Folder>/<name>.node.json", tool, paramsJson? }. To EDIT, read_node_file first, then save_node_file back with your changes (keep fields you aren't changing). paramsJson is a JSON object STRING (e.g. {"width":2.5,"shape":"cross"}); omit it to use the tool's defaults. The tool must be a real catalog id.
- DELETE a node: delete_node_file { path }. IMPORT a saved node onto the canvas: import_node { path } (or { tool, paramsJson? }) — it appends ONE node to the live graph.
- WORKFLOWS: save_workflow_file { name } writes the CURRENT graph to Workflows/<name>.json; list_workflow_files + import_workflow { path } discover and load saved workflows (import_workflow REPLACES the graph). A workflow is the whole nodes+connections graph — that's what you build with replace_flow.
- These are DEV-ONLY writes (the library bridge). On a production build the save/delete tools return an error; relay that to the user rather than retrying.

COMMIT BEHAVIOUR (what "Run Flow" does with the graph you build):
- Running the flow commits STEPWISE: each op (inset, optimise-rect, split, bsp, skeleton, massing …) runs against the COMMITTED geometry of its upstream op — not a live preview — and parks its own fresh Spaces + wall segments on their OWN layer ("Step N · <Tool>"). So a chain like source → inset → optimise-rect commits the inset polygon first (its own layer), then fits the rectangle inside that committed inset (a second layer), keeping each step's walls from conflicting. Build linear source→op→op chains and the runner handles the per-step layering automatically — you do NOT emit layers yourself.

TOOL NOTES:
- replace_flow's argument (graphJson) is the COMPLETE graph as a JSON string. compile_flow re-reads and validates the live graph.
- If a tool returns { "error" } or compile_flow lists errors, FIX the graph and replace_flow again — do not repeat the same broken graph.
- LIBRARY FOLDER: tools / node templates → Tools/<Folder>/*.node.json (save_node_file); whole workflows → Workflows/*.json (save_workflow_file, or the Flow panel's Export → "Save .json file"); designs → Designs/; parametric objects → Objects/.`;

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
  /** Render the canvas — INCLUDING this flow's live preview — to a PNG data URL, so the agent can SEE what
   *  the graph drew and refine it. `{ dataUrl, widthM, heightM }` or `{ error }`. Optional: without it the
   *  agent simply has no snapshot_canvas tool and falls back to compile-only verification. */
  snapshotCanvas?: () => unknown | Promise<unknown>;
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
  const ROOTS = ["source", "grab-object", "pobj-source", "canvas-source", "graph-source", "segment-source", "node-source", "grid-source", "image", "space-creator"];
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
  const [{ generateText, stepCountIs, tool }, { createGoogleGenerativeAI }] = await Promise.all([import("ai"), import("@ai-sdk/google")]);
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
    snapshot_canvas: tool({
      description: "Render the canvas — committed geometry AND this flow's LIVE PREVIEW — to a PNG and receive it AS AN IMAGE. This is the only way to see what the graph actually drew: compile_flow proves the graph is well-formed, the snapshot proves it works. Framed to all visible content; top of the image = NORTH (-y), right = EAST (+x). Call it after every replace_flow and grade the picture against the request before reporting. Also returns the captured extent { widthM, heightM }.",
      inputSchema: z.object({}),
      execute: wrap("snapshot_canvas", async () => {
        if (!p.api.snapshotCanvas) return { error: "this host cannot capture the canvas — verify with compile_flow only" };
        // The graph was applied a moment ago and the overlay re-evaluates it asynchronously, so capturing
        // immediately would photograph the PREVIOUS preview and the agent would refine against a stale
        // picture. Let the live evaluation settle first — the same beat flow_apply waits on the canvas side.
        await new Promise((r) => setTimeout(r, 500));
        return p.api.snapshotCanvas();
      }),
      // Hand the model a real image part rather than a base64 blob in JSON. Errors fall through as text.
      toModelOutput: ({ output }) => {
        const o = output as { dataUrl?: string; widthM?: number; heightM?: number } | null;
        const b64 = typeof o?.dataUrl === "string" && o.dataUrl.includes(",") ? o.dataUrl.split(",")[1] : null;
        if (b64) {
          return {
            type: "content",
            value: [
              { type: "file", mediaType: "image/png", data: { type: "data", data: b64 } },
              { type: "text", text: `canvas + live flow preview — extent ${o?.widthM ?? "?"} m × ${o?.heightM ?? "?"} m; top of the image is NORTH (-y), right is EAST (+x)` },
            ],
          };
        }
        return { type: "text", value: JSON.stringify(output ?? { error: "no snapshot" }) };
      },
    }),

    // ── TOOL-LIBRARY tools — the reusable node declarations / templates under Tools/ (the palette
    //    moved to files; the user adds nodes via "Import Nodes"). Dev only (the library bridge). ──
    list_node_files: tool({
      description: "List every reusable TOOL (node declaration / template) under Tools/ — folder-relative paths like \"Space/inset.node.json\" (folder = category). Each file is one saved node (a tool + preset params). Call before read/save/delete/import_node.",
      inputSchema: z.object({}),
      execute: wrap("list_node_files", async () => ({ files: await listFlowNodeFiles() })),
    }),
    read_node_file: tool({
      description: "Read one node-template file's JSON ({ tool, label, category, description, params }). `path` is folder-relative under Tools. Call before editing so you preserve the fields you aren't changing.",
      inputSchema: z.object({ path: z.string().describe('e.g. "Space/inset.node.json"') }),
      execute: wrap("read_node_file", (a: { path: string }) => fetchNodeFile(a.path)),
    }),
    save_node_file: tool({
      description: "Create OR overwrite a reusable TOOL at Tools/<path> (both CREATE a new node and EDIT an existing one — read_node_file first to keep other fields). `tool` MUST be a real node type from the catalog; `paramsJson` presets it (omit → the tool's defaults). `.node.json` is appended if missing; the folder is the category. Dev only — returns { ok, path } or throws with the bridge error.",
      inputSchema: z.object({
        path: z.string().describe('folder-relative under Tools, e.g. "Custom/wide-corridoor.node.json"'),
        tool: z.string().describe('a node type id from the catalog (e.g. "rectangle", "inset", "corridoor")'),
        label: z.string().optional(),
        category: z.string().optional().describe("display category (defaults to the folder name)"),
        description: z.string().optional(),
        paramsJson: z.string().optional().describe('preset params as a JSON object string, e.g. {"width":2,"shape":"cross"} (omit → the tool\'s defaults)'),
      }),
      execute: wrap("save_node_file", async (a: { path: string; tool: string; label?: string; category?: string; description?: string; paramsJson?: string }) => {
        const def = looseTool(a.tool);
        if (!def) throw new Error(`unknown tool "${a.tool}" — see the catalog`);
        const params = parseParamsJson(a.paramsJson) ?? def.defaultParams ?? {};
        let rel = a.path.replace(/^\/+/, "").replace(/\\/g, "/");
        if (!/\.node\.json$/i.test(rel)) rel = `${rel.replace(/\.json$/i, "")}.node.json`;
        const folder = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "Custom";
        const body = {
          version: 1, kind: "flow-node", tool: a.tool,
          label: a.label ?? def.label ?? a.tool,
          category: a.category ?? folder,
          description: a.description ?? (typeof def.hint === "string" ? def.hint : ""),
          params,
        };
        const r = await saveLibraryFile(`${LIB_TOOLS}/${rel}`, `${JSON.stringify(body, null, 2)}\n`);
        if (!r.ok) throw new Error(r.error ?? "save failed (library bridge is dev-only)");
        return { ok: true, path: r.path ?? `${LIB_TOOLS}/${rel}` };
      }),
    }),
    delete_node_file: tool({
      description: "Delete a tool file at Tools/<path> (folder-relative). Dev only. Returns { ok, deleted } or throws.",
      inputSchema: z.object({ path: z.string().describe('e.g. "Custom/old.node.json"') }),
      execute: wrap("delete_node_file", async (a: { path: string }) => {
        const rel = a.path.replace(/^\/+/, "").replace(/\\/g, "/");
        const r = await deleteLibraryFile(`${LIB_TOOLS}/${rel}`);
        if (!r.ok) throw new Error(r.error ?? "delete failed");
        return r;
      }),
    }),
    import_node: tool({
      description: "Add ONE node to the CURRENT Flow canvas — from a saved tool file (`path` under Tools) OR directly by `tool` (+ optional `paramsJson`). Appends to the live graph (keeps everything else). Use replace_flow to build a whole pipeline; use this to drop a single library node.",
      inputSchema: z.object({
        path: z.string().optional().describe('a node template, e.g. "Space/inset.node.json"'),
        tool: z.string().optional().describe("a node type id (when no path)"),
        paramsJson: z.string().optional().describe("param overrides as a JSON object string"),
        x: z.number().optional(),
        y: z.number().optional(),
      }),
      execute: wrap("import_node", async (a: { path?: string; tool?: string; paramsJson?: string; x?: number; y?: number }) => {
        let toolId = a.tool;
        let fileParams: Record<string, unknown> | undefined;
        if (a.path) {
          const f = await fetchNodeFile(a.path);
          toolId = f.tool;
          fileParams = f.params;
        }
        const def = toolId ? looseTool(toolId) : undefined;
        if (!toolId || !def) throw new Error(`unknown tool "${toolId ?? ""}" — pass a valid path or tool`);
        const overrides = parseParamsJson(a.paramsJson);
        const params = { ...(def.defaultParams ?? {}), ...(fileParams ?? {}), ...(overrides ?? {}) };
        const g = p.api.getFlow();
        const nodes = (Array.isArray(g.nodes) ? g.nodes.slice() : []) as SerializedFlowNode[];
        const count = nodes.filter((x) => x?.data?.tool === toolId).length + 1;
        const id = `${toolId}_${count}`;
        const position = { x: a.x ?? 120 + (nodes.length % 4) * 240, y: a.y ?? 120 + Math.floor(nodes.length / 4) * 160 };
        nodes.push({ id, position, data: { tool: toolId, params } });
        const applied = await p.api.applyFlow({ ...g, nodes });
        return { ok: true, nodeId: id, tool: toolId, applied };
      }),
    }),

    // ── WORKFLOW-FILE tools — full node+connection graphs under Workflows/. ──
    list_workflow_files: tool({
      description: "List saved WORKFLOW files (full node+connection graphs) under Workflows/ — folder-relative paths like \"Architectural/corridoor-generator.json\". Use before import_workflow.",
      inputSchema: z.object({}),
      execute: wrap("list_workflow_files", async () => {
        const all = await listLibraryFiles(LIB_WORKFLOWS);
        return { files: (all ?? []).filter((f) => f.toLowerCase().endsWith(".json")) };
      }),
    }),
    save_workflow_file: tool({
      description: "Save the CURRENT Flow graph (ALL nodes + connections) as a reusable WORKFLOW file at Workflows/<name>.json. Build + compile_flow the graph first. Dev only. Returns { ok, path, nodes }.",
      inputSchema: z.object({
        name: z.string().describe('file name, e.g. "site-massing" or "Architectural/site-massing" (.json appended)'),
        title: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: wrap("save_workflow_file", async (a: { name: string; title?: string; description?: string }) => {
        const g = p.api.getFlow();
        if (!Array.isArray(g.nodes) || g.nodes.length === 0) throw new Error("the flow is empty — build it first (replace_flow)");
        const name = a.name.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.json$/i, "");
        const rel = `${LIB_WORKFLOWS}/${name}.json`;
        const doc = { version: 1, title: a.title ?? name, ...(a.description ? { description: a.description } : {}), nodes: g.nodes, edges: g.edges ?? [] };
        const r = await saveLibraryFile(rel, `${JSON.stringify(doc, null, 2)}\n`);
        if (!r.ok) throw new Error(r.error ?? "save failed (library bridge is dev-only)");
        return { ok: true, path: r.path ?? rel, nodes: g.nodes.length };
      }),
    }),
    import_workflow: tool({
      description: "Load a saved WORKFLOW file (from list_workflow_files) and REPLACE the current graph with it. `path` is Workflows-relative, e.g. \"Architectural/corridoor-generator.json\".",
      inputSchema: z.object({ path: z.string() }),
      execute: wrap("import_workflow", async (a: { path: string }) => {
        const rel = a.path.replace(/^\/+/, "").replace(/\\/g, "/");
        const g = await fetchLibraryJson<{ nodes?: unknown[]; edges?: unknown[]; version?: number }>(`${LIB_WORKFLOWS}/${rel}`);
        if (!g) throw new Error(`workflow not found: ${rel}`);
        if (!Array.isArray(g.nodes)) throw new Error("not a workflow file (no nodes[])");
        const applied = await p.api.applyFlow(g);
        const check = validateFlowGraph(g as unknown as SerializedFlow);
        return { applied, ok: check.ok, errors: check.errors };
      }),
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
