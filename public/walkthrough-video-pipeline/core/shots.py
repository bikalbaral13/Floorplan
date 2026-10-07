"""The shot list (walkthrough-shots/1) and the prompt sheet (walkthrough-prompts/1). Project-independent.

Units: metres, seconds. Axes are the .blend's own (Blender: Z up).
shots.json
  {"schema": "walkthrough-shots/1", "fps": 24, "coverage": "exterior | interior | both",
   "shots": [{"id": "S1", "name": "Arrival aerial", "start": 0, "duration": 10, "lens": 28, "light": "dusk | day | night",
              "camera": {"type": "path", "keys": [[x,y,z], ...]}                      # keys spread evenly over the shot
                     |  {"type": "orbit", "center": [x,y], "radius": 26, "start_deg": 200, "sweep_deg": 96, "z": [z0, z1]},
              "target": {"keys": [[x,y,z], ...]} | {"object": "<prop id or scene object>"},
              "script_cue": "<the script line this shot carries>", "path_ref": "<sheet / marker in the path drawing>",
              "src": "measured | derived | convention | user"}],
   "props": [{"id": "CAR", "type": "car", "keys": [[t_seconds, x, y], ...]}],        # optional moving stand-ins
   "lamps": {"object_pattern": "light|lamp", "height_m": 5.5}}                       # optional, else standards
prompts.json
  {"schema": "walkthrough-prompts/1", "model": "<ai_models key>", "resolution": "720p", "aspect_ratio": "16:9", "seed": 12345,
   "style": {"prefix": "...", "suffix": "..."}, "shots": {"S1": {"body": "..."}}}
The full prompt is always prefix + body + suffix, so every clip carries the same style words.
"""
from pipeline_kit.findings import F

def frames(shot, fps):
    f0 = int(round(shot["start"] * fps)) + 1
    return f0, f0 + int(round(shot["duration"] * fps)) - 1

def full_prompt(prompts, sid):
    st = prompts.get("style", {})
    return " ".join(x.strip() for x in (st.get("prefix", ""), prompts["shots"][sid]["body"], st.get("suffix", "")) if x and x.strip())

def _pt(v, n=3): return isinstance(v, (list, tuple)) and len(v) == n and all(isinstance(c, (int, float)) for c in v)

