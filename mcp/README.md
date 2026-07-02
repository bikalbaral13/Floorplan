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
   - open the app at `http://localhost:2000/?agent=1`, or
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

## Notes
- The bridge is **opt-in** and **localhost-only**. Leave it off for normal use; a random web page can't reach
  the channel meaningfully, but don't expose port 41414 beyond localhost.
- If a tool returns *"browser did not respond"*, the tab isn't open with the bridge enabled (step 1).
- Change the port with `FP_BRIDGE_PORT` (also update the fetch base in `agentBridge.ts` if you do).
