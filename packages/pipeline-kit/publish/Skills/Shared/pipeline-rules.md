---
id: pipeline-rules
name: Rules every pipeline agent follows
category: Shared
when: Before running or changing ANY pipeline (program, floorplan tracer, interior / exterior mesh, or a new one). Each pipeline's AGENTS.md adds its own rules on top of these.
---

**The user decides; the agent executes.**
1. Preview a task before running it; a task that needs the user (scope / brief answers, confirming a manifest or a sketch reading, choosing an option, final review) is never answered on their behalf. Rendering a form and proceeding on your own preselections is a failure — put the question where they can see it, then stop.
2. An approval is the user's own words, recorded with the date; one approval covers one task. "Go ahead" answers whether to proceed, not the questions inside a form.
3. Regression fixtures (`project.json → fixture: true`) take approvals that start with `FIXTURE` so nobody mistakes the agent's test inputs for user decisions.

**Fix the source, not the output.**
4. Never hand-edit generated files (plans, meshes, exports): fix the family / stage / adapter / rule and rebuild.
5. A blocked task means: read its report, fix the cause, rerun; if it cannot be fixed, leave it blocked with a clear note in the append-only REPORT.md. Never delete task rows — mark `skipped` with a reason.

**Conventions are not facts.**
6. Values taken from `library/Standards` are tagged `src=convention` and listed in the report; authority values from `library/Rules` are binding only once confirmed by the user for that project.
7. Every lesson learned becomes a check plus a fixture case, not only a sentence.

**Versions and shared libraries.**
8. Semver everywhere: new optional parameter → minor; fix with no output change → patch; output change or removed parameter → major (and rebuild everything that pinned it). Every change gets a CHANGELOG line.
9. Shared libraries (`library/Families`, `Standards`, `Rules`, `Schemas`, `Fixtures`) are published one way — edit the master, verify, then publish with the user's approval. Never edit them directly in R2.
10. Hand-off files validate against `library/Schemas`; a new or changed format is a new schema version.

**Files and size.**
11. Heavy, regenerable files (renders, .blend, FBX, caches) go in the project's work dir OUTSIDE the web app's `public/` (`project.json → work_dir`), never in the repo.
12. Report outcomes faithfully: say what passed, what failed, what was assumed, and what was never run.

**Where every file goes — three places (pipeline/1).**
13. Ask of every file a run creates: *will a future run or another pipeline need it?* **Reusable across projects** → `library/` (families, objects, materials, standards, schemas, skills) — only through a promote step the user approves, with a version bump. **Lasting for this project** → `Projects/<CODE>/` in R2 (accepted plan, final .blend / FBX / GLB, renders, REPORT.md, `runs/<pipeline>/<run_id>/run.json`) — published by the run's publish stage, no approval needed; large binaries keep only the latest copy, run.json keeps the hash. **Everything else** → the work dir (cache, intermediates, previews, retries, logs): temporary, outside `public/`, safe to delete.
14. Each pipeline declares this in `pipeline.json` (schema `pipeline/1`, next to AGENTS.md): `inputs` (R2 keys or `project:` files), `library_pins`, `outputs.keep` (what goes to `Projects/<CODE>/`, with the gate it waits for) and `outputs.temp`. A file not listed in `keep` is never uploaded. Every run writes `run.json` (schema `run/1`): inputs, library versions used, outputs with sha256, task statuses and approvals.
15. Pipelines hand off through `Projects/<CODE>/` (e.g. the tracer's `plan/handoff.json` is the mesh pipelines' input), never by reading another pipeline's work dir.

