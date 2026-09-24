---
id: choose-the-fitout-set
name: Choose what goes in each room, at what size, facing which way
category: Floorplan Improver
when: The plan is read and every room is classified — now decide the objects, before any of them is placed.
tools: [Bash, Glob]
requires: [read-the-plan-and-brief, lay-out-tiles-and-floor-finishes]
---

This is the decision. The later skills only place what is chosen here, so a wrong choice here cannot be fixed downstream.

Every id below exists in `library/Objects/Architectural/` and is referenced as `objectId: "<id>-with-math"`, `objectPath: "Objects/Architectural/<id>.json"`. **Check the listing before you write one down.** There is no sofa-bed, no bunk, no dishwasher; substitute the nearest and say so.

## The set, by room type

Choose for a household that lives there, not for coverage. `[S]` = segment-hosted (rides one wall piece), `[SP]` = space-hosted, everything else is node-hosted.

| Room | Core | Added at size | Always |
|---|---|---|---|
| **Bedroom** | `bed`, `bedding`, `nightstand` ×1–2, `wardrobe` | `dressing-table` or `desk`+`chair` ≥ 12 m²; `window-seat` under a window ≥ 1.4 m wide; `chest-of-drawers` ≥ 14 m²; `armchair` ≥ 16 m² | `ceiling-fan`, `rug`[SP], `curtain`, `plant-potted`, `cushion`, `decor-cluster` on each nightstand |
| **Living / hall** | `sofa`, `tv-unit`, `table` (coffee), `armchair` ×1–2 | second `sofa` + 2 × `armchair` ≥ 20 m²; `shelf` ≥ 16 m²; `piano`[SP] only if the brief said so | `ceiling-fan` or `chandelier`, `rug`[SP], `curtain`, `plant-potted` ×2, `wall-art`[S], `decor-cluster` |
| **Dining** | `table`, `chair` ×4 (each its own entry) | 6 chairs and `length` 1.8 ≥ 14 m²; `cabinet` (sideboard) ≥ 12 m² | `pendant` ×1–3 over the table centre, `rug`[SP], `wall-art`[S] |
| **Kitchen** | `kitchen-counter`[S], `kitchen-sink`, `stove`, `exhaust-hood`, `refrigerator`, `wall-cabinet`[S] | `microwave`, `oven` ≥ 8 m²; `table`+2 `chair` for an eat-in ≥ 12 m² | `light-panel` or `downlight` grid, `floor-drain`, no curtain |
| **Bathroom / WC** | `toilet`, `washbasin`, `floor-drain`, `mirror`[S], `towel-rack`[S], `water-heater` | `shower` only when a clear 0.9 × 0.9 fits past the door swing; `bathtub` only ≥ 5 m² **and** a clear 1.7 m run | `exhaust`-style `ac-grille`, `toilet-paper-holder`[S], `faucet` |
| **Study / office** | `desk`, `chair`, `shelf` | `cabinet` ≥ 9 m² | `track`+`track-head`, `plant-potted`, `wall-art`[S] |
| **Utility** | `washing-machine`, `shelf`, `floor-drain` | `cabinet` ≥ 5 m² | — |
| **Entry / foyer** | `shoe-rack`, `mirror`[S] | `cabinet` (console) + `decor-cluster` ≥ 4 m² | `pendant`, `plant-potted` |
| **Balcony / verandah** | `stool` ×2, `planter-box` | `table` (bistro) ≥ 4 m² | `outdoor-light`, its open side is an `opening` on the wall |
| **Corridor / lobby** | — | `wall-art`[S] on any run ≥ 2 m | `downlight` at 1.2–1.5 m pitch |
| **Pooja / store** | `shelf` | `cabinet` in a store ≥ 3 m² | `downlight` ×1 |
| **Stair** | `staircase`, `channel-gate` on the toe wall | — | nothing else |

**Every window except in a kitchen, bathroom or stair** gets a `curtain` at the window's own clear width, plus a `curtain-track`[S] or `curtain-pelmet`[S] above it. Generate it **from** the window opening you measured — never place one by hand at a guessed width.

## Size the object to the room, do not accept the default

The library defaults are a 1.5 m bed and a 1.2 m wardrobe. Real rooms want:

- **bed** — `width` 1.8 / `length` 2.0 (king) at ≥ 12 m², 1.5 / 2.0 (queen) at 9–12 m², 1.0 / 1.9 (single) below. Set `bedding` to the same `bedWidth` / `bedLength` and `mattressTop` = `platformHeight` + `mattressThk`.
- **wardrobe** — `width` = the clear wall run minus 100 mm, capped at 2.4; `doorStyle: "Sliding"` whenever the clear floor in front is under 1.0 m; `topFiller: true` with `fillerTo` = `bandSoffit` so it reads built-in rather than parked.
- **sofa** — `seats` 3 / `length` 2.0 at ≥ 16 m², 2 / 1.6 below; never wider than the wall run minus 300 mm.
- **table** (dining) — 1.6 × 0.9 for 4, 1.8 × 0.9 for 6, 2.2 × 1.0 for 8; needs 900 mm of pull-out clear on every used side.
- **kitchen-counter** / **wall-cabinet** — `fitMode: "Exact"` and let the segment give the length. This is what segment hosting is for; never type the run length.
- **window-seat** — `length` = the window's clear width, `depth` 0.6.

## Rotation is never typed in

An object is placed by what it is **for**, and the degrees follow.

- **Back to a wall** — headboard, backrest, screen, cistern, tap, carcass against the wall; doors, drawers, seat and pillows into the room. Each kind's back at rotation 0 is a **measured** fact from baking it once, not a guess: a bed's headboard is at −x, a sofa's back at +y, a chair's back at −x, a fridge's handles at +y so its back is −y. Three of those guesses were wrong on one plan.
- **Facing a point** — every chair faces its table; the sofa faces the screen and the screen faces the sofa; an armchair faces the screen or the window.

Rotation turns a local vector by R(θ): `(x, y) → (x cos θ − y sin θ, x sin θ + y cos θ)`, θ in degrees.

**Put things that face each other on one axis.** A sofa angled 20° to face an off-axis screen grows a rotated footprint into the armchair beside it and through the wall behind it. Sofa and screen on the same axis, backs to opposite walls, is an exact 180° and costs nothing.

**Place by the dimension that runs into the room.** With its back to a wall a WC's `length` points into the room, not its `width`; a wardrobe's `depth` does. Set the centre out from the wall **face** (not the centreline) by half of *that* dimension.

## Draw the door zones first, then furnish what is left

Every door, gate and open bay owns a clearance zone **its own clear width across and 0.9 m deep on both sides of its wall**. Nothing floor-standing sits in a zone, and nothing at door-head height either — a water heater at 1.8 m is inside a 2.1 m leaf's swing. An open balcony front is an entrance and gets the same zone.

Lay a room out by drawing its zones first; what is left is where furniture can go. In an L-shaped hall the clear region is one arm of the L, and the TV wall is whichever stretch lies **between** two door zones.

## Height bands — no two objects overlap at the same height

Tag every placement with a band and test only **floor–floor** pairs:

- `floor` — bed, wardrobe, sofa, table, chair, WC, basin, fridge, stove, **and columns**. A 12″ column projects 1½″ past a 9″ wall, so anything pushed into a grid corner lands on it.
- `wall` — mirror, wall cabinet, towel rack, water heater, TV, switch, socket. Over a floor object is fine; inside a door swing is not.
- `high` — ceiling fan, chandelier, pendant, downlight, hood, cove, curtain track, AC grille. Over anything.
- `surface` — floor drain and its fall zone, rug, tile field.

## Three traps

**A space-hosted object centres on the space's own anchor and cannot be offset.** In an L-shaped room that anchor falls in the notch — in the neighbour. Anything that needs a position *inside* a room is a node object. Only `room`, `false-ceiling`, `tessellation` and `rug` belong on the space.

**Some objects draw more than themselves.** `outdoor-light` draws its light pool, `floor-drain` its fall zone, `downlight` its beam cone, `wall-washer` its aim lines. Keep the fall zone (band `surface`); set `showBeam` / `showAim` / `showSpill` false wherever the 2D plan would get noisy.

**Kinds with a flat top have no back the bake can show** — curtain, nightstand, wardrobe, fridge, stove, shoe rack, water heater. For those the check compares the `rotation` param against the intended direction; for anything with a headboard, backrest, screen, cistern or tap, the bake itself proves the orientation.

## When the library has not got it

Author it (`author-missing-parametric-object`), bake it alone, upload it, and only then reference it. Never write an `objectPath` for a file that does not exist — it renders as "(missing)" and the whole room reads as a failure.
