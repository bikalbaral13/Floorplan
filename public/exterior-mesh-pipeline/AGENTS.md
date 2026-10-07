# AGENTS.md — how to work in the exterior mesh pipeline

This repository turns a **master plan** (site + placed building designs) into **clean, parametric, geometry-only exterior meshes** in Blender — roads, kerbs, boundary and plot walls, gates, plots, open space, terrain, building envelopes with their outer windows and doors, and instanced trees / shrubs / street lights — and exports them for **Unreal (FBX)**. Sibling of `interior-mesh-pipeline` (the same habits: task sheet, families, reports).

Read in this order: **this file → `projects/<CODE>/PROJECT.md` → `projects/<CODE>/TASKS.csv` → the family you are about to touch.**

---

## 1. Repository layout

```
PIPELINE_ROOT            marker — the root is the folder that contains it (never delete)
AGENTS.md README.md CHANGELOG.md
core/                    shared library — VERSION, CHANGELOG.md
  paths params tasks report          pure Python
  plan2d                             2-D helpers for adapters (system Python + shapely)
  geom uv finish place checks        Blender (bpy / bmesh)
adapters/
  canvas_masterplan.py   BuilderPluss masterplan/1 + site design + placed designs → items, instances
families/                REGISTRY.json + <FAMILY>/family.json + build.py (+ test_values / test_geometry)
tools/
  plan_to_project.py     (system Python) master plan → geometry/, items/, instances.json, TASKS.csv
  run_task.py            (Blender) run_next / run_all — executes the task sheet
  run_item.py            (Blender) build + finish + UV + check + report one item; verify_family
  export_unreal.py       (Blender) FBX set + instances + review FBX
  unreal_import.py       (Unreal Editor Python) import + LOD1 + HISM instances
  preview.py             (Blender) Workbench renders for proof
  selftest.py            (Blender) core smoke test
  new_project.py project_status.py   (Python)
projects/<CODE>/
  PROJECT.md project.json TASKS.csv REPORT.md plan_summary.json instances.json
  inputs/                read-only sources (masterplan/, envelopes/)
  geometry/<design>.json extracted building exteriors (adapter output)
  items/<CODE>/          item.json, prompt.md, report.md/.json
  <work_dir>/cache/      fetched designs          ┐ project.json → work_dir (RMD_EXT: <repo>/pipeline-work/exterior/RMD_EXT)
  <work_dir>/output/     blend · unreal · previews┘ kept OUTSIDE public/ so the web app never ships them
```

## 2. Units, frames, levels

- **Metres everywhere** (Blender units = m). Plans in canvas pixels are converted by the adapter (`pixelsPerMeter`, y flipped).
- World: **X east, Y north, Z up**, origin = the canvas origin of the site design. A design instance places the design's (0, 0) at its site position.
- **Ground level table** (project.json → site.ground), kept strictly ordered so nothing z-fights:
  basements: B1 floor −2.85, B2 −5.7 (slabs 300 mm below), ground deck top −0.20 under the road base; terrain has no cells over a basement
  terrain −0.06 ± roughness · road 0.00 · yard +0.12 · kerb / plot lawn +0.15 · driveway pavers +0.16 · building plinth +0.15 → finished floor +0.60.
- Prototypes (building designs, plants, lights) are built **at their own origin**; unique site elements are built **in world coordinates**.

## 3. Mesh quality bar (every family)

- Closed solids with consistent normals (only `open_mesh_ok` parts such as the terrain surface may be open). No live modifiers. Scale 1.
- Exact topology from `core.geom.MB` — **no welding** between touching solids (a cap on a pier stays its own solid).
- Quads first (sweeps, boxes); caps of polygons with holes are triangulated.
- Logical parts are separate child objects (`<root>_Walls`, `_Glass`, `_Sill`, `_Kerb` …) for material assignment later. **No materials** in the .blend; the exporter adds one empty placeholder slot per part (`M_<Part>`) so Unreal keeps a section per part.
- **UV0 "UVMap"** real-world (1 unit = 1 m): path-follow on sweeps (kerbs, copings, parapets: U along the run), oriented planar elsewhere.
- **UV1 "Lightmap"**: Smart UV Project (66°, margin) + pack, one 0–1 square per mesh, no overlaps; the terrain uses a normalised top projection.
- Triangle budget per family (family.json → tri_budget, per LOD where it matters).

