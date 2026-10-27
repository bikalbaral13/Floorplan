// The GROUPED MCP surface: ~12 tools, each with an `op`, instead of one tool per command.
//
// Shared by the hosted library connector (server/libraryMcp.mjs), the hosted relay (server/relayCore.mjs) and
// the local stdio bridge (floorplan-bridge.mjs). Nothing below the MCP surface changes: a grouped call
// `objects { op: "place", ... }` is turned back into the flat command `place_object { ... }` and runs exactly
// as before — same handlers, same step gate, same timeouts. The flat names stay callable (hidden aliases), so
// skills written against them keep working; they are just no longer LISTED.
//
// GROWTH RULES
//   · new content (a workflow, an object, a skill, a material) is library data — never a new tool or op;
//   · a new command in an existing area is a new entry in that group's `ops` — not a new tool;
//   · a new group only for a genuinely new area, or when a group passes ~15 ops (then split it).
// Zero dependencies.

/** group → { summary, ops: { op → flat command name } }. Order is the order tools are listed in. */
export const GROUPS = {
  viewer: {
    summary: "The R2 HTML viewer — RETIRED (its files were removed from R2; hidden from the list). Use session.open: the live editor.",
    ops: { open: "viewer_open", show: "viewer_show", snapshot: "viewer_snapshot", events: "viewer_events", form: "viewer_form" },
  },
  session: {
    summary: "START HERE. op:open → a one-time link to the live BuilderPluss editor, already connected to you (no code to type): give it to the user; everything they see and do happens there. op:status / state / selection / snapshot read it.",
    ops: { open: "open_editor", connect: "connect_editor", status: "editor_status", state: "get_state", selection: "get_selection", snapshot: "snapshot_canvas", doctor: "session_doctor" },
  },
  step: {
    summary: "Stepwise runs: open a step, then hand it to the user with a checkpoint (blocks until they answer).",
    ops: { begin: "begin_step", checkpoint: "checkpoint", changes: "get_changes_since" },
  },
  library: {
    summary: "The R2 bucket: library/ = reusable Objects/, Materials/, Pipelines/; Projects/<CODE>/ = everything one project uploads or produces (inputs/, <n-phase>/<pipeline>/ steps + output, shared/canvas.json, media/). If you can reach R2 directly (local keys, tools/r2.mjs), read and write there instead — this is for clients that only have the connector.",
    ops: {
      list: "list_library", search: "search_library", read: "read_file", write: "write_file",
      selection: "get_library_selection", select: "set_library_selection",
    },
  },
  skills: {
    summary: "Playbooks under library/Skills/ — RETIRED (the folder was removed; hidden from the list). The journeys are in AGENT.md §5 and each pipeline's AGENTS.md.",
    ops: { list: "list_skills", read: "read_skill" },
  },
  design: {
    summary: "Whole canvases, JSON-first: load a complete plan at once (by path — Projects/<CODE>/shared/canvas.json, or a pipeline output such as Projects/<CODE>/3-build/build-from-deck/output/<CODE>.room.canvas.json), batch edits, export, render.",
    ops: {
      use: "use_design", create: "create_design", load: "load_design", get: "get_design", edit: "edit_design",
      render: "render_design", export: "export_plan", plan: "get_plan", apply_model: "apply_model", clear: "clear_canvas",
    },
  },
  draw: {
    summary: "Plan-level operations the editor computes (spaces, merges, fit). Draw by writing the plan JSON — design.load / design.edit — not here.",
    ops: {
      segment: "draw_segment", wall: "draw_wall", freehand: "draw_freehand", opening: "place_opening",
      style: "style_segments", delete: "delete_entities", spaces: "list_spaces", merge_spaces: "merge_spaces",
      fit_to_rect: "fit_plan_to_rect", tools: "list_draw_tools",
    },
  },
  view: {
    summary: "What the live editor shows: op:mode switches the Views panel (plan / 3d / both / elevations / layout); op:layers shows, hides or isolates layers and display items (grid, spaces, dimensions…). Use for 'show it in 3D', 'hide the Dimension layer', 'show only the furniture layer'.",
    ops: { mode: "set_view_mode", layers: "set_layer_visibility" },
  },
  layers: {
    summary: "Canvas layers.",
    ops: { list: "list_layers", create: "create_layer", move: "move_to_layer" },
  },
  objects: {
    summary: "Parametric objects: load the library and look one up (op:list { object } = its params, compact). Place / attach them with design.edit { op:\"object\" | \"attach\" }.",
    ops: {
      import: "import_objects", list: "list_objects", get: "get_object", place: "place_object",
      attach_segment: "attach_segment_object", attach_space: "attach_space_object",
    },
  },
  workflow: {
    summary: "Saved flows under library/Workflows/ — RETIRED (the folder was removed; hidden from the list).",
    ops: {
      list: "list_workflows", describe: "describe_workflow", run: "run_workflow",
      catalog: "flow_node_catalog", get: "get_flow", compile: "compile_flow", apply: "flow_apply", commit: "flow_commit",
    },
  },
  underlay: {
    summary: "Reference image under the plan: place, align, vectorise.",
    ops: { set: "set_image_underlay", align: "align_underlay", analyze: "analyze_underlay" },
  },
  chat: {
    summary: "The editor's Chat box, driven by YOU instead of Gemini: op:wait blocks until the user sends a prompt (it carries their ticked Library selection), op:reply posts progress and the answer back into the chat, op:ask puts a question (with optional option chips) to the user IN the chat and waits for the answer. The user cannot see your terminal: ask every question with op:ask, never in the terminal. Loop: wait → work on the live canvas (ask when needed) → reply { final: true } → wait.",
    ops: { wait: "chat_wait_prompt", reply: "chat_reply", ask: "chat_ask" },
  },
  pipeline: {
    summary: "Pipeline runs with their OWN UI: op:run opens the pipeline's app (e.g. space-brief) as a full tab in the editor; fill 'claude' steps with op:patch (live, small patches), wait for the user with op:events { wait: true }, op:advance once they approved. The user approves gates in the app — never approve for them.",
    ops: { run: "pipeline_run", status: "pipeline_status", state: "pipeline_state", patch: "pipeline_patch", events: "pipeline_events", advance: "pipeline_advance" },
  },
  project: {
    summary: "Projects from start to finish: op:create a project (ask the USER for code + title first), op:status where it stands (inputs, phases, runner jobs), op:list all projects, op:job queues one script stage of a pipeline for the runner, op:jobs polls it. With pipeline.run the user uploads and answers in the pipeline's app; read library/AGENT.md §5 for the whole journey.",
    ops: { create: "project_create", status: "project_status", list: "project_list", job: "project_job", jobs: "project_jobs", upload_link: "project_upload_link", import: "project_import" },
  },
  app: {
    summary: "When something needs the EDITOR APP's code (not R2 files): op:request writes the problem, evidence and proposal to library/Requests/ for the developer; op:requests lists the open ones. Run session.doctor first — most problems are setup (CORS, token, runner), fixed without code.",
    ops: { request: "app_request", requests: "app_requests" },
  },
  pipelines: {
    summary: "Make NEW pipelines with their own UI in the R2 library, no app rebuild: op:create writes the pipeline folder, its UI (index.html + files) and run steps and registers it — the editor then opens the UI as a tab (pipeline.run). op:update makes a preview version, op:release (only after the user approves) makes it stable, op:rollback goes back. The UI talks to the editor through window.pipeline (db, assets.upload, read, list, job, emit — docs/pipeline-ui-spec.md); a run keeps its files in Projects/<CODE>/<n-phase>/<id>/.",
    ops: { list: "pipeline_list", create: "pipeline_create", update: "pipeline_update", release: "pipeline_release", rollback: "pipeline_rollback" },
  },
  moodboard: {
    summary: "Moodboard picks: a moodboard/1 board saved in the project (Projects/<CODE>/inputs/moodboards/<name>.json, library.write); op:open_picker shows it to the USER in the editor (the Project panel's project), op:get reads what they saved on the plan. Never pick for them.",
    ops: { open_picker: "open_moodboard_picker", get: "get_moodboards" },
  },
};

