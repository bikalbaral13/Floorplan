/** Headless DESIGN editing for the library MCP (`/api/mcp`) — draw walls, cut doors and windows, place
 *  furniture and spaces in a design saved in the R2 library, with no editor tab open.
 *
 *  Every tool is a pure edit of the STANDARD plan JSON (src/floorplan/planFormat.ts), written the same way
 *  tools/scribbleplan/plan.mjs writes plans the editor already opens: coordinates live once in `nodes`,
 *  segments and spaces name node ids, a door is a real gap (the wall split into wall · opening · wall with
 *  `isObjectOpening` on the middle piece), and a free-standing object hangs on a node that owns a degenerate
 *  marker segment so its attachments survive import. Objects are REFERENCED (objectId + objectPath + param
 *  overrides), never baked: the editor evaluates them when the design is opened.
 *
 *  ONE CALL, ONE READ, ONE WRITE. A serverless function keeps nothing between requests, so `edit_design`
 *  takes a whole list of ops and applies them to one load of the file. `settings.revision` is bumped on
 *  every save; pass `expectedRevision` to refuse a save when someone else wrote the file in between.
 *
 *  All tool coordinates are METRES; the file stores world pixels (metres × pixelsPerMeter). */

import { renderDesignSvg, svgToPng } from "./designRender.mjs";

const DEFAULT_PPM = 50;
const DEFAULT_LIBRARY = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";
const WALL_REF = { objectId: "wall-with-math", objectPath: "Objects/Architectural/wall.json" };
/** Params a hosted opening takes its host wall's thickness into — whichever the object declares. */
const DEPTH_PARAMS = ["frameDepth", "wallDepth", "trackDepth"];
const EPS = 1e-3;          // world px: two points closer than this are the same node
const MAX_OPS = 500;

/* ── tool schemas ───────────────────────────────────────────────────────────────────────────────────── */
const OPS_DOC = `Ops (all coordinates in METRES, y grows DOWN the page):
- {op:"wall", x1,y1,x2,y2, thicknessM?=0.15, heightM?=2.7, layer?="wall", label?} — a wall with the Wall object. It is split wherever it crosses or touches another wall and splits them in turn, so shared corners and T-junctions become real junctions and rooms close.
- {op:"line", x1,y1,x2,y2, layer?, label?, dashed?} — a plain line (no Wall object).
- {op:"opening", x,y, object, widthM?, flip?, params?} — cut a door/window (object "door", "window", "opening", "channel-gate" or any segment object) into the NEAREST wall at (x,y): the wall is split and the object fills the gap. Width defaults to the object's own.
- {op:"object", x,y, object, rotation?=0 (deg), params?, layer?, label?} — place a node object (bed, sofa, table, column, staircase, toilet …) at a point.
- {op:"space", points:[[x,y],…], label?, roomType?="room", object?="room", params?} — a named space polygon, with the Room object by default (object:null for none).
- {op:"attach", segments?:[ids] | all?:true, object, params?} — hang a segment object on existing segments without cutting them.
- {op:"delete", segments?, nodes?, spaces?} — remove by id (ids from get_design). Deleting a node removes its segments.
- {op:"layer", id?, name, color?, visible?, locked?} — create a layer (idempotent).
- {op:"move", x?,y? (metres), segments?, nodes?, spaces?} — translate the listed entities, or everything when no list is given.
- {op:"set", id, kind:"segment"|"node"|"space", fields?:{…}, params?:{…}, attachmentId?} — edit an entity's fields, or merge params into one of its attachments (the first non-wall one when attachmentId is omitted).`;