## 4. Instancing

- One prototype per design per LOD (`BLD_villa_1_LOD2`, `_LOD1`), per plant species per LOD, shrub, street light — in `PROTOTYPES` (excluded from the view layer).
- Every placement is a **collection-instance empty** in `EXT › EXT_inst_<group>` (buildings, trees, shrubs, lights) with its transform. Variation (rotation, ±15 % scale) lives on the instance, not in the prototype.
- **Mirrored placements get a mirrored prototype** (`_M`, geometry mirrored by the adapter) — never a negative scale.
- Unreal: prototypes export once (`SM_<proto>_LOD0/1.fbx`), instances as `instances.json/csv` → `unreal_import.py` builds one HISM component per mesh. The `_review.fbx` realises everything (linked duplicates) for a quick look only.

## 5. The task loop

1. `python tools/plan_to_project.py <CODE>` (system Python with shapely) — re-run whenever inputs change; existing task statuses are kept.
2. In Blender: `blender -b --factory-startup --python tools/run_task.py -- <CODE> --all` — or from the Blender Python console:
   ```python
   import sys; sys.path.insert(0, r"<pipeline root>")
   from tools.run_task import run_next; print(run_next("<CODE>", agent="<you>"))
   ```
   The runner opens/saves `output/blend/<CODE>.blend` around every task.
3. Task types: `selftest` · `family_verify` (build test_values, mark tested in REGISTRY) · `item_build` (site element) · `proto_build` (prototype) · `instance_place` · `qc_site` · `export` · `report`.
4. A task `blocked`: read the item's `report.md` / the row's notes, **fix the family, core or adapter** (never hand-edit meshes), set the row back to `todo`, rerun.
5. Finish with `python tools/project_status.py <CODE>`; REPORT.md must explain every blocked / skipped row.

## 6. Families

`build(p, geo, name, coll) -> root` — `p` resolved parameters, `geo` the item geometry (adapter-owned shape, documented in family.json → geometry), `name` root name, `coll` target collection. Build with `core.geom` (`MB.box / obox / ocbox / prism / prism_holes / sweep / tube / cyl / icosphere / pyramid / opyramid`), one `MB` per part, `part(root, coll, "<Part>", mb)`. Deterministic: seed every random choice.

Versioning (semver in family.json + CHANGELOG line + REGISTRY): new optional parameter → minor; fix with no output change → patch; output change → major and rebuild every item / prototype of the family.

| Family | What |
|---|---|
| BUILDING | envelope from adapter geometry; LOD2 detailed, LOD1 massing |
| TERRAIN | rough flat ground + earth dumps |
| ROAD | sub-base + wearing course |
| KERB | precast kerb units + gutter along road edges |
| GROUND_PATCH | lawn / pavers / concrete with brick or kerb edging |
| COMPOUND_WALL | footing, body, coping, piers with caps, optional railing |
| GATE_SLIDING | main gate, pillars, lanterns, track, wheels |
| GATE_SWING | plot gate, pillars, arched double leaf, hardware |
| TREE | NEEM / COCONUT / ASHOKA, LOD2 / LOD1 |
| SHRUB | hedge / shrub plant |
| STREET_LIGHT | pedestal, pole, arm, finned LED head |
| BASEMENT | basement level: floor slab with ramp openings, ground deck, retaining + core walls, stall markings, wheel stops |
| RAMP | two-lane ramp between levels: inclined slab, anti-skid ribs, curbs + median, side guard walls, end guard |

## 7. The adapter (canvas master plan)

Exterior walls are found per level from the **spaces**: rooms / shafts / voids form the indoor region, balconies / decks / terraces / courtyards / entrances the outdoor region; a wall is exterior when its centreline runs on the indoor boundary (or it stands free). Floors, roofs (indoor not covered by the level above), parapets (roof and outdoor edges no wall closes), entrance steps (doors that open off the plinth) are derived from the same regions. Corner joints are butt joints (one wall runs through, the other stops short) so no solids overlap. Change the classification in the adapter, never in a family.

## 8. Do not

- Do not add materials, textures, lights or import external asset libraries.
- Do not hand-edit generated meshes; fix the family / adapter and rebuild.
- Do not edit `inputs/`; re-run `plan_to_project.py` instead of editing `items/` by hand.
- Do not use negative scale for mirroring.
