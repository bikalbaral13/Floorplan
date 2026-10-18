---
id: verify-the-improvement
name: Prove the improvement before reporting it
category: Floorplan Improver
when: The improved JSON is written. Nothing is reported until this passes.
tools: [Bash, Read]
requires: [emit-improved-canvas-json, verify-before-reporting]
---

Eleven checks. Each one has caught a real failure. Run them all, print the numbers, and fix rather than excuse.

## 1 — The shell did not move

Diff the improved plan against the input on the wall graph alone: every node that existed in the input still exists at the **same x and y**, every `wall` / `door` / `window` segment still connects the same two nodes with the same `thickness`, and every space still lists the same `nodeIds` in the same order.

Any difference is a bug, not an improvement. The Tracer solved those centrelines from printed dimensions so that every room reads exactly as printed; a fit-out that nudges a wall to make a wardrobe fit has broken the drawing to hide a bad choice.

Print: `nodes carried N/N · segments carried M/M · spaces carried S/S · max coordinate delta 0.000 px`.

## 2 — Every room is actually finished

Count attachments per space and compare against the set `choose-the-fitout-set` chose. A bedroom holding a bed and nothing else is unfinished. Print a table:

```
M. BEDROOM   16.8 m²   floor 14  wall 5  high 13  surface 3   tiles ✓  ceiling ✓   60 objects
A.TOILET 2    5.5 m²   floor  4  wall 3  high  3  surface 3   tiles ✓  ceiling —   29 objects
```

**Gate on KINDS, not on band counts.** "three floor objects" passes a bathroom that has a WC, a basin and a shower but no drain and no mirror, and fails one that has all five — because a floor drain is a `surface` object and a mirror is a `wall` one. Ask for the things by name (`CORE_SET` in `improve.mjs`) and print what is missing.

And **count segment-hosted objects too.** A room's mirror, skirting, curtain track and wall art all live on its walls, not in its space; tally only node and space attachments and a fully finished bathroom reports "MISSING: mirror" when the mirror is right there.

## 3 — Nothing sits in a door swing

For every door and open bay, rebuild the clearance zone (its clear width across, 0.9 m deep, both sides of the wall) and test every `floor`-band object footprint against it, plus every `wall`-band object below 2.1 m. Report each hit with the object, the door and the overlap in millimetres.

The water heater at 1.8 m inside a 2.1 m leaf's sweep is the one that gets missed.

## 4 — No two floor objects overlap

Build each placed object's rotated footprint from its own `length`/`width`/`depth` and `rotation`, and test every **floor–floor** pair. `wall`, `high` and `surface` bands are exempt, and the tile field and rug are expected to underlie everything.

Two real failures this catches: a fridge and a TV unit each pushed ~30 mm into a column, and a bed pushed to the wall centreline ending up inside its own headboard panel — remember a feature panel sits `backerThk + paddingDepth` in front of the wall face.

## 5 — Every reference resolves

Walk every attachment and assert:

- `objectPath` exists in the `library/Objects/` listing,
- `materialPath` exists in `library/Materials/`,
- every path in `finishes` (`Row=path; Row=path`) exists,
- every `lamp` exists in `library/Photometry/`,
- every `select` param's value is one of that prop's actual options.

**Mind the prefixes — they are not uniform.** `objectPath` and `lamp` carry their own top folder (`Objects/Architectural/bed.json`, `Photometry/LED/cob-spot-3000k.json`), but `materialPath` and every path inside `finishes` are relative to `Materials/` (`Finishes/plaster.json`, `Emissive/diffuser.json`). Compare them without prefixing and a clean plan reports 370 unresolved paths, which is how this check gets ignored.

The last one is the quiet killer: a `pattern` of `"Herringbone"` on an object that offers five other names falls through the expr's ternary chain to the final branch, and you get a diamond floor nobody asked for. Compare each value against the real `input-props` list, not against memory.

## 6 — Bake it

Bake every attachment headlessly and assert each one produced geometry. An object that bakes empty is one whose params are self-contradictory — a wardrobe wider than its wall, a `cellSize` the cap floored to nothing, a curtain with `drop` above `railHeight`.

Read the tessellation metrics back per space and print `cellSizeUsed`, `cellsDrawn` and `coverage`. If `cellSizeUsed ≠ cellSize`, the 250-cell cap fired and your tile is not the tile you specified.

Then check the cameras: each one's eye point must be inside its room's polygon, clear of every `floor`-band footprint by `minClearance`, and not inside a wall.

## 7 — Import it

The real test is the app's own JSON importer — **not** `apply_model`, which skips the ppm, underlay and object resolution that the importer performs. Open `/floorplan-editor`, import the file through the editor's `.json` file input, and confirm with the counts and a screenshot:

```
nodes · segments · spaces · objects resolved · objects missing (must be 0)
```

A plan that imports with "(missing)" objects has a path that does not exist, and check 5 should have caught it — if it did not, check 5 is wrong.

**Read the browser console, not just the counts.** The editor's node count will not match the file's — it merges coincident nodes and does not list object-hosting nodes separately — so a mismatch there is not by itself a fault. What IS worth reading is a React `two children with the same key` warning naming an `att-…` id: it means one segment's attachment list is being rendered once per adjoining room. Confirm against the file first (a clean plan has zero duplicate attachment ids), and if the file is clean, the duplicate is the editor drawing a party wall's trims on both faces — harmless for geometry, but it is also the signal that you have put two objects of one kind on a shared wall.

## 8 — Draw it

Counts do not show a bed inside a wardrobe. `overlay.mjs` bakes every attachment and writes the whole floor as one SVG, coloured by what each thing is and layered floor-finish → trims → furniture → services → lighting. It is the only check that catches a plausible-looking plan that is visually wrong, and it is the artefact worth handing to the user alongside the JSON.

## 9 — No two node objects share a point

`I.coincidentNodes(plan)` must be `[]`. Two markers on one coordinate lose BOTH attachments in the bake
(see `emit-improved-canvas-json`). The symptom downstream is the renderer's attachment count coming back
lower than the plan's by an even number.

## 10 — Every emitter states its output

`I.emitterFaults(plan)` must be `[]` — every downlight, pendant, fan kit and light has `lumens`, every
cove, strip and backlit mirror has `lumensPerMetre`. A missing value renders as a light that is simply not
there. Report the per-room lux (lumen method) AND the emitter list; a room whose light list has no cove
lamp while the plan has a cove is this fault.

## 11 — Modelling plans follow the picks (only when the plan has locked moodboard picks)

Re-run `I.modellingPlanWorklist(plan, loadDef)` on the OUTPUT: every item must have a `params.modelling_plan`
or have been decided `keep` in step 7c, and 7c's `rejected` and `untouched` must both have been empty. Every
per-placement plan's `{refs}` resolve against its object, and every `objectPath` under
`Objects/Moodboard/` exists in the bucket (check 5 covers it if you include those paths). Report the
kept / improved / rewritten / new-object counts per room.

## The report

Plain sentences, no JSON pasted into chat:

- what the input was and what came back, with both file paths;
- the per-room table from check 2, including lux and tile spec;
- the tile set-out: size, pattern, joint, offsets and the cut width at each wall;
- the colour temperature chosen for the house and why;
- **every judgement made because the brief did not say** — the tile size, the ceiling height, the sofa count, the camera positions;
- **every substitution** — what was asked for, what the library actually had;
- anything that failed a check and what you did about it.

If a check failed and you could not fix it, say so plainly with the numbers. A reported failure is worth more than a silent one.
