---
id: run-floorplan-workflow
name: Generate a plan with the floorplan workflow
category: Architectural
when: Producing a floor plan from a brief — a room list, areas, adjacencies or a shape. This is the default route; hand-drawing is the fallback.
tools: [open_workflow, flow_apply, flow_commit, flow_node_catalog]
flows: [Architectural/floorplan.v2.json, Architectural/floorplan.json]
---

Two versions live under `Workflows/Architectural`. They generate the SAME plan; they differ in what lands on the canvas.

- **`floorplan.v2.json` — REAL CANVAS ELEMENTS.** Walls become wall segments; door openings become `door` segments and window openings `window` segments, each HOSTING its object (`wall-with-math`, `door-with-math`, `window-with-math`). Every element is individually selectable, editable in Properties, and carries its own 3D. **Use this almost always** — any plan meant to be worked on afterwards.
- **`floorplan.json` — DRAWN GEOMETRY.** The same maths, but walls are computed as one mitred poché with doors and windows drawn as symbols. Nothing is selectable. Use only for a quick look or a presentation image.

**Parameters** (both, unless noted):

- **Shape** — `mode` = Rectangular | L-shape | T-shape | I-shape | C-shape | Z-shape | Stepped (`steps` sets the terraces).
- **Size** — `sizeMode` = Auto (from `rooms` × `roomArea` at `aspect`) | Inner | Outer (then `dimX` / `dimY` are the clear inner or overall outer dimensions). Or set `useHost` to fit the plan to the SELECTED space's bounding box.
- **Fabric** — `wallWidth` 0.12 interior, `extWall` 0.23 exterior, `doorWidth` 0.9, `windowWidth` 1.2.
- **Layout** — `random` + `seed` jitter the room split. When a layout is nearly right, **change the seed, not the room count**.
- **v2 only** — `doorClear` 0.3, `winClear` 0.6 keep openings clear of junctions. Raise them if openings crowd a corner.
- **v1 only** — `wallHeight`, `doorHeight`, `sillHeight`, `lintelHeight` for the 3D; `mitreMode` Union for a seamless poché.

**Read the Output Metrics before you report** — rooms, floor area, wall run, doors, windows, footprint W × D. If the floor area is far off the brief, adjust `roomArea` or `dimX`/`dimY` and re-apply rather than explaining the discrepancy.

**Do not `apply_model` over a plan you generated with a workflow.** Tune the parameters and re-apply — otherwise the next parameter change wipes your edit.
