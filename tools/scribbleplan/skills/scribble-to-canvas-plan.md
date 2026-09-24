---
id: scribble-to-canvas-plan
name: Turn a hand-drawn scribble into a canvas plan JSON
category: Scribble to Floorplan
when: The user hands over a PHOTO OF A HAND SKETCH — room names, a few dimension strings, wall thicknesses, maybe some column squares and door arcs — and wants a real canvas plan out of it: walls, openings, spaces, structure and furniture.
tools: [Bash, Read, apply_model, import_objects, list_spaces, snapshot_canvas]
requires: [read-a-hand-sketch, resolve-dimensions-and-grid, author-structural-grid, place-staircase-in-plan, furnish-unlabelled-rooms, author-missing-parametric-object, verify-scribble-plan]
---

This is the whole pipeline, in order. It is NOT the raster tracer — `Floorplan Tracer` overlays a measured drawing pixel for pixel, and a scribble has no measurable pixels. A scribble carries **intent plus a dimension chain**, and the plan is DERIVED from the chain, not traced from the paper.

**The one rule that makes the result usable:** author the whole thing from ONE constants module — bay dimensions, wall thicknesses, room rectangles, the stair's measured footprint, the gate position — and derive every coordinate from it. A sketch's numbers will be wrong or missing somewhere; when they are, you change one bay and the plan stays consistent. Coordinates typed in by hand cannot be corrected later.

1. **Read the sketch** (`read-a-hand-sketch`): rooms, adjacency, what the squares and arcs mean, which numbers are given and which you must infer. Present your reading as a block diagram and get it confirmed BEFORE any geometry.
2. **Close the dimension chain** (`resolve-dimensions-and-grid`): metres from feet, "outer" reconciled against centre-to-centre, unstated bays fitted so the chain closes exactly. Defaults when the sketch is silent: 9" outer, 4" inner, 12" columns, 3.0 m floor-to-floor.
3. **Decide the arrangement for the hierarchy**, not the other way round: the hall and the kitchen must each be larger than every bedroom. That means uneven bands and rooms paired across them, and it also fixes circulation without a corridor. Assert it in the schedule.
4. **Author the graph**: wall RUNS that cut themselves at every crossing, every opening edge and every column grid line, one segment per piece. Openings are real gaps carrying their object — Door, Window, **Channel Gate** in front of the stair, **Opening** for a verandah's open bays — never symbols over solid wall and never a dashed line where a lintel should be. **Doors sit to one side of their wall**, a jamb off the corner, hinged on the corner side, never centred.
5. **Spaces** on the inner faces, one per room, each with `room.json` and a `label`; `region` where it means something.
6. **Structure** (`author-structural-grid`): a 12" column and a footing on every grid intersection, and the nib it leaves in each room accounted for.
7. **Staircase** (`place-staircase-in-plan`): sized to FILL its bay, split evenly, oriented so the first tread is at the gate, placed by its measured footprint between the column nibs.
8. **Furnish** (`furnish-unlabelled-rooms`): choose the set per room; orient every object by `back: wall` or `faceTo: point` from its MEASURED back — headboards, backrests, screens, cisterns to the wall; chairs to the table; sofa and screen to each other on one axis. Curtains are generated from the windows, not placed. Anything the library lacks is authored first (`author-missing-parametric-object`).
9. **Verify** (`verify-scribble-plan`): the graph checks, a headless bake of every attachment, then eight checks on the baked geometry — containment, floor-level overlap with columns included, door clearance both sides, stair fill, facing, door offset, gate-on-first-flight, curtains per window. Only then a picture.

Deliver the plan JSON, a rendered drawing, and a plain-sentence report: the fitted bays, the schedule with the hierarchy result, every assumption, every place you overruled the sketch, and every object you authored. Never paste the JSON into chat.

**Failures that cost hours if you do not know them.** Every attachment needs its own `id` — an id-less one takes the whole editor down (`verify-scribble-plan`). Node metadata survives import only when the node is a segment endpoint (`author-structural-grid`). The staircase is not centred on its node and an odd riser split puts treads behind the anchor (`place-staircase-in-plan`). An object's front is not where you think; measure it (`furnish-unlabelled-rooms`). A new object must be in the bucket BEFORE a plan references it (`author-missing-parametric-object`).
