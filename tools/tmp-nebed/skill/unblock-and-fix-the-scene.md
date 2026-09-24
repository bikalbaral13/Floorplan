---
id: unblock-and-fix-the-scene
name: The scene pass — take out what blocks the light, fix what the plan export got wrong
category: Floorplan Renderer
when: After the inspection, before any lighting work. Doing it the other way round means tuning lamps to compensate for a curtain.
tools: [Bash, Write]
requires: [inspect-the-blend, bind-plan-materials]
---

The scene pass is not decoration. Most of what makes a first render look amateur is **something in the way of the light** or **a surface wearing the wrong material**, and no amount of lamp tuning fixes either.

Run it as a script against the original file, never by hand in the UI, so the whole thing is reproducible:

```bash
blender -b original.blend -P scene_pass.py -- improved.blend
```

## Things that block the light

| Problem | Fix |
|---|---|
| A blackout layer + drape fully covering the only window | Hide the blackout. Duplicate the drape and scale each copy to **17 % in Y**, anchored at opposite window edges — two gathered stacks, window clear |
| A Principled BSDF with transmission on the glazing | Cycles treats sun and sky through it as **caustics**, which are off in an interior preset, so almost no daylight enters. Use the architectural glass shader below |
| A door leaf swung open where the camera needs to stand | Hide the leaf and its ironmongery — the door is behind the camera |
| An en-suite door opening into the shot | Rotate it about its hinge: `T(h) · Rz(90°) · T(−h) · matrix_world` |

### Architectural glass

The camera sees a reflective pane; every other ray passes straight through. This is the single highest-value material in an interior — it is what lets daylight in without caustics.

```
Light Path › Is Camera Ray ──► Mix Shader (Fac)
    input 1  Transparent BSDF                                    ← shadow / diffuse / glossy rays
    input 2  Mix( Fresnel IOR 1.52, Transparent, Glossy rough 0.02 )   ← camera rays
```

### A light portal is part of this pass, not the lighting pass

An area light with `is_portal = True` filling the window opening — on the 3BHK job, **1.45 × 1.1 m**, facing into the room. It emits nothing; it tells Cycles where the sky is worth sampling, and it removes more noise per second than any sampling setting.

## Duplicates and clutter

The inspector's collection counts are where these show up.

- **Two bedding sets interpenetrating** (a `Bed` collection and a `Bedding` collection both carrying a duvet) reads as a bloated, lumpy bed. Keep one.
- **A low-poly potted plant** reads as stray lines. Hide it — *a bad prop is worse than no prop*.
- **Helper geometry** — camera cones, aim tubes, the north arrow. Confirm `hide_render` is actually set rather than assuming the exporter did it.

## Materials a plan export gets wrong, every time

These are not random. A plan tool assigns by rule, and the same rules miss the same surfaces:

| Object | Typically exports as | Should be |
|---|---|---|
| TV screen | walnut | near-black glossy glass with a coat |
| Window frames | marble | dark bronze anodised metal |
| Wall art | plaster on every part | walnut frame, paper mat, procedural print |
| Structural columns | diagram grey, with rebar | wall plaster |
| Plant leaves | bark | green glossy leaf |
| Walls | flat grey-white | warm greige — edit the existing colour-ramp stops rather than replacing the material |
| Rug | wool with an odd fringe | stone wool + espresso border with bump; hide the fringe |

The inspector's material table — surface node plus texture node per material — is how you find them: a screen whose texture node is a `TEX_WAVE` is wearing timber.

**Fix the rule, not the object, when the plan is yours.** If the plan came out of Floorplan Improver, a wrong material here usually means a wrong `materialPath` in the plan, and editing the .blend throws the fix away at the next bake. `bind-plan-materials` has the precedence. Edit the .blend only for things the plan genuinely cannot state.

## The one that is not a material bug

A tiled floor that renders as a **chessboard** is not a wrong material — it is a pattern procedural laid over geometry that already is that pattern. See `bind-plan-materials`; the fix is in the plan.

## Order matters

Unblock → fix materials → *then* light. A curtain left closed makes you raise the sun; taking the curtain out afterwards leaves the room blown out, and the lamp values you settled are all wrong.
