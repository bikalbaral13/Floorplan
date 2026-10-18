---
id: choose-the-moodboard
name: Get the user's moodboard picks before the fit-out (uploaded board → Moodboard Creator; otherwise the default board)
category: Floorplan Improver
when: Step 1b of every improve run, right after reading the plan and brief and BEFORE choosing the fit-out set — unless the plan already carries `plan.moodboards` with locked picks the user says are current.
tools: [Bash, Read, Write, preview_start, navigate]
requires: [improve-traced-plan, create-a-moodboard, moodboard-picker, save-to-the-library-moodboard]
---

The moodboard picks steer everything after this step: `pickFloorSpec` (tiles, step 3), `applyMoodboardPicks` (params and kelvin, step 7b) and `apply-moodboard-to-modelling-plans` (step 7c). So the picks are collected FIRST, and **the user makes them** — the agent builds and serves the page, never picks, locks or exports on their behalf.

## Branch A — the user uploaded a moodboard file

A designer PDF (or images) of room-wise reference options:

1. Run the **Moodboard Creator** skill on it (`library/Skills/Moodboard Creator/create-a-moodboard.md`): extract the images, describe the options, build the moodboard/1 JSON, bind rooms to this plan's space labels (`bind.spaceNames` from the plan's own labels — read them from `readPlan`).
2. Save it as `library/Moodboards/<id>.json` with images in `library/Images/Moodboards/<Project>/` (`save-to-the-library-moodboard`: byte-verify every file from the public URL). Confirm the id with the user before the upload, as that skill says.
3. Open it in the picker (below) with `?src=library/Moodboards/<id>.json`.

## Branch B — no moodboard uploaded

Open the default board — **moodboard1**, which is `library/Moodboards/ramanadhapuram-apartment-interior.json` — in the picker (`?src=library/Moodboards/ramanadhapuram-apartment-interior.json`, also the picker's own default). Say which board it is (its title) so the user knows it is the default, not theirs. If that key is missing, stop and tell the user — never fall back silently to another board.

## Open the picker for the user

- In the repo: `preview_start` the `moodboard-picker` launch config (port 2612), then navigate to `http://localhost:2612/?src=<key>`. If that server does not come up (seen 2026-09-27: npx vite on 2612 never answered), use the editor dev server instead — it serves the identical copy at `http://localhost:2500/moodboard-picker.html?src=<key>`. Elsewhere: the copy at `library/Skills/Moodboard Creator/moodboard-picker.html` served over http(s) with the same `?src=`.
- Or, when the user works in the editor, point them to **Files ▸ Import Moodboard** with that board — it writes `plan.moodboards` directly and branch C below is not needed.
- Tell them in one message: pick one option per room, **Lock** the rooms that are decided, then **Export JSON** and hand the file back. Then WAIT. Do not continue the fit-out on assumed picks.

## C — Bring the picks into the plan

```js
import { boardSelectionToPlan, attachMoodboard, moodboardPicks } from "./improve.mjs";
const board = JSON.parse(fs.readFileSync("<id>.selected.json", "utf8"));        // the user's export
const { entry, unbound } = boardSelectionToPlan(board, plan, "library/Moodboards/<id>.json");
attachMoodboard(plan, entry);                                                     // replaces an earlier entry for that board
const { report } = moodboardPicks(plan);                                          // locked / shortlisted / unbound / nothingToApply
```

`boardSelectionToPlan` binds rooms to spaces exactly as the editor does (pinned `spaceId` → label words → `roomType`), across every level of a multi-storey plan. Report per room: locked / shortlisted / open, the chosen takeaway, and every `unbound` room (a board room with no space in this plan). Only **locked** picks are applied later; shortlisted ones are reported and left alone. If nothing is locked, say so and ask whether to go on without moodboard styling.

Upload the user's selected board back to `library/Moodboards/<id>.json` only when they say so (it replaces the options-only file).

## Then carry on as usual

Step 2 onward is unchanged: the fit-out reads `moodboardPicks(plan)` for floor specs, 7b applies materials / object params / kelvin, 7c restyles each object's `modelling_plan` to its room's locked pick.