/** FILE-FIRST: ops that edit the canvas piece by piece (or dump huge catalogs) are no longer LISTED — a plan
 *  is built as a JSON file and shown with design.load (by path) or changed with one design.edit batch, which
 *  covers walls, openings, objects, spaces, attach, delete, layers and moves. They stay CALLABLE (grouped and
 *  flat), so older skills keep working. MCP_FULL_TOOLS=1 lists them again (rollback). A group whose every op
 *  is hidden (layers) drops out of the list. */
/** Groups whose R2 folders were removed (2026-10-15: library/ is Objects, Materials, Pipelines only): not LISTED,
 *  still callable so an old prompt gets a clear answer. MCP_FULL_TOOLS=1 lists them again. */
export const HIDDEN_GROUPS = new Set(["viewer", "skills", "workflow"]);
/** Listing order: what a chat needs first. Groups not named here follow in GROUPS order. */
const ORDER = ["session", "project", "pipeline", "design", "view", "objects", "library", "chat", "step", "underlay", "moodboard", "pipelines", "app"];

export const HIDDEN_OPS = {
  draw: ["segment", "wall", "freehand", "opening", "style", "delete", "tools"],   // tools = the ~360 KB schema dump; objects.list { object } gives one object's params
  objects: ["place", "attach_segment", "attach_space"],
  layers: ["list", "create", "move"],                                            // design.get lists layers; design.edit { op:"layer" } creates them
};
const SHOW_ALL = /^(1|true|yes)$/i.test(String(globalThis.process?.env?.MCP_FULL_TOOLS ?? ""));
const isHidden = (g, op) => !SHOW_ALL && (HIDDEN_OPS[g] ?? []).includes(op);

