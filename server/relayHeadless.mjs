/** Headless FALLBACK for the hosted relay (server/relayCore.mjs): when no editor tab is connected, the
 *  relay's canvas tools run against a design file in the R2 library instead of failing with
 *  EDITOR_NOT_CONNECTED — the same edits server/designMcp.mjs makes for `/api/mcp`.
 *
 *  WHICH FILE. A session has one `design` (Designs/<name>.json): the tab reports the Library design it has
 *  open (its live-sync link) with every poll, and the agent can set one with `use_design`. Nothing is
 *  guessed — with no design set, a fallback call says how to pick one.
 *
 *  ONLY WHEN NO TAB IS CONNECTED. A tab that is connected but slow keeps the ticket path: running a call
 *  headless while the tab may still take it would apply it twice. And when the tab comes back, a design it
 *  has open from the Library picks the headless edits up through live sync (src/floorplan/designLiveSync.ts).
 *
 *  Tab tools that have no headless form (flows, underlays, selection, checkpoints — anything that needs the
 *  live canvas or the user) say so plainly, and name the headless tools that can do the job instead. */

import { DESIGN_TOOLS, callDesignTool } from "./designMcp.mjs";
import { libraryMcpConfig, libraryStore } from "./libraryMcp.mjs";

const DESIGN_PATH = /^Designs\/[^\\]*\.json$/i;

export const USE_DESIGN_TOOL = {
  name: "use_design",
  description: "Pick the Library design (e.g. \"Designs/My House.json\") this session edits when NO editor tab is connected. While a tab is connected, canvas tools drive that tab; with none, they fall back to editing this file headlessly (walls, openings, objects, layers, delete, snapshot, export). A tab that has a Library design open sets it automatically. `create: true` makes an empty design if the file does not exist.",
  inputSchema: { type: "object", properties: {
    path: { type: "string", description: "Designs/<name>.json" },
    create: { type: "boolean", description: "create an empty design when the file is missing (default false)" },
  }, required: ["path"] },
};

export const LOAD_DESIGN_TOOL = {
  name: "load_design",
  description: "FASTEST way to draw: hand over a COMPLETE plan JSON (the standard format the editor's Import JSON / Export JSON use — nodes, segments, spaces, layers, settings; older walls/rooms exports work too). It is saved to `path` in the Library and, when an editor tab is connected, loaded into that tab in ONE step exactly as Import JSON would (objects resolved, scale restored) — and the tab then stays linked to the file, so later edit_design batches on it appear there live. With no tab connected it is only saved. Prefer this (or edit_design batches) over many draw_segment / place_object calls: build the whole plan as JSON, load it once, then check with snapshot_canvas.",
  inputSchema: { type: "object", properties: {
    path: { type: "string", description: "Designs/<name>.json" },
    design: { description: "the plan: a JSON object, or its text" },
    overwrite: { type: "boolean", description: "replace an existing file (default false) — read it first if it may hold work you want to keep" },
  }, required: ["path", "design"] },
};

