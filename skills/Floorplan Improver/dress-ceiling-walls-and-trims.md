---
id: dress-ceiling-walls-and-trims
name: False ceiling, cornice, skirting, shadow gaps, curtains and wall panels
category: Floorplan Improver
when: Furniture and lighting are decided — this is the layer that makes the room read as built rather than blocked out.
tools: [Bash]
requires: [read-the-plan-and-brief, light-the-rooms]
---

These are the cheap objects that do the most work. The reference bedroom carries **six `skirting`, six `cornice` and six `shadow-gap` attachments** — one per wall run — and one `false-ceiling` on the space. A room without them reads as an untextured box no matter how good the furniture is.

## The ceiling, on the space

One `false-ceiling-with-math` attached to the space. The three heights come from `read-the-plan-and-brief` and every other ceiling-mounted object must agree with them:

```
slabHeight   the structural soffit, from wall-with-math's height   (3.3528 in the reference)
bandSoffit   underside of the perimeter band                        slabHeight − 0.38
panelSoffit  underside of the centre panel                          slabHeight − 0.23
```

- `bandWidth` 0.30–0.45 m; `bandSides: "All four"` in a regular room, `"Long sides"` in a corridor or a room under 3 m wide.
- `edgeProfile`: `"Shadow gap"` for a contemporary brief, `"Stepped"` for a classical one, `"Square"` when the brief said nothing.
- `coveLed: true` with `ledInset` 0.05, `lumensPerMetre` 900, `kelvin` matching the house temperature, `lightGroup: "cove"`, `sceneMembership: "Relax, Night, Photo"`. This is a real light — count it in the lux budget.
- `opening: true` only where a fan or a chandelier drops through the panel.

**A bathroom, utility or store gets no false ceiling** unless the brief asks; they get a flat soffit and a `light-panel`.

## Trims, on wall runs

Each is segment-hosted on **one wall piece**, with `fitMode: "Fill segment"` so the length comes from the wall and is never typed. A run interrupted by a door or a window is several pieces — attach one trim per piece, not one across the opening.

| Object | Where | Key params |
|---|---|---|
| `skirting` | base of every wall run in a dry room | `height` 0.076–0.100, `thickness` 0.018, `profile` `Square`/`Chamfered`/`Shadow gap` |
| `shadow-gap` | base of every wall run in a contemporary brief — **instead of** skirting | `gapHeight` 0.012, `gapDepth` 0.018, `position: "Wall base"` |
| `cornice` | head of every wall run, where the brief wants one | `projection` 0.06, `drop` 0.08, `profile` `Stepped`/`Cove`/`Shadow`, `ceilingHeight` = `bandSoffit` |
| `curtain-track` | over every curtained window | `mountHeight` = `bandSoffit`, `mount: "Recessed"`, `length` = window width + 2 × 0.15 |
| `curtain-pelmet` | over a window where the brief wants concealed hardware | `ceilingHeight` = `slabHeight`, `faceDrop` 0.18, `ledLip: true` |
| `wall-art` | on a wall run ≥ 1.5 m clear, at eye level | `centreHeight` 1.5, `arrangement` `Single`/`Pair`/`Triptych` |
| `mirror` | over a basin, in an entry, in a dressing area | `sillHeight` 1.0, `backlit` at a basin |
| `tv` | on the wall the sofa faces | `screenHeight` 1.1 |

**`skirting` and `shadow-gap` are alternatives.** Pick one per room from the brief and apply it to every run in that room — mixing them within one room is a modelling error, not a design choice.

**Bathrooms get no skirting and no cornice** — the wall tile runs to the floor and the ceiling.

## Feature walls

One per room at most, and only where the furniture gives it a reason:

- **`upholstered-panel`** behind a bed. `length` = bed width + 2 × 0.4 (or the full wall run if shorter), `height` = `bandSoffit`, `pattern: "Vertical channels"`, `haloLed: true` with `ledInset` 0.02 — that halo is a light, so give it a `lightGroup` and count it.
- **`fluted-panel`** behind a TV, in an entry, or on a dead wall. `flutePitch` 0.051, `profile: "Half-round"`, `height` = `bandSoffit`; `cutout: true` when the TV is recessed into it.
- **`backplate-plane`** where a plain accent-painted or stone plane is wanted instead.

Feature panels are `wall`-band objects and sit **in front of** the wall face. Anything floor-standing against that wall moves out by the panel's `backerThk` + `paddingDepth` — a bed pushed to the wall centreline ends up inside the headboard panel.

## Curtains come from the window, never from a guess

For each window that earns one (`choose-the-fitout-set` says which):

- `curtain-with-math` as a **node** object at the window's centre, `width` = the window's clear width + 2 × 0.15 overlap, `drop` = `railHeight` − 0.006, `railHeight` = `bandSoffit`, `layers: "Sheer + blackout"` in a bedroom, `"Sheer only"` in a living room, `mount: "Recessed track"` when there is a pelmet.
- It hangs ~90 mm inside the wall face. `stackSide: "Both"` unless furniture blocks one side.
- The matching `curtain-track` or `curtain-pelmet` goes on the wall **segment** above it.

## Styling — the last 5 % that reads as 50 %

- **`rug`** on the space, `fitMode: "Max"`, `margin` 0.4, under the seating or the foot of the bed.
- **`cushion`** against a bed head or on a sofa, `count` 3, `seatHeight` matching the bed platform or the sofa seat.
- **`decor-cluster`** on every horizontal surface that would be bare in a photograph — each nightstand, the media console, a console table. `style: "Mixed"`, `baseHeight` = the host surface's top.
- **`plant-potted`** in the corner the furniture layout left empty; one per living room corner, one per bedroom.
- **`bedding`** on every bed, matched to the bed's `width`/`length`, `mattressTop` = `platformHeight` + `mattressThk`.

Every one of these carries `materialPath`, `finishes` and `semantics`. `decor-cluster` on `Finishes/paper.json` with no semantics renders as grey blocks; with `"lived-in styling on a console, quiet, not staged"` it renders as styling.
