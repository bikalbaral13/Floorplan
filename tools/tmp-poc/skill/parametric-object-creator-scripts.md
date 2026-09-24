---
id: parametric-object-creator-scripts
name: The scripts that ship with Parametric Object Creator, and how to wire them for a new object
category: Parametric Object Creator
when: Whenever another file in this skill says to build, check, publish, fetch materials, render or export. Lists every script, where to put it, its arguments and what it proves.
tools: [Bash, Read, Write]
requires: []
---

# Scripts

Copy them into a repo scratch folder per object, `tools/tmp-<object>/` — they resolve `@builderpluss/engine`
and `../r2.mjs` relative to that location. The worked example is `tools/tmp-chair/` (chair.json, 2026-09-24).

| File | Run | Proves |
|---|---|---|
| `build.mjs` (write per object — template: `tools/tmp-chair/build.mjs`) | `node tools/tmp-<object>/build.mjs` | writes `out/<name>.json` from `expr.txt` + props/slots/rows/materials/edges |
| `check_object.mjs` | `node tools/tmp-<object>/check_object.mjs out/<name>.json [--set k=v]… [--obj out/<name>.obj]` | evaluates the Math Engine headlessly; prints eval ms, per-row faces, SIGNED VOLUME, bounds, plan rings, every scalar metric; `PASS` / `FAIL n` |
| `upload.mjs` (write per object — template: `tools/tmp-chair/upload.mjs`) | `node tools/tmp-<object>/upload.mjs` | puts the object (and any new material) in R2 and reads each back to compare byte counts |
| `npm run bake` (repo) | `npm run bake -- <file-or-r2-url> --out out/<name>.baked.json [--set k=v]` | the APP's own resolver (`spineObject.ts`); `resolved.meshes` carry faces + material links. ~80 s, mostly esbuild bundling |
| `fetch_materials.mjs` | `node tools/tmp-<object>/fetch_materials.mjs out/<name>.baked.json out/mats` | every linked material + `bp_materials.py` downloaded; `MISSING` for a link R2 lacks |
| `render_object.py` | `blender -b --python tools/tmp-<object>/render_object.py -- <ABS baked> <ABS mats> <ABS out> --samples 16 --res 640 [--view front]` | `still.png`, `<name>.blend`, `<name>.glb`, `report.json` (row → material or MISSING) |

Blender: `C:/Program Files/Blender Foundation/Blender 4.5/blender.exe`. This box has 4 cores and no GPU
device — 16 samples at 640 px for one small object is well under a minute. Launching the Blender GUI from a
backgrounded shell kills it; to open the .blend for the user use `cmd //c start "" "<blender.exe>" "<file>"`.

## check_object.mjs — what each failure means

| Output | Meaning | Fix |
|---|---|---|
| `eval` > ~1500 ms | too slow for the editor | look for `max/min/sum` over a whole mesh column (compute from station vectors), per-point loops (broadcast with `kron`), oversized sample counts |
| `signed volume … (inside-out?)` | a closed solid wound the wrong way | reverse its ring (`sortby(ring, 0 - arange(n))`) based on the ring's shoelace area. Open sheets (cloth) legitimately fail this — note it |
| `faces < 3 verts` | two faces share an id run, or a ring collapsed | stride id bases (`i * 100000`); keep section heights > 0 with a clamp |
| `ids split into two runs` | the same id used by two solids in one row | offset ids before `vcat` |
| `non-finite` | division by zero, `sqrt` of a negative, `pow` of a negative base | clamp with `max(0.000001, …)`; `pow(abs(x), e)` with `sign(x)` |
| plan `BAD` | a 2D row not N×3 or < 3 points | plan rows are `[x, y, group]`, one ring per group |

For a per-statement profile, time each top-level statement with the engine's own parser:
`parseExprStmts` + `evalValue` from `@builderpluss/engine/node` (see `tools/tmp-chair/prof2.mjs`). That is how
the chair's 67 s → 1.3 s was found: three `max()` calls over 27 000-row columns cost 25 s.

## Upload

```js
import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
await putObject(cfg, "library/Objects/Architectural/<name>.json", text, "application/json");
const back = (await getObjectText(cfg, key, 5_000_000)).text;   // compare back.length === text.length
```
`.env` R2 values are quoted — `cfg` from `tools/tmp-r2/ls.mjs` already strips them. Before overwriting an
existing object, save the old one: `node tools/tmp-r2/ls.mjs cat library/Objects/<…>.json > out/<name>.orig.json`.

## Status of the shipped scripts

`check_object.mjs` is the checker used to build chair.json. `fetch_materials.mjs` and `render_object.py`
were written with this skill and have not yet been run end to end — on their first use, read their output
carefully and fix them here in R2 if a step misbehaves.
