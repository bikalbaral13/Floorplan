---
id: furnish-unlabelled-rooms
name: Choose, orient and place the objects when the sketch names none
category: Scribble to Floorplan
when: The shell exists and the sketch says nothing about what goes in the rooms — which is every scribble.
tools: [Bash, list_objects, import_objects, place_object, attach_space_object]
requires: [import-objects-scoped, author-missing-parametric-object, verify-scribble-plan]
---

`furnish-every-room` covers driving the place-object solver. This skill is the decision BEFORE that: which objects, at what size, facing which way, when nobody told you — and the rules every placement must satisfy.

## The set, by room

Choose for a real household, not for coverage. Every one of these exists in `Objects/Architectural/`:

| Room | Objects |
|---|---|
| Bedroom | `bed`, `wardrobe`, `nightstand`, `dressing-table`, `ceiling-fan` |
| Kitchen | `kitchen-counter` (segment), `kitchen-sink`, `stove`, `exhaust-hood`, `refrigerator`, `wall-cabinet` (segment), `table` + `chair` ×4 if it has room |
| Toilet | `toilet`, `washbasin`, `floor-drain`, `mirror` (segment), `towel-rack` (segment), `water-heater`; a `shower` only if a 0.9 × 0.9 fits clear of the door |
| Hall | `sofa`, `armchair`, `tv-unit`, `ceiling-fan` |
| Verandah | `stool` ×2, `planter-box`, `shoe-rack`, `outdoor-light`; its open front and side are `opening` objects on the wall, not dashed lines |
| Stair | the staircase and a `channel-gate` on its toe wall — nothing else |
| Every window except kitchen and stair | a `curtain`, generated FROM the window at the window's width, not placed by hand |

## ROTATION IS NEVER TYPED IN

An object is placed by what it is FOR, and the degrees follow:

- **`back: N|S|E|W`** — it stands against that wall with its back to it: headboard, backrest, screen, cistern, tap, chimney, wardrobe carcass to the wall; doors, drawers, seat and pillows into the room. That is what "the usable side faces the room" means, object by object.
- **`faceTo: [x, y]`** — it faces that point: every chair faces its table; the sofa faces the screen and the screen faces the sofa; an armchair faces the screen.

Both resolve through `rotationFor(kind, direction)` from a `BACK` table of each kind's back at rotation 0 — and that table is MEASURED, by baking every kind once and finding where its tallest element (headboard, backrest, screen, cistern, tap) or its handles sit. A bed's headboard is at −x; a sofa's back at +y; a chair's back at −x; a fridge's handles at +y so its back is −y. Never assume `length` runs along x or that "front" is +y; three of those guesses were wrong on one plan.

Rotation turns a local vector by R(θ): (x, y) → (x cos θ − y sin θ, x sin θ + y cos θ), θ in degrees — verified on the staircase, whose bake at 90 took [3.43, 0] to [0, 3.43].

**Put things that face each other on one axis.** A sofa angled 20° to face an off-axis screen grows a rotated footprint into the armchair beside it and through the wall behind it. Sofa and screen on the same x, backs to opposite walls, is an exact 180° and costs nothing.

**Place by the dimension that runs into the room.** With its back to the wall a WC's LENGTH points into the room, not its width; a wardrobe's DEPTH does. Set the centre out from the wall face by half of THAT dimension, and the wall-gap test in check 5 catches the case where you used the other one.

## Draw the door zones first, then furnish what is left

Every door, gate and open bay gets a clearance zone the opening's width across and 0.9 m deep on BOTH sides of its wall. Nothing floor-standing, and nothing at door-head height either (a geyser at 1.8 m is inside a 2.1 m leaf's swing), may sit in a zone in its room. An open verandah front is an entrance and gets the same zone — two stools and a planter were sitting in one. Lay a room out by drawing its zones first; what is left is where furniture can go. In an L-shaped hall the clear region is one arm of the L; the TV wall is whichever stretch of wall lies BETWEEN two door zones.

## No two objects overlap — at the same height

Tag every kind with a band: `floor` (default), `wall` (geyser, wall cabinet, mirror, towel rail — below door-head height: over floor objects is fine, in a door swing is not), `high` (ceiling fan, hood, curtain, wall light — over anything), `surface` (floor drain). Only floor–floor pairs are tested, and **columns are floor objects**: a 12" column projects 1½" past a 9" wall and 4" past a 4" partition, so anything pushed into a grid corner lands on it. A fridge and a TV unit both did, by ~30 mm.

## Placement rules that survive the checks

- **Beds** head to a wall, never head to a window or a door. A party wall is the best headboard wall.
- **Wardrobes** on the wall opposite the bed if there is 2 m clear between them, otherwise on the party wall beside it. Never in front of a window, never on a nib.
- **The kitchen working run** — counter, sink, stove, hood — on ONE wall the openings left intact: a segment object rides a single PIECE, and windows cut runs into pieces. A party wall with no openings is the one.
- **Hoods sit on the same node as the stove.** Correct, not a duplicate.
- **Toilets**: WC on the party wall (cistern to the wall, pan into the room), basin opposite, both PAST the door swing, drain between, geyser high on the wall clear of the swing. A 5' × 7'-6" toilet has room for WC + basin + wet floor, not a shower enclosure too — do not force one in.
- **Curtains** hang ~90 mm inside the wall face, rail along the wall, one per window that wants one, at the window's width. Kitchen and stair windows do not.

## Three traps

**A space-hosted object centres on the space's own anchor and cannot be offset.** In an L-shaped room the anchor can fall in the notch — in the neighbour. Anything that needs a position INSIDE a room is a node object.

**Some objects draw more than themselves.** `outdoor-light` draws its light pool, `floor-drain` its fall zone. Keep the fall zone (band `surface`); turn the light spill off (`showSpill: false`).

**Kinds with a flat top have no back the bake can show** — curtain, nightstand, wardrobe, fridge, stove, shoe rack, geyser. For them the check uses the rotation parameter against `rotationFor`; for everything with a headboard, backrest, screen, cistern or tap, the bake itself proves the orientation.

## What to do when the library has not got it

Author it (`author-missing-parametric-object`), bake it alone, upload it, and only then reference it.
