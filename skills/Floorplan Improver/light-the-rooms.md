---
id: light-the-rooms
name: Light every room from a lux target, in groups the render can switch
category: Floorplan Improver
when: Furniture is chosen and the ceiling heights are fixed — now the lighting layer.
tools: [Bash]
requires: [read-the-plan-and-brief, choose-the-fitout-set, dress-ceiling-walls-and-trims]
---

Lighting is the layer that most obviously separates a traced shell from a finished plan, and it is the one most often faked. A ring of six downlights at a guessed pitch is not a lighting design. Work the layers, then the arithmetic, then the groups.

## Four layers, every habitable room

1. **Ambient** — the general wash: a `downlight` grid, or a `light-panel` in a kitchen or utility, or a `false-ceiling` cove (its `coveLed` is a light in its own right).
2. **Task** — where work happens: `pendant` over a dining table or a kitchen island, `downlight` over a counter run, `track` + `track-head` over a desk or a display wall, `mirror` with `backlit: true` at a basin.
3. **Accent** — what makes it a photograph: `wall-washer` down a feature wall, `track-head` on art, `led-strip` or `cove-light` in a niche, `nightstand` with `underLed: true`.
4. **Decorative** — the object you look *at*: `chandelier`, a hung `pendant` pair, a `floor-lamp` beside a chair.

Plus, in every habitable room in this climate, a **`ceiling-fan`** at the room's centre — with `lightKit` or `ringLight` on where it is the only ceiling fitting.

## The downlight grid is computed, not guessed

`lighting-layout-with-math` does the lumen method for you and is the right way to get the count. Attach it to the space, read the result, then place the individual `downlight` objects at the positions it implies.

```
N = (targetLux × area) / (fixtureLumens × utilisationFactor × maintenanceFactor)
```

with `utilisationFactor` 0.5, `maintenanceFactor` 0.8, `reflCeiling` 0.7 / `reflWall` 0.5 / `reflFloor` 0.2, `workPlane` 0.75, `spacingRatio` 1.2, `edgeSetback` 0.6, `arrangement: "Grid"`.

Target lux by room — these are the numbers to design to:

| Room | Ambient lux | Notes |
|---|---|---|
| Bedroom | 100–150 | low ambient, lift it with task and accent |
| Living | 150–200 | 300 over a reading chair |
| Dining | 150 | the pendant does the work over the table |
| Kitchen | 300 | 500 on the counter run |
| Bathroom | 200 | 300 at the mirror |
| Study | 300 | 500 at the desk |
| Corridor | 100 | |
| Utility / store | 150 | |
| Balcony | 50 | `outdoor-light` |

Then place: `mountHeight` = the **`panelSoffit`** of the false ceiling (never 2.7 by default), `edgeSetback` 0.6 m from the wall face, the grid **centred on the ceiling panel** and aligned to the room axes, spacing ≤ `spacingRatio × (mountHeight − workPlane)`. Round the count up to a symmetric arrangement — five downlights in a rectangular room is always wrong; go to four or six.

A downlight that will be seen edge-on in a render carries `aimTilt` 0 in the field and 20–30° only when it is washing a wall, in which case it is a `wall-washer` at `offsetFromWall` 0.9 and not a downlight at all.

## What hangs where

- **`pendant`** over a dining table: centred on the table, `bottomHeight` 1.5–1.6 m above finished floor (not above the ceiling), `mountHeight` = `slabHeight`. Two or three in a row over a table longer than 1.6 m, spaced at `length / (n + 1)`.
- **`chandelier`** in a living or dining room with `slabHeight` ≥ 3.0 m, centred, `mountHeight` = `slabHeight`, `chainLength` set so the bottom clears 2.1 m.
- **`ceiling-fan`** at the room centre — **not** on the solver's boundary list; the solver slides things along a wall, which is the wrong answer for anything on a ceiling. Set `ceilingHeight` = `slabHeight`, `rodLength` so the blades sit 2.4–2.6 m above the floor.
- **`cove-light`** / **`led-strip`** along the false ceiling perimeter: `slabHeight` and `coveDrop` must match the `false-ceiling`'s `bandSoffit`, or the strip floats in front of the band.
- **`floor-lamp`** beside a reading chair, in the corner the furniture layout left.

