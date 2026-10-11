"""python tools/selftest.py [--blender] — run after ANY change to core/, bscripts/, standards/ or a stage.

 1 structure: every PLAN stage has stage.json + run.py (+ prompt.md for agent stages); gates are declared
 2 the Kingswood fixture shot list and prompts pass every check
 3 negative cases — each rule must actually FAIL: gaps between shots, unknown light, bad orbit, missing target prop,
   fractional duration, clip longer than the model allows, missing seed, missing prompt body, unknown model
 4 frame maths: back-to-back shots map to contiguous frames
 5 vendored pipeline_kit matches KIT.json (no hand edits)
 --blender  6 smoke: build + draft-render a 2-shot walkthrough of a generated scene (needs Blender, ~1 min)
"""
import copy, hashlib, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, shots as SH, stage as S, blender

STD = paths.standards(); FX = os.path.join(paths.ROOT, "tests", "fixtures")
res = []
def check(c, msg): res.append((bool(c), msg))
def fails(fnd, name): return [f for f in fnd if f["level"] == "fail" and f["check"] == name]

# 1 structure
for sid in S.PLAN:
    m = S.meta(sid); d = paths.stage_dir(sid)
    check(m["id"] == sid and os.path.exists(os.path.join(d, "run.py")), f"{sid}: stage.json + run.py")
    if m["kind"] == "agent": check(os.path.exists(os.path.join(d, "prompt.md")), f"{sid}: agent stage has prompt.md")
check([s for s in S.PLAN if S.meta(s)["gate"]] == ["S5_PREVIEW_REVIEW", "S7_BUDGET", "S10_REVIEW"], "gates: preview review, budget, final review")
# 2 fixture
shots = paths.load_json(os.path.join(FX, "kingswood_ext.shots.json")); prompts = paths.load_json(os.path.join(FX, "kingswood_ext.prompts.json"))
inv = paths.load_json(os.path.join(FX, "kingswood_ext.inventory.json"))
f1 = SH.check_shots(shots, STD, inv); f2 = SH.check_prompts(prompts, shots, STD)
check(not [f for f in f1 if f["level"] != "info"], f"Kingswood shot list clean ({[f['msg'] for f in f1 if f['level'] != 'info'][:3]})")
check(not [f for f in f2 if f["level"] != "info"], f"Kingswood prompts clean ({[f['msg'] for f in f2 if f['level'] != 'info'][:3]})")
check(SH.full_prompt(prompts, "S2").startswith(prompts["style"]["prefix"]) and SH.full_prompt(prompts, "S2").endswith(prompts["style"]["suffix"]), "full prompt = shared prefix + body + shared suffix")
# 3 negatives
def neg(mut, name, msg, which="shots"):
    a, b = copy.deepcopy(shots), copy.deepcopy(prompts); mut(a, b)
    fnd = SH.check_shots(a, STD, inv) if which == "shots" else SH.check_prompts(b, a, STD)
    check(fails(fnd, name), msg)
neg(lambda a, b: a["shots"][2].__setitem__("start", a["shots"][2]["start"] + 1), "timing", "a gap between shots FAILS")
neg(lambda a, b: a["shots"][0].__setitem__("light", "sunrise"), "light", "an unknown light preset FAILS")
neg(lambda a, b: a["shots"][4]["camera"].pop("radius"), "camera", "an orbit without a radius FAILS")
neg(lambda a, b: a["shots"][1]["target"].__setitem__("object", "BUS"), "target", "following a prop that does not exist FAILS")
neg(lambda a, b: a["shots"][0].__setitem__("duration", 9.5), "duration", "a fractional-second shot FAILS for AI clips", "prompts")
neg(lambda a, b: a["shots"][0].__setitem__("duration", 40), "duration", "a shot longer than the model allows FAILS", "prompts")
neg(lambda a, b: b.pop("seed"), "prompts", "a missing fixed seed FAILS", "prompts")
neg(lambda a, b: b["shots"]["S3"].__setitem__("body", ""), "prompts", "a missing prompt body FAILS", "prompts")
neg(lambda a, b: b.__setitem__("model", "acme/unknown"), "prompts", "an unknown model FAILS", "prompts")
# 4 frames
fr = [SH.frames(s, shots["fps"]) for s in shots["shots"]]
check(fr[0][0] == 1 and all(fr[i + 1][0] == fr[i][1] + 1 for i in range(len(fr) - 1)), f"shots map to contiguous frames 1–{fr[-1][1]}")
# 5 kit
kit = json.load(open(os.path.join(paths.ROOT, "_vendor", "KIT.json"), encoding="utf-8"))
d = os.path.join(paths.ROOT, "_vendor", "pipeline_kit")
check(all(hashlib.sha256(open(os.path.join(d, f), "rb").read()).hexdigest() == h for f, h in kit["files"].items()), f"vendored pipeline_kit {kit['version']} unmodified")
# 6 optional Blender smoke
if "--blender" in sys.argv:
    tmp = tempfile.mkdtemp(prefix="wt_selftest_")
    mini = {"schema": "walkthrough-shots/1", "fps": 24, "coverage": "exterior", "shots": [
        {"id": "A", "name": "Walk", "start": 0, "duration": 4, "lens": 28, "light": "dusk", "camera": {"type": "path", "keys": [[0, -12, 1.6], [0, -6, 1.6]]}, "target": {"keys": [[0, 0, 2]]}, "script_cue": "t", "src": "convention"},
        {"id": "B", "name": "Orbit", "start": 4, "duration": 4, "lens": 35, "light": "night", "camera": {"type": "orbit", "center": [0, 0], "radius": 15, "start_deg": 0, "sweep_deg": 90, "z": [8, 6]}, "target": {"keys": [[0, 0, 2]]}, "script_cue": "t", "src": "convention"}]}
    src = os.path.join(tmp, "scene.blend")
    blender.run("_selftest_scene.py", {"out": src}, os.path.join(tmp, "scene.json"))
    r = blender.run("build_walkthrough.py", {"blend": src, "out_blend": os.path.join(tmp, "wt.blend"), "shots": mini, "std": STD, "materials": "palette"}, os.path.join(tmp, "build.json"))
    check(r.get("ok") and len(r["shots"]) == 2 and r["frame_end"] == 192 and r["lamps"] == 1, f"Blender build: {r.get('error') or (len(r.get('shots', [])), r.get('frame_end'), r.get('lamps'))}")
    if r.get("ok"):
        p = blender.run("render_shots.py", {"blend": os.path.join(tmp, "wt.blend"), "out_dir": tmp, "preset": STD["render_presets"]["draft"], "shots": mini, "std": STD}, os.path.join(tmp, "render.json"))
        check(p.get("ok") and all(os.path.exists(x["clip"]) for x in p["shots"]), f"Blender draft render: {p.get('error') or [os.path.basename(x['clip']) for x in p['shots']]}")
        a = blender.run("assemble.py", {"clips": [x["clip"] for x in p.get("shots", [])], "out": os.path.join(tmp, "joined.mp4")}, os.path.join(tmp, "asm.json"))
        check(a.get("ok") and abs(a["seconds"] - 8) < 0.2, f"Blender assemble: {a.get('error') or a.get('seconds')} s")

for ok, msg in res: print(("PASS " if ok else "FAIL ") + msg)
n = sum(1 for ok, _ in res if not ok); print(f"\n{len(res) - n}/{len(res)} passed"); sys.exit(1 if n else 0)
