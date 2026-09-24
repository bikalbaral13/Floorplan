---
id: verify-scribble-plan
name: Verify a scribble-derived plan before reporting it
category: Scribble to Floorplan
when: Before saying a plan is done, and after every change to it. Run it as a script; never sign off from a screenshot.
tools: [Bash, Read, apply_model, snapshot_canvas]
requires: [verify-before-reporting]
---

A scribble plan is derived, not traced, so there is no underlay to check it against. These are the checks that stand in for one. They run as a script over the BAKE — the plan resolved by the same evaluator the app uses — because everything that matters about an object (its footprint, which way it faces, whether it touches a wall) depends on how ITS geometry reads `rotation` and `anchorDir`, and that differs per object. Nothing here is predicted from a parameter.

On one plan these checks caught, in order: a hall smaller than both bedrooms; a fridge and a TV unit sitting on 12" column nibs; three pieces of verandah furniture inside the open front; a staircase 0.52 m longer than its bay, starting behind its own anchor; a staircase lost to a rounding bug; a WC placed by its width instead of its length and so 160 mm through the wall; a sofa angled at an off-axis screen and grown into the armchair; a nightstand 191 mm short of the wall it was supposed to touch. None of those was visible in a screenshot.

## Stage A — the graph (before any bake)

- **Every attachment has an `id`.** The editor tests selection with `selectedComponent?.attId === att.id`; with nothing selected the left side is `undefined`, and an id-less attachment makes the two EQUAL, so the true branch dereferences the null selection and the whole canvas throws. It dies on the NEXT render, so the command that carried the bad model reports success and the following one times out. Assert unique, present ids across nodes, segments and spaces as a build step.
- **Node objects keep a host.** A node's metadata survives import only if it is an endpoint of some segment (`stableKeys`). Free-standing objects need a degenerate marker segment; columns on a grid line with no partition need the run CUT at the grid line.
- **Planar; Euler** `V − E + F = 1 + components`; enclosed cells = rooms; **no dangling ends**.
- **Space areas match the dimension chain to 0.00 mm²** — both come from the same constants, so anything else means a coordinate was typed by hand.
- **Hierarchy**: `hall > every bedroom && kitchen > every bedroom`, printed as booleans with the schedule.

## Stage B — bake everything headlessly

```bash
node tools/bakeplan/run.mjs plan.json --out baked.json
```

`attachments 149   with meshes 149` is the line you want. Any shortfall is an object the evaluator could not resolve — a parameter it does not have, or a definition not yet in the bucket — and it will be silently invisible in the app.

## Stage C — eight checks on the baked geometry

Every object is located by `anchor + plan2d` (both world metres) and matched to its room by the node's label. **Match nodes to anchors by distance (< 2 mm), never by a rounded string key** — the bake rounds to 4 dp and a 3 dp key lands on the wrong side of a half-unit often enough to lose an object.

**1. Containment.** Every object inside the room it was declared for, 20 mm tolerance for a leg grazing a face. L-shaped rooms are tested against the ring, not the bounding box.

**2. No overlap, at floor level.** Height bands per kind: `floor` (default), `wall` (geyser, wall cabinet, mirror, towel rail — below door-head height), `high` (fans, hoods, curtains, wall lights), `surface` (a flush drain; its fall zone is a slope, not a solid). Only floor–floor pairs are tested: a fan over a bed is correct, not a collision. **Columns are floor objects** — the section, not the bake's centre-axes — because their nibs (`column/2 − wall/2`: 1½" past a 9" wall, 4" past a 4" partition) are inside the room.

**3. Door clearance, both sides.** For every door, gate and open bay, a zone the opening's width across and 0.9 m deep on EACH side of the wall, tagged with the room it lies in. Nothing in band `floor` OR `wall` may intersect the zone in its room — a geyser at 1.8 m is still inside a 2.1 m leaf's swing. An open verandah front is an entrance and gets a zone like a door. A gate has no inside zone (nothing swings); a stair door that swings out has none on the stair side.

**4. Stair fill.** The staircase's baked footprint ≥ 85 % of its bay. Below that the bay is oversized or the flight is at library defaults.

**5. Facing.** Two sources of truth, chosen per kind:
- For kinds whose back is their TALLEST element — bed (headboard), chair, sofa, armchair, tv-unit (screen), dressing-table (mirror), toilet (cistern), washbasin and kitchen-sink (tap), exhaust-hood (chimney) — take the tallest mesh's centroid from the bake. `back: "S"` passes when that centroid lies on the south side of the object's centre (cosine ≥ 0.35 — a tap sits at the corner of its deck) AND the object's south edge is within 120 mm of the south wall face. `faceTo: [x, y]` passes when the vector from the tallest element through the centre points at the target within 25°.
- For kinds with a flat top and a back known from handles or by design — wardrobe, nightstand, fridge, stove, shoe rack, geyser, curtain — the bake cannot show a back, so the test is the rotation parameter against `rotationFor(kind, wall)` from the measured `BACK` table, plus the same wall-gap rule.
The "touch the wall" half of this test is what catches an object placed by the wrong dimension: a WC set out by its width when its length runs into the room ends 160 mm through the wall; a nightstand centred a guess too far in ends 191 mm short of it.

**6. Doors to one side.** For every hinged door, its wall span is the extent the two rooms it joins share along the run. The gap from the leaf to the nearer corner must be ≥ 30 mm (a jamb) and ≤ 600 mm, and the door's centre must be off the wall's centre by more than 10 % of its length. A door squeezed between a column nib and a return can legitimately sit 43 mm from the corner; a door in the middle of a wall is a fault.

**7. Gate ↔ stair.** The stair's toe edge is within 150 mm of the gate wall's face, and the gate's span lies over the FIRST flight (the up flight), not the landing or the return flight. At rotation 270 with "Left to right" the first flight is the west half of the footprint.

**8. Curtains.** Every window flagged for one has a curtain node within 300 mm of the window's inset centre, on the window's wall, whose baked extent along the wall is the window width + 0.24 m (the rail overhang) ± 0.1. Kitchen and stair windows are flagged off; everything else — toilet ventilator included — is on.

A plan is not done until all eight print `PASS`.

## Stage D — then look at it

Push into the live editor and snapshot; the editor's overlays make that good for verification and bad as a drawing. For a person, render the baked geometry yourself: wall bands from the segments, every object from its `plan2d` at `anchor + local`, labels last. Both renderings must use the SAME frame — node coordinates and baked anchors are both world metres; mixing in a building-local frame offsets every object by half the building and looks exactly like a rotation bug.

Then read the picture for the things a script does not encode: does the toilet door swing onto the WC; does the gate's zigzag read as a gate; is the sofa on axis with the screen; is anything correct-by-the-numbers but odd to a person.

## Stage E — report in sentences

The bay dimensions you fitted, the room schedule with the hierarchy result, carpet against gross, every assumption (door widths, windows the sketch never drew, floor-to-floor, the column size), every place you overruled the sketch and why, and every object you AUTHORED because the library had not got it. If a check failed and you left it failing, say which. Never paste the JSON.
