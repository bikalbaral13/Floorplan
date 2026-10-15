# `library/Families` — shared parametric mesh families (DRAFT for review)

Status: **accepted in principle, 2026-10-06** — the user took the recommended option for every **[decide]** below (own top-level `library/Families`; the categories as listed; object → family mapping in the object; agents publish via the signed write with approval per publish). Material-binding home and the migration itself are deferred.

**2026-10-06 — raw copy done:** both pipelines' `families/` folders were copied as-is to R2 `library/Families/Interior/` (182 files) and `library/Families/Exterior/` (40 files), each with its own REGISTRY.json, plus `library/Families/README.md`. Not yet the source of truth: the pipelines still build from their local folders; edit there and re-copy until the migration.

## 1. Why

Two pipelines already carry their own mesh-generator libraries, with the same rules but in different places and formats:

| | interior-mesh-pipeline | exterior-mesh-pipeline |
|---|---|---|
| families | 60 (6 implemented: ART_FRAME, POUF_ROUND, RUG, STOOL, TABLE_DRUM, TABLE_ROUND; 54 specs) | 13 implemented (BUILDING, TERRAIN, ROAD, KERB, GROUND_PATCH, COMPOUND_WALL, GATE_SLIDING, GATE_SWING, TREE, SHRUB, STREET_LIGHT, BASEMENT, RAMP) |
| units | mm | m |
| contract | `build(p, name, coll)` | `build(p, geo, name, coll)` |
| home | `public/…/families/` (not visible to in-app agents) | same |

And both overlap the R2 parametric objects (`library/Objects`, 143) — a bed is `bed.json` / `bed_python.json` in R2 and BED_PLATFORM (spec) in the interior pipeline, with different parameters. One family catalogue in R2 removes the duplicates, makes families visible to agents and every pipeline, and gives each editor object a render-quality mesh representation.

**A family** = a versioned Python generator: given parameters (and optional plan geometry) it builds clean, closed, UV'd, material-free mesh parts in Blender. It is not placed, not lit, not textured — pipelines place it, material bindings dress it.

## 2. Folder layout (R2)

```
library/Families/
  README.md                       the contract (this document, trimmed)
  REGISTRY.json                   one entry per family (§ 6)
  _runtime/                       the shared helper library every build.py imports
    famlib/  __init__.py  geom.py (MeshBuilder: box, obox, prism_holes, sweep, tube, …)
             finish.py  uv.py (UV0 real-world, UV1 lightmap)  checks.py
    VERSION  CHANGELOG.md
  <Category>/<FAMILY_ID>/
    family.json                   schema + parameters + parts + LODs + links (§ 3)
    build.py                      build(p, geo, ctx) → root (§ 4)
    CHANGELOG.md
    test/
      values.json                 1–3 realistic parameter sets (+ geometry for site families)
      golden.json                 expected tri count / bbox / part names per test set (regression)
      preview.png                 Workbench render of the first test set
    versions/<x.y.z>/             frozen copies (family.json + build.py) kept while any project pins them
```

**Categories [decide]:** `Furniture`, `Lighting`, `Soft goods`, `Joinery`, `Finishes`, `Fixtures` (sanitary, kitchen), `Architectural` (BUILDING, windows, doors, stairs, BASEMENT, RAMP), `Site` (ROAD, KERB, GROUND_PATCH, COMPOUND_WALL, gates, TERRAIN), `Landscape` (TREE, SHRUB), `Street` (STREET_LIGHT, bollards), `Wrappers` (PY_OBJECT). The id is global and unique; the category is only the folder.

## 3. `family.json` (schema `family/2`)

```json
{
 "schema": "family/2",
 "id": "TABLE_ROUND",
 "version": "1.0.0",
 "status": "tested",
 "category": "Furniture",
 "title": "Round table on a drum or pedestal base",
 "runtime": ">=1.0 <2",
 "units": "m",
 "frame": {"up": "+Z", "front": "-Y", "pivot": "bottom-centre"},
 "host": "floor",
 "geometry_input": "none",
 "parameters": {
  "L":     {"type": "number", "default": 0.5,  "min": 0.3, "max": 3.0, "unit": "m", "label": "Diameter"},
  "H":     {"type": "number", "default": 0.42, "min": 0.3, "max": 1.2, "unit": "m", "label": "Height"},
  "top_t": {"type": "number", "default": 0.04, "min": 0.01, "max": 0.1, "unit": "m", "label": "Top thickness"},
  "base":  {"type": "choice", "default": "drum", "options": ["drum", "pedestal"], "label": "Base"},
  "seed":  {"type": "int", "default": 1, "label": "Shape seed"}
 },
 "parts": [
  {"name": "Top",  "material_key": "top"},
  {"name": "Base", "material_key": "base"}
 ],
 "lods": {"LOD0": {"tri_budget": 8000, "label": "detailed"}, "LOD1": {"tri_budget": 800, "label": "light"}},
 "recipe": "Round top Ø=L, top_t thick, 6 mm eased edge; drum = cylinder Ø0.9·L; pedestal = column Ø140 on a disc plinth Ø0.6·L × 20.",
 "links": {"object": "Objects/Furniture/table-round.json", "object_params": {"diameter": "L", "height": "H"}},
 "provenance": {"from": "interior-mesh-pipeline TABLE_ROUND 0.2.0", "migrated": "2026-10-??"}
}
```

