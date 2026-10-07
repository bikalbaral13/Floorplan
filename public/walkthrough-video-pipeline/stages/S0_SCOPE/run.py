"""S0 — scope. The user answers; proceeding on the drafted defaults is a failure."""
import os
from core import paths
from core.stage import result, F, status_from

def run(ctx):
    q = paths.load_json(os.path.join(os.path.dirname(__file__), "scope.questions.json"))
    if not ctx.has("scope.json"):
        draft = {"questionnaire": q["id"], "answered_by": "", "answered_at": "", **{x["id"]: x.get("default") for x in q["questions"]}}
        ctx.save("scope.json", draft)
        return result("blocked", "Draft scope.json written from the defaults. Ask the user every question, record THEIR answers, "
                      "set answered_by='user' and answered_at, then rerun with --approved \"<their words, date>\".", ["scope.json"])
    s = ctx.scope; fnd = []
    if s.get("answered_by") != "user" and not (ctx.fixture and s.get("answered_by") == "fixture"):
        fnd.append(F("fail", "scope", "answered_by", "scope.json is not answered by the user"))
    if ctx.fixture: fnd.append(F("info", "scope", "fixture", "regression fixture: answers and approvals are test inputs, not user decisions"))
    if not s.get("answered_at"): fnd.append(F("fail", "scope", "answered_at", "answered_at missing"))
    for x in q["questions"]:
        v = s.get(x["id"])
        if x.get("required") and v in (None, "", []): fnd.append(F("fail", "scope", x["id"], "required answer missing"))
        if "options" in x and v not in (None, "") and v not in x["options"]: fnd.append(F("fail", "scope", x["id"], f"{v!r} not in {x['options']}"))
    for k in ("blend_path", "script_file", "path_file", "audio_file"):
        if s.get(k) and not os.path.exists(s[k]): fnd.append(F("fail", "scope", k, f"file not found: {s[k]}"))
    bp = os.path.abspath(s.get("blend_path") or "")
    if s.get("blend_path") and os.sep + "public" + os.sep in bp: fnd.append(F("fail", "scope", "blend_path", "keep the .blend outside public/ (the web app would ship it)"))
    std = ctx.standards()
    if s.get("ai_provider") == "krea" and s.get("ai_model") not in std["ai_models"]:
        fnd.append(F("fail", "scope", "ai_model", f"{s.get('ai_model')!r} has no limits in standards ai_models — add it first"))
    if s.get("ai_mode") == "api" and not std["krea"].get("verified"):
        fnd.append(F("warn", "scope", "ai_mode", "api mode paths are not verified yet (standards krea.verified=false) — connector mode is the tested path"))
    if not isinstance(s.get("seed"), int): fnd.append(F("fail", "scope", "seed", "seed must be an integer"))
    if not ctx.approved: fnd.append(F("fail", "scope", "approval", "rerun with --approved \"<the user's words, date>\""))
    st = status_from(fnd)
    return result(st, f"scope: {s.get('coverage')} · {s.get('target_seconds')} s · preview {s.get('preview_preset')} · {s.get('ai_provider')}/{s.get('ai_model')} {s.get('ai_resolution')} seed {s.get('seed')}",
                  ["scope.json"], fnd, [f"scope answered by the user: {ctx.approved}"] if st == "done" else [])
