import type { FloorPlanModel } from "./types";

const ROOM_AUTO_ID_PREFIX = "auto-room:";

/** Strip auto-detected rooms before persisting (they are recomputed from walls on load). */
export function floorPlanModelForApiStorage(model: FloorPlanModel): FloorPlanModel {
  return {
    ...model,
    rooms: model.rooms.filter((room) => !room.id.startsWith(ROOM_AUTO_ID_PREFIX)),
  };
}
