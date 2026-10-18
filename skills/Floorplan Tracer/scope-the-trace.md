---
id: scope-the-trace
name: Ask what the trace is for before measuring anything
category: Floorplan Tracer
when: A raster floorplan or a drawing PDF has just been handed over and the run has not started — including the short form, "from the image, trace the master bedroom". Before `trace-raster-plan-to-canvas` or `trace-raster-plan-live`.
tools: [Bash, Read]
requires: []
files: [trace-scope.questions.json, trace-scope-form.html]
---

A trace that runs to completion and hands back the wrong thing has cost more than one that asked. The usual way to get this wrong is to open the image, start measuring wall bands, and discover at the overlay proof that the user wanted a bare graph of one room and no furniture at all.

Everything in this form changes **which steps run** or **what the build script emits**. None of it is a preference, and none of it can be inferred from the image.

## Run it

```
trace-scope-form.html?q=trace-scope.questions.json
```

Or open the form and pick the file. The user answers; the form produces a **run plan** — the mode, the entry skill, the ordered list of skill files to read, and an options block. The Brief tab is the same thing in plain text, and is what you paste back into the conversation.

Twenty questions, five of them conditional, all with defaults that describe the accurate route. A user who changes nothing gets the pipeline as `trace-raster-plan-to-canvas` documents it.

## Getting it in front of the user, and getting it back

Rendering the form is not asking the question. **Confirm the user can actually see it**, because the usual ways of showing it all fail quietly:

- the desktop app's Browser pane **can be hidden**, so a form opened there is running where nobody can see it — `tabs_context` tells you, and there is no tool to un-hide it;
- a `localhost` URL only works while your dev server is alive, and dies with the session;
- an inline widget renders, but nothing makes the user submit it.

So: put the form where they can reach it, say so in one line, and then **stop**. Do not begin the next sentence with what you are going to do while measuring.

**A run plan is something the form produced.** It has `scopedAt`, a `questionnaire.id` and a `run` block. Your own summary of what you think they want is not one, however carefully reasoned — and writing "I've preselected these four, change any of them" then proceeding is the exact failure this gate exists to stop.

If the user says "go ahead" without answering, they are answering *one* question — whether to proceed — not the other twenty. Say plainly which assumptions you are about to make, and get those confirmed. Two lines, not a lecture.

## Live means the step gate, not the live canvas

These are different things and confusing them is easy:

- **drawing on the live canvas** — your `draw_segment` calls land in the editor and the user can watch the geometry appear. This is what `trace-raster-plan-to-canvas` does when the app happens to be open.
- **live mode** — `trace-raster-plan-live`: every stage is opened with `begin_step`, drawn, and then handed to the user with `checkpoint` before the next one starts.

A run that draws on the live canvas without ever opening a step is **batch mode with an audience**, and calling it live is a misreport. The check is one call and it is not optional:

```bash
node tools/fp.mjs get_state '{}'     # stepState.armed must be true before you draw
```

`armed: false` with `stepIndex: 0` and `completed: []` at the end of a run means no step ever ran. If the run plan said live and that is what `get_state` shows, the run did not do what was asked — say so rather than describing the result as live.

`checkpoint` blocks until the user answers its card, so drive it on its own call and let it wait. It is the only tool here that is *supposed* to hang.

## A PDF instead of an image

The first question, *What are you handing over?*, decides whether `pdf-intake` runs. For a PDF, three more questions appear:

- **What is in it:** *let the intake decide*, one plan, several floors of one building, or a master plan.
- **Which pages.**
- **Whether to check the crops.**

The first of these only adds the route skills to the steps. The real route is the `documentKind` the intake writes after reading the sheet titles, and the user sees it with the crops.

Two things to hold to:
- **The crops gate is the user's.** When `options.confirmCrops` is true, show the contact sheets and the table and stop, exactly as with this form. `manifest.confirmed` is set from their answer, never from yours.
- **A multi-level or master-plan PDF in live mode raises a warning.** The live route draws one plan on one canvas. Trace one confirmed crop live, or run the set in batch.

## What the answers actually decide

**Mode** picks the entry point, and it is the biggest branch in this skill. *Run it through* is `trace-raster-plan-to-canvas`; *trace it while I watch* is `trace-raster-plan-live`, which splits the work by who is faster — the user clicks a scale in ninety seconds, the agent measures fifty centrelines. Do not pick this for them.