/** Validate and save a whole plan JSON for load_design. Returns { path, text, replaced } or throws. */
export async function saveDesignJson(session, args, user = "relay") {
  const cfg = libraryMcpConfig();
  if (!cfg) throw new Error("library storage is not configured on this server");
  const path = String(args.path ?? "").trim().replace(/^library\//i, "");
  if (!validDesignPath(path)) throw new Error("path must look like Designs/<name>.json");
  let plan = args.design;
  if (typeof plan === "string") { try { plan = JSON.parse(plan); } catch (e) { throw new Error(`design is not valid JSON: ${e.message}`); } }
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("design must be a JSON object");
  const standard = Array.isArray(plan.nodes) || Array.isArray(plan.segments) || Array.isArray(plan.levels);
  if (!standard && !Array.isArray(plan.walls)) throw new Error("design is not a plan: expected nodes/segments/spaces (standard format) or walls (older export)");
  if (standard) {
    plan.settings = { ...(plan.settings ?? {}) };
    plan.settings.revision = (Number(plan.settings.revision) || 0) + 1;
    plan.settings.editedBy = user;
  }
  const store = libraryStore(cfg);
  const replaced = await store.exists(path);
  if (replaced && !args.overwrite) throw new Error(`${path} already exists — call again with overwrite: true to replace it, or pick a new name`);
  const text = JSON.stringify(plan);
  await store.put(path, text);
  session.design = path; session.designSetBy = "agent";
  return { path, text, replaced, counts: standard
    ? { nodes: plan.nodes?.length ?? 0, segments: plan.segments?.length ?? 0, spaces: plan.spaces?.length ?? 0, levels: plan.levels?.length ?? 0 }
    : { walls: plan.walls.length, rooms: plan.rooms?.length ?? 0 } };
}

/** The explicit headless tools the relay lists next to its canvas tools. `list_objects` is left out: the
 *  canvas tool of that name already exists and falls back to the same catalog. */
export const RELAY_HEADLESS_TOOLS = [USE_DESIGN_TOOL, LOAD_DESIGN_TOOL, ...DESIGN_TOOLS.filter((t) => t.name !== "list_objects")];
export const HEADLESS_TOOL_NAMES = new Set(RELAY_HEADLESS_TOOLS.map((t) => t.name).filter((n) => n !== "load_design"));

export const validDesignPath = (p) => typeof p === "string" && DESIGN_PATH.test(p) && !/(^|\/)\.\.(\/|$)/.test(p);

const text = (v) => ({ content: [{ type: "text", text: typeof v === "string" ? v : JSON.stringify(v) }] });
const errText = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });
const wrap = (r) => (r?.__content ? { content: r.__content } : text(r));

/** Canvas tool → one headless op (tool args are already METRES for these, so they map straight across). */
const TO_OP = {
  draw_wall: (a) => ({ op: "wall", x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, thicknessM: a.thicknessM ?? 0.1 }),
  draw_segment: (a) => {
    const type = String(a.type ?? "wall").toLowerCase();
    if (type === "wall") return { op: "wall", x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...(a.thicknessM !== undefined ? { thicknessM: a.thicknessM } : {}), ...(a.label ? { label: a.label } : {}) };
    if (type === "line") return { op: "line", x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...(a.label ? { label: a.label } : {}) };
    return null;                                                        // door/window segments: use place_opening
  },
  place_opening: (a) => ({ op: "opening", x: a.x, y: a.y, object: a.object, ...(a.widthM !== undefined ? { widthM: a.widthM } : {}), ...(a.flip ? { flip: true } : {}), ...(a.params ? { params: a.params } : {}) }),
  place_object: (a) => ({ op: "object", x: a.x, y: a.y, object: a.object, ...(a.rotation !== undefined ? { rotation: a.rotation } : {}), ...(a.params ? { params: a.params } : {}) }),
  delete_entities: (a) => ({ op: "delete", segments: a.segments ?? [], nodes: [...(a.objects ?? []), ...(a.furniture ?? [])] }),
  create_layer: (a) => ({ op: "layer", name: a.name, ...(a.id ? { id: a.id } : {}), ...(a.color ? { color: a.color } : {}), ...(a.visible !== undefined ? { visible: a.visible } : {}), ...(a.locked !== undefined ? { locked: a.locked } : {}) }),
  attach_segment_object: (a) => ({ op: "attach", object: a.object, ...(a.all ? { all: true } : { segments: a.ids ?? [] }), ...(a.params ? { params: a.params } : {}) }),
};

/** Tools that need the live canvas or the user; the reason is part of the error. */
const TAB_ONLY = {
  checkpoint: "a checkpoint hands the step to the USER in their open tab, and nobody is there — stop and tell the user the step is ready for review",
  get_selection: "a selection only exists in an open tab",
  merge_spaces: "merging auto-detected spaces needs the editor's room detection",
  list_spaces: "auto-detected rooms are computed by the editor — get_design lists the design's own spaces",
  get_changes_since: "the revision log lives in the tab — get_design returns the file's revision instead",
  apply_model: "apply_model takes the editor's in-memory model — use edit_design ops, or write_file for a whole plan",
};

