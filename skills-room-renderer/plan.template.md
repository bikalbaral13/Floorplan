---
id: plan-template
name: How the modelling plan is rendered from the plan JSON
category: Room Renderer
when: When changing what the modelling plan says, or when writing one by hand from a plan JSON.
---

The modelling plan is **rendered from `<room>_plan.json`, never written alongside it**. `form.html` produces both from the same answers, so the prose cannot drift from the parameters — which is the whole reason the plan is a render rather than a document.

Write the `.md` by hand only when there is no plan JSON, and then produce the JSON too.

## The order, and why each part is there

### 1. Title and datum line

```
# Master bedroom — modelling plan

room length, wall to wall 13'0" · room width, wall to wall 12'3" · floor-to-slab height 11'0"
```

Drawn from the `plan` and `answers` blocks. Lengths are shown in the questionnaire's `display` units and stored in metres — the reader wants feet and inches, the model wants metres, and only one of those is the file.

### 2. Settle before modelling

Every **unresolved blocker**, numbered. A resolved one is gone from here, because it is no longer a decision — the resolution is already in `params`.

```
## Settle before modelling

1. **Sliding shutters need 2'0" of carcass depth to lap and still close; this wardrobe is
   shallower.** Take the wardrobe to 2'0", or use hinged shutters.
```

This section is the plan's most useful page, and it is entirely computed. Nobody writes it.

Omit the heading when there are no unresolved blockers. An empty "Settle before modelling" reads as "nothing was checked".

### 3. Still open

Every id in `open`, by its question text, on one line separated by `·`. These are questions nobody answered — **listed, never defaulted**, so a gap stays visible. Omit the heading when nothing is open.

### 4. One section per questionnaire section

Heading, the section's `lead` if it has one, then a two-column table of question and answer, in file order. Only visible, answered, non-`derived` questions appear.

```
## Wardrobe wall

Full height, matte shutters, mirrors and grooves.

| | |
|---|---|
| Wardrobe depth | 2'0" |
| Shutter type | Sliding |
| Where should the mirror go? | One panel, seat end |
```

Answers are shown by their **label**, not their stored value — "One panel, seat end", not `Last panel`. The label is what was asked; the value is what gets written. Lengths use the display units, booleans read `yes` / `no`, and a `multi` is comma-joined.

### 5. Parameters to apply

The `params` block as a flat table — object id, parameter, value, in metres.

```
| Object | Parameter | Value |
|---|---|---|
| `wardrobe-with-math` | `doorStyle` | "Sliding" |
| `wardrobe-with-math` | `depth` | 0.61 |
```

This is the section a modeller actually works from, and it is the same data the app would apply. Keeping it in the document means a person and a machine are reading one source rather than two.

### 6. Character and materials

The `context` block, as a list. Prefaced with the reminder that **no geometry depends on these** — they ride on each object's `material` and `semantics` text parameters, which are wired to nothing.

```
## Character and materials

- **Shutter finish** — light oak veneer, matte lacquer, bronze-tinted mirror panel
- **Metal finish across the room** — brushed brass
```

Omit when `context` is empty.

## What the plan deliberately does not contain

**Positions.** No "bed centred at X = 7'6"". `params` says what an object is, not where it goes; placement is a separate step with its own solver, and a coordinate written here would be a second, stale answer.

**Counts.** "Six recessed spots" is a `plan` answer and appears in its section's table, not as six parameter sets. One parameter set placed six times is one parameter set.

**Anything not traceable to an answer.** If a line cannot be pointed at a question id, a conflict or a parameter, it does not belong in a rendered document — it belongs in the questionnaire as a question, or in `notes`.

## Build order

A plan is read top to bottom by someone building bottom up, so end the document with the order rather than assuming it:

1. Shell and openings — verify the room against the datum line.
2. False ceiling, because everything hangs from it.
3. Joinery against the walls it shares.
4. Furniture, then fittings.
5. Floor, skirting, curtains.
6. Soft items.
7. Materials, then lights, then cameras.

This list is constant and is appended verbatim. It is the one part of the plan that is not derived, because it describes how to build any room rather than this one.
