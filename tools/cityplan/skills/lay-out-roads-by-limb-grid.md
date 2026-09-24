---
id: lay-out-roads-by-limb-grid
name: Lay out the road network — limb grids, two rows between roads, a stepping hierarchy, one connected tree
category: City Planning
when: After the parcel is traced. Before any plot exists, because plots are cut along road edges.
tools: [Bash]
requires: [trace-assigned-parcel]
---

Roads come first; plots are what is left between them. The method is LIMB GRIDS, chosen after two others were tried on the same parcel:

- **One grid over the whole parcel** — the principal axis of an L runs diagonally, so every plot in both arms is skewed 45° to its boundary and the edges are all slivers.
- **A medial-axis road tree** (skeleton / Voronoi) — gives a comb of stubs perpendicular to the spine every couple of plots, not streets. Fine for a corridor, wrong for a subdivision.

Both are still worth knowing: use the skeleton to READ a parcel (where its limbs are, how wide), then grid the limbs.

## A ROAD MUST EARN ITS LAND — two rows between any two parallel roads

A road is worth building only if some plot has no other way to reach one. Between two parallel roads the right content is **two rows of plots back to back**: the near row fronts one road, the far row fronts the other, and their back fences meet in the middle. A street one row out from the spine serves nobody — every plot on its near side already fronts the spine, every plot on its far side fronts the next street — and it is pure lost land: a 6 m strip the length of the limb taken out of the plots on both sides to give them an access they already had. The first version of this layout did exactly that in the arm, and removing the street raised the plot count from 161 to 189 and cut the road share from 20.7 % to 19.2 % with the plots landing on the nominal size exactly.

So the FIRST parallel street sits TWO rows out from the spine, and every further one two rows beyond the last. A side too shallow for two rows gets one deep row and no street.

## 1. Cut into limbs at reflex corners

A reflex corner — interior angle over 180° — is where one limb turns into another. Extend the corner's incoming edge (and, as a second candidate, its outgoing edge) across the parcel; the two sides are the pieces. Score each candidate by area-weighted rectangularity (area over oriented bounding-box area, in the piece's own frame) and take the best. Then apply two refusals:

- each piece ≥ 12 % of the parent — otherwise the cut is trimming a notch, not finding a limb;
- each piece's rectangularity ≥ 0.45 — an arm that tapers is still an arm (0.50), a triangle sliced off by a notch is not (0.33).

Repeat on the pieces while a cut still qualifies. The L came out as a 3.5 ha strip, a 1.4 ha shoulder and a 4.2 ha arm.

## 2. Grid each limb in its own frame

Principal axis `u`, perpendicular `v`, the limb's extent in both.

**Spine** — along `u`, through the ENTRY point in the entry limb (so the entry road is straight into the site), through the limb centre in every other limb. Entry limb spine = the `main` width (10 m here); other spines = `branch` (9 m).

**Parallel streets** — either side of the spine, `street` wide (6 m), two rows out and then every two rows. Do not assume the nominal depth: SOLVE the row depth so the bands tile the limb's half-width `S` exactly —

```
n   = round((S − 2D) / (2D + w))           # streets on this side
De  = (S − n·w) / (2 + 2n)                 # row depth that makes [row][row][street][row][row]… fit
keep 0.75D ≤ De ≤ 1.45D;  S < 1.5D → one row of depth S and no street
```

— otherwise a 74 m half-width leaves a 31 m strip nobody can front onto. Here De came out 15–22 m for D = 18.3.

**Cross streets** — perpendicular, every `block` plots along `u` (7 × 18.3 + 6 ≈ 134 m), starting from the entry end, so every parallel street is reached. Their plots are corner plots and always front a parallel too — a cross street is justified by BLOCK LENGTH, not by exclusive frontage, and is excess only when the next one is closer than ~0.6 of a block.

Clip every run to ITS LIMB, not the parcel: a cross street clipped to the parcel would run on into the next limb's grid.

## 3. Connect the pieces — by overlap, not by touch

Two road runs are joined when they share AREA (a crossing, a run ending inside another). Corners that merely touch are not a junction a car can use, and a boolean union will happily glue them and report one network. Build components from the overlap graph. Every component without the entry gets the shortest possible `branch` road to the entry component — nearest vertex pair, extended 6 m past each end so it genuinely overlaps both, clipped to the parcel — until there is one. This is also what carries the road across a limb junction.

## 4. The hierarchy, stated

Entry `main` (10) → limb spines and connectors `branch` (9) → parallels and crosses `street` (6). Every step away from the entry is narrower, which is what the client described and what `verify-subdivision` can read off the road classes.

## 5. Park — beside the spine, at the junction

A square of the asked share, placed at the reflex corner where the limbs meet (straight plots come out worst there), pushed to whichever SIDE of the spine keeps more of it inside the parcel. Centred on the spine it cuts the main road and the entry dead-ends into a lawn.
