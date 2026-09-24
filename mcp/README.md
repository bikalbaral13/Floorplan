# Floorplan MCP bridge

Lets an MCP client (Claude Code / Claude Desktop) drive the **live** floorplan app you're watching in the browser.

```
Claude ──stdio JSON-RPC──►  mcp/floorplan-bridge.mjs  ──HTTP long-poll──►  browser tab (agent bridge)
                                                        ◄──HTTP result────
```

A tool call from Claude is queued by the bridge, the browser tab picks it up, runs it against the live
canvas, and posts the result back — so you see the change happen on screen.

## Pieces
- `mcp/floorplan-bridge.mjs` — the MCP server (stdio) + an HTTP command channel on `127.0.0.1:41414`. Zero deps.
- `src/floorplan/agentBridge.ts` — the browser client that long-polls the channel and runs commands.
- `src/floorplan/FloorPlanEditor.tsx` — registers the command handlers (opt-in effect).
- `.mcp.json` — registers the server so Claude Code launches it automatically.

## Enable it (one time)

1. **Turn the bridge ON in the app** (it's off by default so it never runs in normal use). Either:
   - open the app at `http://localhost:3000/?agent=1`, or
   - in the browser devtools console: `localStorage.setItem("bp.agentBridge","1")` then reload.
   You can confirm it's polling in the Network tab (requests to `127.0.0.1:41414/next`).

2. **Register the MCP server with Claude.**
   - *Claude Code*: `.mcp.json` in the repo root already declares it. Reload/restart the session; approve the
     server when prompted. The tools appear as `import_objects`, `list_draw_tools`, `draw_segment`,
     `place_opening`, `place_object`, `draw_wall`, `apply_model`, `get_state`, `clear_canvas`.
   - *Claude Desktop*: add the same `mcpServers` entry to its config, pointing `args` at the absolute path of
     `mcp/floorplan-bridge.mjs`.

3. **Prompt Claude.** e.g. *"import objects, then build a professional 2-bedroom apartment: 0.23 m exterior
   walls, 0.10 m interior, doors + windows + furniture + a staircase — apply it and I'll watch."*

## Tools

**Preferred — parametric-object pipeline** (same as the app's Add Segment / Add Node dropdowns; coordinates in **metres**):

| Tool | What it does |
|------|--------------|
| `list_draw_tools` | discover drawable segment/node/space TYPES + every imported object's id, symbol & param schema |
| `draw_segment` | draw a typed segment (`type`: wall/line/door/window/schema type) — tags `seg-type`, auto-creates a layer |
| `place_opening` | cut a Door/Window **parametric object** into the nearest wall (splits wall·opening·wall) |
| `place_object` | place a **parametric object** as an object node (bed.v2 / sofa.v2 / footing.column.v1 / staircase.straight.v1 …) |

**Core / low-level:**

| Tool | What it does |
|------|--------------|
| `get_state` | wall/room/object counts, pixels-per-metre, loaded object ids |
| `import_objects` | load the bundled parametric library (**call first**) |
| `clear_canvas` | new empty document |
| `draw_wall` | append one plain wall (metres; `thicknessM` 0.23=9in / 0.10=4in) — prefer `draw_segment type="wall"` |
| `apply_model` | replace the whole plan with a complete FloorPlanModel JSON (bulk builder; PIXEL coords) |

**Typical flow:** `import_objects` → `list_draw_tools` → `draw_segment` (shell, type=`wall`) → `place_opening` (doors/windows) → `place_object` (furniture). Everything is in metres and renders as real parametric objects.

## Stepwise mode (build *with* the user, not *at* them)

Two tools turn a one-shot build into a reviewed, step-by-step one:

| Tool | What it does |
|------|--------------|
| `begin_step` | **opens a step** and arms the gate. Drawing tools are refused unless a step is open, and you cannot open one while another is open. |
| `delete_entities` | **retraction** — removes segments / objects / furniture by id (redraw the span you want healed). |
| `style_segments` | restyle walls in place: thickness (absolute or scaled) and hatch; keeps `wall-thickness` in step. |
| `attach_segment_object` | the Wall object (or any segment-hosted object) along existing segments without cutting — `all: true` puts `wall-with-math` on every wall. |
| `export_plan` | the exact bytes Export JSON writes — how a run delivers to `library/Designs/`. |
| `checkpoint` | **pauses the agent** and hands control to the user: a card appears in the live app with what you just did; the call blocks until they answer. They can edit the canvas by hand and/or type a note first. Returns `{ decision, notes, userEdits, rev }`. |
| `get_changes_since` | every plan revision after `rev`, each tagged `agent` (your own tool call) or `user` (a hand edit), with the entities added / removed / modified, the properties that changed and geometry in **metres**. |

```
draw step 1  →  checkpoint("1/6 — calibrate")   ⏸  user nudges a wall, types "north wall is 200mm out"
             ←  { decision:"continue", notes:"…", userEdits:[…moved wall…] }
draw step 2  →  checkpoint("2/6 — exterior walls")   ⏸  …
```

The rule that makes it work: **`userEdits` is ground truth.** Re-fit around what the user changed; never
revert it.

**The step gate.** Telling a model to "checkpoint after every step" does not hold — it will merge three
steps into one turn and check in at the end, which is the behaviour stepwise mode exists to prevent. So the
bridge enforces it: `begin_step` opens a step, `checkpoint` closes it, and every drawing tool is refused
while no step is open. A model can still do too much inside one step, but never unlabelled — every write
belongs to a declared step, and every step ends at the user. `"redo step"` keeps the step open so it can be
redone under the same label. The gate stays **disarmed until the first `begin_step`**, so one-shot use of
the bridge is completely unaffected; `import_objects` is never gated, since every skill is told to call it
before anything else. `get_state` reports the open step and the accepted ones, which is how an interrupted
run is resumed.

**Answering from the chat instead of the app.** When the MCP client supports
[elicitation](https://modelcontextprotocol.io/specification/server/elicitation) (protocol `2025-06-18`+,
which the bridge negotiates automatically), `checkpoint` *also* asks in the chat and takes whichever answer
arrives first — a chat answer closes the card in the app, and the user's canvas edits still come back in the
result. Clients without elicitation simply use the card. The wait budget is 30 min (`FP_CHECKPOINT_TIMEOUT_MS`).

Attribution is by time window, not by instrumenting every mutator: `agentBridge.ts` marks the span of each
tool call and `agentRevisions.ts` credits changes inside it (plus a short grace for React's commit) to the
agent. A checkpoint suspends that span while it waits — so edits made while the card is open are the
user's, which is the entire point.


## Notes
- The bridge is **opt-in** and **localhost-only**. Leave it off for normal use; a random web page can't reach
  the channel meaningfully, but don't expose port 41414 beyond localhost.
- If a tool returns *"browser did not respond"*, the tab isn't open with the bridge enabled (step 1).
- **Do not edit `FloorPlanEditor.tsx` while a run is live.** Adding a hook makes Fast Refresh remount the
  editor and the canvas is wiped; and because the bridge effect re-runs on every refresh, a handler must read
  component callbacks through a ref (`export_plan` → `exportJsonRef`), never a captured closure.
- Step-gate state lives in the bridge **process**, so it survives a chat session but not a bridge restart.
  After a restart the canvas is the real record: `get_changes_since(0)` shows what is already drawn, and by whom.
- Change the port with `FP_BRIDGE_PORT`, and point the app at it with `?agentPort=41415` or
  `localStorage.setItem("bp.agentBridgePort", "41415")` — handy for running a second bridge beside the
  one your MCP client owns.
