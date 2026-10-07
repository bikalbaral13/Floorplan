# S2 — author `shots.json` (agent)

You turn the user's **script** and **camera-path drawing** into a shot list in the model's own coordinates.
Read `scope.json`, `intake.json` and look at the top-down plan (`work/intake/topdown.png`) first.

## Coordinates
- Metres, the .blend's axes (Blender: Z up). `intake.json → topdown` gives the plan mapping:
  `x = cx + (px_x - px/2) * m_per_px`, `y = cy - (px_y - px/2) * m_per_px`.
- Match landmarks in the path drawing (entry drive, spine, named buildings) to the plan **by shape**, not by the drawing's scale.
- Use real object positions where you can (an instance's location from `work/intake/inventory.json` or a quick Blender query) and tag those `src: "measured"`; positions read off the plan are `derived`; house defaults are `convention`.

## Shots
- One shot per camera move in the path drawing, **in film order**, `start` = previous `start + duration` (back-to-back, from 0).
- Durations in **whole seconds**, between the AI model's `min_s` and `max_s` (standards `ai_models`). Split longer moves.
- Heights from the drawing (drone, eye level 1.5–1.7 m, crane). Lens: 24–35 mm walks / interiors, 28–50 mm exteriors.
- `camera.type: "path"` with ≥ 2 keys spread evenly over the shot, or `"orbit"` (center, radius, start_deg, sweep_deg, z [start, end]).
- `target`: look-at keys, or `{"object": "<prop id>"}` to follow a prop (e.g. a car).
- `light`: one of the standards lighting presets (`dusk`, `day`, `night`); a night shot switches lamps + window glow on.
- `script_cue`: the script line the shot carries; `path_ref`: the marker in the drawing.

## What the model cannot show
- If a scripted scene is not in the model (interiors in an exterior shell, an amenity that is not modelled), **do not invent geometry**. Drop or substitute the shot (an exterior shot of the same area) and list every drop / substitution with its reason under `## Decisions` in `PROJECT.md`. The user sees this at S5.

## Props (optional)
`{"id": "CAR", "type": "car", "keys": [[t, x, y], ...]}` — t in seconds of film time; the stand-in faces its direction of travel.

## Done when
`python tools/run_task.py <CODE> --task S2_SHOTLIST` passes (no `fail`). Fix warnings or explain them in PROJECT.md.
