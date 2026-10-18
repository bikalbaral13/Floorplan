---
id: upgrade-object-meshes
name: Upgrade a library object from a CAD block to a rendered mesh
category: Floorplan Improver
when: An object renders as hard boxes — every arris a perfect 90° — and it needs to hold up in a render. Also whenever a new object is authored, so it starts here rather than being upgraded later.
tools: [Bash, Read, Write]
requires: [floorplan-improver-scripts]
---

`bed.json` is the benchmark in this library and the thing it does differently is **one call**. Everything else builds solids as hard six-face boxes; the bed samples a superellipsoid as loft sections and stitches them. At exponent 0 that returns an exact cuboid, so the same call covers a crisp carcass panel and a plump pillow and the only difference is a number.

## The mesh kernel

`Solid.*` builtins, all available in the Math Engine:

| call | what it is for |
|---|---|
| `Solid.SoftBox(box, roundTop, roundBase, roundPlan, stations, points)` | a superellipsoid sampled as loft sections; `box` is `[x0,y0,z0,x1,y1,z1]` in whatever frame you built it |
| `Solid.Skin(sections, idBase)` | stitch those sections into a `[x,y,z,faceId]` face list for a **Polyhedron** row |
| `Solid.Prism(ring, z0, z1)` · `mprism` | extrude a footprint |
| `Solid.Lathe(profile, axis, steps)` | revolve — the cheap way to a hollow body |
| `Solid.Sweep(profile, rail, closed)` | carry a section along a path; parallel-transport frames, never twists |
| `Solid.Cylinder(axis, r, sides, r2)` · `Solid.Geodesic(freq, r, hemi, centre)` | the drill, and a sphere or dome |
| `Solid.Union` · `Solid.Subtract` · `Solid.Intersect` | BSP CSG on the same face list |

**`idBase` is not decoration.** The canvas groups faces by RUNS of equal id, so two solids whose ids both start at 0 weld their touching faces into one. Stride the bases well apart — `i * 100000` per part.

## The three measured facts that decide everything

**1. `roundTop` DOMES the solid; it does not chamfer it.** On a 1 × 1 × 0.6 box, any non-zero `roundTop` collapses the top ring to a point. That is right for a mattress and wrong for a wardrobe top you put a lamp on. So hard goods take `roundTop = roundBase = 0` and round **only in plan**: the horizontal faces stay dead flat at full size while the vertical arrises ease. Only genuine upholstery rolls its top.

**2. The exponent is not a radius, but it scales with the part.** Measured plan-corner inset on a 1 m box: `0.012 → 3 mm`, `0.045 → 10 mm`, `0.20 → 47 mm`. Because it is an exponent, an 86 mm switch plate gets its own proportionate 0.3 mm from the same number — which is what you want, and what a radius would not give you.

**3. With a flat top, stations are pure waste.** `roundTop = 0` makes the solid a straight prism between two flat faces, so every station above the first two subdivides a vertical wall. Measured: the footprint at 12 stations is *identical* to the footprint at 2, for 7.7× the vertices. Gate stations on the upholstery case and spend the budget on `points`, which is where the shape actually is.

Together those three took the wardrobe from 10,080 vertices to 2,016 with no visible difference.

## The two dials, in bed.json's own vocabulary

- **`detail`** — `Blocky | Medium | Fine | Smooth`. One dial drives every sample count, so face count is a decision rather than a discovery. **`Blocky` must reproduce the old hard box exactly** — that is what makes the upgrade safe to apply across a whole library, because the old look stays one setting away and any regression is one click from being proved.
- **`edgeCharacter`** — `Crisp | Soft | Plump`. Crisp is deliberately not zero: a hair of ease is what catches a highlight along an arris, and a dead-square edge is the tell of a generated mesh. `Plump` means **upholstery** and is the only one that rolls the top.

Default `Fine` + `Soft`, except for soft goods — `cushion`, `bedding`, `rug`, `sofa`, `armchair`, `window-seat`, `upholstered-panel`, `curtain` — which default to `Plump`.

## The two patterns in this library

Almost every object builds solids one of two ways, and both soften mechanically.

