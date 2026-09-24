import type { Point, Wall } from "../types.js";

/** The id of a piece cut off an existing segment when walls are split at their intersections.
 *
 *  DETERMINISTIC, like an auto room's id and for the same reason: splitting is RE-DERIVED from the
 *  geometry, here and again in wallGeometry for what is drawn, so a piece needs the same id every time or
 *  a selection, an attachment and a metric would all follow a different wall after each edit. A random
 *  uuid is exactly what it must not be.
 *
 *  It used to be spelled `<parentId>~-496,30_679,30` — the coordinates, in the id. That is stable, and it
 *  is also the only id in the app that did not read as `kind_uuid`: it grew with the geometry, changed
 *  shape when a wall moved, and showed a reader a coordinate pair where every other id shows a name. The
 *  parent id and the two rounded endpoints are folded into the same 13-hex digest every other derived id
 *  uses, so a piece is `segment_<hash>` — same input, same id, and nothing to read but a name.
 */
export function splitPieceId(parentId: string, s: Point, e: Point): string {
  const key = `${parentId}~${Math.round(s.x)},${Math.round(s.y)}_${Math.round(e.x)},${Math.round(e.y)}`;
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `segment_${(a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 13)}`;
}

/** A wall's own id when it is the FIRST piece — a split that leaves the wall's start where it was keeps
 *  its identity, so only the pieces after it are new. */
export const firstPieceKeepsId = (wall: Wall): string => wall.id;
