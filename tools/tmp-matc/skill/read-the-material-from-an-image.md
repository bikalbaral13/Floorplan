---
id: read-the-material-from-an-image
name: Read a surface's colour, pattern, scale and finish from a photo — measured, not guessed
category: Material Creator
when: Step 2 of create-a-material, whenever the user gave a picture. Without a picture, fill in the same checklist from material knowledge and say every assumption.
tools: [Bash, Read]
requires: [material-creator-scripts]
---

# Read the material from the image

## 1. Crop to the material

Pick a rectangle that is ONLY the surface: no furniture, no rug, no sky, no cast shadow, no UI icons.
Write it as fractions `x0,y0,x1,y1` (origin top-left). The oak test: `--crop 0.1,0.6,0.84,0.98` — the
floor in front of the bed, stopping short of the zoom icons in the corner.

## 2. Measure

```bash
blender -b --python mc_image.py -- ref.png --crop 0.1,0.6,0.84,0.98
```

| Number | Use it for |
|---|---|
| `mean` | the `pbr.baseColor` fallback, and the target for the render's mean |
| `tones` p10…p90 | the COLOR RAMP stops, darkest grain to lightest figure |
| `dominant` (k-means 5) | a second opinion on the ramp; a colour with a big share that is far from the tones is usually a second material (joint, grout, veining) |
| `contrast` (p90 − p10 luminance) | how strong the figure is; oak laminate ≈ 0.20, lacquer ≈ 0.03 |
| `orientation` | stripe angle in the image and anisotropy (0 isotropic … 1 perfectly striped); grain, brushing, weave |
| `detail` | mean gradient: how busy the texture is at pixel scale — too high reads as noise, too low as plastic |

## 3. Look, and write down what numbers cannot say

- **What it is**: species / stone / weave / metal and finish ("honey oak laminate, satin, micro-bevel").
- **The layout**, if any: planks, tiles, bricks, herringbone, chevron, hexagons, a weave — and its size
  **in metres**, scaled from something known in the photo: a plank is 0.12–0.22 m wide and 1.2–1.8 m
  long; a bed is 1.5–2.0 m wide; a door 0.8–0.9 m; a floor tile 0.6 m; a brick 0.215 × 0.065 m.
- **Per-element variation**: does each plank / tile differ in tone? By how much?
- **The joint**: width, colour, is it a groove (darker, rougher, lower) or proud?
- **The figure**: straight grain, cathedral arcs, knots, veins, speckle, pile direction, brushing.
- **Finish**: matte / satin / gloss (how sharp the window reflection is), clear coat, sheen (fabric),
  metallic, translucency.
- **Relief**: embossed grain, bevel, weave depth — what should drive the bump.

## Without an image

Same list, from knowledge. Use real-world sizes and a restrained palette (a real oak is three or four
close browns, not a rainbow), state each choice ("honey tone, satin, 190 mm planks, random stagger")
and let the user correct it after the first swatch.

## Output of this step

```
Material: honey oak laminate floor, satin, long wide planks, V-groove joint
Layout:   planks 1.22 × 0.195 m, rows offset ~0.6
Tones:    #9a6f48 #af8359 #bc9166 #c3996f #cca378   joint #4a3322
Numbers:  mean #b78c63 · contrast 0.20 · anisotropy 0.66 · detail 0.024
Finish:   roughness ~0.4, light clear coat, grain bump faint, joint bump strong
Name:     <asked from the user>   Category: Finishes
```
