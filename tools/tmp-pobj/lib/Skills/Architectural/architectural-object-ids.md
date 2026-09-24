---
id: architectural-object-ids
name: The Architectural object ids and how they host
category: Architectural
when: Any time a wall, door, window or parking object is referenced by id.
tools: [list_objects, get_object, import_objects]
---

The Architectural objects were rebuilt as six-node spine objects (Geometry → Input Properties → Math Engine → Output Metrics → 2D + 3D Render).

**The OLD ids are gone.** Never reference `floorplan.bsp.v1`, `wall.segment.v1`, `door.single.v1`, `window.standard.v1` or `room.v1`.

Current ids:

- **`wall-with-math`** *(segment)* — a wall run: thickness, height, alignment across the run, poché hatch, and its own quantities. Bind `thickness` to the segment it sits on.
- **`door-with-math`** *(segment)* — frame, leaf and swing arc; `hinge`, `swing`, `openAngle`, `frameDepth`. It reads its width FROM the segment, so a 0.9 m door segment is a 0.9 m door.
- **`window-with-math`** *(segment)* — frame, panes and operation symbol; `panes`, `operation`, `sillHeight`, `lintelHeight`, `wallDepth`.
- **`car-with-math`**, **`bike-with-math`** *(node)* — parking. Drop with `place_object` at a point; node-hosted, so they sit where you put them and rotate with their own parameter.

- **`room-with-math`** *(space)* — attach to every Space with `attach_space_object`. Carries `identifyingType: "room"`, which is how downstream tools find rooms at all, plus the room's colour and its own `semantics`.

**Node-hosted furniture** — all placed by the `place-object` solver or `place_object`, all reading their size from their own parameters: `bed-with-math`, `wardrobe-with-math`, `sofa-with-math`, `table-with-math`, `chair-with-math`, `desk-with-math`, `shelf-with-math`, `cabinet-with-math`, `plant-with-math`, `curtain-with-math`, `ceiling-fan-with-math`, `chandelier-with-math`, `light-bulb-with-math`. There is **no sanitaryware** in the library — no toilet, basin or bath.

**Every Architectural object carries a `semantics` parameter** — free text, editable, describing material and character only ("modern flush door, oak veneer, matte finish"). It drives nothing geometric; it is what an AI render reads. Keep the shipped default unless the brief asks otherwise.

**All four read their geometry from their HOST.** A segment object takes the segment's length and direction; a node object takes the point. That is why a workflow can hand a 0.9 m opening to a door and get a correct door — and why you must never fight it by typing a width that contradicts the host.
