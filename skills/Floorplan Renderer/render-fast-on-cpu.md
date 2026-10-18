---
id: render-fast-on-cpu
name: A presentation still in under five minutes on a laptop
category: Floorplan Renderer
when: The scene, lighting and modelling passes are done and it is time to spend real seconds. Also read it before the first test render, to pick the engine.
tools: [Bash, Read]
requires: [light-and-expose, model-soft-goods-and-edges, verify-the-render]
---

The reference job: **Blender 4.5.3 LTS, Intel i5-6200U (4 threads), Intel HD 520, no usable GPU. 1600 × 1000 PNG in 4 min 5 s** — load, BVH, ~200 s sampling, denoise.

## Benchmark first, then choose the engine

| Test | Result | Decision |
|---|---|---|
| Cycles CPU, 640 × 400, 16 spp | **52 s** (~3 s per sample at 0.25 MP) | usable **with a time cap and a denoiser** |
| Eevee Next, 1280 × 800, 32 spp | 78 s shader compile, **all-red output** (Intel HD driver bug) | ✗ unusable on this GPU |

Rule of thumb on a 4-thread laptop: **1600 × 1000 Cycles gets about 13–25 samples in 200 s.** With OpenImageDenoise plus albedo and normal passes, that is clean enough for a presentation still.

Run the benchmark on the actual scene, not a default cube — BVH build on a 143 k-face interior is a real part of the budget.

## Settings

| Setting | Value | Why |
|---|---|---|
| Device | CPU | when the GPU is unusable, say so and move on |
| Resolution | 1600 × 1000 @ 100 % | presentation size |
| Samples | **256 max, time limit 200 s** | the cap is what guarantees the budget; the sample count never binds |
| Adaptive sampling | on, threshold **0.04**, min **8** | spend samples where the noise actually is |
| Denoiser | **OpenImageDenoise, Albedo + Normal, prefilter Accurate** | this is what makes 13–25 spp presentable |
| Light tree | **on** | essential with many lights — 66 in the reference file, 66 in the 3BHK |
| Bounces | max 6 / diffuse 3 / glossy 2 / transmission 4 / transparent 8 / volume 0 | enough GI for an interior, and fast |
| Caustics | reflective **off**, refractive **off** | noise killers, and the architectural glass shader makes them pointless |
| Filter glossy | 1.0 | fewer fireflies |
| Clamp indirect | 6 | fewer fireflies |
| Colour | AgX, Medium High Contrast, exposure **+0.35** | |

**The time limit is the setting that matters.** `samples` is an upper bound you will never reach; `time_limit` is the promise you are making about the render.

## The preview loop

Same file, `resolution_percentage = 30`, `time_limit = 0`, `samples = 12` → **about 30 s a look**.

Composition, materials, sims and exposure all get settled here. Spend the four minutes **once**, at the end. Anyone iterating at full resolution is spending forty minutes to learn what thirty seconds would have told them.

## Run every pass as a script against the original

Never by hand in the UI. Each pass takes the previous file and writes the next, so any step can be re-run in isolation and the whole thing is reproducible:

```bash
blender -b original.blend  -P scene_pass.py      -- improved.blend
blender -b improved.blend  -P model_upgrade.py   -- pro.blend
blender -b pro.blend -o //render_# -F PNG -f 1
```

## Checklist for the next room

- [ ] Find north and the room's floor-plate bounds — `inspect-the-blend`
- [ ] List everything inside the room's bbox; hide helpers, duplicates, bad props
- [ ] Windows: curtains open, architectural glass, portal light
- [ ] Sun lamp 3–5 W/m², sky sun disc **off**, low sun angle through the actual window
- [ ] Artificial light 3000–3500 K; check **total watts**, not colour
- [ ] Fix plan-export materials — screens, frames, art, columns, plants
- [ ] Level camera, 16–20 mm, ~1.2 m eye height, **shift not tilt**
- [ ] Soft goods: cloth sims on clean proxy colliders, pinned edges, **bbox-check after baking**
- [ ] Bevel every hard edge; Weighted Normal on smooth-shaded bevelled boxes
- [ ] A feature element behind the focal wall
- [ ] Previews at 30 % / 12 spp, then one final render with `time_limit`
- [ ] **Open the PNG** — a black render exits 0

## When there is more time

Raise `time_limit`, render at 2400 × 1500, and swap the Nishita sky for a real HDRI. In that order — the HDRI is the one that changes the look, the other two only change the noise.
