---
id: render-a-room
name: Take a room from a brief to a modelling plan and a parameter set
category: Room Renderer
when: A single room has been picked out of a floorplan and someone wants it detailed, modelled or rendered — "design this bedroom", "what do we need to decide for this room", "turn this room into a render brief".
files: [questionnaire.schema.md, rooms/*.questions.json, form.html, plan.template.md]
---

A room brief that comes back as prose is a **failure, not a draft**. Someone then re-types it into a model, and from that moment the document and the model are two answers to the same question. The usual way to get this wrong is to write a nice questionnaire, collect nice answers, and produce a nice paragraph.

What this skill produces instead is **`params`** — object id → parameter → value, in metres — next to the prose, from the same answers. The prose is for the person who models it. The parameters are what the model is.

## The four artefacts

| | |
|---|---|
| `rooms/<room>.questions.json` | The only file anyone hand-edits. Questions bound to real object parameters. |
| `form.html` | Generic. Renders **any** questions file; never edit it per room. |
| `<room>_plan.json` | What comes out. `answers` · `params` · `context` · `plan` · `open` · `conflicts`. |
| `<room>_modelling_plan.md` | Rendered from the plan JSON, per `plan.template.md`. Never written alongside it. |

## The cycle

**1. Pick the room and know its size.** From the floorplan: length, width, slab height, where the doors and windows are, which wall is which. The questionnaire asks for these first and everything downstream is checked against them.

**1a. If the room was traced, take its measurements with you.** A trace hands over a flat map of what it learned, each entry tagged `measured`, `derived` or `convention`. Open the form with it:

```
form.html?q=rooms/bedroom.questions.json&prefill=bedroom_trace_prefill.json
```

Measured and derived answers arrive locked — they are facts, and retyping them is how a room ends up with two lengths. A `convention` arrives flagged and editable, because it is the tracer's assumption and not a measurement. **Never promote one to the other to tidy the form up.** The conflict rules run over prefilled answers exactly as over typed ones, so an assumed sill that does not suit the seat is caught here rather than in the model.

No prefill is the normal case, and the form is identical without one.

**2. Open the form on the room's questions file.**

```
form.html?q=rooms/bedroom.questions.json
```

Or load the file with the picker. Served from the app, the form also **checks every binding against the live library** and shows a banner naming any that are dead. Do that once per session — a dead binding writes nothing and is otherwise completely silent.

**2a. Make sure they can actually see it, then stop.** Opening the form is not asking the question. The desktop app's Browser pane **can be hidden**, so a form opened there is running where nobody can see it; a `localhost` URL dies with the session; an inline widget renders but nothing makes anyone submit it. Put it somewhere they can reach, say so in one line, and then wait.

**A plan JSON is something the form produced.** It carries `answeredAt`, a `questionnaire.id` and a `params` block. A summary of what you think they would pick is not one — and "I've preselected these, change any you like" followed by carrying on is the failure this exists to prevent.

**3. Answer, and watch the flags.** Conflicts are computed as you go, not collected at the end:

- a **blocker** means do not model yet — a fan and a chandelier both wanting one centre, a panel taller than the ceiling it dies into, sliding shutters on a carcass too shallow to lap;
- a **warning** is worth a look — a headboard that leaves a 6" sliver each side, a seat that will not read as built into its window.

Where a conflict offers **Apply that**, taking it writes the resolution straight into `params`. That is the difference between a plan that says "decide between a fan and a chandelier" and one where `ceiling-fan-with-math.ringLight` is already `true`.

**4. Leave what you do not know blank.** Unanswered questions land in `open` and are listed in the plan. **Never answer on the client's behalf to clear the progress bar** — a guessed answer is indistinguishable from a decided one once it reaches `params`, and that is exactly the kind of thing that gets modelled and then rebuilt.

Taking the defaults is a legitimate answer, but it is **theirs to give, not yours to assume**. "Go with the defaults" said out loud is a decision; defaults you applied because nobody replied are guesses wearing the same clothes. When they do choose the defaults, say which ones carried real consequences — the questionnaire's defaults describe the brief, not the room you just traced, and a default that contradicts a measurement is a conflict, not a preference.

**5. Download both.** `<room>_plan.json` is what gets applied. `<room>_modelling_plan.md` is what gets read.

**6. Apply the parameters.** Each key in `params` is a library object id; each value is that object's parameter set. Place the objects, then set these. Placement is not in here — see below.

## Adding a room type

Copy the nearest `rooms/*.questions.json`, then read **`questionnaire.schema.md`** before changing a binding. The short version:

- every geometry answer names a real object and a real parameter, spelled exactly as the object spells it;
- lengths are **metres** in the file, feet and inches only in the form;
- two questions never write the same parameter;
- an answer the library has no word for — "daybed" — is **several writes**, not a new option invented on the object's behalf.

Then validate against the live library before anyone fills it in:

```bash
node tools/roomq/validate.mjs skills-room-renderer/rooms/bedroom.questions.json
```

It reads every object from R2 and fails on a parameter that does not exist, an option spelled differently, a numeric parameter fed a string, and two questions fighting over one parameter. Run it after **any** change to the object library, not just after changing a questions file — a renamed parameter breaks a questionnaire silently and from the other side.

## What this does not do

**It does not place anything.** `params` says what an object should be; it says nothing about where it goes or how many there are. Two matching bedside tables are one parameter set placed twice. Use the plan and the place-object solver for position.

**It does not model.** No geometry is created here. The output is the decisions, resolved and machine-readable.

**It does not invent options.** If the brief wants something the library cannot express, that surfaces as a question with nowhere to write — which is the signal to add the parameter to the object, not to write the wish into prose and hope.

## Completion gate

Do not hand over until all four hold:

1. **The plan JSON came from the form**, and carries `answeredAt` and `questionnaire.id`. Defaults you applied on nobody's behalf do not make one.
2. **No unresolved blockers.** Each one is either resolved, or named in the handover as a decision the client still owes.
3. **`open` is empty, or every id in it is listed as an open question.** Silence about a gap is the failure this is built to prevent.
4. **Every binding resolves** — the form's banner is green, or `validate.mjs` exits 0.

State the counts in the summary: questions answered, parameters bound, conflicts outstanding. A room handed over with an unstated gap is the one that comes back.
