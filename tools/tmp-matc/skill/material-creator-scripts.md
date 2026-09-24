---
id: material-creator-scripts
name: The Material Creator scripts — what each does and how to run it
category: Material Creator
when: Whenever another file in this skill runs a script. Copy the folder's scripts side by side into a scratch folder first.
tools: [Bash]
requires: []
---

# Scripts

Download the whole folder (`library/Skills/Material Creator/`) into one local scratch folder — the three
Python files import each other by sibling path. Blender 4.5 LTS:
`C:/Program Files/Blender Foundation/Blender 4.5/blender.exe`. All paths to Blender **absolute**
(background Blender resolves a relative output against the drive root).

| File | Run | Does |
|---|---|---|
| `mc_build.py` | imported (`import mc_build; mc_build.build(defn, name)`) | turns a `material/1` + `blenderGraph` JSON into a Blender material. Pure bpy, no app code |
| `mc_render.py` | `blender -b --python mc_render.py -- <mat.json> <out dir> [--shape plane\|cube\|sphere] [--size 3] [--view top\|persp\|both] [--samples 16] [--res 512] [--yaw 40] [--look standard\|agx] [--blend]` | the low-quality swatch: Cycles CPU, denoised, neutral white world + one raking sun, Standard view transform unless `--look agx` |
| `mc_image.py` | `blender -b --python mc_image.py -- <ref> [--crop x0,y0,x1,y1]` or `-- <ref> <render> [--crop …] [--crop2 …] [--out compare.png]` | measures a photo (mean, tones, k-means colours, contrast, stripe orientation + anisotropy, detail); with two images prints both + deltas and writes a side-by-side PNG. Uses the numpy bundled with Blender — nothing to install |
| `upload_material.mjs` | `node upload_material.mjs <file> <Category>/<name>.json [--force]` | the only step that touches R2. Run from inside the repo (`tools/<scratch>/`) so it finds `tools/r2.mjs`; refuses to overwrite without `--force`; reads back and compares sizes |

Timing on this 4-core CPU box: a 512 px swatch at 16 samples is ~15–30 s per view; `mc_image.py` ~5 s.

A failure prints a Python traceback from Blender; the usual ones:
- `KeyError: no socket 'X'` — a socket name wrong for Blender 4.5; the message lists the node's sockets.
- `link to unknown node 'x'` — a typo in a link, or the node id missing from `nodes`.
- `AttributeError` on a prop — a node property name or enum value wrong (`bands_direction` wants `'X'|'Y'|'Z'|'DIAGONAL'`).
