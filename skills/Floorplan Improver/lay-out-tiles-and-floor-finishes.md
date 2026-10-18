---
id: lay-out-tiles-and-floor-finishes
name: Tile every floor at a real size, pattern and set-out
category: Floorplan Improver
when: The fit-out set is chosen and each space needs its floor finish — the step the traced plan never has.
tools: [Bash, Glob]
requires: [choose-the-fitout-set, read-space-boundary-in-metres]
---

A traced plan has no floor. Tiling is one **space-hosted** `tessellation-with-math` attachment per space, and getting it right is arithmetic, not taste: a tile size that does not divide the room leaves a 40 mm splinter against one wall, and that single detail is what makes a render look amateur.

## The object

`objectId: "tessellation-with-math"`, `objectPath: "Objects/Architectural/tessellation.json"`, attached to the **space** (it takes the space outline as `P`). The params that matter:

| Param | Meaning | Use |
|---|---|---|
| `pattern` | `Square` · `Brick` · `Triangle` · `Hexagon` · `Rhombus` | the bond |
| `cellSize` | tile width, metres | 0.6, 0.8, 1.2 for vitrified; 0.3 for ceramic; 0.2 × 1.2 for plank |
| `cellLength` | tile length; `0` = square. **Only Square and Brick honour it** | a stretched hexagon is a different tiling, so the object ignores the aspect for the other three |
| `joint` | grout width, metres | 0.002 rectified, 0.003 normal, 0.008 ceramic, 0.010 outdoor |
| `angle` | pattern rotation, degrees | `0` straight, `45` diagonal |
| `originCorner` | `NW` · `NE` · `SW` · `SE` | which corner the lattice is phased from |
| `startOffsetX` / `startOffsetY` | shifts the lattice, metres | this is how a centred set-out is achieved |
| `fitMode` | `Clip to boundary` · `Whole cells only` | almost always clip |
| `height` | extrude, metres | **0.01**, not the 0.3 default — that default is a paving block, not a floor tile |
| `base` | level, metres | 0 in dry rooms, −0.015 in wet rooms |
| `materialPath` | `Finishes/…` | the real material, never left at the default |
| `material` / `semantics` | words the render reads | "800 × 800 ivory marble-look porcelain, matt, 2 mm matching grout" |

Two behaviours are worth knowing before you fight them. The object **forces a 1 mm joint when clipping** — two cells sharing an exact edge would be merged into one blob by the boolean, so a joint of 0 is quietly raised. And the cell count is **capped at 250 lattice cells**: ask for 50 mm mosaic in a 20 m² room and `cellSize` is silently floored, with `cellSizeUsed` in the output metrics telling you it happened. **Read `cellSizeUsed` back and compare it to what you asked for** — if they differ, the tile you specified is not the tile that was drawn.

## Set out from the centre, not from a corner

This is the rule that separates a professional layout from a default one. Phase the lattice so the **cut tiles at opposite walls are equal**, and so that no cut is narrower than half a tile.

For each axis, with room clear dimension `L`, tile pitch `p` = `cellSize` + `joint` (use `cellLength` + `joint` on the V axis for a rectangular tile):

```
n      = floor(L / p)              whole tiles that fit
rem    = L - n * p                 what is left over
offset = rem / 2                   half at each end  →  equal cuts
if offset < p / 2:  offset += p / 2  and n -= 1      →  no sliver thinner than half a tile
```

`offset` is what goes into `startOffsetX` / `startOffsetY`, measured from the room's min corner in the **pattern frame**. Compute it in the rotated frame when `angle ≠ 0`; the object rotates the host polygon by `angle` before it lays the lattice, so a 45° diagonal is set out against the rotated bounding box, not the room.

Report the resulting cut width per wall. A cut under 100 mm on a 600 mm tile means the tile size is wrong for the room — change the tile, not the offset.

## When nothing is said about the floor — the room defaults (user rule, 2026-09-24)

If the user has **not stated** a floor finish, every room of these types gets this material — before the
tile table below is consulted:

| Room type | `materialPath` | Laid as |
|---|---|---|
| Bedroom (incl. master, guest, kids) | `Finishes/oak-veneer.json` | plank: `Brick`, 0.2 × 1.2, joint 0.001 |
| Kitchen | `Finishes/marble.json` | `Square` 0.6, joint 0.002 |
| Toilet / bathroom / WC / powder | `Finishes/terrazzo.json` | `Square` 0.6, joint 0.002, anti-skid honed |

**"Not stated" includes "use the form's defaults".** The scope form's `floor_finish` default
(`vitrified`) is the form's convenience, not the user's choice; the user's rule wins over it. Only these
override the room defaults: an explicit answer to the floor questions, the prompt text, a mood-board
image the user gave, or a finishes schedule. Other room types (living, dining, corridor, balcony, utility…)
still follow the table below.

