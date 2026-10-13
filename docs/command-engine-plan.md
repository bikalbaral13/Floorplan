# Command Engine — plan

Status: **phases 1–6 built, v0.1.0 published** (2026-10-13). Code: `packages/command-engine` (engine + tests), `src/floorplan/commandEngine` (editor host + runtime), `tools/command-engine` (inventory, publish). Not done yet: chat logging, a review step for learned examples, viewer/connector use, AGENT.md entry.

## Why

Most chat requests in the editor are routine floor-plan edits ("add a door on the north wall of bedroom 2, 900 wide", "hide the MEP layers", "place a queen bed in the master bedroom"). Today every one of them goes to Claude, which turns the sentence into a tool call. The connector's 12 grouped tools (`design`, `objects`, `viewer`, … each taking an `op`) already define what those calls look like.

The **Command Engine** turns natural text into the same JSON tool calls **locally**: no AI, no API cost, works offline, and gives a result in milliseconds where the relay takes ~1.9 s per call. It supplements Claude and does not replace it.

## Settings: Chat Mode

| Mode | Behaviour |
|---|---|
| **AI** | Today's behaviour: everything goes to Claude. |
| **Manual** | Command Engine only. If it can't parse a sentence, it shows example phrasings instead of guessing. |
| **Auto** (default) | The Command Engine tries first. If it's confident it runs the command; if it's unsure it asks "did you mean…"; if it can't parse it, the sentence goes to Claude. |

Every result from the engine shows the JSON it produced as a small card (`Parsed: design.edit {…}` ✓ Run / ✎ Edit) so users can see what it understood.

## Scope

**Command Engine handles:** add/delete/move/resize rooms, walls, doors and windows; place/replace/remove objects; rename; layers, levels and views; render mode; undo/redo; selection.

**Claude still handles:** vague or creative requests ("make it feel spacious"), multi-step skills (Tracer, Improver, Renderer), reading images or PDFs, moodboards, and questions about the plan.

## Architecture

```
text → normalise (units, typos, split multi-step sentences)
     → embed
     → find the command type   (nearest example sentences)
     → Grammar fills in details (numbers, directions, counts)
     → match names              (objects, rooms, layers, materials)
     → Router: confidence → run / suggest top-3 / send to Claude
     → tool call JSON → same execution path as Claude's calls
```

### 1. Grammar layer (rules, TypeScript)
- Rules for each command type built from regular expressions or a PEG grammar.
- Unit parser: mm, cm, m, ft-in, `4x3.5`, `4 by 3.5`.
- **Rules only, never embeddings**, for words embeddings can't tell apart: numbers, directions (N/S/E/W, left/right, clockwise), opposite verbs (add/remove, show/hide), and negation ("don't …").
- Optional: compromise.js (~200 KB) for light part-of-speech help.

### 2. Semantic layer (embeddings)
- **Command types:** about 10 example sentences per command, embedded once; the nearest match decides the command type.
- **Name matching:** embeddings of library objects, materials, and the current plan's room, layer and level names, so "recliner" → `armchair_recliner` and "lounge" → `Living Room`.
- Model: run in the browser with transformers.js.
  - `all-MiniLM-L6-v2` (~23 MB compressed) is the default.
  - `multilingual-e5-small` adds Hindi and Hinglish.
  - About 10–30 ms per sentence.
- Vectors are kept in memory and compared directly; no vector database is needed.

### 3. Router (confidence)
- ≥ 0.80 → run the command.
- 0.60–0.80 → show "Did you mean…" with the top 3 options.
- < 0.60 → send it to Claude (Auto) or show suggestions (Manual).
- The cutoffs are a starting point; tune them on real chat logs.

### Learning
- Each confirmed suggestion is saved as a new example in the user's or project's `learned.json`.
- Learned examples are promoted into the shared published version **only after review**.

## Storage in R2

Same pattern as `library/Engine/<ver>/` and `library/Viewer/v1`: versioned folders that never change once published, plus sha256 checks.

```
library/CommandEngine/
  latest.json                  → { "version": "0.1.0", "sha256": {…} }
  0.1.0/
    command-engine.js          normalise + grammar + router
    manifest.json              files, hashes, modelId, schema "commandengine/1"
    intents/intents.json       command types → tool-call templates
    intents/examples.json      example sentences per command type
    grammar/units.json
    grammar/directions.json
    grammar/synonyms.json      almirah→wardrobe, WC→toilet, …
    vectors/intents.f32
    vectors/objects.f32 + objects.json
    vectors/materials.f32 + materials.json
    model/model.onnx + tokenizer.json   (optional; else a public model CDN)
```

| Part | Where |
|---|---|
| Code, grammar, command types, examples, library vectors | R2, versioned |
| Plan words (rooms/layers/levels) | Built in the browser when a plan loads |
| Learned phrasings | `Projects/<CODE>/command-engine/learned.json` (or a user-level file) |

**Loading:** the editor reads `latest.json`, checks the hashes, loads the files and caches them in IndexedDB. Later starts are instant and work offline.

**Publishing:** `tools/command-engine/publish.mjs` bundles the code, embeds the examples and the library, uploads a new version, and moves `latest.json`. Re-run it whenever `library/Objects` or `library/Materials` changes.

**Other places that can use it:** the R2 viewer, the MCP connector (as a quick first pass), and Python/Blender tools (they can reuse the JSON and vectors). Point to it from `library/AGENT.md` so Claude and the engine share one list of commands.

## Risks

- **Mismatched model and vectors:** record `modelId` in the manifest and refuse to load if it doesn't match.
- **Schema drift:** keep a separate `commandengine/1` schema version so an older editor build doesn't misread a newer intents file.
- **Download size:** set long cache headers and CORS on R2 for the model and vector files (they never change).
- **Wrong edits:** always show the parsed JSON card; every engine action can be undone with one undo.

## Phases

1. **Inventory:** go through past chat transcripts and list the ~30 most common sentence → tool-call pairs. These become the test set.
2. **Grammar MVP:** units, directions, and the 30 command types as rules in TypeScript, plus a test runner on the test set.
3. **Name matching:** embed library objects and materials and publish the vectors to R2. This works on its own and is useful even in AI mode.
4. **Command-type embeddings + Router:** confidence cutoffs, "did you mean", and handoff to Claude.
5. **Settings UI:** Chat Mode AI / Manual / Auto and the parsed-JSON card in chat.
6. **R2 packaging:** `library/CommandEngine/<ver>/`, `publish.mjs`, hash-checked loader, IndexedDB cache.
7. **Learning loop:** `learned.json` plus a review step to promote examples into the next version.
8. **Other places:** viewer, MCP connector first pass, and a reference in `AGENT.md`.

## Success measures

- ≥ 70% of routine edit messages handled in Manual/Auto without Claude.
- Wrong commands run < 2% (measured by undo within 10 s after an engine action).
- Median time from sentence to action < 100 ms after the first load.
