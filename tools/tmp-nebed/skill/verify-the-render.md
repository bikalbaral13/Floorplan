---
id: verify-the-render
name: Prove the scene before handing over the .blend
category: Floorplan Renderer
when: The .blend is built. Nothing is reported until this passes.
tools: [Bash, Read]
requires: [render-a-floorplan, bind-plan-materials, frame-the-shot]
---

Six checks. The first five are numbers the build already prints and cost nothing; the sixth is the only one that finds what the numbers cannot, and it is the one that gets skipped.

## 1 — The bake carried everything

```
attachments N   with meshes N   faces F   via hidden rows 0
library: X/X objects resolved
```

`with meshes` must equal `attachments` bar the few objects that legitimately have no geometry (`room`, `opening`, `render-look`). `X/X objects resolved` must be equal — an unresolved object is a path that does not exist and everything downstream of it is missing, not wrong.

## 2 — Materials

```
materials  56 unique from 27 definitions
materials  33 bound from params.finishes, 126 from params.materialPath, 61 still on flat colour
```

The last number is how many rows are grey. Read the fall-through list by name. **`from 27 definitions` matters as much as `56 unique`**: if definitions is much smaller than unique, most materials are tints of a few procedurals, which is usually right; if it is 1, the embed failed and everything is wearing the same thing.

## 3 — Lamps, by order of magnitude

```
lights    1 sun, 41 spot, 10 point, 14 area   (lm/W 184)
```

Count them against the plan. Every downlight, pendant, fan light kit, cove, mirror halo and the sun should be there. **A zero in a category the plan populates is the failure mode** — for two years the area count was 0 on every plan because the loop only knew four fixture kinds, and nothing said so.

Sanity-check one number by hand: a 650 lm downlight at 184 lm/W is 3.5 W. If the scene is full of 650 W lamps, `--lm-per-w` was not applied and the render will be white.

## 4 — Cameras

```
cameras   9
```

One per camera attachment plus the plan view. If it says 1, no camera attachment had a baked anchor and you are looking at the fallback at the origin.

## 5 — The cut

```
cut       235 objects hidden above z=1.35 m
```

Zero means the flag did nothing and the plan view will be a picture of ceilings. A number close to the total object count means the cut is below the furniture.

## 6 — Open the images

**A render that came out black, brown, magenta or empty exits 0.** Every one of the five checks above passes on a scene whose cameras all face a wall.

- **The plan view**, `--camera 1 --res 800 --samples 24 --cut 1.35`. Every room should show its floor, its furniture and its fittings. A white rectangle is a ceiling that survived the cut; a black one is a room with no light reaching it.
- **One interior**, `--camera 2 --res 720 --samples 24`. This is where an unaimed camera shows up as a flat brown wall filling the frame. It is also the only place the lighting balance can be judged.

Magenta is a missing texture. Flat grey on everything is the embed having failed. A brown or cream field with a faint vertical edge is a camera 300 mm from a wall.

## 7 — Read the plan warnings as plan defects

`enrich_plan.mjs` prints every attachment whose `metrics.scale` is under 0.5. That is not a render problem: `fitMode: "Exact"` scales the whole object including its section, so the object is at the wrong height and the wrong thickness in the plan itself. Fix the plan and re-bake. A render that quietly draws 16 skirtings at 14 mm tall is worse than one that fails.

## What to report

- the three counts — geometry, materials, lamps — and the camera list;
- the material fall-through count **by name**, not just the number;
- every plan defect the render found, separately from anything the renderer did;
- where the `.blend` is, and the exact command to render it at full quality.

Never report a render as finished on the strength of exit codes.
