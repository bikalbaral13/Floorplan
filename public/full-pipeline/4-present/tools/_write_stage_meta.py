"""One-off generator for stages/*/stage.json (kept so the descriptors stay consistent; rerun after editing STAGES)."""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

STAGES = [
 ("S0_SCOPE", "Scope the walkthrough (the user answers)", "script", False,
  "Writes scope.json from scope.questions.json defaults as a DRAFT; the user answers it: which .blend, script and camera-path files, exterior / interior coverage, preview quality, AI provider / model / resolution / seed, style notes, budget. Done only when answered_by='user' and the approval carries their words.",
  ["stages/S0_SCOPE/scope.questions.json", "scope.json (user-answered)"], ["scope.json"],
  ["answered_by == user", "required answers present and valid", "blend / script / path files exist", "blend is not inside public/"]),
 ("S1_INTAKE", "Inventory the .blend", "blender", False,
  "Opens the source .blend headless (never saves it): bounding box, object / collection / material lists, lamp-like and interior-hint objects, and a top-down Workbench plan with its pixel → world mapping, so the shot list can be written in model coordinates.",
  ["scope.json", "<blend_path>"], ["intake.json", "work/intake/inventory.json", "work/intake/topdown.png"],
  ["blend opens and renders", "coverage vs interior hints (warn)", "metric units, scale 1 (warn)"]),
 ("S2_SHOTLIST", "Author the shot list (agent)", "agent", False,
  "The agent turns the script + camera-path drawing into shots.json (walkthrough-shots/1) in model coordinates, using intake.json and the top-down plan. Shots the model cannot show (e.g. interiors in an exterior-only file) are dropped and listed in PROJECT.md.",
  ["scope.json", "intake.json", "work/intake/topdown.png", "<script_file>", "<path_file>"], ["shots.json"],
  ["schema", "back-to-back timing", "camera path / orbit valid", "targets exist", "lens and light valid", "cameras inside the site (warn)", "script cue + src on every shot (warn)"]),
 ("S3_BUILD", "Build the walkthrough .blend", "blender", False,
  "shots.json → <CODE>_walkthrough.blend: a camera + look-at target per shot bound to timeline markers, sun / moon / sky keyed per shot light, street-lamp point lights, glowing windows at night, moving prop stand-ins, optional flat-material palette. The source .blend is never overwritten.",
  ["scope.json", "shots.json", "standards"], ["work/output/<CODE>_walkthrough.blend", "build.json"],
  ["build script succeeds", "one camera per shot", "frame range = total duration"]),
 ("S4_PREVIEW", "Render the preview", "blender", False,
  "Renders every shot with the scope's preview preset (default 'low': Workbench 960x540 @ 12 fps) as its own clip with first / last keyframes, then joins them into <CODE>_preview.mp4. These clips are the AI reference videos.",
  ["build.json", "shots.json", "standards"], ["work/output/preview/shots/<ID>.mp4", "work/output/preview/keyframes/*", "work/output/<CODE>_preview.mp4", "preview.json"],
  ["every shot rendered", "clip size >= the AI model's minimum reference pixels"]),
 ("S5_PREVIEW_REVIEW", "The user approves the preview", "script", True,
  "Show the user the preview video and keyframes. They approve the framing and timing, or say what to change (then rerun S2/S3/S4).",
  ["preview.json"], ["preview.json (approved)"], ["the user's words"]),
 ("S6_PROMPTS", "Author the AI prompts (agent)", "agent", False,
  "The agent writes prompts.json (walkthrough-prompts/1): one shared style prefix / suffix, one fixed seed, and a body per shot describing camera move, architecture, materials and light from the script. Full prompts are written to prompts.preview.md for the user.",
  ["shots.json", "scope.json", "standards style", "<script_file>"], ["prompts.json", "prompts.preview.md"],
  ["model known", "resolution allowed", "fixed integer seed", "shared style", "every shot has a body", "durations whole seconds within model limits"]),
 ("S7_BUDGET", "The user approves the generation spend", "script", True,
  "Summarises what S8 will submit (clips, seconds, model, resolution, provider concurrency) against scope.budget_units. Generation spends the user's credits, so it never starts without their words.",
  ["prompts.json", "preview.json", "scope.json"], ["budget.json"], ["reference clips large enough", "the user's words"]),
 ("S8_GENERATE", "Generate the AI clips", "script", False,
  "One clip per shot, sequentially (provider concurrency 1). connector mode: writes generate/requests.json; the agent submits each through the Krea MCP connector and records job ids / result URLs in jobs.json; rerun downloads finished clips. api mode: upload → submit → poll → download with $KREA_API_KEY. Resumable: finished clips are never regenerated; out-of-credit (402) or busy (429) blocks with the shot to resume from.",
  ["prompts.json", "preview.json", "jobs.json"], ["jobs.json", "work/output/ai/<ID>.mp4"],
  ["every shot has a downloaded clip", "no failed jobs"]),
 ("S9_ASSEMBLE", "Assemble the final video", "blender", False,
  "Joins the AI clips in shot order (optionally under scope.audio_file) into <CODE>_final.mp4 with Blender's sequencer.",
  ["jobs.json", "work/output/ai/*.mp4"], ["work/output/<CODE>_final.mp4", "final.json"],
  ["every shot present", "duration within 10 % of the shot list"]),
 ("S10_REVIEW", "The user approves the final video", "script", True,
  "The user watches the final video and approves; the hand-off is recorded and outputs may be published to Projects/{CODE}/walkthrough/.",
  ["final.json"], ["handoff.json"], ["the user's words"]),
]

for sid, title, kind, gate, summary, ins, outs, checks in STAGES:
    d = os.path.join(ROOT, "stages", sid); os.makedirs(d, exist_ok=True)
    json.dump({"id": sid, "version": "0.1.0", "title": title, "kind": kind, "gate": gate, "summary": summary,
               "inputs": ins, "outputs": outs, "checks": checks}, open(os.path.join(d, "stage.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
open(os.path.join(ROOT, "stages", "__init__.py"), "w", encoding="utf-8").write("")
print("wrote", len(STAGES), "stage.json files")