**Scale source** decides whether `calibrate-scale-from-printed-dimensions` runs at all. Picking *I will set the scale myself* drops it from the steps, because there is nothing left to fit.

**Detail** is a ladder, and each rung adds emitted elements rather than changing the method — this trace is pixel measurement plus your reading of zoomed crops, not a detector, so asking for less does not make it less accurate, only faster. *Centrelines only* also drops `read-openings-and-fixtures-by-zoom`, because there is nothing to classify.

**When printed sizes and drawn walls disagree** is the question most likely to be answered wrongly by an agent guessing. Solving from the printed spans makes every room label read exactly as printed and moves wall lines a few pixels; following the drawn walls keeps the measured lines and lets labels read a few inches off. Both are defensible. It is not your call.

## The flags

Computed as the user answers, never collected at the end. A **blocker** is a contradiction — asking to set the scale yourself in a run that never stops to hand you the app. A **warning** is a consequence worth seeing before it arrives: a guessed scale that every downstream dimension inherits, one nominal wall thickness under a printed-exact solve, room labels asked for at a detail level that emits no spaces.

The single-room warning is deliberately one that changes nothing: a room's walls are shared, so the bands either side still get measured. The saving is in what gets authored. Say that rather than letting the user believe one room is a tenth of the work.

## Validate the file, not just the answers

```bash
node tools/roomq/validate-trace-scope.mjs skills-floorplan-tracer/trace-scope.questions.json
```

It checks that every step named in the questionnaire is a skill file that exists in this folder, that every `showWhen` and flag predicate names a real question, and that no two questions write the same option path. Run it whenever a skill file in this folder is renamed — a step that no longer exists produces a run plan telling you to read a document that is not there, and nothing else complains.

## "Trace the master bedroom" — the whole route

That sentence names an image, a scope and a room, and nothing else. It is not enough to start on, and it is not enough to guess from either. Run the form.

1. **Scope the trace.** The user picks *one room*, names it, and says what kind of room it is. Those three answers are what turn a one-line request into a run plan.
2. **Trace it**, through whichever entry the run plan names. A single room still measures the bands either side — its walls are shared.
3. **Hand over the measurements.** The run plan carries `handoff`, and the trace produces a flat map of what it learned:

```json
{
  "room_length":  { "value": 3.962, "source": "measured" },
  "clear_span":   { "value": 3.352, "source": "derived" },
  "sill_height":  { "value": 0.914, "source": "convention" }
}
```

4. **Then the design questions**, opened on that map.

**The `source` tag is the part to get right.** `measured` came from pixels and `derived` was computed from measured things — both are facts and both arrive locked. `convention` is this skill's own assumption wearing a number: step 3 of `read-openings-and-fixtures-by-zoom` assigns a toilet window a sill of 1.5–1.8 m because that is what toilet windows are, not because anything was measured. Tag those as `convention` and they arrive flagged and editable. **Tag a convention as measured and you have laundered a guess into a fact** — which is the one failure this whole chain is arranged to prevent.

A plan has no heights. Slab height, lintel heights and whether a beam crosses the room are not in a raster floorplan and are never prefilled, however confident the trace was about everything else.

## What this does not do

**It does not look at the image.** Every question here is answerable before opening the file. Questions that need a look — which of the plans on this sheet, which rooms are there, is there a compass — are answered *by you* during the run, and the form only captures the user's intent about them.

**It does not trace.** The run plan is an input to `trace-raster-plan-to-canvas` or `trace-raster-plan-live`, not a substitute for either.

**It does not carry design decisions.** Nothing here says what a room should look like. That is a different skill with a different form, and the two share no files — this one names where to go next and hands over a flat map of measurements, which is the whole of the contract between them.

## Completion gate

Do not measure a single pixel until all four hold:

1. **The run plan came from the form**, and carries `scopedAt` and `questionnaire.id`. Preselections you made and described are not a run plan.
2. **No blockers.** A blocker is a contradiction in the request, and starting anyway means discarding work later.
3. **The image is named**, and it is the file, not a screenshot of it.
4. **The run plan is in the conversation**, so the user can see the pipeline before it runs rather than after.

And one at the end of the run, not the start: **if the run plan said live, `get_state` must show steps were actually run.** `completed: []` means it did not happen, whatever the geometry looks like.
