---
id: object-resolver
name: Bind every brief item to a real library object, its params, host and material
category: Object Resolver
when: A roombrief.json exists and its items have to become placeable objects — in a pipeline this is S3 Objects.
tools: [Bash, Read]
files: [skill.json, resolve-items-to-objects.md, tools/catalog.mjs, tools/resolve_check.py, tools/review_apply.py, review.html, objects/, materials/]
---

## Steps (skill.json)

| Step | Who | What |
|---|---|---|
| CATALOG | script | `catalog.mjs <work>/catalog.json` — every R2 object (host kind + input-props params with options) and material |
| RESOLVE | agent | write `resolve.json` — see [resolve-items-to-objects.md](resolve-items-to-objects.md) |
| CHECK | script | `review_apply.py` applies the user's sign-off (review.json), then `resolve_check.py` fails on unknown params, select values outside options, missing materials and unknown hosts |
| APPROVE | **user** | signs off every item in the Objects review (`review.html`, run by the pipeline app) |

If CHECK writes `review.todo.json`, the agent rebinds those items and CHECK runs again.

## New objects and materials

- No library object fits → `objects/objects-deck.mjs` (specs on the six-node spine) → `objects/build-objects.mjs` → `objects/out/`, or the **Parametric Object Creator** skill. Every new object carries `materialPath`, `finishes` and the provenance text props.
- A deck colour → `material_variant.py` in the pipeline recolours a library material (keeps recipe + surface, records `variantOf`), or the **Material Creator** skill.
