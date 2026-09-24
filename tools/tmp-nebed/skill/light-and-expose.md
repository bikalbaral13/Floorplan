---
id: light-and-expose
name: Daylight in, warm light back — the lighting pass and the tone mapping
category: Floorplan Renderer
when: The scene pass is done and nothing is blocking the window. This is where a render stops looking like a viewport grab.
tools: [Bash]
requires: [unblock-and-fix-the-scene, inspect-the-blend]
---

## The mood recipe

**Cool daylight plus warm 3000–3500 K artificial light.** The *contrast between the two* is what reads as professional. A room lit only by its own warm lamps reads as a sodium car park; a room lit only by daylight reads as an estate-agent photo.

## Daylight

| Source | Setting | Why |
|---|---|---|
| Sun lamp | **4 W/m²**, colour `(1, 0.86, 0.72)`, angle **1.2°**, elevation **22°** | a low afternoon sun that actually reaches into the room; a high sun only lights the floor by the window |
| Sky (Nishita) | strength **0.6**, **sun disc OFF** | the lamp *is* the sun. Leaving the disc on gives you two suns and two shadows |
| Light portal | area light, `is_portal = True`, filling the window opening | far less noise from the sky than any sampling setting buys |

**Put the sun on the side the window is on.** The inspector reports which axis is north from the north arrow — on the 3BHK that was `+X`, not `+Y`, so "through the west window" meant `−X`. Getting this wrong puts the sun through a party wall and the room renders flat.

## Artificial light

| Fixture | Watts | Kelvin |
|---|---|---|
| Downlights (spot) | **9 W**, radius 5 cm | ~3500 K |
| Pendants (point) | **6 W** | ~3000 K |
| Cove area lights | **30 W** | ~3000 K |
| LED strip emissives | strength **6** | ~3000 K |
| Fan light kit | strength 1.5 | ~3000 K |
| Fan point light | **off** | the downlights carry the room |

## Wattage is almost always the problem, and colour almost never is

This is the trap worth stating carefully, because it looks like the opposite.

`render_plan.py` converts a fixture's real lumens to watts with **one number for the whole rig**, `--lm-per-w`, default **184**. A 650 lm downlight therefore arrives as **3.5 W**, and a cove as **4.9 W**. Measured on the 3BHK: `AREA ×14 total 42.8 W`, `POINT ×10 total 35.0 W` — against the table above, that is a **two-to-three-fold** shortfall, and it is why a first render comes back dim and muddy.

**Lower `--lm-per-w` to raise the whole rig.** At **80**, a 650 lm downlight lands at 8.1 W, which is where the table wants it. It is one number and it is the right lever — never edit individual lamps to compensate.

### The colour is not the bug it looks like

Every lamp in the file reads `rgb (1.0, 0.38, 0.1)`, which looks like a deep sodium orange and invites a "these are all 1800 K" diagnosis. **It is not.** Measured against Blender's own Blackbody node, rendered and read back as linear values:

| Kelvin | Blender Blackbody (linear) | `kelvin_rgb()` (linear) |
|---|---|---|
| 1800 | `(1, 0.208, 0.000)` | `(1, 0.210, 0.000)` |
| 2700 | `(1, 0.415, 0.099)` | `(1, 0.385, 0.096)` |
| 3000 | `(1, 0.477, 0.154)` | `(1, 0.441, 0.156)` |
| 3500 | `(1, 0.571, 0.259)` | `(1, 0.530, 0.266)` |
| 4000 | `(1, 0.653, 0.377)` | `(1, 0.616, 0.382)` |
| 5200 | `(1, 0.816, 0.679)` | `(1, 0.806, 0.663)` |

The two agree within 0.03 across the range. `(1, 0.38, 0.1)` **is** a physically accurate linear 2700 K — Blender's own 1800 K is `(1, 0.21, 0.0)`, far deeper. The conversion is correct and does not need fixing.

What is true is that a physically-correct warm colour, at too few watts, under AgX, reads orange — because the only light reaching the camera is the most saturated part of it. Fix the watts first and the colour usually stops looking wrong.

If it still reads too warm after that, desaturating is an **art-direction** choice, and the honest way to state it is as a temperature: use the linear colour of a cooler temperature than the fixture's nominal — nominal 3000 K rendered with the 4000 K value `(1, 0.65, 0.38)`. Say so in the report; do not call it a correction.

## Tone mapping

**AgX, look Medium High Contrast, exposure +0.35.**

Exposure is a view-transform stop — it costs nothing and does not need a re-render of the lighting. Settle it on a 30 % preview. Reach for `--exposure` before you reach for the lamps.

## The check

Re-run `inspect_blend.py` and read the `--- lights` and `--- world` blocks back:

- total watts per type, against the table above;
- `sun_disc` **off** on the sky node;
- sky strength around 0.6, not 1.0;
- one sun, not two.

A room with lamps and no portal is not broken, it is just noisy — but a room with the sky's sun disc *and* a sun lamp has two shadows, and that is the one people see immediately.
