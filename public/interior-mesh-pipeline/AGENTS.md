# AGENTS.md — how to work in this repository

This repository turns interior-design projects (floor plan → layouts → furnishing tables → modelling workbook) into **clean, parametric, geometry-only meshes** in Blender, one item at a time, driven by a task sheet. Any agent (human or AI) that reads this file must be able to pick up a project, execute the next job, extend the libraries when needed, and leave a correct report behind.

Read in this order: **this file → `projects/<CODE>/PROJECT.md` → `projects/<CODE>/TASKS.csv` → the item / family you are about to touch.**

---

## 1. Repository layout

```
PIPELINE_ROOT                 marker file — the root is the folder that contains it (never delete)
AGENTS.md                     this file (rules for every agent)
README.md                     short human overview
core/                         shared library (geometry only)  — VERSION, CHANGELOG.md
  paths.py params.py tasks.py report.py        pure Python (run anywhere)
  geom.py finish.py place.py checks.py         need Blender (bpy / bmesh)
families/                     one folder per parametric mesh family
  REGISTRY.json               status + version of every family (spec | implemented | tested | deprecated)
  <FAMILY>/family.json        parameter schema (defaults, min/max), host, pivot, recipe, test_values
  <FAMILY>/build.py           generator: build(p, name, coll) -> root object
  <FAMILY>/CHANGELOG.md
tools/                        runners and generators
  run_task.py   (Blender)     run_next(project) / run_task(project, row): executes the next runnable job
  run_item.py   (Blender)     run_item(item.json): build → finish → place → check → report one item
  selftest.py   (Blender)     core library smoke test
  workbook_to_project.py      (Python + openpyxl) workbook → item folders + families + TASKS.csv
  new_project.py              (Python) scaffold projects/<CODE> from projects/_TEMPLATE
  project_status.py           (Python) summary + next runnable task
projects/
  _TEMPLATE/                  copy for every new project (new_project.py does it)
  <CODE>/
    PROJECT.md                project brief for agents (conventions, decisions, open items)
    project.json              machine settings: ffl_mm, collection names, name prefix
    TASKS.csv                 the task sheet — ONE row per job, executed top-down by dependency
    REPORT.md                 rolling project log (append-only)
    inputs/                   floorplans, layouts, furnishing tables, moodboards (read-only sources)
    workbook/                 modelling workbook (.xlsx) — source of items, placements, families, rooms
    items/<CODE>_<slug>/      one folder per item:
        item.json             size, params, placements, facing, host, budget, status
        prompt.md             the job brief for this item (what to build, acceptance)
        build.py              runs the item in Blender
        report.md/.json       written by the runner after every build (with history)
    output/blend, output/fbx  deliverables
```

## 2. Units, axes and conventions (all projects)

- Parameters and plan coordinates in **millimetres**; Blender scene in **metres** (core converts).
- Plan: X east, Y north, origin per project (see PROJECT.md). Z measured from the floor's finished level `ffl_mm` (project.json).
- Every asset is built at the origin with **Z up and its front facing −Y**. Rotation `rot_z` turns the front to face S = 0°, E = 90°, N = 180°, W = 270°.
- Pivots: floor items bottom-centre · wall items back-bottom-centre on the wall plane (body toward −Y) · ceiling items top-centre · room-wide items built directly in plan coordinates.
- **Geometry only.** No materials, material slots, textures, shaders or lights. Keep logical parts as separate child objects so materials can be assigned later.
- Quality bar: closed manifold solids (except families flagged for open surfaces), consistent normals, no loose geometry, modifiers baked, scale 1, one UV map (real-world box projection), sharp edges above 30°, triangle budget per item.
- Naming: objects `<name_prefix><CODE>_<NN>` (prefix in project.json, e.g. `SM_FF_UL_01_02`), collections `<collection_root> › <collection_prefix><SpaceCode>`.
- Repeated items are linked duplicates (shared mesh), never rebuilt per instance.

## 3. The task loop (do exactly this)

1. Open the project's base `.blend` (PROJECT.md says which) in Blender with the Blender connector. Never overwrite it — save outputs to `output/blend/`.
2. In Blender's Python, put the root on the path and run one task:
   ```python
   import sys; ROOT = r"<full path to this repository>"; sys.path.insert(0, ROOT)
   from tools.run_task import run_next
   print(run_next("<PROJECT_CODE>", agent="<your agent name>"))
   ```
   `run_next` picks the first `todo` row whose `depends_on` are all `done`/`skipped`, marks it `doing`, executes it, writes reports and marks it `done` or `blocked`.
