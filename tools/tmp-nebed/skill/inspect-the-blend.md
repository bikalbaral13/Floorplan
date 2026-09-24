---
id: inspect-the-blend
name: Read the scene before touching it
category: Floorplan Renderer
when: First step of every render job, and again after any pass that moves or bakes geometry.
tools: [Bash, Read]
requires: [render-a-floorplan]
---

Run `inspect_blend.py` before changing anything. It writes nothing and saves nothing.

```bash
blender -b <file>.blend -P inspect_blend.py -- [--room "M. BEDROOM"] [--limit 40]
```

## Why world-space bounding boxes, and never `obj.location`

Geometry that came out of a plan tool has its coordinates **baked into the mesh**, so almost every object sits at `location = (0, 0, 0)` and the transform tells you nothing at all. Ask the corners where they are:

```python
def bb(o):
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    return [round(min(p[i] for p in pts), 2) for i in range(3)] + \
           [round(max(p[i] for p in pts), 2) for i in range(3)]
```

Every number in this skill is world space, in metres, and comes from that function. It is also the only honest way to check a cloth simulation afterwards — see `model-soft-goods-and-edges`.

## What to read, and what each answer decides

| Section | What it settles |
|---|---|
| **collections + counts** | where things live; a collection with one object is usually a duplicate of something |
| **north arrow** | which axis is north — every sun angle and every "the west window" depends on it |
| **room floor plates** | each room's extent, so you can list what is inside it |
| **inside `--room`** | the room's actual contents, largest footprint first, with z range, `hide_render` and material |
| **lights** | type, count, total watts, colour, position |
| **world** | sky type, strength, **sun disc on/off**, elevation |
| **cameras** | lens or ortho scale, position, rotation, shift |
| **materials** | surface node + texture node per material, so a screen wearing timber shows up |
| **render** | engine, device, resolution, samples, time limit, view transform |

## Finding north

**Trust the architect's drawing over the trace.** On the 3BHK the traced `north-arrow` carries `rotation: 0` (the object default, i.e. nobody set it) and the Tracer labelled terraces `OPEN TERRACE N / E / W` as if north were page-up — while the source sheet's own arrow points to the **right**. Open the source image (`settings.source.image`) and read its arrow; when the two disagree, the drawing wins and the report says so. With north = page-right, the north-east bedroom is BEDROOM 3 (bottom-right of the sheet), not a room at the top.

The arrow's head is the long end of its bbox; read which axis it runs along rather than assuming `+Y`. On the 3BHK it came back **`+X`**, not `+Y` — so "the west window" is at `−X`, and a sun placed for a `+Y` north would have come through the wrong wall. If there is no north arrow the script says so, and north becomes an assumption that belongs in the report.

## Finding the rooms

Floor plates live in the `Spaces` collection. **`bp_host` is the host KIND (`"space"`), not the label** — read it alone and every room prints as "space" and `--room` can never match anything. The label survives in the object NAME, after the `·`. With that fixed the 3BHK lists all twelve: `M. BEDROOM 4.22 × 3.97 m`, `A.TOILET 2 1.70 × 3.22 m`, and so on.

## The numbers that matter in the light list

The script prints total watts per lamp type and the range. Two things to look at:

- **Total watts against room area.** On the 3BHK it read `AREA ×14 total 42.8 W` and `POINT ×10 total 35.0 W` — coves at 4.89 W and fan lights at 7.61 W. That is a fraction of what an interior needs, and it is the single biggest reason a first render comes back dim and muddy. See `light-and-expose` for what to do about it.
- **The colour.** Every lamp read `rgb (1.0, 0.38, 0.1)`. That looks alarming and **is not a bug** — measured against Blender's own Blackbody node, it is an accurate *linear* 2700 K. `light-and-expose` has the full table and explains why it still renders orange.

## Check it again after every destructive pass

A cloth bake, a modifier apply, a re-parent: re-run the inspector and compare bounding boxes. A duvet that ended at `z = −0.28` fell through its collider; one at `y-max 4.48` slid off the foot of the bed. Both look plausible in an outliner and both are obvious in a bbox.
