---
id: render-and-compare
name: Render a low-quality swatch in Blender headless and compare it with the photo, by numbers and side by side
category: Material Creator
when: Step 4 of create-a-material, after every edit to the graph. Also the only step when there is no photo — the swatch is then the deliverable to show the user.
tools: [Bash, Read]
requires: [write-the-procedural-graph, material-creator-scripts]
---

# Render and compare

```bash
BL="C:/Program Files/Blender Foundation/Blender 4.5/blender.exe"
# 1. the swatch: a 3 m plane for floors/walls, --shape sphere or cube for fabric, metal, small parts
"$BL" -b --python mc_render.py -- <ABS mat.json> <ABS out/rN> --size 3 --samples 16 --res 512 --yaw 40
# 2. against the photo (crop each to the material)
"$BL" -b --python mc_image.py -- ref.png out/rN/<id>_persp.png --crop 0.1,0.6,0.84,0.98 \
      --crop2 0.1,0.45,0.9,0.98 --out <ABS out/rN/compare.png>
```

`mc_render.py` writes `<id>_top.png` (orthographic, straight down — the pattern at true scale) and
`<id>_persp.png` (low and long, like a photographed floor — gloss and foreshortening). Always open the
PNGs: a magenta, black or grey swatch still exits 0.

## Reading the delta

| Delta | Meaning | Fix |
|---|---|---|
| `meanRGB` all + / all − | render brighter / darker | shift every ramp stop the same way |
| one channel off | hue shift | usually the lighting (keep the neutral world) or a tint ramp too warm/cool |
| `contrast` − | figure too weak | spread the ramp stops, place them where the Fac actually lives, raise per-element tint range |
| `anisotropy` + | too striped / regular | lower the stretch, raise distortion, less Wave |
| `anisotropy` − | too blotchy | more stretch on the grain noise |
| `detail` + | busy, noisy | lower Detail / scale on the finest layer, or weaker hairlines |
| `detail` − | plasticky | add a fine layer (hairlines, speckle), a little more bump |

The numbers catch drift; the side-by-side catches character. A delta near zero on all four with a picture
that looks wrong (dunes instead of grain) is still wrong — trust the picture, then use the numbers.

## Worked example — honey-oak laminate, 2026-09-24

Photo crop: mean `#b78c63`, contrast 0.201, anisotropy 0.66, detail 0.0238.

| Pass | Change | Render mean | Contrast | Aniso. | Detail | What it looked like |
|---|---|---|---|---|---|---|
| 1 | first graph, AgX, bluish sky | `#b3967f` | 0.102 | 0.69 | 0.017 | grey-pink, zig-zag bands across the planks |
| 2 | neutral world + Standard view; finer wave, less distortion | `#c59973` | 0.137 | 0.90 | 0.029 | right hue, corduroy stripes |
| 3 | ramp darker, more distortion, camera yaw 40° | `#bd926e` | 0.148 | 0.85 | 0.030 | sand dunes |
| 4 | stretched noise dominant + hairlines, wave only 12 % | `#c19671` | 0.146 | 0.83 | 0.024 | wood planks with grain |
| 5 | joint 3 mm (1.5 mm broke up at 512 px), wider plank tint, darker ramp ends | `#ba8f6c` | 0.176 | 0.80 | 0.028 | close; grain still a little busier and more striped than the photo |

What the passes taught, in order of effect: the **lighting** decides whether colour can be compared at
all; **what dominates the figure** (stretched noise, not a wave) decides whether it reads as wood; the
**ramp placement** decides contrast; a joint below one pixel at the test resolution looks broken, not fine.

## Stop and ask

After a pass where all four deltas are small and the picture reads right — or after 5 passes, whichever
comes first — show the swatch(es) and the side-by-side, list what still differs, and ask the user
whether to save or which difference to work on next.
