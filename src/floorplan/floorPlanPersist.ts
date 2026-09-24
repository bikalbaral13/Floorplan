import type { FloorPlanModel } from "./types";

// A DETECTED space says so in its own `auto` field: every space id is `space_<uuid>` now, drawn or found,
// so the prefix cannot answer it. The two legacy prefixes stay as the fallback for a plan saved before the
// field existed. Local copy rather than an engine import — this module is deliberately dependency-free so
// it can run in a worker.
const AUTO_ROOM_PREFIXES = ["space-auto-", "auto-room:"];
const isAutoRoom = (room: { id?: string; auto?: boolean } | undefined): boolean =>
  !!room && (room.auto === true || (!!room.id && AUTO_ROOM_PREFIXES.some((p) => room.id!.startsWith(p))));

/** Strip auto-detected rooms before persisting (they are recomputed from walls on load). */
export function floorPlanModelForApiStorage(model: FloorPlanModel): FloorPlanModel {
  return {
    ...model,
    rooms: model.rooms.filter((room) => !isAutoRoom(room)),
  };
}