3. Read the result. If it says **action required** (family not implemented) → do §4, then run the same task again.
4. If a task is `blocked`: read the item's `report.md` / the task `notes`, fix the cause **in the family or core** (never by hand-editing meshes), rerun. If it cannot be fixed, leave it `blocked` with a clear note and continue with the next runnable task.
5. Repeat until `run_next` reports no runnable task. Then run `tools/project_status.py` and make sure `REPORT.md` explains every `blocked` / `skipped` row.

Task types: `selftest` · `family_implement` (code a spec family) · `family_verify` (build the family's `test_values`, check, mark tested) · `item_build` · `qc_space` (overlaps inside one space collection) · `export` (FBX of the project collection) · `report` (summary into REPORT.md).

## 4. Implementing or changing a family

- A family is `families/<NAME>/family.json` + `build.py`. Contract:
  `build(p, name, coll) -> root` — `p` is the resolved parameter dict (mm), `name` the root object name, `coll` the target collection. Build at the origin following the pivot rule; return an empty root with mesh children (or a mesh). Do not place, rename or add materials — the runner does placement.
- Use `core.geom` builders (`box`, `rounded_box`, `cylinder`, `revolve`, `sweep_tube`, `grid`, `to_object`, `empty_root`). Deterministic output: seed any randomness from `p["seed"]`.
- Follow the recipe text in family.json. Fill `test_values` with one realistic item. Reference implementations to copy from: `TABLE_ROUND`, `TABLE_DRUM`, `POUF_ROUND`, `STOOL`, `RUG`, `ART_FRAME`.
- Versioning (semver): new parameter or new optional behaviour → **minor**; fix that changes no output for existing items → **patch**; anything that changes existing outputs or removes a parameter → **major** + rerun every item that uses the family (REGISTRY.json → `projects`).
- Every change: bump `version` in family.json, add a CHANGELOG.md line, update REGISTRY.json (`status`, `version`), run the `family_verify` task. Status ladder: `spec` → `implemented` (code written) → `tested` (verify passed; set automatically).
- New family needed by a project: create `families/<NEW>/` from any skeleton (`workbook_to_project.py` does it when a workbook names an unknown family), write the recipe, add it to REGISTRY.json, and add a `P1-FAM-<NEW>` row to the project task sheet.

## 5. Changing the core library

- Only additive changes without discussion: new helpers, new optional arguments with defaults. Bump `core/VERSION` (minor) and add a line to `core/CHANGELOG.md`.
- Breaking change (signature, units, conventions): **major** version, update every family that uses it, rerun `selftest` and all `family_verify` tasks, note it in AGENTS.md.
- Pure-Python modules must stay importable without Blender.

## 6. Starting a NEW project

1. `python tools/new_project.py <CODE> "<title>"` → creates `projects/<CODE>` from the template.
2. Put sources in `inputs/` (floor plans, layouts, furnishing tables, moodboards). Fill `project.json` (`ffl_mm`, names) and PROJECT.md (conventions, decisions, open items).
3. Produce the modelling workbook in `workbook/` with sheets **Items, Placements, Families, Rooms** (column contract in `projects/_TEMPLATE/PROJECT.md`).
4. `python tools/workbook_to_project.py <CODE>` → item folders (item.json, prompt.md, build.py), new/extended families, and TASKS.csv.
5. Run the task loop (§3).

## 7. Reporting rules

- Item: `report.md` + `report.json` are written by the runner every build (status, family version, triangles, open edges, instances, overlaps, flags, assumed defaults, errors, history). Do not edit by hand except to add a short "Agent note" section at the end.
- Project: `REPORT.md` is append-only. Add a dated line for every manual decision (family change, skipped item, parameter override) and a summary block when a phase completes.
- Task sheet: only the runner or the agent working the row changes `status/agent/started/finished/output/notes`. Never delete rows; mark `skipped` with a reason.

## 8. Do not

- Do not add materials, import external asset libraries or download models.
- Do not hand-edit generated meshes; fix the family and rebuild.
- Do not edit `inputs/` or other projects' items.
- Do not change a family's behaviour without a version bump and a verify run.
