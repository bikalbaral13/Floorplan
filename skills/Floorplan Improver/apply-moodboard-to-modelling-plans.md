---
id: apply-moodboard-to-modelling-plans
name: Restyle each object's modelling plan to the locked moodboard pick
category: Floorplan Improver
when: Step 7c — after 7b has applied the locked picks' floors, params and kelvin, and before verify. Runs only for spaces with a LOCKED moodboard pick; a plan with no `moodboards` skips it.
tools: [Bash, Read, Write]
requires: [improve-traced-plan, floorplan-improver-scripts]
---

Every library object carries a **`modelling_plan`** text param in its Input Properties: the recipe a Blender (or any engine) agent follows to build a render-quality model — WHAT IT IS, GEOMETRY, MATERIALS, LIGHTS, CHECKS — with **every value written as `{paramId}`**, never as a bare number. The library plan is generic ("a bed"). Step 7b made the room's *numbers* match the moodboard; this step makes each object's *description* match it ("a low japandi platform bed in pale oak, linen bedding, no footboard").

## Where the new plan goes

**On the placement, never on the library object.** Write it to the attachment's own `params.modelling_plan`. The library file stays the generic default, so one project's moodboard cannot restyle every other project's sofa. The Renderer / Blender step reads `params.modelling_plan` first and falls back to the library's.

## Decide one action per object

`modellingPlanWorklist(plan, loadDef)` lists every styleable object inside a space with a locked pick — furniture, fittings and lights, node- or space-hosted — with its library plan, its param ids and the pick (`image`, `takeaway`, `tags`, `palette`, `note`). Look at the pick's **image** (download it; the takeaway is an inference, the image is the evidence) and choose:

| Action | When | What you write |
|---|---|---|
| `keep` | The pick says nothing about this object (a floor drain, a switch plate, a socket). | nothing |
| `improve` | Same kind of object, different look — the usual case. | The library plan with WHAT IT IS, MATERIALS and style details in GEOMETRY rewritten to the pick. Structure, `{refs}` and CHECKS kept. |
| `rewrite` | Same kind of object, but the library plan's construction is wrong for this style (a plain slab door where the pick shows a fluted one, a drum pendant where it shows a paper lantern of the same size). | A complete new plan in the same six sections. |
| `new-object` | The pick clearly shows a **different kind** of object (a cane daybed where the plan has a bed, a rattan armchair where it has a dining chair, a floor lamp where it has a pendant). | A new library object + its plan — see below. |

When in doubt between `improve` and `rewrite`, improve. Never invent a pick: a room without a locked pick is untouched, and a `shortlisted` pick is reported, not applied.

## Rules for the plan text

1. **Values stay parameters.** A colour, a wood tone, a colour temperature, a size — each is a `{param}`. If the pick needs a value the object has no param for, set an existing param through the decision's `params` (e.g. `{ baseColor: "#d8cbb5" }` from the palette) — do not type the number into the text. Only fixed construction craft (segment counts, "45° V-groove") may be literal.
2. **A moodboard restyles, it does not resize.** Every `{ref}` in the library plan's CHECKS section must still be in yours. The fit-out already chose sizes that fit the room; the plan must build that size.
3. **Name the source.** End the plan with `SOURCE: <board>#<roomKey>→<optionId>` (the worklist's `tag`) plus one line on what you read from the image.
4. **Palette → params.** Take colours from the pick's `palette` (pixel-derived) into colour params; describe finish and texture (matte, brushed, bouclé, rattan weave, lime-wash) in MATERIALS words.
5. **Lights follow the pick** — the LIGHTS section describes the fitting's character (diffused opal glow, exposed filament, hidden cove), while kelvin and lumens stay `{kelvin}` / `{lumens}` as 7b set them.

## new-object — a different kind of thing

Build it from the **closest** existing library object so it still draws on the canvas and keeps its host kind:

```js
const def = I.cloneAsNewObject(baseDef, {
  stem: "daybed-cane",                       // → id "daybed-cane-with-math"
  title: "Cane daybed",
  semantics: "low cane-panelled daybed, teak frame, linen mattress",
  plan,                                      // full six-section modelling plan, SOURCE line included
  defaults: { length: 1.9, width: 0.8 },     // only params the base already has
  extraProps: [{ id: "caneColor", name: "Cane colour", type: "color", value: "#C8A76A" }],
});
```

- Upload it to **`library/Objects/Moodboard/<boardId>/<stem>.json`** (objectPath `Objects/Moodboard/<boardId>/<stem>.json`) BEFORE saving the improved plan — an attachment pointing at a missing object imports as "(missing)".
- Sizes must still fit where the fit-out placed the original: keep the footprint within the original's, or go back to `choose-the-fitout-set` and re-place it.
- The clone keeps the base's 2D/3D geometry. If the canvas shape must truly change (a round table replacing a rectangular one), author the geometry with the **Parametric Object Creator** skill and use that definition instead — `applyModellingPlans` accepts any complete definition.
- Never overwrite an `Objects/Architectural/` file from this step.

## Apply and report

```js
const items = await I.modellingPlanWorklist(plan, loadDef);          // loadDef: objectPath → JSON from R2
// … look at each pick image, write decisions[] …
const { edits, rejected, newObjects, untouched } = I.applyModellingPlans(plan, decisions, items);
for (const o of newObjects) await putObject(cfg, `library/${o.objectPath}`, JSON.stringify(o.def, null, 2));
```

`applyModellingPlans` refuses (and lists in `rejected`) any decision whose plan references a param the object does not have, drops a CHECKS size, lacks the `SOURCE:` line, or sets `params` the object does not have. **`rejected` must be empty and `untouched` must be empty** (every worklist item gets a decision, `keep` included) before verify. Paste `edits` into the report as: per room, which objects were kept / improved / rewritten / replaced, and for each new object its path and what it replaced.
