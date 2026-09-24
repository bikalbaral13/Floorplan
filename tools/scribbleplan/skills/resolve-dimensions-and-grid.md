---
id: resolve-dimensions-and-grid
name: Close the dimension chain and lay out the grid
category: Scribble to Floorplan
when: After the sketch is read and before any node exists. Also whenever a bay dimension changes.
tools: [Bash, Read]
requires: [read-a-hand-sketch]
---

Everything downstream is derived from this step, so it lives in ONE module — bay lists, wall thicknesses, derived grid lines, room rectangles — and nothing else hard-codes a coordinate.

## Defaults when the sketch is silent

- **Outer walls 9"** (229 mm), **inner partitions 4"** (102 mm). Use these unless the sketch prints otherwise; print them in the report as defaults, not as readings.
- **Columns 12" × 12"** (305 mm) — see `author-structural-grid` for what that does to the rooms.
- **Floor-to-floor 3.0 m**, wall height 2.7 m.

## Outer is not centre-to-centre

A sketch says "36ft outer" and marks columns. Outer walls sit ON the perimeter grid lines, so with a 9" outer wall:

```
c-c span = outer − 2 × (wall/2) = 36'-0" − 9" = 35'-3"
```

Lay the bays out along the c-c span, then the outer face is `grid ∓ wall/2` and closes back to 36'-0" exactly. Assert this in code — if the chain does not close to the printed number, stop and re-read the sketch. Do not nudge a bay to make it fit.

## Fitting the bays the sketch never printed

Known bays go in as given. The rest are fitted to the remainder in the pixel proportions from `read-a-hand-sketch`, then rounded to something a builder would set out — whole inches, ideally whole feet or half feet. Check the rounded set still sums to the c-c span; put any residual in the largest bay, where it is proportionally invisible.

## Faces, not centrelines

Rooms are bounded by wall FACES. With `hOut = outerWall/2` and `hIn = innerWall/2`, a room between an outer wall and a partition runs from `grid + hOut` to `grid − hIn`. Get this wrong by half a wall and every area is out by a couple of percent — which is exactly the size of error that survives a visual check and fails a measured one.

## ROOM HIERARCHY IS A CONSTRAINT, NOT AN OUTCOME

**The hall and the kitchen must each come out larger than every bedroom.** Decide the arrangement to satisfy that BEFORE any dimension is fixed, because an arrangement that cannot satisfy it will not be rescued by fiddling the bays.

One room per grid cell cannot deliver it. On a 3 × 2 grid the hall shares a band with a bedroom, the two are the same depth, only width separates them, and the toilet carved out of the hall usually hands the bedroom the win. The plan that was built this way came out hall 93 sq ft against bedrooms of 95 and 147 — inverted.

What does deliver it:

- **Split the bands unevenly.** An 11'-0" / 13'-3" split of a 25' side makes the south band 8" deeper. Every room in the deeper band starts ahead.
- **Pair the rooms across the bands.** Put the kitchen in the shallow band next to the smaller bedroom, and the hall in the deep band next to the larger one — `STAIR · BEDROOM 1 · KITCHEN` over `VERANDAH · HALL · BEDROOM 2`. Both big rooms then win on width as well as depth.
- **Set bedrooms by clear width, not by grid.** Partitions do not have to sit on column lines; the grid carries the columns. A 10'-2" and a 9'-0" bedroom are set out from their own widths and the partition falls where it must.
- **Assert it in the build**: `hall > bed1 && hall > bed2 && kitchen > bed1 && kitchen > bed2`, printed as true/false with the schedule. That arrangement gave hall 154, kitchen 149, bedrooms 106 and 115 — the hall the largest room in the house, which is what a living room is.

This arrangement also fixes circulation without a corridor: the hall in the deep middle cell touches the verandah, both bedrooms, the kitchen and the toilet, so nothing is reached through a bedroom.

## Wet rooms need an outside wall

Before fixing a toilet's position, check it touches an external wall. A toilet with no wall to the outside has no ventilator, and that is a code failure in most places, not a preference. Carving it out of the hall's outer corner is almost always available and costs the hall nothing it needs. Put its partition ON the line of a partition in the other band where one is close, so the two read as one wall down the plan rather than missing by 46 mm.

## Finish with a schedule

Print every room: clear dimensions in feet and inches, area in square feet and square metres, the carpet total against the gross, and the hierarchy assertion. Read it as an architect before continuing — a 95 sq ft bedroom is small but real, a 60 sq ft one means the reading is wrong, and a hall smaller than a bedroom means the arrangement is wrong.
