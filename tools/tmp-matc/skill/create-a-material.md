---
id: create-a-material
name: Create a procedural material from a photo (or a brief), verify it with a low-quality Blender render, save it to the library
category: Material Creator
when: The user wants a new surface material — "make this floor", "a brushed brass like this photo", "a terracotta tile", "a grey chenille" — as a fully procedural Blender material saved to R2 `library/Materials/<Category>/<name>.json` under a name the USER gives. Blender headless only; no dependency on the app, its canvas or its flow engine.
tools: [Bash, Read, Write]
requires: [read-the-material-from-an-image, write-the-procedural-graph, render-and-compare, save-to-the-library, material-creator-scripts]
---

# Create a material

## The loop

```
1. ASK the name (and category) — the user names it; never invent the saved name
2. read-the-material-from-an-image   photo → crop → mc_image.py numbers + what the eye sees
   (no photo → the same list from material knowledge, stated out loud)
3. write-the-procedural-graph        material/1 JSON with a blenderGraph block
4. render-and-compare                mc_render.py (16 samples, 512 px, plane) → mc_image.py side by side
   repeat 3–4 until the numbers AND the picture agree — usually 3–5 passes
5. show the user the swatch PNG (and the side-by-side when there was a photo) and ASK:
   "save as <Category>/<name>.json, or change something?"
6. save-to-the-library               upload, read back, report the key
```

Step 1 and step 5 are the user's. Ask the name before starting if it was not given — the file name is
the library key other objects will reference, so it is theirs to choose. Ask again at step 5 before
writing to R2: the swatch is the proof, and saving is the commitment.

## What "totally procedural" means here

Every colour, pattern and relief comes from Blender shader nodes evaluated in **world space, in
metres** (Geometry ▸ Position): no image textures, no UV dependence. A 0.195 m plank is 0.195 m on a
floor, a wall or a sphere, and nothing tiles visibly because nothing is a bitmap.

The library schema `material/1` allows ONE texture node in its `procedural` block — enough for a plain
lacquer, never for a plank floor (layout + per-plank tone + grain offset per plank + joint). So this skill
writes an additional **`blenderGraph`** block: a small declarative node graph (see
`write-the-procedural-graph`) that its own `mc_build.py` turns into a real shader tree. The flat
`procedural` / `pbr` / `plan2d` / `dxf` blocks are still filled in as the best single-node
approximation, so every existing consumer of `material/1` keeps working; the schema string stays
`material/1` because consumers ignore keys they do not know.

## Render settings are part of the method

- **Cycles CPU, 16 samples, 512 px, denoised** — a check, not a beauty render (~15–30 s per view).
- **Standard view transform and a neutral white world by default.** Under neutral light a base colour
  renders close to its own hex, which is what makes a numeric comparison with a photo mean anything.
  A bluish sky reflecting in a clear coat turned the first honey-oak test grey-pink; AgX desaturates
  bright colours by ~10 %. Check once with `--look agx` before calling it finished.
- **Match the photo's angle** with `--yaw` (and compare the perspective view), or the orientation
  number compares a diagonal floor with a horizontal one.
- EEVEE Next renders flat magenta headless — Cycles only.

## What to report each pass

The swatch PNG(s), the side-by-side, and the four numbers from `mc_image.py` against the photo — mean
colour, contrast, anisotropy, detail — each with the change you would make next. Then ask.

Worked example (2026-09-24): a honey-oak laminate floor from a bedroom photo, five passes, recorded in
`render-and-compare.md`.