def check_shots(doc, std, inventory=None):
    fnd, C = [], std["checks"]
    if doc.get("schema") != "walkthrough-shots/1": fnd.append(F("fail", "shots", "schema", "schema must be walkthrough-shots/1"))
    shots = doc.get("shots", [])
    if not shots: return fnd + [F("fail", "shots", "shots", "no shots")]
    ids = [s.get("id") for s in shots]
    if len(set(ids)) != len(ids): fnd.append(F("fail", "shots", "id", f"duplicate shot ids {ids}"))
    bbox = (inventory or {}).get("bbox")
    known = [p.get("id") for p in doc.get("props", [])] + (inventory or {}).get("objects", [])
    t = 0.0
    for s in shots:
        sid = s.get("id", "?")
        if abs(s.get("start", -1) - t) > 1e-6: fnd.append(F("fail", "timing", sid, f"starts at {s.get('start')} s, expected {t:g} s (shots run back-to-back)"))
        d = s.get("duration", 0)
        if d < C["min_shot_s"]: fnd.append(F("fail", "timing", sid, f"duration {d} s < {C['min_shot_s']} s"))
        t = s.get("start", t) + d
        if not C["min_lens_mm"] <= s.get("lens", 0) <= C["max_lens_mm"]: fnd.append(F("fail", "camera", sid, f"lens {s.get('lens')} mm out of range"))
        if s.get("light") not in std["lighting"]: fnd.append(F("fail", "light", sid, f"light {s.get('light')!r} not in {list(std['lighting'])}"))
        cam = s.get("camera", {}); pts = []
        if cam.get("type") == "path":
            pts = cam.get("keys", [])
            if len(pts) < 2 or not all(_pt(p) for p in pts): fnd.append(F("fail", "camera", sid, "path needs >= 2 [x,y,z] keys"))
        elif cam.get("type") == "orbit":
            if not (_pt(cam.get("center"), 2) and cam.get("radius", 0) > 0 and _pt(cam.get("z"), 2) and "sweep_deg" in cam):
                fnd.append(F("fail", "camera", sid, "orbit needs center [x,y], radius > 0, z [z0,z1], start_deg, sweep_deg"))
            else: pts = [[cam["center"][0], cam["center"][1], z] for z in cam["z"]]
        else: fnd.append(F("fail", "camera", sid, f"camera.type {cam.get('type')!r} must be path | orbit"))
        tg = s.get("target", {})
        if "object" in tg:
            if tg["object"] not in known: fnd.append(F("fail", "target", sid, f"target object {tg['object']!r} is neither a prop nor in the scene"))
        elif not tg.get("keys") or not all(_pt(p) for p in tg["keys"]): fnd.append(F("fail", "target", sid, "target needs keys [[x,y,z]...] or object"))
        for p in pts:
            if not _pt(p): continue
            if p[2] < C["cam_min_height_m"]: fnd.append(F("warn", "camera", sid, f"camera at z {p[2]} m is below {C['cam_min_height_m']} m"))
            m = C["site_margin_m"]
            if bbox and not (bbox[0][0] - m <= p[0] <= bbox[1][0] + m and bbox[0][1] - m <= p[1] <= bbox[1][1] + m):
                fnd.append(F("warn", "camera", sid, f"camera key {p} is far outside the model"))
        if not s.get("script_cue"): fnd.append(F("warn", "script", sid, "no script_cue — which script line does this shot carry?"))
        if not s.get("src"): fnd.append(F("warn", "provenance", sid, "no src (measured | derived | convention | user)"))
    for p in doc.get("props", []):
        ks = p.get("keys", [])
        if len(ks) < 2 or any(len(k) != 3 for k in ks) or [k[0] for k in ks] != sorted(k[0] for k in ks):
            fnd.append(F("fail", "props", p.get("id", "?"), "prop keys must be >= 2 [t, x, y] in time order"))
    fnd.append(F("info", "timing", "total", f"{len(shots)} shots, {t:g} s"))
    return fnd

def check_prompts(prompts, shots_doc, std):
    fnd = []
    if prompts.get("schema") != "walkthrough-prompts/1": fnd.append(F("fail", "prompts", "schema", "schema must be walkthrough-prompts/1"))
    m = std["ai_models"].get(prompts.get("model"))
    if not m: return fnd + [F("fail", "prompts", "model", f"model {prompts.get('model')!r} not in standards ai_models {list(std['ai_models'])}")]
    if prompts.get("resolution") not in m["resolutions"]: fnd.append(F("fail", "prompts", "resolution", f"{prompts.get('resolution')} not in {m['resolutions']}"))
    if m.get("seed") and not isinstance(prompts.get("seed"), int): fnd.append(F("fail", "prompts", "seed", "a fixed integer seed is required so every clip shares it"))
    st = prompts.get("style", {})
    if not st.get("prefix") or not st.get("suffix"): fnd.append(F("fail", "prompts", "style", "style.prefix and style.suffix are required (shared by every clip)"))
    for s in shots_doc["shots"]:
        sid = s["id"]; p = prompts.get("shots", {}).get(sid)
        if not p or not p.get("body", "").strip(): fnd.append(F("fail", "prompts", sid, "no prompt body")); continue
        if len(p["body"]) < 80: fnd.append(F("warn", "prompts", sid, "body under 80 characters — describe camera move, architecture, light"))
        d = s["duration"]
        if d != int(d): fnd.append(F("fail", "duration", sid, f"{d} s — AI clips are whole seconds; round the shot"))
        if not m["min_s"] <= d <= m["max_s"]: fnd.append(F("fail", "duration", sid, f"{d} s outside {prompts['model']} limits {m['min_s']}–{m['max_s']} s — split the shot"))
    extra = set(prompts.get("shots", {})) - {s["id"] for s in shots_doc["shots"]}
    if extra: fnd.append(F("fail", "prompts", "extra", f"prompts for unknown shots {sorted(extra)}"))
    return fnd