/** Tools that stay flat: the relay protocol itself depends on the exact name. */
export const FLAT_ALWAYS = new Set(["await_result"]);

/** Ops the grouped surface adds that have no flat tool of their own (their schemas live here). */
export const EXTRA_SCHEMAS = {
  list_workflows: { type: "object", properties: {} },
  describe_workflow: { type: "object", properties: { path: { type: "string", description: "flow path under Workflows/, e.g. \"Operations/double_inset\"" } }, required: ["path"] },
  run_workflow: { type: "object", properties: {
    path: { type: "string", description: "flow path under Workflows/, e.g. \"Architectural/floorplan.v5\"" },
    inputs: { type: "object", description: "input values keyed by name (op:describe lists them); unspecified keep their defaults" },
    space_id: { type: "string", description: "run on this canvas space; the result is LINKED to it (re-runs when its controls change)" },
    outline: { type: "array", items: { type: "array", items: { type: "number" } }, description: "[[x,y],…] metres, for flows with a Polygon input and no space" },
    preview: { type: "boolean", description: "preview only, commit nothing (default false: commits)" },
  }, required: ["path"] },
};

const OP_TO_FLAT = new Map();       // "objects.place" → "place_object"
const FLAT_TO_GROUP = new Map();    // "place_object" → ["objects", "place"]
for (const [g, def] of Object.entries(GROUPS)) for (const [op, flat] of Object.entries(def.ops)) { OP_TO_FLAT.set(`${g}.${op}`, flat); FLAT_TO_GROUP.set(flat, [g, op]); }
export const isGroupTool = (name) => Object.prototype.hasOwnProperty.call(GROUPS, name);

/** The grouped tool list, built from the flat schemas actually available on this server. Groups (and ops)
 *  whose flat command this server lacks are left out, so each server lists only what it can run. */
