---
id: verify-subdivision
name: Verify a subdivision before reporting it
category: City Planning
when: Before saying a subdivision is done, and after every change to the layout. Run as a script; never sign off from the picture.
tools: [Bash, Read, apply_model, snapshot_canvas]
requires: [emit-plots-and-roads-as-spaces, verify-before-reporting]
---

A hundred and fifty plots cannot be checked by eye, and the faults that matter are exactly the ones a rendering hides: a plot that no road touches, two plots that overlap by a metre, a road network in three pieces that looks like one, a boundary that sits two metres inside the map's line. These are the checks that stand in for an inspector. On one parcel they caught, in order: a 1,900 m² plot (a whole edge strip merged into one neighbour), a road tree in three pieces that a boolean union reported as one, two plots left landlocked by an oversize split, two more landlocked because they were cut along a road's line past where the road was clipped, a 5 % park asked for at 10 %, and an outline simplified at 6 m that cut every curve straight, and a street one row out from the spine that no plot needed.

## The ten checks, on the layout in metres, the plan file, and the scan

1. **Inside and clear.** Every plot polygon minus the parcel is < 2 % of its area; every plot ∩ the road union is < 2 %.
2. **No overlap.** Every pair of plots with intersecting bounding boxes has ∩ area < 1 m²; the park intersects no plot.
3. **Frontage.** Every plot has a vertex within 0.6 m of the road SURFACE — the union of the road polygons, not a road's centreline extended. A landlocked plot is unsellable; the fix is upstream (a split that crossed a frontage, a cell cut along a line where the road had ended), not a footpath.
4. **Sizes.** Every plot within [0.45, 2.5] × nominal; the median within 35 % of nominal. Print min, median, max. A max of 616 m² against a nominal of 335 is a corner plot that took a wedge; 1,900 is a fault.
5. **Numbering.** Numbers are exactly 1..N, and increase with walking distance from the entry along the roads.
6. **One network, reaching the entry.** Components from the OVERLAP graph of road runs — two runs are joined only if their intersection area is > 2 m². A union glues corner-touching runs and lies. One component, containing a run within a road-width of the entry.
7. **Park share** within ±3 % of what was asked.
8. **The file.** Every attachment has a unique id; every plot / park / reserve space carries plot.json with a numeric `number` and a `status`; every road space carries road.json; the underlay exists and is centred (`x = −width/2`, `y = −height/2`); `pixelsPerMeter` and `northbearing` are the calibrated values.
9. **Boundary on the drawn line.** Every vertex of the traced parcel, converted back to image pixels, lies within 2.5 px of a dark or red pixel of the scan; report the mean and the worst. This is the check that says the overlay is honest — 0.3 px mean / 1.4 px worst on a good trace; a mean of 2 px means the fill was never grown back onto the line (`trace-assigned-parcel`). Vertex count is the other half of the story: 14 vertices for an L is a trace that cut its curves straight; 38 is one that followed them.

10. **No redundant road.** Every parallel road, spine and connector must be the ONLY frontage of at least one plot, or its removal must split the network. A road whose plots all front some other road is land taken for nothing — the middle street of the arm on this parcel, one row out from the spine, served nobody and cost 28 plots. Cross streets are judged differently: their plots are corner plots and always front a parallel too, so a cross street is excess only when the next cross street in the same limb is closer than ~0.6 of a block (≈ 80 m).

A subdivision is not done until all ten print `PASS`.

## Then look — twice

**The overlay render** (`drawSite.mjs`, at 3× for the boundary): the blue outline must sit ON the map's line all the way round, including under the dimension stroke and around the shoulder; roads dark, plots pale with their numbers, park green, reserve pink. Read it for what a script does not encode: is the main road straight into the site from the marked entry; are the arm's plots square to the arm's boundary or to the strip's; is the park where a person would put it; is any block so long a car would have to drive round three sides.

**The editor.** Push it and snapshot. The extents reported in metres must match the parcel's bounding box (438 × 521 m here); if they come back at a fiftieth of that, the plan is at the scan's px/m and the editor is at 50 — emit at 50 (`emit-plots-and-roads-as-spaces`). Then open it as the client will and look at the boundary against the picture: that is the view the trace tolerance was chosen for.

## Report in sentences

Scale and how it was measured, north and how, parcel area, vertex count and boundary fidelity, limb count, road runs by class and their widths, plot count with mean / median / min / max, road share, park share, reserve area, and — separately — which numbers were READ off the map rather than measured (the entry width, the plot size, the park share). Never paste the JSON.
