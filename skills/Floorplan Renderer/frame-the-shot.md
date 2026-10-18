---
id: frame-the-shot
name: The plan view, the room view, and aiming a camera at what it is named for
category: Floorplan Renderer
when: Deciding what to render — the whole floor or one room — and making the cameras point at it.
tools: [Bash]
requires: [render-a-floorplan]
---

## The default is the whole floor from above

If the user has not named a room, that is the deliverable. It is **not** a photograph taken from the ceiling; it is an architectural plan, and three things make it one.

**Orthographic.** A perspective camera from above splays the walls outward and the rooms at the edge lean away. `enrich_plan.mjs` adds a camera with `view: "Orthographic"` and `orthoScale` = the long side of the plan extent in metres, plus 2 %. `orthoScale` is the frame **width**, so setting it from the long side means nothing is cropped whichever way round the plan is.

**Straight down.** `tilt: -90`. The renderer's `bearing_dir(rotation, tilt)` returns `(sin b · cos t, cos b · cos t, sin t)`, so a tilt of −90 gives `(0, 0, −1)` regardless of bearing. Height is the slab plus 6 m — an orthographic camera does not care, but the clip range and the helper cone do.

**A cut.** `--cut 1.35`. Without it the ceilings are the nearest surface and every furnished room renders as a white rectangle — which is exactly what it looks like from above, and exactly why plans are drawn as sections. The flag hides every object whose **lowest** vertex is above the cut, so walls survive (they start at the floor) and ceilings, cove bands, cornices, curtain tracks and high-level art do not. 1.2–1.4 m is the conventional plane; go higher only to keep a tall wardrobe's top.

The camera is inserted **first** in the node list, so it is `scene.camera` and `--camera 1`.

## One room instead

`enrich_plan.mjs --room "BEDROOM 2"` frames that space's ring rather than the whole floor, exact label first then a contains match, and lists the labels it has if nothing matches. For an interior shot render the plan's **own** cameras instead — the eye-level ones — and leave `--cut` off, because the ceiling and its cove are most of what makes an interior read.

## A camera must be aimed, and the bearing is derived

**`rotation: 0` is not "no rotation", it is east.** Eight shots named for eight different subjects, all left at 0, render the same wall eight times. This is the single most common way a plan looks finished and renders useless, and no amount of checking material assignments will explain it.

The renderer reads `rotation` through `bearing_dir(rotation + 90)` measured `atan2(x, −y)`. So in the **plan** frame (x east, y south), the bearing from a camera at `(cx, cy)` to what the shot is about at `(tx, ty)` is:

```js
rotation = (atan2(tx - cx, -(ty - cy)) * 180 / PI - 90 + 360) % 360
```

Derive it from the subject named in `shotName`. A shot called "wardrobe and window wall" is aimed at the wardrobe's anchor, not at a number someone typed.

## Eye height, tilt and the verticals

- `eyeHeight` **1.35–1.40 m** — seated-eye height, which is what interior photography uses. 1.6 makes a room look like a security camera.
- `view: "Two-point"` forces `tilt` to 0, which is what keeps verticals vertical. Use it for every interior. `shiftY ≈ 0.08` lifts the frame without tilting.
- `focalLength` 24 in a tight room, 28–35 for a hero, 50 for a detail. A 3.7 m bedroom at 35 mm sees one piece of furniture.
- `minClearance` 0.6 — and check it: a camera inside a wardrobe still renders, it just renders the inside of a wardrobe.

## A dedicated hero camera beats any of the plan's own

The cameras a plan carries are placed by rule. One hero camera, placed by eye against the inspector's room bounds, is worth all of them. The reference bedroom:

- **In the corner by the door, looking diagonally across at the focal wall.** Location `(-0.78, 2.30, 1.22)`, rotation `(90°, 0, 47°)`.
- **Rotation X exactly 90° is what makes it two-point** — perfectly level, verticals stay vertical, which is the architectural standard. Frame with `shift_y = -0.06`, never by tilting.
- **16 mm on a 36 mm sensor** — about 96° horizontal. A 3.7 m bedroom at 35 mm sees one piece of furniture.
- `clip_start = 0.05`, eye height **~1.2 m** for a bedroom, and stand **~20 cm off the walls**.
- **Framing**: focal wall right of centre, the window as a daylight source on the left, the bed on the diagonal leading the eye in.

If something large cuts into a bottom corner, yaw a few degrees rather than moving the camera — on the reference job a TV unit in the bottom-left was fixed by going from 47° to ~44°.

## Prove it small, every time

```bash
blender -b --python render_plan.py -- plan.v2.json --out <ABS> --camera 2 --res 720 --samples 24
```

About a minute. This is the only check that catches a camera aimed at a wall, a room with no light in it, or a mesh inside the lens. Settle exposure here with `--exposure` rather than re-rendering with different lamps — it is a view-transform stop, not a re-light.

A render that came out black, brown or empty **still exits 0**. Open the PNG.