function notConnected(extra = "") {
  return errText(`EDITOR_NOT_CONNECTED${extra ? `: ${extra}` : ""}. Either open https://floorplan-indol.vercel.app/floorplan-editor and click Connect Claude, or work headless: use_design picks a Library design, then canvas drawing tools (draw_segment, place_opening, place_object, delete_entities, snapshot_canvas …) or edit_design / render_design edit it directly.`);
}

/** Run `name` headless for a relay session. `session` is the relay's stored session object (mutated for
 *  use_design; the caller saves it). Returns an MCP tool result. */
export async function runHeadless(session, name, args, user = "relay") {
  const cfg = libraryMcpConfig();
  if (!cfg) return notConnected("and headless editing is not configured on this server (no library storage keys)");
  const store = libraryStore(cfg);
  const who = user;

  if (name === "use_design") {
    const p = String(args.path ?? "").trim();
    if (!validDesignPath(p)) return errText("path must be Designs/<name>.json");
    if (!(await store.exists(p))) {
      if (!args.create) return errText(`${p} does not exist — pass create: true to start it empty, or pick an existing design (list_library folder "Designs")`);
      await callDesignTool(store, "create_design", { path: p }, who);
    }
    session.design = p;
    session.designSetBy = "agent";
    return text({ ok: true, design: p, note: "With no editor tab connected, canvas tools now edit this file. Open it in the editor (Files ▸ Import from Library) to watch — it stays live." });
  }

  // The explicit design tools run as they do on /api/mcp; a path argument defaults to the session's design.
  if (HEADLESS_TOOL_NAMES.has(name)) {
    const a = { ...args, path: args.path ?? session.design };
    if (!a.path) return errText("no design given — pass path, or call use_design first");
    return wrap(await callDesignTool(store, name, a, who));
  }

  if (TAB_ONLY[name]) return notConnected(TAB_ONLY[name]);
  const p = session.design;
  const needDesign = () => notConnected("and this session has no design to edit headless — call use_design with a Designs/<name>.json path");

  if (name === "import_objects") return text({ ok: true, headless: true, note: "Headless edits resolve objects from the Library's Objects/ folder on demand — nothing to import." });
  if (name === "list_objects" || name === "list_draw_tools") return wrap(await callDesignTool(store, "list_objects", {}, who));
  if (name === "get_object") return wrap(await callDesignTool(store, "list_objects", { object: args.id }, who));
  if (!p) return needDesign();

  if (name === "get_state" || name === "get_plan") {
    const d = await callDesignTool(store, "get_design", { path: p }, who);
    return text(name === "get_state"
      ? { headless: true, design: p, revision: d.revision, pixelsPerMeter: d.pixelsPerMeter, counts: d.counts, boundsM: d.boundsM,
          note: "No editor tab is connected: tools edit this Library file directly. Coordinates here are METRES." }
      : { headless: true, design: p, units: "metres (not pixels: this is the headless summary, not serializeForAI)", ...d });
  }
  if (name === "snapshot_canvas") return wrap(await callDesignTool(store, "render_design", { path: p }, who));
  if (name === "export_plan") return text(await store.get(p));
  if (name === "clear_canvas") {
    const cur = JSON.parse(await store.get(p));
    await callDesignTool(store, "create_design", { path: p, overwrite: true, pixelsPerMeter: cur.settings?.pixelsPerMeter }, who);
    return text({ ok: true, headless: true, design: p, cleared: true });
  }
  if (TO_OP[name]) {
    const op = TO_OP[name](args);
    if (!op) return notConnected(`draw_segment type "${args.type}" has no headless form — cut doors and windows with place_opening`);
    const r = await callDesignTool(store, "edit_design", { path: p, ops: [op] }, who);
    return text({ ...r.results[0], headless: true, design: p, revision: r.revision });
  }
  return notConnected(`${name} needs the live editor canvas`);
}
