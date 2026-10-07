"""S6 — every check on plan.json. A fail blocks unless accepted.json lists it with the USER's reason:
[{"check": "printed", "ref": "TOILET-1", "reason": "printed 8'x5' does not fit the drawn faces at any scale"}]."""
from core import paths, units as U
from core.stage import result
from core.model import summarize
from checks import plan_checks

def run(ctx):
    plan = ctx.load("plan.json"); reading = ctx.load("reading.json", default={})
    fnd = plan_checks.run(plan, ctx.standards(), {"reading": reading})
    acc = {(a["check"], a["ref"]): a["reason"] for a in ctx.load("accepted.json", default=[])}
    for f in fnd:
        if f["level"] == "fail" and (f["check"], f["ref"]) in acc: f["level"] = "warn"; f["msg"] += f"  (accepted: {acc[(f['check'], f['ref'])]})"
    n = summarize(fnd)
    md = [f"# QC — {ctx.code}", "", f"{n['fail']} fail · {n['warn']} warn · {n['info']} info", "", "| level | check | ref | finding |", "|---|---|---|---|"]
    md += [f"| {f['level']} | {f['check']} | {f['ref']} | {f['msg']} |" for f in sorted(fnd, key=lambda f: ["fail", "warn", "info"].index(f["level"]))]
    md += ["", "## Schedule", "", "| room | clear | net area |", "|---|---|---|"]
    for L in plan["levels"]:
        for s in L["spaces"]:
            md.append(f"| {L['name']} · {s['name']} | {U.ftin(s['clear'][0]) + ' × ' + U.ftin(s['clear'][1]) if s.get('clear') else '—'} | {s['net_area']:.2f} m² ({U.sqft(s['net_area']):.0f} sq ft) |")
    open(ctx.w("qc.md"), "w", encoding="utf-8").write("\n".join(md) + "\n"); paths.save_json(ctx.w("qc.json"), fnd)
    return result("failed" if n["fail"] else "done", f"QC: {n['fail']} fail, {n['warn']} warn", [ctx.wrel(ctx.w("qc.md"))], fnd)
