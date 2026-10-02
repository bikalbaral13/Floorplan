/**
 * "Shell" 3D view of a storey: only what can be seen from outside the building.
 *
 * The 3D "All" view stacks every storey, and a fully fitted-out storey of a master plan is tens of thousands
 * of meshes (one per light, chair, skirting run, tile field…) — one draw call each, so the stack could not
 * be drawn interactively. From outside, nearly all of it is behind the facade. A shell sheet keeps the
 * exterior walls with their doors and windows and the floor slabs, and drops the rest:
 *  - segments on the fit-out layers (furniture, lighting, curtains, services, cameras, render kit) and the
 *    zero-length markers placed objects hang from;
 *  - every segment / space object that is not structure (skirting, cornice, tiling, false ceiling, …);
 *  - INTERIOR segments — a wall, door or opening with a room on both sides.
 * Read-only by construction: it is built per render of the 3D view and never written back.
 */
import type { FloorPlanModel, Point, Room, Wall } from "./types";

const FIT_OUT_LAYERS = new Set(["furniture", "lighting", "curtains", "services", "cameras", "render"]);
const objName = (a: { objectId?: string; objectPath?: string }) => `${a.objectId ?? ""} ${a.objectPath ?? ""}`;
/** Segment objects that are the building's envelope. */
const KEEP_SEGMENT_OBJECT = /(^|[/ ])(wall|window|door|opening)(-with-math|\.json)/;
/** Space objects kept: the floor slab, and the site surfaces a master plan sits on. */
const KEEP_SPACE_OBJECT = /(^|[/ ])(room|floor|plot|road|plot-boundary)(-with-math|\.json)/;

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Rooms bucketed by bounding box, for the two point tests each segment makes. */
function roomIndex(rooms: Room[]) {
  const CELL = 500;
  const grid = new Map<string, { poly: Point[]; x0: number; y0: number; x1: number; y1: number }[]>();
  for (const r of rooms) {
    // Only habitable rooms decide inside/outside: an "area" (plot, site, buildable zone) contains the whole
    // building, and every wall would read as having a room on both sides.
    if ((r.roomType ?? "room") !== "room" || !r.points || r.points.length < 3) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of r.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const e = { poly: r.points, x0, y0, x1, y1 };
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = `${cx},${cy}`;
        const b = grid.get(k);
        if (b) b.push(e); else grid.set(k, [e]);
      }
  }
  return (p: Point): boolean => {
    for (const e of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`) ?? [])
      if (p.x >= e.x0 && p.x <= e.x1 && p.y >= e.y0 && p.y <= e.y1 && inside(p, e.poly)) return true;
    return false;
  };
}

/** The shell of one storey's sheet (see the file comment). `ppm` converts object thicknesses in metres. */
export function shellSheet(m: FloorPlanModel, ppm: number): FloorPlanModel {
  const inRoom = roomIndex(m.rooms ?? []);
  const walls: Wall[] = [];
  for (const w of m.walls ?? []) {
    if (FIT_OUT_LAYERS.has(w.layerId ?? "")) continue;
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue; // an object's marker node
    const atts = (w.attachments ?? []).filter((a) => KEEP_SEGMENT_OBJECT.test(objName(a)));
    if ((w.attachments?.length ?? 0) > 0 && atts.length === 0) continue; // only non-structure objects on it
    // Interior: probe a point just past each face; a room on both sides means nobody outside can see it.
    const wallAtt = atts.find((a) => /(^|[/ ])wall(-with-math|\.json)/.test(objName(a)));
    const tM = Number(wallAtt?.params?.thickness);
    const half = (Number.isFinite(tM) && tM > 0 ? tM * ppm : w.thickness ?? 0) / 2 + 0.2 * ppm;
    const mx = (w.start.x + w.end.x) / 2, my = (w.start.y + w.end.y) / 2, nx = -dy / len, ny = dx / len;
    if (inRoom({ x: mx + nx * half, y: my + ny * half }) && inRoom({ x: mx - nx * half, y: my - ny * half })) continue;
    walls.push(atts.length === (w.attachments?.length ?? 0) ? w : { ...w, attachments: atts });
  }
  const rooms = (m.rooms ?? []).map((r) => {
    if (!r.attachments?.length) return r;
    const atts = r.attachments.filter((a) => KEEP_SPACE_OBJECT.test(objName(a)));
    return atts.length === r.attachments.length ? r : { ...r, attachments: atts };
  });
  return { ...m, walls, rooms, objects: [], furniture: [], nodeMeta: {} };
}
