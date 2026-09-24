---
id: place-staircase-in-plan
name: Choose, orient and place a staircase that fills its bay
category: Scribble to Floorplan
when: The sketch marks a stair, or the plan is for more than one floor.
tools: [Bash, place_object, get_object]
requires: [author-structural-grid, author-missing-parametric-object]
---

`Objects/Structural/staircase.json` is node-hosted. Four decisions, in this order: which configuration fits, how big to make it, which way it is ENTERED, and where the node goes.

## THE STAIRCASE OCCUPIES THE WHOLE ROOM

A stair bay exists for the stair. The flight is sized to the bay — not dropped in at library defaults and left floating in a corner with a metre of dead floor beside it. Target **≥ 85 % of the bay area** as the baked footprint, and assert it (`verify-scribble-plan` check 4). Get there by widening the flights (1.25–1.30 m each is generous and right for a domestic bay) and choosing tread and landing so the run uses the depth — not by shrinking the room around a default stair.

## Configuration is arithmetic, not taste

```
risers  = round(floorToFloor / 0.170)        # 3.0 m → 18
riser   = floorToFloor / risers              # 0.167
```

A single straight flight needs `(risers − 1) × tread` in one direction — 4.25 m at 250 mm — and does not fit a 3.2 m bay. So it is a DOG-LEG:

```
U-shape run   = flightSteps × tread + landingWidth      # 9 × 0.25 + 0.85 = 3.10 m
U-shape width = 2 × flightWidth + midSpace              # 2 × 1.25 + 0.12 = 2.62 m
```

3.10 × 2.62 fills a 3.19 × 2.88 bay at 88 %. Check BOTH dimensions before committing.

**Split the risers EVENLY.** The run of a dog-leg is set by its LONGER flight, and an odd split puts the difference behind the anchor: 18 as 8 + 10 baked to a 3.60 m run starting 0.52 m *back* from the node, not the 3.08 m the shorter flight promised. 9 + 9 keeps both flights inside the landing-to-toe length.

## The stair is ENTERED at the bottom tread, through a gate

A stair that fills its bay has no floor for a door leaf to swing over. So its closure is a **channel gate** (`Objects/Architectural/channel-gate.json`, segment-hosted like a door, folds along its own track, needs no swing floor), and it goes on the wall at the **toe** of the stair, centred on the **first flight** — the up flight — so you walk through the gate onto the bottom tread. Not on the landing end, not on the return flight.

Which end is the toe is a property of the object's own frame, and it decides `rotation`:

- At rotation 0 the treads start at the anchor and the landing is at the far +x end. The tread rectangles come out of the bake in order — the first (`[[0,0],[0.25,0],[0.25,1.25],[0,1.25]]`) is the bottom step, on the local y ∈ [0, width] side under "Left to right".
- **Rotation 270** puts the first tread at the anchor's y and the landing 3.10 m NORTH of it: toe on the south wall, first flight the WEST half. That is the orientation for a gate on the south wall.
- Rotation 90 would put the landing at the gate and the first step at the far wall — walk in and meet a wall.

Centre the gate on the first flight's half of the footprint, not on the bay. `verify-scribble-plan` check 7 proves both: toe edge within 150 mm of the gate wall, gate span over the first flight.

## THE STAIRCASE IS NOT CENTRED ON ITS NODE

Unlike the furniture objects it has no `anchorDir`. Measure the footprint from the bake, LOCAL to the anchor:

```bash
node tools/bakeplan/run.mjs plan.json --out baked.json      # then read the staircase's plan2d min/max
```

At rotation 270, 9 + 9, it sat at `x ∈ [0, 2.62]`, `y ∈ [−3.10, 0]` — the node is the box's bottom-LEFT corner. Write the measured box as a named constant and derive the node:

```
node = targetCentre − (localMin + localMax) / 2
```

Re-measure after ANY change to flight, split or rotation, and print the measured box beside the constant so a mismatch is a line in the output, not a surprise on the canvas.

## Centre it between the column nibs, not in the bay

The corner columns project into the bay — 4" on the partition side, 1½" on the outer-wall side (`author-structural-grid`). The target centre is the midpoint of the span BETWEEN the nibs:

```
clearX = [x0 + nib(outerWall), x1 − nib(partition)]
```

2.62 m in a 2.88 m bay leaves 130 mm; the nibs take 140 mm of it; what is left is 60 mm a side — enough, and the overlap check (columns are floor objects) proves it.
