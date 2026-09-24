---
id: cut-plots-along-roads
name: Cut, tidy, number and describe the plots
category: City Planning
when: After the road network exists. Plots are cells along road edges and nothing else.
tools: [Bash]
requires: [lay-out-roads-by-limb-grid]
---

A plot is a cell of `front` × row-depth against a road edge. Everything in this step is about making every square metre of the parcel be one of those, or a road, or the park — and never a sliver.

## Cut

For every road run, both sides: a band from the road edge out to the row depth solved for that side (`lay-out-roads-by-limb-grid`); cells of `front` along it, the last one absorbing a short remainder. Each cell is CLIPPED to what is still free (parcel − roads − park − cells already cut) and kept only if

- what survives is ≥ 45 % of a nominal plot, and
- some vertex of it lies on the road edge it was cut from (< 0.6 m) — it FRONTS its road.

Take the free area out as you go, so a cross-street cell and a parallel-street cell that meet at a corner do not both claim the corner.

## Tidy what is left

The free area after cutting is the strips behind rows, the edge wedges, the corners. Three passes, in this order:

1. **Shatter, then merge.** A leftover bigger than 0.8 of a plot is cut into cells the width of a frontage along its own axis first; each cell then goes to the plot it shares the LONGEST EDGE with — measured as overlap of parallel, coincident edges, never by counting shared vertices (a sliver and its neighbour share one long edge and no vertices). Without the shatter, one plot on the row takes the whole 100 m strip and comes out at 1,900 m².
2. **Cap.** A merge that would push the receiver past 2× nominal goes to the next-longest neighbour that stays under the cap.
3. **Nearest.** Whatever is still free tries the four nearest plots by centroid for a union that is one polygon under 2.2× nominal. What survives that is a genuine sliver between road and boundary — emit it as RESERVE (`emit-plots-and-roads-as-spaces`), labelled, so no area is a hole in the plan.

Then any plot still over 2.2× nominal is split PERPENDICULAR TO ITS FRONTAGE into as many cells as it holds nominal plots; a piece the cut leaves with no road edge goes back into the fronted piece beside it.

## Number by walking, not by cutting

Sample every road centreline every 5 m, join samples within 9 m (that is what makes a junction), Dijkstra from the sample nearest the entry, and give each plot the distance to the sample nearest its frontage midpoint. Sort by that — ties by side of road, then by cut order — and number 1..N. Plot 1 is the first one you pass through the gate; the far end of the far arm is last. Cutting order is meaningless to a buyer.

## Describe each plot

- `direction` — the compass of the vector from the plot's centroid to its frontage midpoint, under the calibrated north bearing, snapped to North/East/South/West.
- `neighbours` — `"East:12, West:14, North:Road, South:Empty"`: for each compass side, the number of the plot sharing ≥ 2 boundary points there, "Road" on the frontage side, "Empty" at the parcel boundary. The Globusarima design in the Library writes exactly this string.
- `status` — Available, for every plot, until somebody sells one.

## Report

Count, mean and median area, min and max, road share, park share, reserve area — and the two or three numbers a client reads first: how many plots, how big, how much road.
