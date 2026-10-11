# pyobject — object/2: parametric objects as Python

One object format, one source, three runtimes: Pyodide in the editor, CPython in pipelines, Blender's Python.
An object/2 file is the editor's Python object file (`tools/pyobj/bed_python.json` is the reference) plus optional
`units`, `functions` and `rule_keys` (schema: `schemas/object.v2.schema.json`).

```
python -m pyobject check <object.json>                 build() at defaults, every number's min/max, every option
python -m pyobject run   <object.json> key=value …     build() → summary (+ --out result.json)
python -m pyobject.spine2py <spine.json> <out.json>    six-node Math Engine object → object/2   (--all <dir> <out dir>)
python -m pyobject.bake  <plan.json> <out.json>        run every placed instance once; results stored in python.baked
python tools/from_program_object.py <objects/ID> <out> program-pipeline object (feet) → object/2
python tests/test_pyobject.py                          11 checks
```

## build() contract
`build(params[, host]) -> {"meshes": [{name, color, material?, positions, indices}], "plan": [[[x, y]…]…], "planColors"?, "stats"?}`
— metres; object-local (+x across, +y back→front, +z up) and turned by the editor's `rotation`, or, for
`python.rotates: "self"` (Math Engine translations), already placed against `host` (anchor-relative metres).

## Math Engine → Python (spine2py)
The Math Engine body is translated statement by statement with the engine's own grammar (parser mirrors
`packages/engine/src/expr/expr.ts`), and every value operation runs through `pyobject/exprlang_runtime.py`, a port
of the engine's semantics (broadcasting, round6, `?? 0` failure modes, JS number rules) plus the matrix kernels,
prism / lathe / sweep, loft / tube / ring faces, resample / arclen and the named algorithms (`Solid.Skin`,
`Solid.SoftBox`, `Algorithms.*` — translated from `pyobject/algorithms.json`, which `parity/dump_algorithms.ts`
regenerates from the engine).

Refused (the object stays on the engine): 2D/3D booleans (`intersect`, `msubtract` …), `mcyl`, `bezier`/`bspline`/
`nurbs`/`catenary`, `geodesic`, `inv`/`solve`, decode/encode blocks (the AI detection objects), canvas/image hosts.

## Parity (the proof)
`parity/engine_dump.ts` runs the app's own `resolveSpineObject`; `parity/compare.py` runs the translation and compares
every 2D ring point and 3D vertex (1e-6 m) and every metric, at the defaults and at each number's min/max, each
option and each checkbox. Results: `parity/parity_report.json`.

```
node node_modules/jiti/bin/jiti.js packages/pyobject/parity/engine_dump.ts <objects dir> <engine out dir>
python packages/pyobject/parity/compare.py <engine out dir> <converted dir> --out parity.json
```

## Speed — why the editor reads BAKED results
Python is ~6–8× slower than the engine's JS for the same body, and Pyodide slower again: a door ≈ 1 s, the soft
furniture (Solid.SoftBox) several seconds. Evaluated live at load, a 36-object plan took minutes. So the editor does
not evaluate on load: the agent bakes (`pyobject.bake`), the editor shows the stored results instantly and starts
Pyodide (a pool of up to 3 workers) only for an instance whose params moved off every baked set. Results land
asynchronously and are never cached as "empty". The Math Engine stays in the app as the fast evaluator for
un-baked engine objects until every library object has an object/2 twin with bakes (see docs/project-lifecycle-plan.md §6).