In code: `I.floorSpecFor(room.type, statedSpecOrNull, tableSpec)` returns `{ spec, source }`; pass
`spec` to `tileField` and put `source` in the report line for that room ("room default (nothing said)").
`ROOM_FLOOR_DEFAULTS` in `improve.mjs` is the single place these three live. Classification decides the
type, so a room the classifier calls `unknown` (e.g. "W.I.W") is not covered — say so in the report.

## The tile spec, by room

Defaults when the brief, the schedule or the image does not say. Every one of these is overridden by a finishes schedule without argument.

| Room | Tile | `pattern` | `cellSize` × `cellLength` | `joint` | `materialPath` |
|---|---|---|---|---|---|
| Living / dining | large-format vitrified | `Square` | 0.8 × 0 | 0.002 | `Finishes/tile.json` |
| Bedroom | vitrified, or timber plank | `Square` / `Brick` | 0.8 × 0, or 0.2 × 1.2 | 0.002 / 0.001 | `Finishes/tile.json` / `Finishes/light-oak.json` |
| Kitchen | anti-skid vitrified | `Square` | 0.6 × 0 | 0.003 | `Finishes/tile.json` |
| Bathroom | anti-skid ceramic | `Square` | 0.3 × 0 | 0.005 | `Finishes/ceramic.json` |
| Balcony | outdoor ceramic | `Square` | 0.3 × 0 | 0.010 | `Finishes/ceramic.json` |
| Corridor | match the room it serves | `Square` | 0.6 × 0 | 0.002 | as adjacent |
| Entry | contrast band or the living tile | `Brick` / `Square` | 0.6 × 0 | 0.003 | `Finishes/marble.json` |
| Utility / store | plain ceramic | `Square` | 0.3 × 0 | 0.005 | `Finishes/ceramic.json` |

**These are the only floor materials the library actually has**: `Finishes/tile.json`, `Finishes/ceramic.json`, `Finishes/marble.json`, `Finishes/terrazzo.json`, `Finishes/quartz.json`, `Finishes/light-oak.json`, `Finishes/walnut.json`, `Finishes/wood.json`, `Masonry/stone.json`, `Masonry/concrete.json`, `Site/gravel.json`. There is **no** `Finishes/porcelain.json` — porcelain is `Finishes/tile.json` with the word "porcelain" in `material` and `semantics`, which is where the renderer reads it. Writing a path the bucket does not hold gives a "(missing)" object on import, and check 5 of `verify-the-improvement` exists precisely because this is easy to get wrong.

**Timber plank** is `pattern: "Brick"` with `cellSize` 0.2, `cellLength` 1.2, `joint` 0.001 — Brick's half-cell row offset is exactly the running bond a plank floor wants. **Diagonal** is the same tile at `angle: 45`. **Herringbone and basketweave** are not in the object's pattern list; if the brief asks for one, either extend `tessellation.json` first (six-node spine, add the template and its lattice pitch, then re-validate) or use `Brick` and say in the report that the bond was substituted. **Never write a pattern value the object does not offer** — the expr falls through to Rhombus and you get a diamond floor nobody asked for.

## Wet rooms

A bathroom floor is not just a smaller tile:

- `base: -0.015` — the wet floor sits 15 mm below the adjoining room, which is what the threshold detail expects.
- the `floor-drain` goes at the **low point**, which is the corner furthest from the door inside the shower zone; keep its `showFall: true` so the fall zone is visible in plan, and keep the fall zone clear of the WC and the basin.
- `joint` 0.005 minimum — a rectified 2 mm joint is not a wet-area detail.
- Nothing floor-standing over the fall zone: it is a `surface`-band object and the check treats anything sitting in it as a fault.

## Skirting is the floor's edge, not the wall's

The tile stops at the wall face; the `skirting-with-math` on each wall run covers that junction. Two rules bind them:

- **skirting `materialPath` follows the floor** when the brief says tile skirting, and follows the wall when it says painted MDF. Say which in the report.
- **`skirting` and `shadow-gap` are alternatives, never both** on the same run. A shadow gap *is* the skirting detail; stacking them gives a 12 mm reveal 76 mm off the floor and reads as a modelling error.

Skirting is placed in `dress-ceiling-walls-and-trims`; this skill only fixes which one and what it is made of.

## Under rugs and under furniture

Tile the **whole** space. Do not cut the field around the wardrobe or under the bed — real floors run through, the tile field is a `surface`-band object, and the overlap check exempts it. A `rug-with-math` on the space sits on top at `height` 0.012 and is expected to overlap.

## What to write back

One attachment per space, plus the numbers in the report: tile size, pattern, joint, the computed `startOffsetX/Y`, the cut width at each of the four walls, and `cellSizeUsed` read back from the object's metrics. If `cellSizeUsed ≠ cellSize`, the cap fired and the report has to say so.
