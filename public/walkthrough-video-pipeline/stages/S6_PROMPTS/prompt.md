# S6 — write the shot prompt bodies (agent)

`prompts.json` is drafted with the model, resolution, seed and the house style from `standards/DEFAULT.json`.
You write **only `shots.<ID>.body`** (and adjust `style` if the user asked for a different look).

The full prompt sent for a shot is always `style.prefix + body + style.suffix`, so every clip carries the same
style words, and every clip uses the same `seed`. That is what keeps separately generated clips consistent.

## A body says, in this order
1. **Camera**: the move from `shots.json` in words (descending drone, eye-level walk at 1.6 m, lateral slide at 3 m, slow orbit, rise while pulling back), and that it follows the reference video.
2. **Place and architecture**: what is in frame, from the script's "Visual" lines and `scope.style_notes` (location, building type, facade materials, landscape, street furniture).
3. **Light**: matches the shot's `light` (dusk: golden hour, long shadows, lamps warming; night: uplit facades, glowing windows; day: soft sun).
4. **Motion**: props that move (a car gliding to a stop), nothing else.

## Rules
- Describe only what the model has or what dressing can plausibly add (trees, lamps, lit windows). Never promise a structure that is not in the reference (an arch, a clubhouse, a fountain) unless the user accepted that the AI invents it.
- No people, text or logos unless the user asked for them (the suffix already says so).
- Keep durations as in `shots.json` (whole seconds, inside the model's limits).
- Do not change `seed` per shot.

Done when `python tools/run_task.py <CODE> --task S6_PROMPTS` passes; show the user `prompts.preview.md`.
