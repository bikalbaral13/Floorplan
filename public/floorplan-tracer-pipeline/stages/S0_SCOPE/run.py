"""S0 — scope. The user answers; rendering a form and proceeding on preselected answers is a failure."""
import os, datetime
from core import paths
from core.stage import result
from core.model import F

def run(ctx):
    q = paths.load_json(os.path.join(os.path.dirname(__file__), "scope.questions.json"))
    if not ctx.has("scope.json"):
        draft = {"questionnaire": q["id"], "answered_by": "", "answered_at": "", **{x["id"]: x.get("default") for x in q["questions"]}}
        ctx.save("scope.json", draft)
        return result("blocked", "Draft scope.json written from the defaults. Show the questions to the user, record THEIR answers, set answered_by='user' and answered_at, then rerun with their words.", ["scope.json"])
    s = ctx.load("scope.json"); fnd = []
    fixture = bool(ctx.project.get("fixture"))
    if s.get("answered_by") != "user" and not (fixture and s.get("answered_by") == "fixture"):
        fnd.append(F("fail", "scope", "answered_by", "scope.json is not answered by the user"))
    if fixture: fnd.append(F("info", "scope", "fixture", "regression fixture: answers and approvals are the agent's test inputs, not user decisions"))
    if not s.get("answered_at"): fnd.append(F("fail", "scope", "answered_at", "answered_at missing"))
    for x in q["questions"]:
        v = s.get(x["id"])
        if x.get("required") and (v is None or v == [] or v == ""): fnd.append(F("fail", "scope", x["id"], "required answer missing"))
        if "options" in x and v is not None and x["id"] != "emit" and v not in x["options"]: fnd.append(F("fail", "scope", x["id"], f"{v!r} not in {x['options']}"))
    for f in s.get("sources", []):
        if not os.path.exists(ctx.p("inputs", f)): fnd.append(F("fail", "scope", f, "source file not found in inputs/"))
    if s.get("scale_owner") == "user" and s.get("source_kind") == "drawing" and not s.get("user_px_per_m"):
        fnd.append(F("warn", "scope", "user_px_per_m", "the user sets the scale but gave no px/m yet — S2 needs it (or switch scale_owner to agent)"))
    if not ctx.approved: fnd.append(F("fail", "scope", "approval", "rerun with --approved \"<the user's words, date>\" — their answers, not yours"))
    st = "failed" if any(f["level"] == "fail" for f in fnd) else "done"
    return result(st, f"scope: {s.get('source_kind')} · {s.get('levels')} · scale by {s.get('scale_owner')} · objects {s.get('objects')} · emit {s.get('emit')}",
                  ["scope.json"], fnd, [f"scope answered by the user: {ctx.approved}"] if st == "done" else [])