## Every light carries its electrical identity

A light without these renders as a grey box, and the Blender pipeline has nothing to switch:

- **`lamp`** — a real path under `library/Photometry/`. **These nine are all there are**: `Photometry/LED/cob-spot-3000k.json` (downlight, wall-washer), `Photometry/LED/gu10-spot-3000k.json` (track head), `Photometry/LED/e27-globe-2700k.json` (pendant, chandelier, floor lamp), `Photometry/LED/panel-4000k.json` (light panel), `Photometry/LED/tape-warm-2700k.json` (cove, LED strip, pelmet), `Photometry/LED/tape-neutral-4000k.json` (backlit mirror), `Photometry/LED/linear-darklight-3000k.json` (linear recessed), `Photometry/Daylight/sun-clear-noon.json` (the sun), `Photometry/Daylight/sky-overcast-6500k.json` (daylight portal). Anything else is a path that does not resolve.
- **`lightGroup`** — the switchable circuit. Use the established names: `downlights`, `cove`, `pendants`, `accent`, `wallwash`, `ambient`, `decorative`, `mirror`, `daylight`, `fill`. One group per switch on the wall, which is what `wire-services-and-render-kit` then wires.
- **`lumens`**, **`kelvin`**, **`cri`** — real values. 650 lm / 3000 K / CRI 90 is a domestic COB downlight; 320 lm / 2700 K a decorative pendant lamp; 900 lm/m for tape.
- **`dimLevel`** and **`dimToKelvin`** — a warm-dim fixture set to 70 % at 2400 K is what "warm hotel bedroom" actually means in numbers.
- **`sceneMembership`** — comma-separated from `Bright`, `Relax`, `Night`, `Photo`, `Day`. This is how one plan renders four different moods without being re-lit. Ambient and task go in `Bright, Photo`; cove and accent in `Relax, Night, Photo`; daylight in `Photo, Day`.
- **`emitsLight: true`** and **`showEmissiveSurface: true`** unless you specifically want a dark fixture.

## Colour temperature is one decision per home

Mixing 3000 K downlights with 4000 K panels in adjoining rooms is the single most common tell of an auto-generated plan. Pick one:

- **2700 K** warm — bedroom, living, dining, hospitality.
- **3000 K** warm white — the general-purpose default; use it for everything if the brief says nothing.
- **4000 K** neutral — kitchen, bathroom mirror, utility, study task lighting, and **only** those.

## Daylight is a light too

Every window that matters to a render gets a **`daylight-portal`** on its opening: `openingWidth` and `sillHeight`/`headHeight` from the window you measured, `skyType` `CIE Clear` or `CIE Overcast`, `exteriorIlluminance` 10000, `glazingTransmittance` 0.7, `lightGroup: "daylight"`. Without it the interior renders black at the glass and the render engine has to guess.

## Brightness that survives the render (measured 2026-09-24)

A plan lit to the letter of the lumen method at 100 lux with 650 lm downlights rendered **dark and orange** —
correct photometry, but under AgX a 3000 K room at that level reads as dusk. Rendered bright and clean at:

| Emitter | Write explicitly | Default |
|---|---|---|
| downlight | `lumens` | **900 lm** (not 650); `fixtureLumens: 900` in `lumenMethod` |
| bedroom target | `targetLux` | **150 lux** (living 200, kitchen/bath 250–300, wardrobe 200) |
| false-ceiling cove | `lumensPerMetre`, `emitsLight: true`, `dimLevel: 100` | **1400 lm/m** |
| ceiling-fan light kit | `lumens` | **2200 lm** |
| backlit mirror | `lumensPerMetre` | 700 lm/m |

**Write the output of every emitter into its params, even when it equals the object's default.** An
attachment stores only what the builder wrote, and the render pipeline reads those params — not the
object file. A cove written without `lumensPerMetre` bakes fine and emits nothing. `emitterFaults(plan)`
in `improve.mjs` lists every emitter missing its output; it must return `[]`.

## The completion gate

Do not move on until every habitable space has: an ambient source, at least one task or accent source, a fan or a decorative fitting, and — in a room with a window — a daylight portal. State the computed lux and the fixture count per room in the report, so a dark room is visible rather than quietly shipped.