**A. The shared quad table** (48 objects). A `Q` table whose rows are `[x1,y1, x2,y2, x3,y3, x4,y4, z0, z1, group]`, then ~20 lines of identical kernel that sweeps each quad into six faces. `softkernel.mjs` holds that kernel byte for byte and its replacement; `upgrade.mjs` swaps it, appends the two props and adds the two value wires. Same inputs, same `_FL` / `_PL` outputs, so nothing downstream moves.

Two things the replacement has to get right, both of which fail silently:
- **A softened row must not also come through as a hard box**, or every soft part carries a cuboid inside it — invisible until a section cut or a glass material shows it.
- **The hard list is SIX blocks of 4·n rows, face-major, not part-major.** The mask that drops a softened part has to be built in that order: `kron(ones(6,1), kron(keep, ones(4,1)))`. Get it wrong and a random-looking half of the object stays square.

**B. A rotated-rectangle table** (`door`, `window`). Centre, unit axis, half-extents, z range, extruded with `mprism` in a loop. Still a box, so it still softens — build it axis-aligned in the part's own frame, then rotate the skinned points back by that axis. `upgrade-rects.mjs` does it.

Anything built from `Solid.Cylinder`, tubes or rings is **already curved** and needs nothing: `downlight`, `pendant`, `ceiling-fan`, `plant-potted` and `water-heater` (a 32-side cylinder) all measured fine as they were.

## There is no element indexing

`Q[i, 10]` returns the **whole matrix**, silently — there is no `M[i,j]` in this language. Pull a row with `sub(Q, i, 0, 1, 11)` and take columns off that. This is the single easiest way to write a kernel that runs, produces numbers, and is wrong.

## Relief on the face is a separate job from easing the arris

The kernel swap above eases every edge. It cannot give a large flat surface a *face*, and on the two objects a bedroom is actually about that is the whole difference between furniture and a block:

| object | the untreated surface | what it became |
|---|---|---|
| `bed` | the headboard — one flat slab | **Channelled**: a flat backer carrying N padded channels, each a superellipsoid so its face ROLLS. 24 → 8 880 verts |
| `wardrobe` | the door leaves, the largest single surface in the room | **Shaker** (stiles, rails, a panel set back from the front face) or **Fluted** (vertical slats at a pitch with shadow gaps). 288 → 960 verts |

Three rules make this safe to do to a library object:

1. **Stay inside the existing thickness.** The channels live within `boardThk`, the shaker frame within the leaf's `_dT`. Overall extent does not move, so every plan that already placed the object is still correct.
2. **`detail` controls DENSITY; the style param controls whether the feature EXISTS.** `Blocky` is not the escape hatch here — `headboardStyle: "Wide panel"` and `doorFace: "Flat"` are. Blocky still builds the frame, just coarsely, because a shaker door is a design decision and not a smoothing setting.
3. **Fall back when it does not fit.** A wardrobe leaf narrower than ~2.2 × the stile width cannot be framed; the leaf silently stays flat rather than producing a frame with no panel. Measured: 8 leaves on a 1.2 m carcass all fall back.

**The trap both times was the DEFAULT.** Making `Channelled` the bed's default silently narrowed it 1.620 → 1.533 m, because the overhang only applied to `Wide panel`. A new default must inherit whatever the old default did to the footprint, or every existing instance moves.

And match the treatment to the mechanism: a **sliding** shutter is flat or fluted, never shaker-framed. The object default can only be one thing — set the other explicitly in the plan.

## Prove it, three ways

1. **Bake before and after.** Overall size must not move — anything over ~0.05 mm means the softening changed the object, not its finish. Vertex count must go up. The 2D plan must be byte-identical, because the drawing does not change.
2. **The face-run contract.** Within each render row, face ids must form contiguous runs of ≥ 3 vertices and no id may appear twice; the canvas groups by runs, so a split run welds two faces into one. Run it on the originals first and **diff** — this library has six objects that already fail it because they publish tube and ring rows through a polyhedron checker, and you need to know that before you blame your change.
3. **`Blocky` round-trip.** Set `detail: "Blocky"` and confirm the vertex count returns to exactly the original. If it does not, the two paths have drifted.
