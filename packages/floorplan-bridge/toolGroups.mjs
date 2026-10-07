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
  session: {
    summary: "The live editor link and what is on the canvas right now.",
    ops: { open: "open_editor", connect: "connect_editor", status: "editor_status", state: "get_state", selection: "get_selection", snapshot: "snapshot_canvas" },
  },
  step: {
    summary: "Stepwise runs: open a step, then hand it to the user with a checkpoint (blocks until they answer).",
    ops: { begin: "begin_step", checkpoint: "checkpoint", changes: "get_changes_since" },
  },
  library: {
    summary: "The shared R2 library (Designs/, Objects/, Materials/, Moodboards/, Skills/, Images/, Workflows/).",
    ops: {
      list: "list_library", search: "search_library", read: "read_file", write: "write_file",
      selection: "get_library_selection", select: "set_library_selection",
    },
  },
  skills: {
    summary: "Playbooks for multi-step jobs. Call op:list FIRST for anything beyond a single edit, then op:read the one that fits.",
    ops: { list: "list_skills", read: "read_skill" },
  },
  design: {
    summary: "Whole designs, JSON-first: load a complete plan at once, batch edits, export, render.",
    ops: {
      use: "use_design", create: "create_design", load: "load_design", get: "get_design", edit: "edit_design",
      render: "render_design", export: "export_plan", plan: "get_plan", apply_model: "apply_model", clear: "clear_canvas",
    },
  },
  draw: {
    summary: "Single canvas edits in METRES — for small touch-ups (use design.load / design.edit for bulk).",
    ops: {
      segment: "draw_segment", wall: "draw_wall", freehand: "draw_freehand", opening: "place_opening",
      style: "style_segments", delete: "delete_entities", spaces: "list_spaces", merge_spaces: "merge_spaces",
      fit_to_rect: "fit_plan_to_rect", tools: "list_draw_tools",
    },
  },
  layers: {
    summary: "Canvas layers.",
    ops: { list: "list_layers", create: "create_layer", move: "move_to_layer" },
  },
  objects: {
    summary: "Parametric objects: load the library, inspect, place on nodes, attach to segments / spaces.",
    ops: {
      import: "import_objects", list: "list_objects", get: "get_object", place: "place_object",
      attach_segment: "attach_segment_object", attach_space: "attach_space_object",
    },
  },
  workflow: {
    summary: "Saved flows under Workflows/ run as tools, by PATH: op:list → op:describe { path } → op:run { path, inputs, space_id? }. Plus the raw Flow graph ops for building new flows.",
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
    summary: "The editor's Chat box, driven by YOU instead of Gemini: op:wait blocks until the user sends a prompt (it carries their ticked Library selection), op:reply posts progress and the answer back into the chat. Loop: wait → work on the live canvas → reply { final: true } → wait.",
    ops: { wait: "chat_wait_prompt", reply: "chat_reply" },
  },
  moodboard: {
    summary: "Moodboard picks (Plan step 4): open the picker for the USER, then read what they saved.",
    ops: { open_picker: "open_moodboard_picker", get: "get_moodboards" },
  },
};

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
  for (const [g, def] of Object.entries(GROUPS)) {
    const ops = Object.entries(def.ops).filter(([, flat]) => schemaOf(flat));
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
    .filter(([, flat]) => byName.has(flat) || EXTRA_SCHEMAS[flat])
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
