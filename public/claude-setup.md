# BuilderPluss Floorplan — setup instructions for Claude Code

> **For the user:** start Claude Code in any folder and say:
> *"Follow https://floorplan-indol.vercel.app/claude-setup.md"*
> Claude will set everything up, open the editor for you and tell you when you can start asking for drawings.

---

## Instructions for Claude

You are setting up the **BuilderPluss floorplan editor** so this user can draw floor plans by prompting you.
The editor runs in the user's browser at `https://floorplan-indol.vercel.app/floorplan-editor`. You drive
it through a small local MCP server, **floorplan-bridge**, that relays your tool calls to the open tab.

Work through the steps in order. **Ask the user whenever you need an input or a decision** (a step
below says which ones), confirm before installing anything, and explain each step in plain words.
Keep going until Step 6 passes — do not stop half-way with a list of things for the user to do.

### The quick way: Connect Claude (nothing to install)

The editor has a **Connect Claude** button (plug icon, top right). It pairs the open tab with a hosted relay
on this same site, so there is no local server and no Node.js to install.

1. Ask the user to open `https://floorplan-indol.vercel.app/floorplan-editor`, click **Connect Claude**, then
   **Connect**, and paste you the command it shows. It looks like:
   `claude mcp add --transport http floorplan https://floorplan-indol.vercel.app/mcp --header "Authorization: Bearer fpa_…"`
2. Ask permission, then run it with `--scope user` added so it works from any folder. If a `floorplan`
   server already exists, ask whether to replace it (`claude mcp remove floorplan --scope user`).
3. Tell the user to **restart Claude Code** so it loads the new server, keep the editor tab **visible**, and
   ask for a drawing. Check with `get_state`.

Over this link a tool that takes longer than about 50 seconds (a `checkpoint` waiting for the user, a big
`apply_model`) returns `{ "pending": true, "ticket": "…" }`. Call **`await_result`** with that ticket, again
until it returns the real result. The token lasts 12 hours; after that (or after **Disconnect**) the user
connects again and you re-run the new command. No sign-up is involved.

Use the steps below only when the user wants the **local** bridge instead (offline work, or a browser that
cannot reach the site).

### Step 1 — Check the prerequisites

1. Run `node --version`. It must be **18 or newer**.
   - Missing or older: ask the user whether you may install it, then install Node.js LTS the normal way for
     their system (Windows: `winget install OpenJS.NodeJS.LTS`; macOS: `brew install node`; Linux: their
     package manager or https://nodejs.org). Re-check the version afterwards.
2. Ask the user **which browser** they will use. **Google Chrome is recommended** (tested). Edge usually
   works. Firefox and Safari are untested — say so.

### Step 2 — Register the bridge with Claude Code

Ask the user for permission, then run:

```bash
claude mcp add floorplan --scope user -- npx -y @builderpluss/floorplan-bridge
```

- If it says a server named `floorplan` already exists, ask whether to keep it or replace it
  (`claude mcp remove floorplan --scope user`, then add again).
- If `npx` later reports the package **cannot be found (404)**, it has not been published to npm yet.
  Tell the user, and ask them for the path of a copy of `floorplan-bridge.mjs` (the BuilderPluss team
  can send it). Then register it with `claude mcp add floorplan --scope user -- node "<that path>"`.

### Step 3 — Port check (only if needed)

The bridge listens on `127.0.0.1:41414`. Check whether that port is already taken
(Windows: `netstat -ano | findstr 41414`; macOS/Linux: `lsof -i :41414`).
- Free: continue.
- Taken: tell the user, pick a free port (e.g. `41500`), remove and re-add the server with
  `-e FP_BRIDGE_PORT=41500`, and remember to add `&agentPort=41500` to the editor URL in Step 5.

### Step 4 — Restart so the tools load

A newly added MCP server is only picked up when Claude Code starts. Tell the user:

> "Please exit Claude Code (`/exit`) and start it again in this folder, then say **continue the floorplan setup**."

When they come back, confirm the tools are there (you should have `get_state`, `import_objects`,
`place_object`, `draw_segment`, …). If they are missing, have the user run `/mcp` and check that
`floorplan` is connected; fix the command from Step 2 if it failed.

### Step 5 — Open the editor for the user

Open this URL in the browser they chose (add `&agentPort=<port>` if you changed the port in Step 3):

```
https://floorplan-indol.vercel.app/floorplan-editor?agent=1
```

- Windows (Chrome): `start chrome "https://floorplan-indol.vercel.app/floorplan-editor?agent=1"`
- macOS (Chrome): `open -a "Google Chrome" "https://floorplan-indol.vercel.app/floorplan-editor?agent=1"`
- Linux: `xdg-open "https://floorplan-indol.vercel.app/floorplan-editor?agent=1"`
- Other browser, or the command fails: give the user the URL to open themselves.

Tell the user: **"If the browser asks to let this site access devices on your local network, click Allow"** —
that is how the page reaches the bridge on their own computer. Keep this tab open while working; if they
have several editor tabs with `?agent=1`, the last one they clicked receives the drawing.

### Step 6 — Confirm the connection

Call `get_state`. A result with `walls`, `ppm`, `objectIds` means the tab is connected.

If it times out ("browser did not respond"):
1. Ask the user to click once inside the editor tab (the focused tab takes the connection) and retry.
2. Check the URL contains `?agent=1` (and the right `agentPort`).
3. Chrome: the site may be blocked from the local network — have them click the icon at the left of the
   address bar ▸ Site settings ▸ allow **Local network access**, then reload.
4. Browser extensions that block requests (ad/privacy blockers) can stop it — ask them to allow the site.

### Step 7 — Library access (ask; the user enters the keys, not you)

Reading the object library needs no keys. **Listing the full, current library** (all furniture such as
table, chair, sofa, wardrobe) and saving/uploading to it needs Cloudflare R2 keys. Ask the user:

> "Do you have Cloudflare R2 keys for the BuilderPluss library? If yes, enter them in the editor:
> ⚙ **Preferences ▸ Cloudflare R2 keys** — Endpoint, Access Key ID, Secret Access Key, Bucket — then
> click **Save keys**. It should say **Connected**. If you don't have keys, we can still draw with the
> built-in objects."

**Never ask the user to paste the keys into this chat, and never type them yourself.** They stay in the
user's browser.

### Step 8 — Ready

Call `import_objects`, then `list_draw_tools` to see what can be placed, and tell the user setup is done,
for example:

> "All set — the editor is connected. Try: *draw a 4 m × 3 m bedroom with a door and a window*, *place a
> table in the middle*, or *trace this floor plan image: <path>*."

## Working with the editor afterwards

- Coordinates for `draw_segment`, `place_opening`, `place_object` are in **metres**.
- Typical order: `import_objects` → `list_draw_tools` → `draw_segment` (walls, `type: "wall"`) →
  `place_opening` (doors/windows) → `place_object` (furniture, using ids from `list_draw_tools`).
- `snapshot_canvas` returns a picture of the canvas — use it to check your work before reporting back.
- Skills (Floorplan Tracer, Floorplan Improver, Floorplan Renderer, Parametric Object Creator, …) are
  published in the library. When the user asks for that kind of job, fetch the index
  `https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library/Skills/index.json`, pick the skill, and fetch
  its files as `baseUrl + path` (encode spaces as `%20`). Some skills mention helper scripts that exist
  only on the BuilderPluss team's machine — if a step needs one, tell the user rather than guessing.
- Nothing is saved automatically: remind the user to use **Files ▸ Export** to keep a plan.
