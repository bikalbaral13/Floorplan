---
id: author-structural-grid
name: Put columns and footings on the grid
category: Scribble to Floorplan
when: The sketch marks squares at wall junctions, or the plan is a framed structure and needs its columns and foundations.
tools: [Bash, import_objects, get_object]
requires: [resolve-dimensions-and-grid, import-objects-scoped]
---

The squares on a scribble are a column grid, and the grid is already laid out by `resolve-dimensions-and-grid` — every intersection of an X line and a Y line gets one column and one footing. On a 3 × 2 bay grid that is twelve of each.

Both objects are NODE-hosted and both go on the SAME node, in one `attachments` array:

- `Objects/Structural/column.json` — `shape`, `length`, `breadth`, `height`, `base`, `rotation`
- `Objects/Structural/footing.json` — `type` (Spread / Sloped / Stepped), `columnWidth`, `columnDepth`, `baseWidth`, `baseDepth`, `rccThickness`, `pccThickness`, `solingThickness`

## THE RULE THAT COSTS A DAY IF YOU MISS IT

A node's metadata and its attachments survive a round trip ONLY IF THE NODE IS AN ENDPOINT OF SOME SEGMENT. The plan format keys node metadata by the sorted set of segment ends meeting at the node (`stableKeys`), so a node no segment touches has no key and is silently dropped on import — the column simply is not there, with no error anywhere.

Grid intersections are wall endpoints already — **provided the wall is cut there.** A grid line with no partition of its own still has columns at every crossing, so every run it crosses must break at it whether or not a wall meets it. Give the run emitter the grid lines as explicit cut points; do not rely on crossings alone.

Anything free-standing — a staircase in the middle of a room, a bed, a fridge — needs a **degenerate marker segment**: `fromNodeId === toNodeId`, thickness 0.5, `mode: "line"`, on the object's own layer. It draws nothing and it is what keeps the object alive.

## Sizing — the defaults

- **Column 12" × 12"** (305 mm) unless the sketch says otherwise. Not 230: a 12" column is what a two-storey framed house in this market is built with, and it is what the user expects to see when the sketch is silent.
- **Footing** 1.2 × 1.2 m base, 300 mm RCC, on 100 mm PCC and 100 mm soling.
- **Floor-to-floor** 3.0 m, **wall height** 2.7 m.

Derive footings from tributary area only when the user asks for it or the spans are uneven enough to matter; then corner, edge and internal footings differ and you must say what soil bearing capacity you assumed.

## THE NIB — a 12" column does not fit inside a 9" wall

A 12" column centred on a 9" outer wall projects **1½" into the room** on each side; centred on a 4" partition it projects **4"**. That projection — the nib — is inside the room, at floor level, at every grid corner, and furniture has to clear it:

```
nib = column/2 − wall/2        9" wall → 38 mm    4" wall → 102 mm
```

Two things follow. The first time this plan was checked, a fridge in a kitchen corner and a TV unit against a partition both landed on nibs by 30–35 mm — invisible on screen, real on site. So **columns are floor objects in the overlap check** (`verify-scribble-plan`), using the column SECTION as the footprint, not the bake's centre-axes. And a staircase that fills its bay must be centred on the span **between** the corner nibs, not on the bay — see `place-staircase-in-plan`.

Draw the nib. It is a true statement about the room.

## Also set the canvas footprint

Besides the attachments, set the node's own metadata so the canvas draws a column in Architectural view: `type: "column"`, `columnShape: "rectangular"`, `dimX` and `dimY` **in metres**. The attachment gives the real parametric object; this gives the plan symbol. Set both.

## Footings read as sticking out, and that is correct

A 1.2 m footing centred on a perimeter column projects ~0.5 m beyond the outer wall face. That is what a foundation does — it is below ground and nothing on the finished floor sits on it. Draw it dashed so it reads as "under", and do not shrink it to make the drawing tidier.
