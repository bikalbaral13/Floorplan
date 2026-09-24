---
id: write-the-procedural-graph
name: Write the blenderGraph — a Blender node graph as JSON — and the flat material/1 fallback beside it
category: Material Creator
when: Step 3 of create-a-material, and every iteration after a compare. Covers the format mc_build.py reads, the node vocabulary, and a cookbook of layouts and figures.
tools: [Write, Edit]
requires: [read-the-material-from-an-image]
---

# Write the procedural graph

## The file

A normal `material/1` file with one extra block:

```json
{
  "schema": "material/1", "category": "Finishes", "id": "floor.laminate.oak-honey", "title": "…", "description": "…",
  "procedural": { … best single-node approximation … },
  "pbr": { "baseColor": "#b78c63", "roughness": 0.44, "metallic": 0 },
  "surface": { "coat": { … }, … },
  "blenderGraph": {
    "version": 1,
    "nodes": {
      "planks": { "type": "ShaderNodeTexBrick", "props": { "offset": 0.62, "offset_frequency": 2 },
                  "in": { "Vector": "@pos", "Brick Width": 1.22, "Row Height": 0.195, "Color1": "#000000", "Color2": "#ffffff" } },
      "tone":   { "type": "ShaderNodeValToRGB", "in": { "Fac": "grain:Result" }, "ramp": [[0.36, "#7a5533"], [0.64, "#c69c72"]] }
    },
    "out": { "Base Color": "joint:Result", "Roughness": "rough:Value", "Normal": "bump:Normal", "Coat Weight": 0.12 }
  },
  "plan2d": { … }, "dxf": { … }
}
```

- `type` — any Blender 4.5 shader node `bl_idname`.
- `props` — node PROPERTIES: `operation`, `blend_type`, `data_type`, `wave_type`, `bands_direction`,
  `offset`, `feature`, `distance`, `vector_type` …
- `in` — input sockets by name. A value is a number, a list (vector / RGBA), a `"#rrggbb"` colour, or a
  LINK `"<nodeId>:<Output>"`. Repeated names are indexed: Math has three `Value` inputs → `"Value"`,
  `"Value#1"`, `"Value#2"`; Vector Math ADD → `"Vector"`, `"Vector#1"`.
- `"@pos"` — world position in metres (the default and the library convention). `"@obj"`, `"@uv"`,
  `"@gen"` exist but break the metres rule; avoid them.
- `ramp` — ColorRamp stops `[position, "#hex"]` (only on `ShaderNodeValToRGB`); `interpolation` optional.
- `out` — Principled BSDF inputs by name (`Base Color`, `Roughness`, `Metallic`, `Normal`, `Coat Weight`,
  `Coat Roughness`, `Sheen Weight`, `Sheen Tint`, `Subsurface Weight`, `Transmission Weight`, `IOR`,
  `Anisotropic`, `Emission Color`, `Emission Strength` …) plus `"Displacement"` (→ Material Output, bump
  method).

Socket names that differ from what you might guess (Blender 4.5): Mix node inputs `Factor`, `A`, `B`,
output `Result` (set `data_type` FLOAT / RGBA / VECTOR); Noise output `Fac` and `Color`; Brick outputs
`Color` and `Fac` (Fac = mortar); Voronoi outputs `Distance`, `Color`, `Position`; Bump inputs
`Strength`, `Distance`, `Height`. **No Musgrave** (removed in 4.1 — use Noise with Detail/Roughness).

## Building blocks

| Need | Nodes | Notes |
|---|---|---|
| a layout with joints | `ShaderNodeTexBrick` | planks, tiles (Brick Width = Row Height), bricks. `Fac` = joint mask. `Color` with Color1 black / Color2 white and Bias 0 = **a random value per element** |
| per-element variation | Brick `Color` → a ColorRamp (tint) → Mix MULTIPLY | ±5–10 % is realistic; more reads as a patchwork |
| break continuity across joints | Vector Math SCALE (a big vector × per-element random) → ADD to `@pos` → feed the figure | without it grain runs straight across planks as if the floor were one board |
| anisotropic figure (grain, brushing) | Mapping `Scale` e.g. `[0.12, 8, 1]` → Noise | stretches features along the low-scale axis; 20–60× for wood grain and brushed metal |
| hairlines | a second, more stretched Noise (`[0.08, 40, 1]`) mixed in ~35 % | the fine figure a photo shows at close range |
| cathedral / arcs | Wave BANDS, low weight (~10–15 %), Distortion 3–5 | at high weight or high distortion it reads as sand dunes |
| cells, pebbles, terrazzo chips | Voronoi (F1 distance or Color) → ramp | leather: scale 300–500; terrazzo: 30–80 with a hard ramp |
| veining (marble) | Noise with Distortion 3–6 → ramp with a narrow dark band | |
| weave | two Wave BANDS at 90° multiplied, or Brick with tiny bricks | plus Sheen for fabric |
| roughness from the figure | Math MULTIPLY_ADD (fac × a + b), then + joint × c | joints rougher, figure slightly rougher than the flat |
| relief | Math → Bump `Height`, Strength 0.2–0.5, Distance 0.001 | joint = −1 × mask; grain = + 0.25 × figure |

## Calibrating the ramp — the lesson of the oak test

A Noise `Fac` lives mostly between **0.35 and 0.65**, a Wave's across the whole 0–1. Put ramp stops where
the driving value actually is, or most of the surface lands on one stop and the contrast collapses (the
first oak pass rendered at contrast 0.10 against the photo's 0.20). Start the stops at the measured
tones p10…p90, then shift them darker by the amount the render comes out bright.

## The flat fallback

`procedural` = the single node that best carries the look (the layout for a floor: Brick with the two
main tones and the joint colour); `pbr.baseColor` = the measured mean; `plan2d` hatch from
`none | diagonal | dots`; `dxf.pattern` from ezdxf's set (AR-PARQ1 for timber floors, AR-CONC, AR-SAND,
ANSI31/32, NET for tiles). These keep the canvas, DXF and the existing Blender importers working; only
this skill's `mc_build.py` reads `blenderGraph` today.
