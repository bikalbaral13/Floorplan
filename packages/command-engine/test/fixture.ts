import type { EngineContext } from "../src/types";

const ppm = 50;
const rect = (x: number, y: number, w: number, h: number) =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => ({ x: a * ppm, y: b * ppm }));

/** A small 3BHK-ish plan: metres, +y down (north = up). */
export const CTX: EngineContext = {
  ppm,
  spaces: [
    { id: "r1", label: "Living Room", roomType: "living", pointsPx: rect(0, 0, 5, 4) },
    { id: "r2", label: "Dining", roomType: "dining", pointsPx: rect(5, 0, 3, 4) },
    { id: "r3", label: "Kitchen", roomType: "kitchen", pointsPx: rect(8, 0, 3, 3) },
    { id: "r4", label: "Master Bedroom", roomType: "bedroom", pointsPx: rect(0, 4, 4, 4) },
    { id: "r5", label: "Bedroom 2", roomType: "bedroom", pointsPx: rect(4, 4, 3.5, 3.5) },
    { id: "r6", label: "Toilet", roomType: "toilet", pointsPx: rect(7.5, 4, 2, 2) },
    { id: "r7", label: "Space007", pointsPx: rect(9.5, 4, 3, 3) },
    { id: "r8", label: "Study", roomType: "study", pointsPx: rect(9.5, 7, 3, 3) },
    { id: "r9", label: "Balcony", roomType: "balcony", pointsPx: rect(0, 8, 4, 1.5) },
  ],
  selection: [],
  layers: [
    { id: "0", name: "0" }, { id: "wall", name: "Wall" }, { id: "door", name: "Door" }, { id: "window", name: "Window" },
    { id: "furniture", name: "Furniture", group: "Interior" }, { id: "mep-elec", name: "Electrical" }, { id: "plumbing", name: "Plumbing" },
    { id: "struct-col", name: "Columns" }, { id: "image", name: "Image" }, { id: "dims", name: "Dimensions" },
  ],
  objects: [
    { id: "bed.queen.v1", name: "Queen Bed", hostKind: "node", category: "Furniture" },
    { id: "bed.king.v1", name: "King Bed", hostKind: "node", category: "Furniture" },
    { id: "sofa.3seat.v1", name: "3 Seater Sofa", hostKind: "node", category: "Furniture" },
    { id: "sofa.l.v1", name: "L Shaped Sofa", hostKind: "node", category: "Furniture" },
    { id: "wardrobe.v1", name: "Wardrobe", hostKind: "node", category: "Furniture" },
    { id: "dining_table.v1", name: "Dining Table", hostKind: "node", category: "Furniture" },
    { id: "table.round.v1", name: "Round Table", hostKind: "node", category: "Furniture" },
    { id: "coffee_table.v1", name: "Coffee Table", hostKind: "node", category: "Furniture" },
    { id: "fridge.v1", name: "Refrigerator", hostKind: "node", category: "Kitchen" },
    { id: "armchair.v1", name: "Armchair", hostKind: "node", category: "Furniture" },
    { id: "door.single.v1", name: "Single Door", hostKind: "segment", symbol: "door", category: "Architectural" },
    { id: "window.standard.v1", name: "Standard Window", hostKind: "segment", symbol: "window", category: "Architectural" },
    { id: "floor.v1", name: "Floor", hostKind: "space", category: "Architectural" },
    { id: "skirting.v1", name: "Skirting", hostKind: "space", category: "Architectural" },
  ],
  levels: [{ id: "L0", name: "Ground floor 0" }, { id: "L1", name: "First floor 1" }, { id: "L2", name: "Second floor 2" }],
};

/** Same plan with something selected — for "this / these / selected". */
export const CTX_SEL: EngineContext = {
  ...CTX,
  selection: [{ kind: "segment", id: "w12", midM: { x: 2.5, y: 0 } } as never, { kind: "space", id: "r5", label: "Bedroom 2" }],
};
