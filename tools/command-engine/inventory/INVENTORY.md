# Command Engine — Phase 1 inventory

Run: `node tools/command-engine/inventory.mjs` (reads `~/.claude/projects/D--MAIN-monica-recent` and `D--MAIN-Viewer`).

## What the transcripts contain

- 89 sentence → canvas-tool-call pairs from 15 sessions; **68 unique sentences** (some sessions were copied/resumed).
- Raw pairs: `pairs.jsonl`; tool frequency: `tools.json`.
- Most-called canvas tools: `place_object` 91, `import_objects` 52, `get_state` 49, `flow_apply` 42, `snapshot_canvas` 42, `list_layers` 32, `set_image_underlay` 21, `clear_canvas` 13.

## Main finding: these are developer sessions, not editor chat

Almost every sentence is a **development request** ("improve floorplan.v8.json so…", "fix the Image node…", "restart server"). The canvas calls are Claude checking its own work, not a user editing a plan.

Nearly none are routine one-shot edits like "add a door to bedroom 2". The closest are:
- "put the underlay up" → `underlay.set`
- "clear the canvas" (implied in several sessions) → `design.clear`
- the 3BHK object list → `place_object` ×N (a batch of `object.place`)

So the transcripts can't supply the ~30 command patterns with real phrasings. **The editor's in-app chat (`ChatAIPanel`) isn't saved anywhere**, and that is where routine user commands actually happen.

## What was produced instead

`seed-intents.json` lists **30 command types**. They are mapped to the real tool surface:
- `design.edit` ops from `server/designMcp.mjs`: `wall, line, opening, space, object, attach, move, set, delete, layer`
- plus the `draw`, `layers`, `underlay`, `viewer` and `session` groups from `packages/floorplan-bridge/toolGroups.mjs`

Each command type has its slots and 2–3 hand-written example sentences. This is enough to start Phase 2 (grammar MVP) and its test runner.

## Recommended next step (small, before Phase 2)

Add opt-in logging to the editor chat. For every message, save `{ text, toolCalls[], mode, accepted }` to `Projects/<CODE>/command-engine/chatlog.jsonl` (or the browser's local storage).

After a week of real use, re-run the inventory on that log. Then:
- replace the hand-written examples with real phrasings
- re-rank the 30 command types by actual frequency
