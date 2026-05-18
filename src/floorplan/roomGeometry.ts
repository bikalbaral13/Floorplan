import type { Point, Room } from "./types";
import {
  polygonArea,
  polygonAreaWithHoles,
  polygonContainsPolygon,
} from "./algorithms/geometry/polygon";

/** Derive the effective holes of a room.
 *
 *  Currently: a plot-boundary room treats every other room whose ring is fully
 *  contained inside it as a hole. This mirrors the SketchUp "face with inner
 *  loops" model — the holes aren't stored, they fall out of containment over
 *  the current room set, so they can't go stale.
 *
 *  If `room.holes` is explicitly set, those rings are returned as-is and no
 *  auto-detection runs. That gives us an escape hatch for manual overrides.
 */
export function getRoomHoles(room: Room, allRooms: readonly Room[]): Point[][] {
  if (room.holes && room.holes.length > 0) return room.holes;
  if (room.roomType !== "plot-boundary") return [];
  if (!room.points || room.points.length < 3) return [];

  const holes: Point[][] = [];
  for (const other of allRooms) {
    if (other.id === room.id) continue;
    if (!other.points || other.points.length < 3) continue;
    if (other.roomType === "plot-boundary") continue;
    if (other.isPathSpacePreview) continue;
    if (polygonContainsPolygon(room.points, other.points)) {
      holes.push(other.points);
    }
  }
  return holes;
}

/** Net area of a room, subtracting any holes carved out of it.
 *  Honors a pre-computed `room.netArea` if present (existing detect-auto-rooms
 *  path), then derived holes, then raw polygon area as fallback. */
export function roomNetArea(room: Room, allRooms: readonly Room[]): number {
  if (typeof room.netArea === "number") return room.netArea;
  const holes = getRoomHoles(room, allRooms);
  if (holes.length === 0) return polygonArea(room.points);
  return polygonAreaWithHoles(room.points, holes);
}