Rules
- **Metres everywhere** (the interior families convert from mm once, at migration). Pipelines that think in mm convert at the call.
- `frame`: built at the origin, Z up, front toward −Y; `pivot` is one of bottom-centre (floor), back-bottom-centre (wall), top-centre (ceiling), world (site families built in plan coordinates).
- `host`: floor · wall · ceiling · room (needs a room polygon) · site (needs plan geometry) · prototype (instanced: trees, buildings) · on-host (snaps onto what is below: cushions, decor).
- `geometry_input`: `none` | a named shape the family reads from `geo` (`polygons`, `line`, `building/1` …) — documented in the family, owned by the adapter that writes it (the exterior families already work this way).
- `parameters`: one canonical schema. `type` number | int | choice | bool | text; numbers carry `min`/`max`/`unit`. Unknown keys are an error at build time.
- `parts`: every child object the build makes, each with a `material_key` — the hook for material bindings (§ 7). Parts not listed are a verify failure.
- `lods`: names the family can build; LOD0 = most detailed (Unreal's convention). Exterior "LOD2/LOD1" map to LOD0/LOD1 here.
- `status`: spec → implemented → tested → deprecated. Only `tested` families can be pinned by a project for production.

## 4. The build contract

```python
from famlib import geom, part

def build(p: dict, geo: dict | None, ctx) -> "bpy.types.Object":
    """p: resolved parameters (defaults ⊕ project values, validated, metres)
       geo: plan geometry for site / room families (None otherwise)
       ctx: ctx.name (root object name), ctx.coll (target collection), ctx.lod ("LOD0"…),
            ctx.seed, ctx.log(msg)
       → an empty root with one child mesh per declared part, built at the origin per `frame`."""
```

- One contract for both pipelines. Shims during migration: interior `build(p, name, coll)` → `build(p, None, ctx)` with mm→m; exterior `build(p, geo, name, coll)` → `build(p, geo, ctx)`.
- Families import only `famlib` (and `bpy`, `bmesh`, `mathutils`) — never a pipeline's `core`. `famlib` is the merge of the interior `core.geom/finish` and the exterior `core.geom/uv/finish` (MeshBuilder with exact topology, no welding; UV0 real-world; UV1 lightmap).
- Deterministic: every random choice from `p["seed"]` / `ctx.seed`.
- Quality bar (checked by `verify`): closed manifold parts (except parts flagged open, e.g. frond ribbons, terrain), consistent normals, no live modifiers, scale 1, UV0 + UV1, tri budget per LOD, every declared part present.

## 5. Object ↔ family link (one parameter schema)

The editor object stays the design-time component (plan symbol, host fitting, metrics); the family is its detailed mesh. They meet in ONE place:

```json
// in the R2 object (Objects/Furniture/table-round.json), new top-level field:
"meshFamily": {"id": "TABLE_ROUND", "version": "^1.0", "params": {"L": "diameter", "H": "height", "base": "baseStyle"}}
```

- The mapping lives in the **object** (objects are many, families are fewer; an object may change its props without touching the family). Values are object prop names or simple expressions in metres (`"L": "diameter"`, `"top_t": "0.04"`).
- `links.object` in family.json is a back-reference for discovery only.
- Objects with a `python` block (`bed_python.json`) need no family: the `PY_OBJECT` wrapper (§ 8) runs their own `build()`.
- **[decide]** whether new objects should be authored family-first (object props generated from family.json) — recommended for furniture, where detail lives in the family.

## 6. `REGISTRY.json`

```json
{
 "schema": "families-registry/1",
 "runtime": "1.0.0",
 "families": {
  "TABLE_ROUND": {
   "category": "Furniture", "version": "1.0.0", "status": "tested",
   "versions_kept": ["0.2.0", "1.0.0"],
   "object": "Objects/Furniture/table-round.json",
   "lods": ["LOD0", "LOD1"],
   "verified": {"at": "2026-10-??", "runtime": "1.0.0", "blender": "4.5.3", "tris": {"LOD0": 6132}},
   "pinned_by": [{"pipeline": "interior-mesh-pipeline", "project": "RMD_FF", "version": "1.0.0"}]
  }
 }
}
```

`pinned_by` decides which frozen versions must be kept; a `deprecated` family stays readable until nothing pins it.

## 7. Materials (no geometry change ever needed)

Families stay material-free; each part has a `material_key`. A **material binding** maps keys to `library/Materials` files:

```json
// project-level or design-level binding (e.g. projects/RMD_FF/materials.json, or a moodboard pick)
{"schema": "material-binding/1",
 "TABLE_ROUND": {"top": "Materials/Stone/honed-marble.json", "base": "Materials/Wood/walnut.json"},
 "BED_PLATFORM": {"base": "Materials/Fabric/boucle.json", "duvet": "Materials/Fabric/cotton-sateen.json"}}
```

Pipelines apply bindings after building (Blender materials by key; Unreal: the exporter's `M_<key>` slots are what the binding fills). This also replaces the `bed-materials.json` pattern (a full copy of the object with materials inside) with a binding that references the object.

## 8. `PY_OBJECT` — the wrapper family

`Wrappers/PY_OBJECT` takes `p = {"object": "Objects/Architectural/bed_python.json", "params": {…}}`, runs the object's own Python `build(params)` (the same code the editor runs in Pyodide), turns each returned mesh into a part (its `material` key → `material_key`), converts the object frame (+y back→front) to the family frame (front −Y), adds UV0 / UV1 and runs the quality checks. One source for editor and render meshes.

## 9. How pipelines use it

- **Pin**: each project lists the families it uses — `projects/<CODE>/families.lock.json`: `{"TABLE_ROUND": "1.0.0", "BED_PLATFORM": "1.1.2"}` (written by the pipeline's plan step, like program_pipeline pins typologies).
- **Fetch**: a sync tool downloads the pinned versions (+ `_runtime`) into the project's work dir cache (`pipeline-work/<pipeline>/<CODE>/families/`), verifies the sha256 against the registry, and the runner imports from there. Works offline once cached.
- **Develop**: an override (`FAMILIES_DEV=/path/to/local/Families`) lets an agent edit a family locally and build against it before publishing.
- **Upgrade**: `upgrade_family <CODE> <ID> --to x.y.z` rebuilds the affected items on both versions, writes a diff (tri counts, bboxes, part names), and moves the pin only with approval.

## 10. Publishing (who may change the shared library)

1. Author or edit locally (dev override). 2. `verify`: build every test set at every LOD, check the quality bar, compare with `golden.json`, render `preview.png`. 3. Bump the version (semver: new optional parameter → minor; fix with no output change → patch; output change or removed parameter → major), add a CHANGELOG line. 4. Publish with the server's signed R2 write (the Cloud Library token route from commit f8d6c03) — freezes the previous version into `versions/` if anything pins it, updates `REGISTRY.json` and `library/index.json` (note: its counts are stale today — objects 19 vs 143 in the bucket). 5. A major version never changes a project's output until that project's pin is upgraded.

## 11. Migration plan (when approved)

| Step | What | Notes |
|---|---|---|
| 1 | Create `_runtime/famlib` from the two pipelines' cores | MeshBuilder (exterior) is the superset; add interior's `revolve`, `rounded_box` |
| 2 | Move the 13 exterior families | already metres + geometry input; contract shim only |
| 3 | Move the 6 implemented interior families | mm → m, parts + material keys, test/golden from their test_values |
| 4 | Move the 54 interior specs as `status: spec` | no code yet; each gets a recipe + parameters only |
| 5 | Add `PY_OBJECT`; link `bed_python.json`; drop the BED_PLATFORM spec in favour of it | first object ↔ family link |
| 6 | Point both pipelines at the registry (lock file + sync) | the local `families/` folders become caches, then go |
| 7 | Add `meshFamily` to the R2 objects that have a family | furniture first |

No name collisions between the two pipelines today.

## 12. Open decisions

1. **[decide]** `library/Families` as its own top-level folder (this draft) — or fold families into `library/Objects` as a `mesh` representation of each object?
2. **[decide]** Categories list (§ 2).
3. **[decide]** Mapping direction (§ 5): object → family mapping (recommended), or family-first generated object props.
4. **[decide]** Where material bindings live: per project, per design, or produced by the moodboard picker.
5. **[decide]** Who can publish: agents through the signed write with your approval per publish (recommended), or only from a dev machine.

## 13. Unifying `library/Objects` and `library/Families` (PLAN, 2026-10-14 — not decided)

Status: written for review; the user decides later. Nothing below has been done.

### 13.1 The problem today (R2 `library/`)

| Copy | Where | What |
|---|---|---|
| Objects | `library/Objects/` (154 files, mostly one `Architectural/` folder) | editor objects: params, Math Engine spine, 2D symbol, editor 3D preview |
| Families | `library/Families/Interior` (182), `Exterior` (40) | Blender mesh generators (`family.json` + `build.py`) — raw copy of 2026-10-06 |
| Pipeline copies | `library/Pipelines/Build/{interior,exterior}-mesh-pipeline/families/` | the copies the mesh pipelines actually build from |

The same thing is described up to three times with different parameters (`Objects/Architectural/bed.json`,
`bed_python.json` ↔ `Families/Interior/BED_PLATFORM` ↔ the pipeline's own copy), and nothing links them.

### 13.2 Two end states

**A — two folders, linked.** Both stay; each object gets `"family": "<Category>/<ID>@<ver>"`, each family
`"objects": [...]`; the mesh pipelines read `library/Families/` (pinned) and drop their own copies. Nothing moves.

**B — one folder, one item per folder (recommended).** `library/Families/` goes away:

```
library/Objects/<Category>/<id>/
    object.json      params, Math Engine spine, 2D symbol        (was Objects/Architectural/<id>.json)
    family/          family.json, build.py, test/                (was Families/<Interior|Exterior>/<ID>)
    preview.png
    versions/<x.y.z>/
```

An object with no render mesh has no `family/`; a render-only family (TERRAIN, ROAD, …) gets a thin `object.json`
so it can be placed and listed. Categories are shared (Furniture, Lighting, Soft goods, Joinery, Finishes,
Fixtures, Architectural, Site, Landscape, Street).

### 13.3 Rules that make it one system

1. **One parameter schema.** The object's params are the source of truth; `family.json` maps them (`"map"`), never
   redefines them. Units in metres everywhere.
2. **Parameter kinds** in `family.json`: `geometry` (in the instance key), `material` (per-instance override),
   `placement` (the transform), each with a rounding step.
3. **Instance key** = `<family>@<version>#hash(rounded geometry params)`. Same key → one mesh, many transforms —
   three.js `InstancedMesh` in the editor/viewer, one mesh datablock in Blender (the instance-master standard), one
   mesh + many nodes in GLB, ISM in Unreal; the count per key is also the BOQ quantity. Families with
   `"geometry_input": "plan"` (walls, finishes, roads, terrain) are unique and skip the key. One `instanceKey()`
   helper in the shared kit, used by the editor, the renderer and the mesh pipelines; built meshes cached by key.
4. **Versions are frozen**; a key includes the version, so a changed `build.py` never alters existing instances.
5. **Writers**: the Parametric Object Creator links/creates the family instead of a separate mesh; new families go
   through the approval-gated publish (draft → preview → release), like pipelines.

### 13.4 Existing work keeps working

- **Designs** store `objectId` + `objectPath`. A generated alias index `library/Objects/index.json` (old path → new
  folder, plus `family`, `status`, `category`) lets the loader resolve moved objects; old designs open unchanged and
  a save writes the new path. Aliases kept for at least one release.
- **Mesh pipelines** switch their one pinned families reference; their local `families/` folders are deleted only
  after a test room renders identically.
- **Skills / docs / AGENT.md** paths updated in the same pass; a check fails on any old path left.
- `REGISTRY.json` and `index.json` are generated, never hand-edited. A check script flags: object → missing family,
  unused family (unless `standalone`), duplicate ids, old paths.

### 13.5 What "in unison" means in practice

| Case | After unification |
|---|---|
| object + matching family (e.g. bed ↔ BED_PLATFORM) | one item: params → 2D, editor 3D, render mesh, instancing |
| object only (most of today's objects) | unchanged (Math Engine 3D) until a `build.py` is written |
| family only (site families, ~54 interior specs) | placeable via a thin object; renders as before |
| spec-only families (no `build.py`) | listed, not rendered, until implemented |

### 13.6 Steps (each one reversible; stop after any)

1. **Back up** `library/Objects/`, `library/Families/` and the two pipeline `families/` folders to `backups/`.
2. **Inventory** (read-only): pair objects ↔ families; list paired / object-only / family-only; flag `*.bak-*`,
   `-materials` side files, `bed` / `bed_python` style duplicates. Output: a pairing table (xlsx). This sizes the rest.
3. **Decide A or B** from the table.
4. **Tag parameters** of each paired family (`geometry` / `material` / `placement`, rounding) and write the `map`.
5. **Generate** `index.json` (with aliases) and `REGISTRY.json`; add the check script.
6. **Move one category** (Furniture first): merge pairs, clean leftovers, keep aliases; re-render a test room and
   compare.
7. **Point the mesh pipelines** at the single source; delete their copies after the comparison passes.
8. **Remaining categories**, one at a time, same check each time.
9. **Instancing**: `instanceKey()` in the kit, mesh cache by key, instancing report in the render step.
10. **Update writers and docs**: Parametric Object Creator skill, AGENT.md, publish flow for families.
