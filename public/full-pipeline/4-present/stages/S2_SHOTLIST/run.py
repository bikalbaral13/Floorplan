"""S2 — validate the shot list the agent wrote (see prompt.md)."""
from core import paths, shots as SH
from core.stage import result, F, status_from

def run(ctx):
    if not ctx.has("shots.json"):
        return result("blocked", "Write shots.json (walkthrough-shots/1) following stages/S2_SHOTLIST/prompt.md, then rerun this task.")
    doc = ctx.load("shots.json"); intake = ctx.load("intake.json", default={})
    inv = paths.load_json(ctx.p(intake["inventory"]), {}) if intake.get("inventory") else {}
    fnd = SH.check_shots(doc, ctx.standards(), inv)
    total = sum(s["duration"] for s in doc.get("shots", []))
    tgt = ctx.scope.get("target_seconds") or 0
    if tgt and total > tgt * 1.25: fnd.append(F("warn", "timing", "total", f"{total:g} s is well over the target {tgt} s"))
    return result(status_from(fnd), f"{len(doc.get('shots', []))} shots, {total:g} s", ["shots.json"], fnd)
