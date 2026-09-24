---
id: author-missing-parametric-object
name: Author a parametric object the library has not got
category: Scribble to Floorplan
when: A plan needs a fixture, fitting or closure with no file in `Objects/`, and composing it from existing objects would be a lie rather than a simplification.
tools: [Bash, Read, get_object, list_objects]
requires: [furnish-unlabelled-rooms]
---

First ask whether it needs authoring at all. A dining set is a `table` plus four `chair`s and should be composed. Author only when the thing is genuinely absent and genuinely distinct. Three were, on one plan: a storage **water heater** (node), a **channel gate** (segment — a stair that fills its bay cannot take a swinging door), and an **opening** (segment — a verandah's open front is a lintel and two reveals, not a dashed line pretending to be a gap).

## The spine, and what of it is yours

Every object in the bucket is the same six nodes wired the same way:

```
geo (source) → props (input-props) → math (expr) → out (output) → r2d (render-2d)
                                                                 ↘ r3d (render-3d)
```

- `geo` grabs the host points and feeds `P` into props.
- `props` declares the parameter schema; every prop except `P` is wired `props.val-<id> → math.valin-<id>`.
- `math` is one Math Engine expression — the whole object.
- `out` has one slot per published value; geometry slots wire on to a render prim, metric slots stop there and become the reported numbers.
- `r2d` / `r3d` name the prims: `polygon` and `stroke` in plan, `polyhedron` in 3D.

**Copy the host-frame preamble verbatim** from an object with the SAME host kind. Node objects (bed, floor-drain …) open with the nine-point `anchorDir` / `fitMode` / `flipSide` frame; segment objects (door, window) open with the piece-ends frame — `_u` along the host, `_W` = its length under "Fill segment", `_m` its midpoint, `_jL`/`_jR` its ends. That block is the CONTRACT with the host, not your object's idea; an object that reimplements it will sit differently from everything around it. Keep the standard tail parameters too — `rotation`, `anchorDir`, `fitMode`, `margin`, `flipSide`, `semantics` for a node object; `fitMode` and `semantics` for a segment one.

**Write geometry in the host frame, map it once.** Build every part as a Q row `[u1,v1 … u4,v4, z0, z1, group]` about the host midpoint and hand the list to the shared quad-prism block (floor-drain.json has it), which sweeps each quad into a 6-face prism and maps (u, v) → world in one place. Then `compress` by group for each output. A gate written this way is still a gate on a diagonal wall. Use `loop i in n: … end` to accumulate repeated parts (bars, treads, slats) and `cos(i * PI)` for an alternating sign — there is no `mod`.

## Make it parametric on the number people actually use

A geyser is bought in LITRES: capacity is the input, the jacketed bore gives the inner radius, and the shell length falls out — with the two dished ends' volume subtracted, because they hold water too and ignoring them overstates a 25 L unit by 200 mm. A gate is specified by its opening and how far it is FOLDED (`open` as a fraction: the closed run gets the bars, the stack sits at one jamb). An opening is specified by its lintel and its sill — `sillHeight` 0 is open to the floor, 0.9 is a verandah parapet. In each case the parameter is the thing a person would say, and the geometry is derived.

## Give it a plan symbol a person reads

A gate in plan is a track and a zigzag — draw the zigzag as a `stroke` between the bars, not as a solid band. An opening in plan is two jamb marks and one line across at the lintel. The 3D is for the model; the plan symbol is what the drawing is judged by.

## Publish numbers, not just a shape

The metrics are half the reason the object exists. Report what someone specifying, buying or fixing the thing needs: capacity, overall size, surface area, empty AND full weight for a geyser (19.5 / 44.5 kg at 25 L — the second is what the wall carries); opening width, clear opening at the current fold, bar count and weight for a gate; clear width and height, open area and lintel concrete for an opening.

## Bake it alone, then upload it, THEN reference it

```bash
node tools/bake/run.mjs Objects/Architectural/<name>.json --out /tmp/<name>.baked.json
```

Read the mesh count and every metric against the real product — a 25 L geyser is about 450 × 400 mm; if the bake says 675 the maths is wrong, not the product. Then `putObject` it to `library/Objects/<Category>/` BEFORE any plan references it: a plan's bake resolves `objectPath` against the bucket, and an attachment on an object that is not there yet comes back without meshes and vanishes in the app without a word.