export const DESIGN_TOOLS = [
  {
    name: "create_design",
    description: "Start a NEW empty design (standard plan JSON) at `path` in the library, e.g. \"Designs/My House.json\". Then draw into it with edit_design. Refuses to replace an existing file unless overwrite is true. Open it in the editor at https://floorplan-indol.vercel.app/floorplan-editor (Library ▸ Designs).",
    inputSchema: { type: "object", properties: {
      path: { type: "string", description: "library-relative .json path, usually under Designs/" },
      pixelsPerMeter: { type: "number", description: "world pixels per metre (default 50)" },
      keywords: { type: "string" },
      overwrite: { type: "boolean", description: "replace an existing file (default false)" },
    }, required: ["path"] },
  },
  {
    name: "get_design",
    description: "Read a design as a compact summary in METRES: revision, bounds, layers, every segment (id, type, ends, thickness, objects on it), every node object (id, point, objects), every space (id, label, area, polygon). Use this before edit_design to find ids, and after it to check the result. `level` picks a floor in a multi-storey plan (default the first).",
    inputSchema: { type: "object", properties: {
      path: { type: "string" },
      level: { type: "string", description: "level id or name (multi-storey plans only)" },
    }, required: ["path"] },
  },
  {
    name: "edit_design",
    description: `Apply a list of drawing ops to a design in the library and save it — no editor tab needed. The ops run in order against one load of the file, so batch a whole step (a shell, a floor's doors, a room's furniture) into one call. Returns what each op created (ids) and the new revision. If any op fails, NOTHING is saved and the error names the op.\n\n${OPS_DOC}`,
    inputSchema: { type: "object", properties: {
      path: { type: "string" },
      ops: { type: "array", items: { type: "object" }, description: "ordered list of ops (see description)" },
      level: { type: "string", description: "level id or name (multi-storey plans only)" },
      expectedRevision: { type: "number", description: "refuse to save if the file's revision has moved on (someone else edited it)" },
      dryRun: { type: "boolean", description: "run the ops and report, but do not save" },
    }, required: ["path", "ops"] },
  },
  {
    name: "render_design",
    description: "Render a design to a PNG PREVIEW so you can SEE it — call after edit_design to check your work. Draws walls at their thickness, doors with leaf and swing, windows, spaces with label and area, and every placed object as a labelled footprint box (from its width/depth params, turned by rotation), plus overall dimensions and a scale bar. Objects are NOT evaluated, so it shows layout, not appearance. `save: true` also writes it next to the design as <name>.preview.png.",
    inputSchema: { type: "object", properties: {
      path: { type: "string" },
      level: { type: "string", description: "level id or name (multi-storey plans only)" },
      widthPx: { type: "number", description: "image width in pixels, 400–2400 (default 1200)" },
      save: { type: "boolean", description: "also save the PNG beside the design in the library (default false)" },
    }, required: ["path"] },
  },
  {
    name: "list_objects",
    description: "List the parametric objects a design can use (from Objects/ in the library): the name to pass as `object` in edit_design, and its folder. Pass `object` to get that one object's hostKind (segment = door/window/wall, node = furniture/columns, space = room/floor) and its editable params with defaults and options.",
    inputSchema: { type: "object", properties: {
      query: { type: "string", description: "filter by words in the name/path" },
      object: { type: "string", description: "one object to describe in full" },
    } },
  },
];

/* ── small helpers ──────────────────────────────────────────────────────────────────────────────────── */
const r4 = (v) => +Number(v).toFixed(4);
const num = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
};
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "layer";
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const newId = (prefix, taken) => {
  let i = taken.size + 1, id;
  do id = `${prefix}-${Math.random().toString(36).slice(2, 7)}${i++}`; while (taken.has(id));
  taken.add(id);
  return id;
};
const polygonArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
};

/* ── object catalog (R2 Objects/) ───────────────────────────────────────────────────────────────────── */
/** The catalog comes from the bucket LISTING only (one request); an object's file is read only when an op
 *  actually needs its params, and each file is read at most once per request. */
