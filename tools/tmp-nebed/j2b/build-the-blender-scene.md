---
id: build-the-blender-scene
name: Build the Blender scene
category: Json to Blender Render Ready
when: Running or debugging `render_plan.py` — the Blender half, which turns the baked payload into a lit scene, stills and a GLB.
files: [render_plan.py, bp_materials.py]
---

```bash
blender -b --python render_plan.py -- <plan>.baked.json --out <dir> [flags]
```

Blender 4.5 LTS at `C:/Program Files/Blender Foundation/Blender 4.5/blender.exe`. The script is standalone —
it does not need the House addon enabled, and it does not touch it.

## The frame

Canvas → Blender is `(ax + x, −(ay + y), z)`. The y flip is the whole of it: the canvas measures y downward
from the top-left, Blender measures it upward. Face rings are anchor-relative metres, so the anchor is added
before the flip and never after.

Bearings are `rotation + 90°` measured `atan2(x, −y)` — the convention the camera objects' own view cones
are drawn with, checked against all four of them. A tilt is signed from the horizon, negative downward,
except a downlight's, which the object measures from straight DOWN.

## One object per render row

A wardrobe arrives as seven objects, not one with seven material slots. Seven objects cost a path tracer
nothing, and they make a material swap, a hide or a per-part UV scale a one-liner rather than a
polygon-index hunt. Every one carries `bp_host`, `bp_object`, `bp_row`, `bp_surface` and `bp_material`.

Rings with fewer than three points, and rings whose cleaned index list repeats a vertex, are dropped — a
degenerate ring is a zero-area face and Blender's own validator would remove it later, less quietly. Expect
the face count in the .blend to sit **below** the baker's: the baker counts rings, this counts polygons that
survived.

## UVs nothing asked for

Every mesh gets a planar UV in metres, the axis chosen per face from its dominant normal. Procedural
materials do not use it — they read world-space `Geometry ▸ Position`, which is what keeps a 230 mm brick
230 mm on a part of any size. It exists for two other consumers: an image map in a material, and glTF, which
has no concept of world-space projection and would otherwise export a flat colour. Because both projections
are metre-scaled world space, an image map and its procedural sibling agree between the render and the GLB.

## Lights the plan did not ask for

The fixtures are geometry. The object library draws a housing and a beam cone and explicitly does no
photometry — but its parameters carry real lumens, kelvin and beam angles, so each becomes a real lamp:

| Object | Lamp | Placed at | From |
|---|---|---|---|
| `light` type Directional | `SUN`, stood 6 m back along its own ray | mount height | lumens ÷ emitter area = lux |
| `light` type Spot / Point / Area | matching lamp | mount height | `coneAngle`, `sizeLength × sizeWidth` |
| `downlight` | `SPOT` | `ceilingHeight`, aimed from straight down by `tilt` | `beamAngle`, aperture → shadow softness |
| `pendant` | `POINT` | inside the shade, above `bottomHeight` | shade diameter → shadow softness |
| `ceiling-fan` | `POINT`, only if it states lumens | below the soffit | |

**lm → W divides by `LM_PER_W`, default 184** — 683 lm/W at the peak of the eye's response, times the ~0.27
luminous efficiency of a broadband white source. It is one number for the whole rig on purpose: tuning it
per fixture would destroy the only thing that makes the plan's photometry worth carrying, which is that the
fixtures are in the right ratio to each other. If the room is too bright, raise `--lm-per-w`; if the
daylight alone is wrong, use `--sun`; if it is only the picture, use `--exposure`.

## Cameras, world, engine

Cameras take `focalLength`, `sensorWidth`, `eyeHeight` and the bearing; a **Two-point** view is an ordinary
perspective with the tilt forced to zero, which is what keeps verticals vertical. The render resolution
follows each camera's own `aspect`.

The world is a **Nishita** sky aligned to the Directional light, with **the sun disc off** — the SUN lamp
already does the direct light and leaving both on doubles it.

Cycles, CPU, OpenImageDenoise, AgX. **EEVEE is not offered**: EEVEE Next renders flat magenta in background
mode on a machine with no GPU device, and the failure looks exactly like a material bug.

## Budget

Four cores, no GPU. About 45 s per view at 640 px / 24 samples, and roughly 15–25 minutes at 1600 px / 128.
Look at a 640 px view before spending that.

## When the render is wrong

| What you see | Where to look |
|---|---|
| Flat magenta | The engine got switched to EEVEE. |
| Black frame | No lamp built — check the `lights` line, then whether the fixtures carry `lumens`. |
| Blue cones, camera bodies | A helper rule stopped matching; check `helpers.match` in the finishes file. |
| Everything grey | `materials` missing from the payload — the embed step failed in the bake. |
| Washed out / soot dark | `--exposure` first, `--lm-per-w` second. Never the individual lamps. |
| A wall you can see through | That wall is a band the canvas draws, not a solid — check the plan, not the scene. |
