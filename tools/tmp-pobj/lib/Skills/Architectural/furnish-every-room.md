---
id: furnish-every-room
name: Furnish every room with the place-object solver
category: Architectural
when: After a plan's walls and openings exist and the rooms are to be furnished — a "draw a floorplan" brief that did not say "shell only".
tools: [list_spaces, flow_node_catalog, flow_apply, flow_commit, place_object, get_state, snapshot_canvas]
---

A plan that comes back with one bed in one bedroom and nothing anywhere else is a **failure, not a draft**. The usual way to get this wrong is to furnish one room, see objects appear, and stop.

Do not hand-compute furniture coordinates. The Flow's **`place-object`** node is the layout solver: it measures each object's real footprint from the library, starts from a seeded arrangement, and slides the pieces **along the room boundary** until nothing overlaps and corners stay clear.

## The set per room

Only these node-hosted objects exist. Read the real ids from your import and never reach for one that is not there:

`bed` · `wardrobe` · `sofa` · `table` · `chair` · `desk` · `shelf` · `cabinet` · `plant` · `curtain` · `ceiling-fan` · `chandelier` · `light-bulb` · `piano` · `staircase`

- **bedroom** → bed + wardrobe + shelf; add desk + chair at ≥ 12 m²
- **living / drawing** → sofa + table + shelf; add a second sofa and 2 chairs at ≥ 20 m²
- **dining** → table + 4 × chair (each chair is its own entry)
- **kitchen** → cabinet + shelf (+ table for an eat-in kitchen)
- **study / office** → desk + chair + shelf
- **bathroom / WC** → the library has **no sanitaryware** — no toilet, basin or bath. Leave it empty and say so in your report rather than substituting a cabinet for a WC.
- **corridor / balcony / store / pooja** → empty unless the brief named something.

Take the room type from each Space's label and area in `list_spaces`. Where the label is generic (`Space004`), infer the function from the plan's zoning and the room's size, then furnish it as that type.

## The cycle — one room at a time

Never put two rooms in one graph.

1. **`flow_apply`** a graph of a `source` pinned to that space feeding a `place-object` node with **one entry per object** in the set:

```json
{"version":1,"nodes":[
  {"id":"source_1","position":{"x":80,"y":200},"data":{"tool":"source","params":{"id":"Space001"}}},
  {"id":"place-object_1","position":{"x":360,"y":200},"data":{"tool":"place-object","params":{
    "objects":[{"objectId":"bed-with-math"},{"objectId":"wardrobe-with-math"},{"objectId":"shelf-with-math"}],
    "seed":3}}}],
 "edges":[{"id":"e1","source":"source_1","target":"place-object_1","sourceHandle":null,"targetHandle":null}]}
```

Entries carry **only `objectId`**. The solver measures length/breadth/height from the object itself — never invent them. Set `position` (0–100 along the boundary) or `setback` (metres) only when the brief pinned a spot.

2. **Check the preview** — the polygon count must equal the entry count. Fewer means some did not fit: try another `seed` first, then drop the least important item, and only then reconsider the room size.
3. **`flow_commit`** — each footprint becomes a real node-hosted object, selectable and boundary-following. This creates the node and its attachment; you do not hand-author either.
4. **`flow_apply` the empty graph** `{"version":1,"nodes":[],"edges":[]}` **before the next room.** Skipping this is the classic bug: the stale `place-object` node re-fires on the next commit and duplicates the previous room's furniture.

## Ceiling fittings and curtains are not boundary objects

The solver slides things along a **wall**, which is the wrong answer for a ceiling fan or chandelier — those belong at the room's **centre**. Keep all three out of the solver's object list and drop them with `place_object`:

- a **ceiling-fan** in every habitable room (a **chandelier** in living/dining instead, when the brief suggests it)
- a **curtain** on each window wall

## Completion gate

Do not report until this passes. Call `list_spaces` / `get_state` and **count the node objects in every habitable space**. Any bedroom, living, dining, kitchen or study holding fewer than its set is unfinished — go back and run its cycle. State the per-room count in your summary so a remaining gap is visible rather than quietly shipped.
