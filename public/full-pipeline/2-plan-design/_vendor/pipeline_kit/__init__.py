"""pipeline_kit — the shared plumbing of every BuilderPluss pipeline (pure Python 3.10+, stdlib only).

0.3.0 merges the two 0.2.0 branches: the app (r2, sync, runner --pull/--publish) and the program/space-brief bundle
(units, semver, standards, state, interop, paths.save_text/sha256/inputs_snapshot, tasks.deps_done).

    paths     pipeline root (PIPELINE_ROOT marker), projects, work dir outside public/, JSON helpers
    tasks     the task sheet (TASKS.csv): fields per pipeline, dependencies, next runnable, reset downstream
    findings  F (fail / warn / info), summarize, result
    report    append-only project log + item reports with history
    stage     stage folders (stage.json + run.py + prompt.md), task context
    runner    preview / run one / run all — dependency waits, user gates, FIXTURE projects, decisions logged
    r2        R2 client (stdlib SigV4) + LocalStore; credentials from env / .env
    sync      pipeline.json (pipeline/1): pull inputs, publish outputs.keep → Projects/<CODE>/ + run.json (run/1)
    units     feet-inch ⇄ mm (Indian plot practice), parsing "10'-6\"", "3200mm", "3.2m"           (0.2.0 zip branch)
    semver    version compatibility ("needs 0.2.x")
    standards firm standards sets (library/Standards) with extends: conventions + object prefs
    state     save a project to the library and resume it in a later chat; Projects/index.json
    interop   format bridges between pipelines: plan_trace.v1 (program) → canvas.v1 (editor)

Master copy: the app repo `packages/pipeline-kit/`. Pipelines carry a vendored copy in `_vendor/pipeline_kit`
(written by `packages/pipeline-kit/tools/vendor.py`, which also records hashes so drift is detectable).
Published snapshot: R2 `library/Pipelines/_kit/<version>/`. Never edit a vendored copy — change the master,
run its tests, re-vendor.
"""
import os as _os, sys as _sys
for _s in (_sys.stdout, _sys.stderr):          # Windows consoles default to cp1252; reports use →, ×, ²
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
__version__ = open(_os.path.join(_os.path.dirname(__file__), "VERSION"), encoding="utf-8").read().strip()
