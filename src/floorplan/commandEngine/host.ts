// Editor host for the Command Engine: builds the engine's view of the live plan (EngineContext) and runs
// the tool calls it returns. Agent tools (draw_segment, place_opening, place_object …) go through the SAME
// AgentToolApi Claude's calls use; the handful of edits that API lacks (move / rotate / params / rename …)
// are done here directly on the model, each as one undoable history step.
import { isAutoRoom } from "@builderpluss/engine";
import { lexScore, type EngineContext, type Targets, type ToolCall } from "../../../packages/command-engine/src";
import type { AgentToolApi } from "../ai/agentChat";
import type { FloorPlanModel, Room, Wall } from "../types";

type ViewMode = "2d" | "3d" | "both";

export interface CommandHostDeps {
  getState: () => FloorPlanModel;
  setState: (next: FloorPlanModel) => void;
  ppm: () => number;
  /** Visible spaces, auto-detected included. */
  rooms: () => Room[];
  selection: () => { ids: string[]; nodeKey: string | null };
  setSelection: (ids: string[]) => void;
  api: () => AgentToolApi | null;
  setView: (mode: ViewMode) => void;
  levels: () => { id: string; name: string }[];
  activeLevelId: () => string | null;
  switchLevel: (id: string) => void;
  undo: () => void;
  redo: () => void;
  listDesigns: () => Promise<string[]>;
  loadDesign: (path: string) => Promise<boolean>;
  /** Resolve after React has re-rendered, so the next call reads fresh state. */
  settle: () => Promise<void>;
}

const NODE_KEY = (wallId: string) => [`${wallId}:start`, `${wallId}:end`].sort().join("|");
const isMarker = (w: Wall) => w.start.x === w.end.x && w.start.y === w.end.y;
const labelOf = (r: Room, i: number) => r.label || `Space${String(i + 1).padStart(3, "0")}`;

