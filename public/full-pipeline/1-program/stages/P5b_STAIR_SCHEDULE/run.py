import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.stage import F, result
from stages._common import confirmed

def run(ctx):
    if not ctx.shas("selected.json"): return result("blocked", "selected.json missing — run P5")
    brief, e1 = confirmed(ctx, "brief.json"); rules, e2 = confirmed(ctx, "rules.json")
    if e1 or e2: return result("blocked", e1 or e2)
    T = ctx.typology(); res = ctx.sload("selected.json")["result"]; st = res.get("stair")
    if "stair" not in T.objects: return result("failed", f"{T.ref} has no 'stair' object slot")
    needed = len(T.schema.get("levels", ["GF"])) > 1 or brief.get("future_floors", False)
    if not st:
        return result("failed" if needed else "done", "a staircase is needed but the selection has none" if needed else "no staircase (single level, no future floors)")
    so = T.objects["stair"]; fnd = so.mod.qc(st, rules, F)
    rows = ["item,value"] + [f"\"{k}\",\"{v}\"" for k, v in so.mod.schedule(st)] + [f"\"Object\",\"{so.id}@{so.version}\"", f"\"Typology\",\"{T.ref}\""]
    out = ctx.ssave_text("output/stair_schedule.csv", "\n".join(rows) + "\n")
    return result("failed" if any(x["level"] == "fail" for x in fnd) else "done", f"stair schedule: {st['risers']} risers of {st['rAct']:.2f}\", {so.id}@{so.version}", [out], fnd)
