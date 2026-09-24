---
id: create-a-parametric-object
name: Create a professional parametric object (six-node JSON) from an image or a brief
category: Parametric Object Creator
when: The user wants a NEW library object, or an existing one rebuilt, that looks like real furniture or a real fitting rather than a CAD block — "make a chair like this photo", "rewrite sofa.json so it looks professional", "add a pendant lamp object". The deliverable is ONE `library/Objects/<Category>/<name>.json` in the six-node spine format (same as bed.json and chair.json), bound to library materials, loaded on the canvas, rendered once in Blender at low quality and exported once to GLB, then shown to the user for the next iteration.
tools: [Bash, Read, Write, Edit, Browser]
requires: [study-the-reference, pick-the-mesh-technique, author-the-six-node-flow, make-the-materials, check-in-canvas-blender-glb, parametric-object-creator-scripts]
---

# Create a parametric object

This skill turns **a picture or a sentence** into a parametric object that belongs in the same library as
`Objects/Architectural/bed.json` (upholstered bed, channelled headboard, draped duvet) and
`Objects/Architectural/chair.json` (tub dining armchair, diamond-quilted shell, piped seams, splayed oak legs).
Read both before starting — they are the house style, and chair.json was written with exactly this process.

## The loop

```
 1. study-the-reference        image?  → parts, proportions, materials, what makes it read as real
                               no image → the same list from architectural knowledge, stated out loud
 2. pick-the-mesh-technique    one technique per part, chosen, not defaulted to boxes
 3. make-the-materials         reuse Materials/** first; create a new material/1 file only when nothing fits
 4. author-the-six-node-flow   expr body + props + slots + rows + Material nodes, built by a script
 5. check (Node)               check_object.mjs: evaluates, times, face runs, SIGNED VOLUME, plan rings
 6. publish to R2              library/Objects/<Category>/<name>.json (+ any new material)
 7. check-in-canvas-blender-glb   canvas → 3D view screenshot · Blender low-sample still · GLB export
 8. compare with the reference, show the user the three pictures, ASK for the next iteration step
```

Steps 1–6 are yours. Step 8 is the user's: **stop and ask**. Do not start a second iteration on your own
judgement of "close enough" or "not yet"; show what you have and let them say which part to change.

## What "professional" means here — the four things a CAD block gets wrong

1. **No perfect 90° arris anywhere a hand would touch.** Every box-like part is at least an eased
   `Solid.SoftBox`; upholstery ROLLS on a stated radius. A dead-square edge is the loudest CG tell.
2. **Soft parts are one continuous surface, not boxes butted together.** A tub chair's back and arms are
   one loft along one plan curve; a duvet is one drape with a roll and a fall. Joints between separately
   modelled soft parts read as a toy.
3. **Surface detail is displacement, not more parts.** Quilting, tufting, channels, creases, gathers and
   folds are a function applied to a face's points (see `pick-the-mesh-technique`). They cost vertices,
   not objects.
4. **Seams and trims exist.** Piping along an upholstery seam, a welt, a shadow gap, a chamfered foot.
   They are small and they are most of why a render reads as a photograph.

And one thing that is not geometry: **a material per row**, bound through a Material node, from the library.

## Hard rules (each one cost a debugging session)

- **Six-node spine only**: `source → input-props → expr → output → render-2d + render-3d`, plus Material
  nodes wired to `matin-<rowId>`. Resolve nodes by `data.tool`, never by id.
- **Keep the object's orientation convention.** Furniture faces +x at rotation 0 (its BACK is at −x) —
  the plan tools' measured BACK table and `furnish.mjs`' `faceTo` depend on it. A rewrite that turns an
  object round silently faces every placed copy into the wall.
- **When rewriting an existing object, a param whose MEANING changes gets a NEW id.** Placed copies store
  every param as an override: the old chair's `backHeight: 0.9` (above the seat) would have given the new
  tub chair a 1.35 m back. Keep an id only when its meaning is identical.
- **Never reduce (`max`, `min`, `sum`) over a whole mesh column.** In this engine a `max()` over a 27 000-row
  column took 12 s; the chair's metrics block was 95 % of a 67 s evaluation until the extents were computed
  from the per-station vectors instead. Target: **under ~1.5 s at the default detail**.
- **Check signed volume of every solid.** An inside-out loft renders fine on the canvas (faces are
  double-sided) and lights wrongly in Blender. The chair's seat came out negative the first time.
- **Write the expression body in its own `.txt` and build the JSON with a script** — never hand-edit a
  47 kB JSON string, and never embed the body in a JS template literal (backticks, `${`).

## Where things live

| What | Where |
|---|---|
| Objects | R2 `library/Objects/<Category>/*.json` (served as `/Library/Objects/...`) |
| Materials | R2 `library/Materials/<Category>/*.json`, schema `material/1` |
| This skill | R2 `library/Skills/Parametric Object Creator/` |
| Worked example source | repo `tools/tmp-chair/` (`expr.txt`, `build.mjs`, `check.mjs`, `upload.mjs`) |
| Engine builtins | `../engine/src/expr/expr.ts` (functions), `exprAlgorithms.ts` (`Solid.SoftBox`, `Solid.Skin`) |
| Canvas mesh path | `src/floorplan/flow/eval/spineObject.ts` → face lists; `FloorPlan3DCanvas.tsx` draws them flat-shaded |

Upload with `putObject` from `tools/r2.mjs` (config from `tools/tmp-r2/ls.mjs`'s `cfg`), and read the object
back to confirm the byte count — see `parametric-object-creator-scripts`.

## Report to the user, every iteration

- the three pictures: canvas 3D screenshot, Blender still, and a line saying the GLB exported (size, mesh
  and material count) — or exactly which step failed and its output;
- the metrics the object reports (overall W × D × H, key heights, mesh faces, evaluation time);
- what differs from the reference, part by part, in one line each;
- **a question**: which of those to change next, or whether it is done.
