---
id: model-soft-goods-and-edges
name: Cloth, colliders, feature walls and the bevel that kills the CG tell
category: Floorplan Renderer
when: The room is lit and framed and still reads as blocks — parametric soft goods are stiff, every arris is a perfect 90°, and the focal wall is flat.
tools: [Bash, Write]
requires: [light-and-expose, inspect-the-blend]
---

A parametric duvet is a shaped slab. It is correct, and it reads as plastic. Three things fix a room: **cloth simulation on the soft goods**, **a feature element behind the focal wall**, and **a bevel on every hard edge**.

Run it as its own pass, after the scene and lighting passes, so a bad sim can be re-run without redoing anything else:

```bash
blender -b improved.blend -P model_upgrade.py -- pro.blend
```

## The collider gotcha — read this before any of the numbers

**An exported "loft" mattress is not a closed, outward-facing shell, so cloth falls straight through it.** This is not a settings problem and no amount of collision distance fixes it.

1. Replace the mattress with a **clean box** — Bevel 6 cm × 6 segments + Weighted Normal gives the pillow-top look.
2. Add a **hidden box proxy** for the bed base and use that as the collider.
3. Remove the collision modifiers after baking.

**Always bbox-check after a bake** (`inspect-the-blend`). The first attempts on the reference job ended at `z = −0.28` — fell through — and at `y-max 4.48` — slid off the foot. Both look plausible in an outliner.

## Duvet

- Grid **2.62 × 1.46 m**, **84 × 48** segments, started **4 cm** above the mattress.
- Cloth: quality **6**, mass **0.5**, tension/compression **20**, shear **8**, bending **2.5** (a thick duvet), air **1.5**, collision distance **12 mm**, collision quality **4**, **self-collision off** for speed.
- **Pin group on the head edge**, as if tucked under the pillows. Without it the heavy foot overhang drags the whole duvet off the bed — this is the most common single failure.
- **45 frames**, then freeze:

```python
me = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
# swap the mesh in, then remove the cloth modifier
```

- Then **Solidify 35 mm** (offset +1) + **Subdivision 1** + smooth shading.

## Knit throw across the foot

- Grid **2.74 × 0.58 m**, **90 × 20** segments, rotated **−3°** — never ruler-straight.
- Dropped onto the **frozen** duvet, which needs a collision modifier of its own.
- Mass **0.3**, bending **0.6** (drapey), **40 frames** → Solidify **12 mm** + Subdivision 1.
- Charcoal with a **Wave-texture bump** for the knit ribs.

## Accent cushions — pressure cloth

A cushion is not a modelled shape, it is an inflated cube.

- Cube subdivided **12** cuts, scaled to **0.46 × 0.46 × 0.07**.
- Cloth with **pressure 8**, **gravity 0**, bending **0.1**, **22 frames** → it inflates into a real cushion with pinched corners.
- Placed tilted **68°** against the pillows, with small yaw variation (**+6°, −5°, +2°**). Identical yaw on three cushions is as obvious as no cushions.
- Two rust velvet (sheen 1.0), one smaller oatmeal linen.

## Upholstered headboard

- **8 vertical channels** across the bed width (2.32 m), 0.16 m deep, **0.22 → 1.22 m** high, 6 mm gaps.
- **Bevel 45 mm × 5 segments** + smooth shading + **Weighted Normal** (keeps the ends sharp) → soft tufted channels.
- Taupe bouclé, sheen 0.6, fine noise bump. The bed base uses the same fabric.
- **Keep it narrower than the nightstands' span** — the parametric one intersected them.

## Fluted walnut feature wall

- Dark backer + **45 mm slats at 53 mm pitch** (8 mm shadow gaps), floor to cove (2.62 m), 3.28 m wide.
- Thin brushed-brass trims at both ends.
- **Vertical grain**: a Noise texture through a Mapping node scaled **(28, 28, 0.9)** so the grain stretches along Z. The stock object-space walnut reads as *marble* at wall scale — this is the fix, and it applies to any wood on a large vertical surface.

## Bevel everything hard

**Perfectly sharp edges are the number one CG tell.** A bevel catches a highlight along the arris, which is what every real manufactured edge does.

- **6 mm × 2 segments**, angle-limited, clamp overlap on: wardrobe, nightstands, TV unit, window-seat carcass / lid / plinth, skirting, sills.
- Window-seat cushions: **30 mm × 5 segments** + smooth shading.
- **Weighted Normal after any bevel you smooth-shade**, or the flat faces bleed into the arris.

If the objects came from the parametric library, much of this is already available upstream — `edgeCharacter` on a library object eases the arris at source, which is cheaper and survives a re-bake. Bevel in Blender only what the library cannot state.

## What to re-check afterwards

Bounding boxes on every simulated object, and the face count. Cloth at 84 × 48 plus Subdivision 1 is not free; if the render time jumps, that is where it went.