function pointInPoly(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The engine's view of the plan. */
export function buildContext(d: CommandHostDeps): EngineContext {
  const s = d.getState();
  const ppm = d.ppm();
  const rooms = d.rooms();
  const sel = d.selection();
  const selection: NonNullable<EngineContext["selection"]> = [];
  for (const id of sel.ids) {
    const w = s.walls.find((x) => x.id === id);
    if (w) { selection.push({ kind: isMarker(w) ? "object" : "segment", id, midM: { x: (w.start.x + w.end.x) / 2 / ppm, y: (w.start.y + w.end.y) / 2 / ppm } } as never); continue; }
    const ri = rooms.findIndex((r) => r.id === id);
    if (ri >= 0) { selection.push({ kind: "space", id, label: labelOf(rooms[ri], ri) }); continue; }
    selection.push({ kind: "object", id });
  }
  if (sel.nodeKey) selection.push({ kind: "node", id: sel.nodeKey });
  return {
    ppm,
    spaces: rooms.map((r, i) => ({ id: r.id, label: labelOf(r, i), roomType: r.roomType, pointsPx: r.points })),
    selection,
    layers: (s.layers ?? []).map((l) => ({ id: l.id, name: l.name, visible: l.visible, group: (l as { group?: string }).group })),
    objects: Object.values(s.objectLibrary ?? {}).map((o) => ({ id: o.meta.id, name: o.meta.name, hostKind: o.hostKind ?? "node", symbol: o.meta.symbol, category: o.meta.category })),
    levels: d.levels(),
    activeLevelId: d.activeLevelId() ?? undefined,
  };
}

/** A placed node object: its zero-length marker wall + the nodeMeta attachment that carries it. */
interface Instance { wall: Wall; key: string; attIndex: number; objectId: string }

function instances(s: FloorPlanModel): Instance[] {
  const out: Instance[] = [];
  const meta = s.nodeMeta ?? {};
  for (const w of s.walls) {
    if (!isMarker(w)) continue;
    const key = NODE_KEY(w.id);
    (meta[key]?.attachments ?? []).forEach((a, attIndex) => out.push({ wall: w, key, attIndex, objectId: a.objectId }));
  }
  return out;
}

/** Walls carrying a door / window attachment. */
function openings(s: FloorPlanModel, kind?: string): Wall[] {
  const lib = s.objectLibrary ?? {};
  return s.walls.filter((w) => (w.attachments ?? []).some((a) => {
    const sym = lib[a.objectId]?.meta.symbol;
    return (sym === "door" || sym === "window") && (!kind || sym === kind);
  }));
}

interface Resolved { instances: Instance[]; walls: Wall[]; rooms: Room[] }

function resolveTargets(d: CommandHostDeps, t: Targets): Resolved {
  const s = d.getState();
  const all = instances(s);
  const rooms = d.rooms();
  if (t.selection) {
    const { ids, nodeKey } = d.selection();
    const idset = new Set(ids);
    return {
      instances: all.filter((i) => idset.has(i.wall.id) || i.key === nodeKey),
      walls: s.walls.filter((w) => idset.has(w.id) && !isMarker(w)),
      rooms: rooms.filter((r) => idset.has(r.id)),
    };
  }
  if (t.all && !t.objectId) {
    if (t.kind === "door" || t.kind === "window") return { instances: [], walls: openings(s, t.kind), rooms: [] };
    if (t.kind === "wall") return { instances: [], walls: s.walls.filter((w) => !isMarker(w) && (w.segmentType ?? "wall") === "wall"), rooms: [] };
    return { instances: all, walls: [], rooms: [] };
  }
  if (t.objectId) {
    let list = all.filter((i) => i.objectId === t.objectId);
    const room = t.spaceId ? rooms.find((r) => r.id === t.spaceId) : undefined;
    if (room) list = list.filter((i) => pointInPoly(i.wall.start, room.points));
    // "the bed" means one; "all beds" means every one. With several and no room named, prefer the selection.
    if (!t.all && list.length > 1) {
      const { ids } = d.selection();
      const picked = list.filter((i) => ids.includes(i.wall.id));
      list = picked.length ? picked : list.slice(0, 1);
    }
    return { instances: list, walls: [], rooms: [] };
  }
  if (t.spaceId) return { instances: [], walls: [], rooms: rooms.filter((r) => r.id === t.spaceId) };
  return { instances: [], walls: [], rooms: [] };
}

const nothing = (t: Targets) => { throw new Error(t.selection ? "nothing is selected" : `nothing on the canvas matches ${t.objectName ?? t.spaceLabel ?? t.kind ?? "that"}`); };

/** Map a requested param ("width") onto the object's own param key ("bedWidth", "w" …). */
function paramKey(s: FloorPlanModel, objectId: string, want: string): string | null {
  const ps = s.objectLibrary?.[objectId]?.parameters ?? [];
  const k = want.toLowerCase();
  const exact = ps.find((p) => p.key.toLowerCase() === k);
  if (exact) return exact.key;
  const alias: Record<string, string[]> = { width: ["w", "wid"], length: ["len", "l", "depth"], depth: ["d", "length"], height: ["h", "ht"], color: ["colour", "fill", "finish"] };
  const hit = ps.find((p) => p.key.toLowerCase().includes(k) || (alias[k] ?? []).includes(p.key.toLowerCase()) || (p.label ?? "").toLowerCase().includes(k));
  return hit?.key ?? null;
}

function editInstances(s: FloorPlanModel, list: Instance[], fn: (params: Record<string, unknown>, objectId: string) => { params: Record<string, unknown>; objectId?: string }): FloorPlanModel {
  const meta = { ...(s.nodeMeta ?? {}) };
  for (const inst of list) {
    const cur = meta[inst.key];
    if (!cur?.attachments) continue;
    const atts = cur.attachments.map((a, i) => {
      if (i !== inst.attIndex) return a;
      const r = fn({ ...(a.params ?? {}) }, a.objectId);
      return { ...a, params: r.params as typeof a.params, ...(r.objectId ? { objectId: r.objectId } : {}) };
    });
    meta[inst.key] = { ...cur, attachments: atts };
  }
  return { ...s, nodeMeta: meta };
}

/** Run one tool call. Returns what the chat should report. */
export async function executeCall(d: CommandHostDeps, call: ToolCall): Promise<unknown> {
  const a = call.args;
  const api = d.api();
  const needApi = (): AgentToolApi => { if (!api) throw new Error("the editor is still loading"); return api; };
  const s = d.getState();
  const ppm = d.ppm();
  switch (call.tool) {
    // ── Through the shared agent API (identical to Claude's calls) ──
    case "draw_segment": return needApi().drawSegment(a);
    case "place_opening": return needApi().placeOpening(a);
    case "place_object": return needApi().placeObject(a);
    case "merge_spaces": return needApi().mergeSpaces(a);
    case "create_layer": return needApi().createLayer(a);
    case "move_to_layer": return needApi().moveToLayer(a);
    case "clear_canvas": return needApi().clearCanvas();
    case "attach_space_object": return needApi().attachSpaceObject(a);
    case "list_spaces": return needApi().listSpaces();

    // ── Editor-local ──
    case "history": {
      const n = Math.max(1, Number(a.count) || 1);
      for (let i = 0; i < n; i++) { (a.op === "redo" ? d.redo : d.undo)(); await d.settle(); }
      return { [String(a.op)]: n };
    }
    case "set_view": d.setView(a.mode as ViewMode); return { view: a.mode };
    case "set_level": d.switchLevel(String(a.id)); return { level: a.id };
    case "set_layer_visibility": {
      const ids = new Set((a.layers as string[]) ?? []);
      d.setState({ ...s, layers: (s.layers ?? []).map((l) => (ids.has(l.id) ? { ...l, visible: !!a.visible } : l)) });
      return { layers: ids.size, visible: a.visible };
    }
    case "set_underlay": {
      let next = s;
      if (typeof a.opacity === "number" && s.imageUnderlay) next = { ...next, imageUnderlay: { ...s.imageUnderlay, opacity: a.opacity } };
      if (typeof a.visible === "boolean") {
        const ids = new Set((a.layers as string[]) ?? []);
        next = { ...next, layers: (next.layers ?? []).map((l) => (ids.has(l.id) ? { ...l, visible: a.visible as boolean } : l)) };
        if (!ids.size && !s.imageUnderlay) throw new Error("there is no image underlay on this plan");
      }
      d.setState(next);
      return { ok: true };
    }
    case "rename_space": {
      const rooms = d.rooms();
      let room = a.space ? rooms.find((r) => r.id === a.space) : undefined;
      if (!room && a.at) {
        await d.settle(); await d.settle(); // a just-drawn room needs a render to be detected
        const p = a.at as { x: number; y: number };
        room = d.rooms().find((r) => pointInPoly({ x: p.x * ppm, y: p.y * ppm }, r.points));
      }
      if (!room) throw new Error("room not found");
      const st = d.getState();
      const name = String(a.name);
      if (isAutoRoom(room)) d.setState({ ...st, rooms: [...st.rooms, { ...room, id: `room-${Math.random().toString(36).slice(2, 10)}`, label: name, auto: undefined } as Room] });
      else d.setState({ ...st, rooms: st.rooms.map((r) => (r.id === room!.id ? { ...r, label: name } : r)) });
      return { renamed: name };
    }
    case "select_entities": {
      const r = resolveTargets(d, a.targets as Targets);
      const ids = [...r.instances.map((i) => i.wall.id), ...r.walls.map((w) => w.id), ...r.rooms.map((x) => x.id)];
      if (!ids.length) nothing(a.targets as Targets);
      d.setSelection(ids);
      return { selected: ids.length };
    }
    case "delete_entities": {
      const t = a.targets as Targets;
      const r = resolveTargets(d, t);
      if (!r.instances.length && !r.walls.length && !r.rooms.length) nothing(t);
      const lib = s.objectLibrary ?? {};
      const markerIds = new Set(r.instances.map((i) => i.wall.id));
      const wallIds = new Set(r.walls.map((w) => w.id));
      const meta = { ...(s.nodeMeta ?? {}) };
      for (const id of markerIds) delete meta[NODE_KEY(id)];
      const deleteOpeningsOnly = t.kind === "door" || t.kind === "window";
      const walls = s.walls
        .filter((w) => !markerIds.has(w.id) && (deleteOpeningsOnly || !wallIds.has(w.id)))
        .map((w) => {
          if (!deleteOpeningsOnly || !wallIds.has(w.id)) return w;
          // Deleting a door/window closes the gap again: drop the opening attachment, keep the wall piece.
          const keep = (w.attachments ?? []).filter((x) => lib[x.objectId]?.meta.symbol !== t.kind);
          return { ...w, isObjectOpening: undefined, attachments: keep.length ? keep : undefined };
        });
      const roomIds = new Set(r.rooms.filter((x) => !isAutoRoom(x)).map((x) => x.id));
      d.setState({ ...s, walls, nodeMeta: meta, rooms: s.rooms.filter((x) => !roomIds.has(x.id)) });
      return { removed: markerIds.size + wallIds.size + roomIds.size };
    }
    case "move_entities": {
      const t = a.targets as Targets;
      const r = resolveTargets(d, t);
      if (!r.instances.length && !r.walls.length) nothing(t);
      const dx = Number(a.dxM) * ppm, dy = Number(a.dyM) * ppm;
      const ids = new Set([...r.instances.map((i) => i.wall.id), ...r.walls.map((w) => w.id)]);
      const mv = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
      d.setState({ ...s, walls: s.walls.map((w) => (ids.has(w.id) ? { ...w, start: mv(w.start), end: mv(w.end) } : w)) });
      return { moved: ids.size };
    }
    case "rotate_objects": {
      const t = a.targets as Targets;
      const r = resolveTargets(d, t);
      if (!r.instances.length) nothing(t);
      const ang = Number(a.angle) || 0;
      d.setState(editInstances(s, r.instances, (p) => ({ params: { ...p, rotation: (((Number(p.rotation) || 0) + ang) % 360 + 360) % 360 } })));
      return { rotated: r.instances.length };
    }
    case "set_object_params":
    case "set_render_mode": {
      const t = a.targets as Targets;
      const r = resolveTargets(d, t);
      const want: Record<string, unknown> = call.tool === "set_render_mode" ? { renderMode: a.mode } : (a.params as Record<string, unknown>);
      const skipped: string[] = [];
      let next = s;
      if (r.instances.length) {
        next = editInstances(next, r.instances, (p, objectId) => {
          for (const [k, v] of Object.entries(want)) {
            const key = paramKey(next, objectId, k);
            if (key) p[key] = v; else skipped.push(`${k} (${objectId})`);
          }
          return { params: p };
        });
      }
      // Openings: change the attachment's params; a width change also resizes the gap around its centre.
      if (r.walls.length) {
        const lib = next.objectLibrary ?? {};
        let walls = next.walls;
        for (const w0 of r.walls) {
          const w = walls.find((x) => x.id === w0.id);
          if (!w) continue;
          const atts = (w.attachments ?? []).map((x) => {
            const sym = lib[x.objectId]?.meta.symbol;
            if (sym !== "door" && sym !== "window") return x;
            const p = { ...(x.params ?? {}) };
            for (const [k, v] of Object.entries(want)) { const key = paramKey(next, x.objectId, k); if (key) p[key] = v as (typeof p)[string]; }
            return { ...x, params: p };
          });
          const newW = typeof want.width === "number" ? (want.width as number) * ppm : null;
          if (newW && w.isObjectOpening) {
            const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1;
            const ux = (w.end.x - w.start.x) / len, uy = (w.end.y - w.start.y) / len;
            const cx = (w.start.x + w.end.x) / 2, cy = (w.start.y + w.end.y) / 2;
            const ns = { x: cx - (ux * newW) / 2, y: cy - (uy * newW) / 2 }, ne = { x: cx + (ux * newW) / 2, y: cy + (uy * newW) / 2 };
            const same = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
            // The pieces either side share the opening's endpoints — move those too so the wall stays closed.
            walls = walls.map((x) => {
              if (x.id === w.id) return { ...x, start: ns, end: ne, attachments: atts };
              let y = x;
              if (same(x.end, w.start)) y = { ...y, end: ns }; else if (same(x.end, w.end)) y = { ...y, end: ne };
              if (same(x.start, w.start)) y = { ...y, start: ns }; else if (same(x.start, w.end)) y = { ...y, start: ne };
              return y;
            });
          } else walls = walls.map((x) => (x.id === w.id ? { ...x, attachments: atts } : x));
        }
        next = { ...next, walls };
      }
      if (next === s) nothing(t);
      d.setState(next);
      return { updated: r.instances.length + r.walls.length, ...(skipped.length ? { skipped } : {}) };
    }
    case "replace_objects": {
      const t = a.targets as Targets;
      const r = resolveTargets(d, t);
      if (!r.instances.length) nothing(t);
      const def = s.objectLibrary?.[String(a.object)];
      if (!def) throw new Error(`object ${a.object} is not loaded`);
      const defaults = Object.fromEntries(def.parameters.map((p) => [p.key, p.default]));
      d.setState(editInstances(s, r.instances, (p) => ({ params: { ...defaults, rotation: p.rotation ?? 0 }, objectId: def.meta.id })));
      return { replaced: r.instances.length };
    }
    case "offset_room_side": {
      const room = d.rooms().find((x) => x.id === a.space);
      if (!room) throw new Error("room not found");
      const side = String(a.side), delta = Number(a.deltaM) * ppm;
      const xs = room.points.map((p) => p.x), ys = room.points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      // Wall centre-lines sit up to half a thickness outside the space outline.
      const tol = 0.3 * ppm;
      const vertical = side === "E" || side === "W";
      const line = side === "E" ? maxX : side === "W" ? minX : side === "N" ? minY : maxY;
      const [lo, hi] = vertical ? [minY - tol, maxY + tol] : [minX - tol, maxX + tol];
      const onEdge = (p: { x: number; y: number }) => vertical ? Math.abs(p.x - line) <= tol && p.y >= lo && p.y <= hi : Math.abs(p.y - line) <= tol && p.x >= lo && p.x <= hi;
      const sign = side === "E" || side === "S" ? 1 : -1;
      // A wall on this line that runs on past the room belongs to a neighbour too: moving the shared
      // corner would bend it. Refuse rather than skew another room — that edit needs a jog (AI / by hand).
      const onLine = (p: { x: number; y: number }) => (vertical ? Math.abs(p.x - line) <= tol : Math.abs(p.y - line) <= tol);
      const along = (p: { x: number; y: number }) => (vertical ? p.y : p.x);
      const runsPast = s.walls.find((w) => !isMarker(w) && onLine(w.start) && onLine(w.end)
        && [w.start, w.end].some(onEdge) && [w.start, w.end].some((p) => along(p) < lo || along(p) > hi));
      if (runsPast) {
        const other = d.rooms().find((x) => x.id !== room.id && x.label && pointInPoly({ x: (runsPast.start.x + runsPast.end.x) / 2 + (vertical ? -sign * tol : 0), y: (runsPast.start.y + runsPast.end.y) / 2 + (vertical ? 0 : -sign * tol) }, x.points));
        throw new Error(`the ${({ N: "north", S: "south", E: "east", W: "west" } as Record<string, string>)[side]} wall carries on past this room${other?.label ? ` (it is also ${other.label}'s wall)` : ""} — moving it would bend that room; do this one by hand or ask the AI`);
      }
      // Room outlines: only points exactly on this edge (tight span) and the neighbour's across the wall.
      const tight = 0.03 * ppm;
      const [rlo, rhi] = vertical ? [minY - tight, maxY + tight] : [minX - tight, maxX + tight];
      const onRoomEdge = (p: { x: number; y: number }) => onLine(p) && along(p) >= rlo && along(p) <= rhi;
      const shift = (p: { x: number; y: number }) => (vertical ? { x: p.x + sign * delta, y: p.y } : { x: p.x, y: p.y + sign * delta });
      const mv = (p: { x: number; y: number }) => (onEdge(p) ? shift(p) : p);
      const mvRoom = (p: { x: number; y: number }) => (onRoomEdge(p) ? shift(p) : p);
      let moved = 0;
      const walls = s.walls.map((w) => {
        if (isMarker(w)) return w;
        const ns = mv(w.start), ne = mv(w.end);
        if (ns !== w.start || ne !== w.end) moved++;
        return ns === w.start && ne === w.end ? w : { ...w, start: ns, end: ne };
      });
      if (!moved) throw new Error("couldn't find the walls on that side of the room");
      // Labelled rooms are stored polygons that don't follow their walls — move their points on that
      // edge too (this room and the neighbour across the wall, whose edge sits within `tol`).
      let roomsMoved = 0;
      const rooms = s.rooms.map((rm) => {
        const pts = rm.points.map(mvRoom);
        if (pts.every((p, i) => p === rm.points[i])) return rm;
        roomsMoved++;
        return { ...rm, points: pts };
      });
      d.setState({ ...s, walls, rooms });
      return { wallsMoved: moved, roomsMoved };
    }
    case "import_design": {
      const q = String(a.query).replace(/^designs\//i, "");
      // "villa 1" should find "Ramanadhapuram_Villa1": compare with digits both apart and glued on.
      const glue = (x: string) => x.replace(/([a-z])\s+(\d)/gi, "$1$2");
      const files = (await d.listDesigns()).filter((f) => !/\.(view|bak-\d+|pre-[\w-]+|baked)\.json$/i.test(f));
      let best = "", bs = 0;
      for (const f of files) {
        const name = f.replace(/\.json$/i, "").replace(/[_-]/g, " ");
        const sc = f.toLowerCase() === q.toLowerCase() ? 1 : Math.max(lexScore(q, name), lexScore(glue(q), glue(name)));
        if (sc > bs) { bs = sc; best = f; }
      }
      if (!best || bs < 0.6) throw new Error(`no design matching “${q}” in Designs/`);
      if (!(await d.loadDesign(best))) throw new Error(`could not load ${best}`);
      return { loaded: best };
    }
    default:
      throw new Error(`unknown command ${call.tool}`);
  }
}

/** Run a whole parsed command, one call after another (each on fresh state). */
export async function executeCalls(d: CommandHostDeps, calls: ToolCall[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const c of calls) { out.push(await executeCall(d, c)); await d.settle(); }
  return out;
}
