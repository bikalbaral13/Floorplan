# @builderpluss/floorplan-bridge

Lets **Claude Code** draw in the BuilderPluss floorplan editor that you have open in your browser:
you ask Claude for a plan, and it appears on your canvas as it is drawn.

```
Claude Code ──MCP (stdio)──► floorplan-bridge (on your computer) ◄──polls── your browser tab
```

Nothing runs on a server: the bridge is a small program on your own machine (Node built-ins only), and
your browser tab talks to it at `http://127.0.0.1:41414`.

## Set up (once)

Needs [Node.js 18+](https://nodejs.org) and [Claude Code](https://claude.com/claude-code).

```bash
claude mcp add floorplan --scope user -- npx -y @builderpluss/floorplan-bridge
```

## Use it

1. Open the editor with the bridge switched on:
   **https://floorplan-indol.vercel.app/floorplan-editor?agent=1**
   Chrome may ask to let the site reach devices on your local network — click **Allow** (that is the
   bridge on your own computer).
2. Start Claude Code and ask, e.g. *"Import the objects, then draw a 4 m × 3 m room with a door and a
   table in the middle."*

Keep the editor tab open while Claude works. If several tabs have `?agent=1`, the one you last focused
receives the commands.

## Options

| Variable | Default | What it does |
|---|---|---|
| `FP_BRIDGE_PORT` | `41414` | Port for the browser channel. If you change it, open the editor with `?agent=1&agentPort=<port>`. |
| `FP_BRIDGE_ORIGINS` | — | Extra websites allowed to connect, comma-separated. The deployed app and `localhost` are always allowed. |

Example: `claude mcp add floorplan -e FP_BRIDGE_PORT=41500 -- npx -y @builderpluss/floorplan-bridge`

## Tools

`get_state`, `import_objects`, `list_draw_tools`, `draw_segment`, `place_opening`, `place_object`,
`draw_wall`, `apply_model`, `clear_canvas`, `get_plan`, `export_plan`, `snapshot_canvas`, flow tools and
more — Claude sees the full list with descriptions once the server is added.