export function makeObjectResolver(store) {
  let keys = null;
  const files = new Map();
  const list = async () => keys ??= (await store.list("Objects/")).filter((k) => k.endsWith(".json"));
  const read = async (rel) => {
    if (!files.has(rel)) files.set(rel, store.get(rel).then((t) => JSON.parse(t)));
    return files.get(rel);
  };
  const describe = (rel, file) => {
    const ip = file.nodes?.find((n) => n.data?.tool === "input-props");
    const props = (ip?.data?.params?.props ?? []).filter((p) => p.id !== "P");
    return {
      path: rel, objectId: file.id, name: file.object?.name ?? file.title, symbol: file.object?.symbol,
      hostKind: file.object?.hostKind ?? "node", category: file.category,
      defaults: Object.fromEntries(props.map((p) => [p.id, p.value])),
      params: props.filter((p) => p.editable || p.necessary).map((p) => ({
        id: p.id, name: p.name, type: p.type, default: p.value,
        ...(p.options?.length ? { options: p.options } : {}),
        ...(p.type === "range" ? { min: p.min, max: p.max, step: p.step } : {}),
      })),
    };
  };
  /** "door", "Door", "door-with-math", "Architectural/door.json", "Objects/Structural/column.json" → object. */
  const resolve = async (ref) => {
    const want = String(ref ?? "").trim();
    if (!want) throw new Error("object is required");
    const all = await list();
    const norm = want.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^library\//, "");
    const lower = norm.toLowerCase().replace(/-with-math$/, "").replace(/\.json$/, "");
    const hit = all.find((k) => k.toLowerCase() === norm.toLowerCase() || k.toLowerCase() === `objects/${norm.toLowerCase()}`)
      ?? all.find((k) => k.toLowerCase().endsWith(`/${lower}.json`))
      ?? all.find((k) => k.toLowerCase().split("/").pop().replace(/\.json$/, "").replace(/[\s_.]+/g, "-") === lower.replace(/[\s_.]+/g, "-"));
    if (!hit) {
      const near = all.filter((k) => k.toLowerCase().includes(lower.split(/[-\s/]/)[0])).slice(0, 8).map((k) => k.replace(/^Objects\//, "").replace(/\.json$/, ""));
      throw new Error(`no object "${want}" in Objects/${near.length ? ` — did you mean ${near.join(", ")}?` : " (see list_objects)"}`);
    }
    return describe(hit, await read(hit));
  };
  return { list, resolve };
}

/* ── the plan document ──────────────────────────────────────────────────────────────────────────────── */
export function emptyPlan({ pixelsPerMeter = DEFAULT_PPM, keywords = "" } = {}) {
  const layer = (id, name, color, order) => ({ id, name, color, visible: true, locked: false, order });
  return {
    schemaVersion: 1,
    settings: { library_path: DEFAULT_LIBRARY, units: "m", northbearing: 0, pixelsPerMeter: pixelsPerMeter, keywords, revision: 0 },
    nodes: [], segments: [], spaces: [], moodboards: [],
    layers: [
      layer("0", "0", "#000000", 0), layer("wall", "Wall", "#1e293b", 1), layer("door", "Door", "#b91c1c", 2),
      layer("window", "Window", "#0e7490", 3), layer("space", "Space", "#16a34a", 4), layer("furniture", "Furniture", "#7c3aed", 5),
    ],
    imageUnderlay: null,
  };
}

/** The node/segment/space container ops act on: the plan itself, or one of `levels[]`. */
function pickLevel(plan, level) {
  if (!Array.isArray(plan.levels) || !plan.levels.length) {
    if (level !== undefined && level !== null && level !== "") throw new Error("this design has no levels");
    return plan;
  }
  if (level === undefined || level === null || level === "") return plan.levels[0];
  const want = String(level).toLowerCase();
  const hit = plan.levels.find((l) => String(l.id).toLowerCase() === want || String(l.name ?? "").toLowerCase() === want);
  if (!hit) throw new Error(`no level "${level}" — levels: ${plan.levels.map((l) => l.name ?? l.id).join(", ")}`);
  return hit;
}

/** Mutable view over one container, with the id sets and node lookup the ops need. */
class Doc {
  constructor(plan, container) {
    this.plan = plan;
    this.c = container;
    for (const k of ["nodes", "segments", "spaces"]) if (!Array.isArray(container[k])) container[k] = [];
    if (!Array.isArray(plan.layers)) plan.layers = [];
    this.ppm = Number(plan.settings?.pixelsPerMeter) || DEFAULT_PPM;
    const all = [...(plan.levels ?? []).flatMap((l) => [...(l.nodes ?? []), ...(l.segments ?? []), ...(l.spaces ?? [])]),
      ...plan.nodes ?? [], ...plan.segments ?? [], ...plan.spaces ?? []];
    this.ids = new Set(all.map((e) => e.id));
    this.attIds = new Set(all.flatMap((e) => (e.attachments ?? []).map((a) => a.id)));
  }
  get nodes() { return this.c.nodes; }
  get segments() { return this.c.segments; }
  get spaces() { return this.c.spaces; }
  px(m) { return r4(m * this.ppm); }
  m(px) { return r4(px / this.ppm); }
  node(id) { return this.nodes.find((n) => n.id === id); }
  /** The node at this world point, created on first use. */
  nodeAt(x, y) {
    const hit = this.nodes.find((n) => Math.abs(n.x - x) < EPS && Math.abs(n.y - y) < EPS);
    if (hit) return hit;
    const n = { id: newId("n", this.ids), x: r4(x), y: r4(y), layer: "0" };
    this.nodes.push(n);
    return n;
  }
  ends(seg) { return [this.node(seg.fromNodeId), this.node(seg.toNodeId)]; }
  attachment(ref, params = {}, extra = {}) {
    return { id: newId("att", this.attIds), objectId: ref.objectId, objectPath: ref.objectPath ?? ref.path, params, t: 0.5, flip: false, ...extra };
  }
  ensureLayer(id, name = id, color = "#64748b") {
    if (!id || this.plan.layers.some((l) => l.id === id)) return id;
    this.plan.layers.push({ id, name, color, visible: true, locked: false, order: this.plan.layers.length });
    return id;
  }
  /** Split `seg` at world point p (known to lie on it), returning [first, second]. Both keep every field
   *  and attachment; the second gets fresh ids. */
  split(seg, p) {
    const [a, b] = this.ends(seg);
    const mid = this.nodeAt(p.x, p.y);
    if (mid.id === a.id || mid.id === b.id) return [seg];
    const clone = JSON.parse(JSON.stringify(seg));
    clone.id = newId("seg", this.ids);
    clone.attachments = (clone.attachments ?? []).map((att) => ({ ...att, id: newId("att", this.attIds) }));
    seg.toNodeId = mid.id;
    clone.fromNodeId = mid.id;
    this.segments.splice(this.segments.indexOf(seg) + 1, 0, clone);
    return [seg, clone];
  }
  /** Drop nodes no segment or space uses any more. */
  gc() {
    const used = new Set([...this.segments.flatMap((s) => [s.fromNodeId, s.toNodeId]), ...this.spaces.flatMap((s) => s.nodeIds)]);
    this.c.nodes = this.nodes.filter((n) => used.has(n.id));
  }
}

/** Parameter along segment AB of the point closest to P, and that point. */
function project(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return { t, q: { x: a.x + t * dx, y: a.y + t * dy } };
}
/** Intersection of segments AB and CD as { t, u, p } (both in [0,1]), or null when parallel/apart. */
function intersect(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  const tol = 1e-7;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return { t, u, p: { x: a.x + t * r.x, y: a.y + t * r.y } };
}

/* ── ops ────────────────────────────────────────────────────────────────────────────────────────────── */
function segmentFields(doc, { kind, thicknessM, layer, label, dashed }) {
  if (kind === "line") {
    return { layer: doc.ensureLayer(layer ?? "0"), thickness: 1.5, color: "#334155", dashed: !!dashed, lineStyle: dashed ? "dashed" : "solid",
      mode: "line", method: "center", segmentType: "line", showLabel: false, ...(label ? { label } : {}) };
  }
  return { layer: doc.ensureLayer(layer ?? "wall", "Wall", "#1e293b"), thickness: doc.px(thicknessM), color: "#1e293b", dashed: false, lineStyle: "solid",
    mode: "fill", method: "center", segmentType: "line", bufferStyle: "flat", hatch: true, hatchStyle: "diagonal", hatchSpacing: 6,
    showLabel: false, ...(label ? { label } : {}) };
}

function opWall(doc, a, kind) {
  const A = { x: doc.px(num(a.x1, "x1")), y: doc.px(num(a.y1, "y1")) };
  const B = { x: doc.px(num(a.x2, "x2")), y: doc.px(num(a.y2, "y2")) };
  if (dist(A, B) < EPS) throw new Error("the two ends are the same point");
  const thicknessM = a.thicknessM === undefined ? 0.15 : num(a.thicknessM, "thicknessM");
  const heightM = a.heightM === undefined ? 2.7 : num(a.heightM, "heightM");

  // Where the new run meets existing segments: split THEM there, and remember the cut for the new run.
  const cuts = [0, 1];
  for (const seg of [...doc.segments]) {
    if (seg.fromNodeId === seg.toNodeId) continue;
    const [c, d] = doc.ends(seg);
    const hit = intersect(A, B, c, d);
    if (!hit) {
      // Collinear overlap is left alone (it would double the wall); a caller should not draw one twice.
      continue;
    }
    cuts.push(hit.t);
    if (hit.u > 1e-6 && hit.u < 1 - 1e-6) doc.split(seg, hit.p);
  }
  const stops = [...new Set(cuts.map((t) => Math.min(1, Math.max(0, t))))].sort((x, y) => x - y)
    .filter((t, i, arr) => i === 0 || (t - arr[i - 1]) * dist(A, B) > EPS);
  const created = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const p = { x: A.x + (B.x - A.x) * stops[i], y: A.y + (B.y - A.y) * stops[i] };
    const q = { x: A.x + (B.x - A.x) * stops[i + 1], y: A.y + (B.y - A.y) * stops[i + 1] };
    const seg = { id: newId("seg", doc.ids), fromNodeId: doc.nodeAt(p.x, p.y).id, toNodeId: doc.nodeAt(q.x, q.y).id,
      ...segmentFields(doc, { kind, thicknessM, layer: a.layer, label: a.label, dashed: a.dashed }) };
    if (kind === "wall") seg.attachments = [doc.attachment(WALL_REF, { thickness: r4(thicknessM), height: r4(heightM), mode: "Buffered", hatch: true, fitMode: "Fill segment" })];
    doc.segments.push(seg);
    created.push(seg.id);
  }
  return { segments: created };
}

async function opOpening(doc, a, objects) {
  const P = { x: doc.px(num(a.x, "x")), y: doc.px(num(a.y, "y")) };
  const obj = await objects.resolve(a.object);
  if (obj.hostKind !== "segment") throw new Error(`${obj.name} is a ${obj.hostKind} object — openings need a segment object (door, window, opening, channel-gate)`);
  // Nearest real wall piece that is not itself an opening.
  let best = null;
  for (const seg of doc.segments) {
    if (seg.fromNodeId === seg.toNodeId || seg.isObjectOpening || seg.segmentType === "line" && seg.mode === "line") continue;
    const [s, e] = doc.ends(seg);
    const { t, q } = project(s, e, P);
    const d = dist(q, P);
    if (!best || d < best.d) best = { seg, t, d, s, e };
  }
  if (!best) throw new Error("there is no wall to cut an opening into");
  const reach = Math.max(best.seg.thickness ?? 0, doc.px(0.5));
  if (best.d > reach) throw new Error(`no wall within ${doc.m(reach)} m of (${a.x}, ${a.y}) — the nearest is ${doc.m(best.d)} m away`);

  const L = dist(best.s, best.e);
  const widthM = a.widthM !== undefined ? num(a.widthM, "widthM") : Number(obj.defaults.width) || 0.9;
  const W = doc.px(widthM);
  if (W >= L - EPS) throw new Error(`a ${widthM} m opening does not fit a ${doc.m(L)} m wall piece`);
  // Keep the opening inside the piece: slide it along if it would run off an end.
  const centre = Math.min(L - W / 2, Math.max(W / 2, best.t * L));
  const at = (s) => ({ x: best.s.x + (best.e.x - best.s.x) * s / L, y: best.s.y + (best.e.y - best.s.y) * s / L });

  const [first, rest] = doc.split(best.seg, at(centre - W / 2));
  const gap = rest ?? first;
  const parts = doc.split(gap, at(centre + W / 2));
  const opening = parts[0];

  const depthM = doc.m(opening.thickness ?? doc.px(0.15));
  const params = { width: r4(widthM), fitMode: obj.defaults.fitMode ?? "Fill segment", ...Object.fromEntries(DEPTH_PARAMS.filter((k) => k in obj.defaults).map((k) => [k, r4(depthM)])), ...(a.params ?? {}) };
  opening.isObjectOpening = true;
  opening.layer = doc.ensureLayer(obj.symbol === "window" ? "window" : "door");
  if (a.label) opening.label = a.label;
  opening.attachments = [...(opening.attachments ?? []), doc.attachment({ objectId: obj.objectId, objectPath: obj.path }, params, { flip: !!a.flip })];
  return { opening: opening.id, object: obj.objectId, widthM: r4(widthM), wall: best.seg.id };
}

async function opObject(doc, a, objects) {
  const obj = await objects.resolve(a.object);
  if (obj.hostKind === "segment") throw new Error(`${obj.name} is a segment object — use op "opening" (doors/windows) or "attach"`);
  if (obj.hostKind === "space") throw new Error(`${obj.name} is a space object — pass it as "object" on a "space" op`);
  const n = doc.nodeAt(doc.px(num(a.x, "x")), doc.px(num(a.y, "y")));
  const layer = doc.ensureLayer(a.layer ?? slug(obj.symbol ?? obj.name), obj.name, "#7c3aed");
  const params = { ...(a.rotation !== undefined ? { rotation: num(a.rotation, "rotation") } : {}), ...(a.params ?? {}) };
  n.attachments = [...(n.attachments ?? []), doc.attachment({ objectId: obj.objectId, objectPath: obj.path }, params)];
  if (a.label) { n.label = a.label; n.showLabel = false; }
  n.type ??= "point";
  // A node's attachments survive import only if it ends a segment — give a lone node its marker.
  let marker = null;
  if (!doc.segments.some((s) => s.fromNodeId === n.id || s.toNodeId === n.id)) {
    marker = { id: newId("obj", doc.ids), fromNodeId: n.id, toNodeId: n.id, layer, thickness: 0.5, color: "#1e293b", dashed: false, mode: "line", method: "center", segmentType: "wall" };
    doc.segments.push(marker);
  }
  return { node: n.id, object: obj.objectId, attachment: n.attachments.at(-1).id, ...(marker ? { marker: marker.id } : {}) };
}

async function opSpace(doc, a, objects) {
  if (!Array.isArray(a.points) || a.points.length < 3) throw new Error("points needs at least 3 [x, y] pairs");
  const nodes = a.points.map((p, i) => {
    if (!Array.isArray(p) || p.length < 2) throw new Error(`points[${i}] must be [x, y]`);
    return doc.nodeAt(doc.px(num(p[0], `points[${i}][0]`)), doc.px(num(p[1], `points[${i}][1]`)));
  });
  const sp = { id: newId("space", doc.ids), nodeIds: nodes.map((n) => n.id), layer: doc.ensureLayer(a.layer ?? "space", "Space", "#16a34a"),
    label: a.label ?? `Space ${doc.spaces.length + 1}`, showLabel: true, roomType: a.roomType ?? "room",
    fill: a.fill ?? "rgba(148,163,184,0.25)", stroke: a.stroke ?? "#475569", fillOpacity: 0.18 };
  if (a.object !== null) {
    const obj = await objects.resolve(a.object ?? "room");
    if (obj.hostKind !== "space") throw new Error(`${obj.name} is a ${obj.hostKind} object, not a space object`);
    sp.attachments = [doc.attachment({ objectId: obj.objectId, objectPath: obj.path }, a.params ?? {})];
  }
  doc.spaces.push(sp);
  return { space: sp.id, areaM2: r4(polygonArea(nodes) / doc.ppm ** 2) };
}

async function opAttach(doc, a, objects) {
  const obj = await objects.resolve(a.object);
  if (obj.hostKind !== "segment") throw new Error(`${obj.name} is a ${obj.hostKind} object — attach takes segment objects`);
  const targets = a.all ? doc.segments.filter((s) => s.fromNodeId !== s.toNodeId && !s.isObjectOpening)
    : (a.segments ?? []).map((id) => doc.segments.find((s) => s.id === id) ?? (() => { throw new Error(`no segment ${id}`); })());
  let attached = 0, skipped = 0;
  for (const seg of targets) {
    if ((seg.attachments ?? []).some((x) => x.objectId === obj.objectId)) { skipped++; continue; }
    const params = { ...("thickness" in obj.defaults && seg.thickness ? { thickness: doc.m(seg.thickness) } : {}), ...(a.params ?? {}) };
    seg.attachments = [...(seg.attachments ?? []), doc.attachment({ objectId: obj.objectId, objectPath: obj.path }, params)];
    attached++;
  }
  return { attached, skipped };
}

function opDelete(doc, a) {
  const removed = [], missing = [];
  const kill = (list, ids, key) => {
    for (const id of ids ?? []) {
      const i = list.findIndex((e) => e.id === id);
      if (i < 0) missing.push(id); else { list.splice(i, 1); removed.push(id); }
    }
  };
  kill(doc.segments, a.segments);
  kill(doc.spaces, a.spaces);
  for (const id of a.nodes ?? []) {
    const i = doc.nodes.findIndex((n) => n.id === id);
    if (i < 0) { missing.push(id); continue; }
    doc.nodes.splice(i, 1); removed.push(id);
    for (let j = doc.segments.length - 1; j >= 0; j--) {
      const s = doc.segments[j];
      if (s.fromNodeId === id || s.toNodeId === id) { removed.push(s.id); doc.segments.splice(j, 1); }
    }
    for (const sp of doc.spaces) sp.nodeIds = sp.nodeIds.filter((n) => n !== id);
  }
  doc.gc();
  return { removed, missing };
}

function opLayer(doc, a) {
  if (!a.name && !a.id) throw new Error("name is required");
  const id = a.id ?? slug(a.name);
  const hit = doc.plan.layers.find((l) => l.id === id || l.name === a.name);
  if (hit) return { layer: hit.id, created: false };
  doc.plan.layers.push({ id, name: a.name ?? id, color: a.color ?? "#64748b", visible: a.visible !== false, locked: !!a.locked, order: doc.plan.layers.length });
  return { layer: id, created: true };
}

function opMove(doc, a) {
  const dx = doc.px(Number(a.x) || 0), dy = doc.px(Number(a.y) || 0);
  const any = a.segments || a.nodes || a.spaces;
  const ids = new Set(a.nodes ?? []);
  if (!any) doc.nodes.forEach((n) => ids.add(n.id));
  for (const id of a.segments ?? []) { const s = doc.segments.find((x) => x.id === id); if (!s) throw new Error(`no segment ${id}`); ids.add(s.fromNodeId); ids.add(s.toNodeId); }
  for (const id of a.spaces ?? []) { const s = doc.spaces.find((x) => x.id === id); if (!s) throw new Error(`no space ${id}`); s.nodeIds.forEach((n) => ids.add(n)); }
  for (const n of doc.nodes) if (ids.has(n.id)) { n.x = r4(n.x + dx); n.y = r4(n.y + dy); }
  return { moved: ids.size };
}

const FIXED = new Set(["id", "fromNodeId", "toNodeId", "nodeIds", "attachments", "x", "y"]);
function opSet(doc, a) {
  const list = { segment: doc.segments, node: doc.nodes, space: doc.spaces }[a.kind ?? "segment"];
  if (!list) throw new Error('kind must be "segment", "node" or "space"');
  const e = list.find((x) => x.id === a.id);
  if (!e) throw new Error(`no ${a.kind ?? "segment"} ${a.id}`);
  for (const [k, v] of Object.entries(a.fields ?? {})) {
    if (FIXED.has(k)) throw new Error(`field ${k} cannot be set here (use move / delete)`);
    e[k] = v;
  }
  if (a.params) {
    const atts = e.attachments ?? [];
    const att = a.attachmentId ? atts.find((x) => x.id === a.attachmentId) : atts.find((x) => x.objectId !== WALL_REF.objectId) ?? atts[0];
    if (!att) throw new Error(`${a.id} has no ${a.attachmentId ? `attachment ${a.attachmentId}` : "attachments"}`);
    att.params = { ...(att.params ?? {}), ...a.params };
    return { updated: e.id, attachment: att.id };
  }
  return { updated: e.id };
}

export async function applyOps(plan, ops, { level, objects }) {
  if (!Array.isArray(ops) || !ops.length) throw new Error("ops must be a non-empty array");
  if (ops.length > MAX_OPS) throw new Error(`at most ${MAX_OPS} ops per call`);
  const doc = new Doc(plan, pickLevel(plan, level));
  const results = [];
  for (const [i, a] of ops.entries()) {
    try {
      const op = a?.op;
      let r;
      if (op === "wall" || op === "line") r = opWall(doc, a, op);
      else if (op === "opening") r = await opOpening(doc, a, objects);
      else if (op === "object") r = await opObject(doc, a, objects);
      else if (op === "space") r = await opSpace(doc, a, objects);
      else if (op === "attach") r = await opAttach(doc, a, objects);
      else if (op === "delete") r = opDelete(doc, a);
      else if (op === "layer") r = opLayer(doc, a);
      else if (op === "move") r = opMove(doc, a);
      else if (op === "set") r = opSet(doc, a);
      else throw new Error(`unknown op "${op}" — wall, line, opening, object, space, attach, delete, layer, move, set`);
      results.push({ op, ...r });
    } catch (e) {
      throw new Error(`op ${i} (${a?.op ?? "?"}): ${e.message}`);
    }
  }
  // Node layer is DERIVED from its segments on export; keep it honest for readers of the raw file.
  for (const n of doc.nodes) {
    const segs = doc.segments.filter((s) => s.fromNodeId === n.id || s.toNodeId === n.id);
    n.layer = segs.length && segs.every((s) => s.layer === segs[0].layer) ? segs[0].layer : "0";
  }
  return results;
}

/** Compact metre summary of one container. */
export function summarize(plan, level) {
  const c = pickLevel(plan, level);
  const ppm = Number(plan.settings?.pixelsPerMeter) || DEFAULT_PPM;
  const m = (v) => r4(v / ppm);
  const byId = new Map((c.nodes ?? []).map((n) => [n.id, n]));
  const pt = (id) => { const n = byId.get(id); return n ? [m(n.x), m(n.y)] : null; };
  const objs = (e) => (e.attachments ?? []).map((a) => ({ id: a.id, object: a.objectId, ...(a.params && Object.keys(a.params).length ? { params: a.params } : {}) }));
  const nodes = c.nodes ?? [];
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  return {
    revision: plan.settings?.revision ?? 0,
    pixelsPerMeter: ppm,
    ...(plan.levels?.length ? { levels: plan.levels.map((l) => ({ id: l.id, name: l.name, elevation: l.elevation })), level: c.id } : {}),
    boundsM: nodes.length ? { minX: m(Math.min(...xs)), minY: m(Math.min(...ys)), maxX: m(Math.max(...xs)), maxY: m(Math.max(...ys)) } : null,
    counts: { nodes: nodes.length, segments: (c.segments ?? []).length, spaces: (c.spaces ?? []).length },
    layers: (plan.layers ?? []).map((l) => l.id),
    segments: (c.segments ?? []).filter((s) => s.fromNodeId !== s.toNodeId).map((s) => ({
      id: s.id, from: pt(s.fromNodeId), to: pt(s.toNodeId), layer: s.layer,
      ...(s.thickness ? { thicknessM: m(s.thickness) } : {}), ...(s.isObjectOpening ? { opening: true } : {}),
      ...(s.label ? { label: s.label } : {}), objects: objs(s),
    })),
    nodeObjects: nodes.filter((n) => n.attachments?.length).map((n) => ({ id: n.id, at: [m(n.x), m(n.y)], ...(n.label ? { label: n.label } : {}), objects: objs(n) })),
    spaces: (c.spaces ?? []).map((s) => {
      const pts = s.nodeIds.map((id) => byId.get(id)).filter(Boolean);
      return { id: s.id, label: s.label, roomType: s.roomType, areaM2: r4(polygonArea(pts) / ppm ** 2), polygon: pts.map((n) => [m(n.x), m(n.y)]), objects: objs(s) };
    }),
  };
}

/* ── tool dispatch ──────────────────────────────────────────────────────────────────────────────────── */
/** `store` is library-relative: get(rel) → text, put(rel, text), putBinary(rel, buf, mime), exists(rel),
 *  list(prefix) → rel paths. Returns a plain object the caller wraps as MCP content — or, when it carries
 *  `__content`, content already (render_design's image). */
export async function callDesignTool(store, name, args, user = "user") {
  const rel = (p) => {
    const s = String(p ?? "").trim();
    if (!s.toLowerCase().endsWith(".json")) throw new Error("a design path must end in .json");
    return s;
  };
  const load = async (p) => {
    let t;
    try { t = await store.get(p); } catch (e) {
      if (/404|NoSuchKey|Not Found|no such/i.test(String(e?.message))) throw new Error(`no such design: ${p} — create_design first`);
      throw e;
    }
    const plan = JSON.parse(t);
    if (!Array.isArray(plan.nodes) || !Array.isArray(plan.segments)) throw new Error(`${p} is not a standard plan (no nodes/segments)`);
    plan.settings ??= { units: "m", northbearing: 0, pixelsPerMeter: DEFAULT_PPM };
    return plan;
  };

  if (name === "create_design") {
    const p = rel(args.path);
    if (!args.overwrite && await store.exists(p)) throw new Error(`${p} already exists — pick a new name, or pass overwrite: true`);
    const plan = emptyPlan({ pixelsPerMeter: args.pixelsPerMeter ? num(args.pixelsPerMeter, "pixelsPerMeter") : DEFAULT_PPM, keywords: args.keywords ?? "" });
    plan.settings.editedBy = user;
    await store.put(p, JSON.stringify(plan, null, 1));
    return { ok: true, path: p, revision: 0, pixelsPerMeter: plan.settings.pixelsPerMeter };
  }
  if (name === "get_design") {
    const p = rel(args.path);
    return { path: p, ...summarize(await load(p), args.level) };
  }
  if (name === "edit_design") {
    const p = rel(args.path);
    const plan = await load(p);
    const rev = Number(plan.settings.revision) || 0;
    if (args.expectedRevision !== undefined && Number(args.expectedRevision) !== rev) {
      throw new Error(`revision conflict: the design is at revision ${rev}, you expected ${args.expectedRevision} — get_design again and redo the edit on top of it`);
    }
    const results = await applyOps(plan, args.ops, { level: args.level, objects: makeObjectResolver(store) });
    if (args.dryRun) return { ok: true, dryRun: true, path: p, revision: rev, results };
    plan.settings.revision = rev + 1;
    plan.settings.editedBy = user;
    plan.settings.editedAt = new Date().toISOString();
    // Re-check just before writing: a narrow window, but it catches the common "two agents, one file" case.
    const now = Number(JSON.parse(await store.get(p)).settings?.revision) || 0;
    if (now !== rev) throw new Error(`revision conflict: someone saved revision ${now} while this edit ran — get_design and redo it`);
    await store.put(p, JSON.stringify(plan, null, 1));
    const c = pickLevel(plan, args.level);
    return { ok: true, path: p, revision: rev + 1, results, counts: { nodes: c.nodes.length, segments: c.segments.length, spaces: c.spaces.length } };
  }
  if (name === "render_design") {
    const p = rel(args.path);
    const plan = await load(p);
    const c = pickLevel(plan, args.level);
    // Object DEFAULTS size the footprints (a bed placed with no params is still 2 m long): resolve each
    // distinct object once, by path and then by id. One that cannot be found draws at a 0.6 m square.
    const objects = makeObjectResolver(store);
    const atts = [...(c.nodes ?? []), ...(c.segments ?? [])].flatMap((e) => e.attachments ?? []);
    const refs = [...new Set(atts.map((a) => a.objectPath || a.objectId).filter(Boolean))];
    const byRef = new Map();
    await Promise.all(refs.map(async (r) => {
      try { byRef.set(r, (await objects.resolve(r)).defaults); } catch { /* unknown object: default box */ }
    }));
    const { svg, widthPx, heightPx, legend, boundsM } = renderDesignSvg(plan, {
      level: args.level, widthPx: args.widthPx,
      defaultsFor: (a) => byRef.get(a.objectPath || a.objectId),
      title: `${p.split("/").pop().replace(/\.json$/, "")} · revision ${plan.settings.revision ?? 0}`,
    });
    const png = Buffer.from(await svgToPng(svg));
    let saved;
    if (args.save) {
      saved = p.replace(/\.json$/i, ".preview.png");
      await store.putBinary(saved, png, "image/png");
    }
    return { __content: [
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: JSON.stringify({ path: p, revision: plan.settings.revision ?? 0, widthPx, heightPx, boundsM, drawn: legend, ...(saved ? { saved } : {}),
        note: "preview: objects are footprint boxes from their params, not evaluated geometry" }) },
    ] };
  }
  if (name === "list_objects") {
    const objects = makeObjectResolver(store);
    if (args.object) return await objects.resolve(args.object);
    const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const all = (await objects.list()).map((k) => k.replace(/^Objects\//, "").replace(/\.json$/, ""))
      .filter((k) => !/(^|\/)detect_/.test(k) && words.every((w) => k.toLowerCase().includes(w)));
    return { count: all.length, objects: all.map((k) => ({ object: k.split("/").pop(), folder: k.split("/").slice(0, -1).join("/") })),
      note: "pass `object` to see one object's hostKind and params" };
  }
  throw new Error(`unknown tool: ${name}`);
}