export function groupedTools(flatTools) {
  const byName = new Map(flatTools.map((t) => [t.name, t]));
  const schemaOf = (flat) => byName.get(flat)?.inputSchema ?? EXTRA_SCHEMAS[flat];
  const out = [];
  const rank = (g) => { const i = ORDER.indexOf(g); return i < 0 ? ORDER.length : i; };
  const entries = Object.entries(GROUPS).sort((a, b) => rank(a[0]) - rank(b[0]));
  for (const [g, def] of entries) {
    if (!SHOW_ALL && HIDDEN_GROUPS.has(g)) continue;
    const ops = Object.entries(def.ops).filter(([op, flat]) => schemaOf(flat) && !isHidden(g, op));
    if (!ops.length) continue;
    // Union of every op's properties, so a client that validates arguments lets each op's fields through.
    const properties = { op: { type: "string", enum: [...ops.map(([op]) => op), "describe_ops"], description: "which action; describe_ops returns every op's description and arguments" } };
    for (const [, flat] of ops) for (const [k, v] of Object.entries(schemaOf(flat).properties ?? {})) if (!(k in properties)) properties[k] = v;
    const lines = ops.map(([op, flat]) => {
      const d = byName.get(flat)?.description ?? EXTRA_DESCRIPTIONS[flat] ?? "";
      const req = schemaOf(flat).required ?? [];
      return `· ${op}${req.length ? ` (${req.join(", ")})` : ""} — ${firstSentence(d)}`;
    });
    out.push({ name: g, description: `${def.summary}\n${lines.join("\n")}\nCall op:"describe_ops" for full arguments.`, inputSchema: { type: "object", properties, required: ["op"] } });
  }
  for (const t of flatTools) if (FLAT_ALWAYS.has(t.name)) out.push(t);
  return out;
}

const EXTRA_DESCRIPTIONS = {
  list_workflows: "Every saved flow under Workflows/, by path; `featured` ones also have a wf_* tool.",
  describe_workflow: "A workflow's inputs (name, type, default, range), Polygon inputs, and what it reads from the canvas.",
  run_workflow: "Run any saved flow in the open editor tab by path; commits unless preview:true, and links to space_id.",
};
/** Up to the first full stop that ends a sentence (not "e.g." / "i.e." / a decimal), capped at 220 chars. */
const firstSentence = (d) => {
  const s = String(d).replace(/\s+/g, " ").trim().replace(/\b(e\.g|i\.e|etc|vs)\./g, "$1․");
  const m = /^(.{20,220}?[.!?])(\s|$)/.exec(s);
  return (m ? m[1] : s.slice(0, 220)).replace(/․/g, ".");
};

/** describe_ops: full description + schema of each op in a group. */
export function describeOps(group, flatTools) {
  const byName = new Map(flatTools.map((t) => [t.name, t]));
  const def = GROUPS[group];
  return { group, summary: def.summary, ops: Object.fromEntries(Object.entries(def.ops)
    .filter(([op, flat]) => (byName.has(flat) || EXTRA_SCHEMAS[flat]) && !isHidden(group, op))
    .map(([op, flat]) => [op, { description: byName.get(flat)?.description ?? EXTRA_DESCRIPTIONS[flat], arguments: byName.get(flat)?.inputSchema ?? EXTRA_SCHEMAS[flat] }])) };
}

/** A tools/call → the flat command it means. Returns { name, args } (flat), { describe: group }, or { error }.
 *  A flat name passes straight through (the hidden alias). */
export function resolveCall(name, args = {}) {
  if (!isGroupTool(name)) return { name, args };
  const { op, ...rest } = args ?? {};
  if (op === "describe_ops" || op === undefined) return op === undefined
    ? { error: `${name} needs an \`op\`: ${Object.keys(GROUPS[name].ops).join(", ")} (or describe_ops)` }
    : { describe: name };
  const flat = OP_TO_FLAT.get(`${name}.${op}`);
  if (!flat) {
    const near = Object.keys(GROUPS[name].ops).find((o) => o.startsWith(String(op).slice(0, 3)));
    const other = [...OP_TO_FLAT.keys()].find((k) => k.endsWith(`.${op}`));
    return { error: `${name} has no op "${op}" — ops: ${Object.keys(GROUPS[name].ops).join(", ")}${near ? `. Did you mean "${near}"?` : ""}${other ? ` ("${op}" is an op of ${other.split(".")[0]})` : ""}` };
  }
  return { name: flat, args: rest };
}

/** "place_object" → "objects.place" (for hints in error messages). */
export const groupedNameOf = (flat) => { const g = FLAT_TO_GROUP.get(flat); return g ? `${g[0]} { op: "${g[1]}" }` : flat; };
