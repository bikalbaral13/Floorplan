---
id: wire-services-and-render-kit
name: Switches, sockets, MEP — then the render kit that makes the file shootable
category: Floorplan Improver
when: The room is furnished, tiled, lit and trimmed. Two last layers: the services that make it buildable, and the kit that makes it renderable.
tools: [Bash]
requires: [light-the-rooms, dress-ceiling-walls-and-trims]
---

## Part 1 — Services

These are small, cheap and almost always missing. They are what a contractor looks for first and what makes a plan read as a real drawing.

### Switches

`switch-plate-with-math`, node-hosted on the wall, `mountHeight` **1.15 m**, `gangs` = the number of light groups in the room.

- **Beside the door, on the handle side, inside the room** — 150 mm clear of the architrave, never behind the open leaf.
- A bedroom gets a **second plate beside the bed** (two-way) when the brief or the room size justifies it, at `mountHeight` 0.75 beside the nightstand.
- `gangs` must equal the distinct `lightGroup` values you created in that room. Three groups and a two-gang plate is a fault the verify step catches.
- `finish` follows the brief's hardware: `Matt white` default, `Brushed steel` / `Brass` / `Matt black` when the ironmongery is named.

### Sockets

`socket-outlet-with-math`, node-hosted, `mountHeight` **0.30 m** normally, **1.10 m** over a kitchen counter or beside a mirror.

| Room | Sockets |
|---|---|
| Bedroom | one each side of the bed, one at the dressing table or desk, one spare on the free wall |
| Living | one behind the TV unit, one at each end of the sofa wall, one at the console |
| Kitchen | at least three at 1.10 m along the counter run, one each for fridge and microwave at 0.30 m |
| Study | two at the desk |
| Utility | one per appliance |
| Bathroom | none at low level; a shaver point at the mirror only if the brief asks |

`switched: true`, `outlets` 2, `usb: true` at a bedside or a desk.

### MEP

- **`ac-grille`** — `grilleType: "Linear slot"` in a bedroom or living room, `"Square diffuser"` elsewhere, `ceilingHeight` = `bandSoffit`, on the band, **never over the bed** and never blowing straight at a seat.
- **`water-heater`** — bathroom, `mountHeight` 1.8, `orientation: "Horizontal"`, clear of the door swing (a 2.1 m leaf sweeps through 1.8 m — this is the trap).
- **`floor-drain`** — every wet room and balcony, at the low point, `showFall: true`.
- **`exhaust-hood`** — over the stove, on the **same node** as the stove. That is correct, not a duplicate.

## Part 2 — The render kit

This is what turns the improved plan into a file the Blender pipeline can shoot without further work. It is four objects and it belongs on the whole plan, not per room.

### `render-look`

One per plan, node-hosted anywhere inside it. The engine reads this object's **Output Metrics**, not its params, so set them coherently rather than tweaking one value:

`engine: "Cycles"`, `samples` 256 (32 preview), `denoise: true`, `maxBounces` 12, `resolutionX/Y` 2560 × 1440, `viewTransform: "AgX"`, `blenderLook: "AgX - Base Contrast"`, `worldType: "Sky"`, `timeOfDay`, `latitude` / `longitude` / `timezoneHours` / `dayOfYear` / `hourOfDay` with `sunFromDateTime: true`, `skyTurbidity` 2.6, `exteriorMode: "Ground"`, `groundAlbedo` 0.22, `aoStrength` 0.25, `bevelWidth` 0.0015, `whiteBalanceK` 5000, `vignette` 0.12, `grain` 0.012.

Set the site's real latitude and longitude when the plan has them, and an hour that matches the mood: 15.5 for a warm afternoon rake, 10.0 for flat neutral daylight, 19.0 for a night scene with the cove on.

### The sun

One `light-with-math`, `type: "Directional"`, placed outside the window you want light through, aimed in. `lumens` 18000, `kelvin` 5200, `cri` 98, `aimTilt` −22 for a low afternoon rake, `lamp: "Photometry/Daylight/sun-clear-noon.json"`, `lightGroup: "daylight"`, `sceneMembership: "Photo, Day"`. Its `semantics` should say what it is doing — *"sun through the west window at about 3:30 pm, warm low rake across the porcelain floor"* — because that sentence is read by the renderer.

### `exterior-context`

One per plan. Without it every window looks into a void. `groundSize` 120, `blocks` 7, `ringRadius` 34, `blockMinHeight` 6, `blockMaxHeight` 18, `materialPath: "Site/grass.json"`, `finishes: "Massing=Masonry/concrete.json"`, `semantics: "middle-distance context beyond the glass, hazy, unremarkable"`. Unremarkable is the point — context that draws the eye is a bug.

### Cameras

Three to five `camera-with-math` objects per room worth shooting, each on its own node, each with a `shotName` and `shotOrder`.

- `view: "Perspective"` for the hero, `"Two-point"` when verticals must stay straight (they usually must), `"Panorama 360"` for a walkthrough still.
- `focalLength` 24 for a tight room, 35 for a hero, 50 for a detail. `sensorWidth` 36, `aspect: "16:9"`.
- `eyeHeight` 1.35–1.40 — seated-eye height, which is what interior photography uses, not standing.
- `shiftY` ~0.08 and `tilt` 0 together are what hold the verticals; tilting the camera and fixing it later is not the same picture.
- `minClearance` 0.6 — the camera must not be inside a wall or a wardrobe, and this is the value the verify step tests.
- Point each from a **corner diagonally across the room** at the thing it is about: the bed wall, the wardrobe wall, the window, the feature panel. A camera in the middle of a room looking at a blank wall is a wasted shot.

## The gate

Before moving on: every room with a light group has a switch plate whose `gangs` matches the group count; every wet room has a drain and a heater clear of the swing; the plan has exactly one `render-look`, one `exterior-context`, at least one daylight source and at least one camera. Anything missing goes in the report by name.
