---
id: drive-the-canvas-over-the-bridge
name: Run a live trace through the bridge, and the four things that silently do the wrong thing
category: Floorplan Tracer
when: Tracing onto the live canvas — before the first `draw_segment`, and whenever a placed object looks right in the result of the call and wrong on the screen.
tools: [Bash, Read]
requires: [scope-the-trace]
---

The bridge is how geometry reaches the live editor. Everything below was paid for once already; none of it announces itself, because every one of these calls **returns success** while doing something other than what was asked.

## When the MCP connection is down, use the HTTP channel

`floorplan-bridge` often starts a session as `failed / Connection closed`, usually a **port collision** — another chat's bridge already holds 41414. It is not reconnectable from your side: it is a `project` server, so only the user can re-dial it from `/mcp`.

You do not need it. The bridge exposes `POST /enqueue {tool, args}` on the same port, routed through the **same `callTool` path** as the stdio transport. All 37 tools work, including the live-mode ones.

```bash
netstat -ano | grep 41414                               # free?
FP_BRIDGE_PORT=41414 node mcp/floorplan-bridge.mjs &    # banner is on stderr; stdout is the protocol
# open a tab on http://localhost:2500/floorplan-editor?agent=1 so it takes the single-client latch
node tools/fp.mjs get_state '{}'
```

`/` is the project list, not the editor — the bridge answers from either, so a `get_state` that works proves nothing about which page is open. The importer's file input only exists on `/floorplan-editor`.

## The step gate is what makes it live

```
begin_step → draw → checkpoint → begin_step → …
```

While a step is open you may draw; the moment you checkpoint it closes and **every drawing tool is refused** until the next `begin_step`. So a run that never opened a step is not a live run — see `scope-the-trace`. `checkpoint` blocks until the user answers its card; that is deliberate, and it is the only tool here that should hang.

A workable stage list for one room: shell walls · openings · joinery · furniture · lighting · finishes. Six cards, one summary each.

## Building a whole plan in two calls

`apply_model` replaces the whole plan at once — walls, openings as wall `attachments`, node objects via marker walls + `nodeMeta` — and is the fast way to author. But it **stores attachments without resolving them**: `export_plan` afterwards shows `baked` missing and `meshes=0`, and on screen every opening is a generic `segmentType` placeholder — a window piece draws as a door arc, and your `hinge` / `swing` / `sillHeight` are inert.

The fix is one more call. **`import_objects` re-bakes existing attachments in place**: after it, the same export shows every opening with meshes and the baked metrics (`hingeAtEnd`, `swingsToSide`, `sillLevel`) carrying exactly the params you set.

```
clear_canvas → apply_model({ model }) → import_objects   # then verify
```

Two things this does not change. `apply_model` is still **not the verification import** — `verify-trace-overlay-and-areas` step 4 goes through the editor's own `.json` file input, which runs `fromStandardPlan` with settings, underlay and object resolution, and that is the check that proves anything. And author the model from your own geometry, never from `get_plan` (see below).

## The four that lie

**1. `place_object` takes `rotation` as its own argument.** Most objects also have a `rotation` *param*, and passing it there looks right and does nothing — the tool's own default of 0 wins. A window seat placed at `params: { rotation: 90 }` lies across the wall it was meant to sit against, and the call returns a nodeKey exactly as if it had worked.

```js
place_object({ object, x, y, rotation: 90, params })   // not params.rotation
```

**2. `place_opening`'s `flip` does not move the baked geometry.** It is recorded on the attachment and the door draws the same either way. The door object's own `swing` param is what moves the arc. Diff two snapshots before believing a flip did anything — zero differing pixels is the answer you will get.

**3. `get_plan` loses node objects; `export_plan` does not.** `get_plan` returns `objects: []` and `furniture: []` with sixteen of them on the canvas, and has no `nodes` array at all — so `get_plan → edit → apply_model` **drops every piece of furniture, camera and light**. It is not a save file.

`export_plan` carries them, but not where you will look first: a node object is an **attachment on a NODE**, with its own `layer` and `objectPath` and its baked meshes — not on the degenerate marker segment, which comes back bare. Searching the segments for an `objectId` finds the doors and windows and nothing else, which reads exactly like data loss and is not. Walk `nodes[].attachments`.

**4. `delete_entities` takes `segments`, not `ids`.** An `ids` key is accepted, matches nothing, and reports `removed: 0` — and a later `place_opening` will then nest a second opening inside the first. Node objects are deleted by their marker segment: take the wall ids `get_plan` returns, subtract the ones you drew, and the remainder are the markers.

## Reading the result, not the return value

`manualRooms` counts space-hosted **attachments**, not rooms: four space objects on one space reads as `manualRooms: 4` while `list_spaces` correctly says one. Check `list_spaces` before believing you have duplicated a room.

`export_plan` writes a second space record for the attachment carrier, with the same `nodeIds` and the same area. It resolves to one space on import — verified — so do not go hunting for a bug there.

And `pixelsPerMeter` exports as the editor's own value, not the image's px/m. The underlay still overlays exactly because it carries its own world placement, but the export is not at the image-native scale the pipeline prefers, and no bridge tool sets it.
