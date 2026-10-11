import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.stage import F, result, summarize, inputs_changed
from core import typology as typ, trace
from stages._common import confirmed, scopes, accepted_keys

def run(ctx):
    if not ctx.has("output", "plan_trace.json"): return result("blocked", "output/plan_trace.json missing — run P6")
    fnd = [F("fail", "inputs", p, "changed since P1 — rerun P1") for p in inputs_changed(ctx)]
    units = 0
    for c, parcel in scopes(ctx):
        tag = c.scope
        brief, e1 = confirmed(c, "brief.json"); rules, e2 = confirmed(c, "rules.json")
        if e1 or e2: return result("blocked", e1 or e2)
        sel = c.sload("selected.json"); T = c.typology()
        if sel["typology_version"] != T.version or sel.get("lineage", [T.ref]) != T.lineage:
            fnd.append(F("fail", "version", tag, f"selected with {sel.get('lineage')}, pin now resolves to {T.lineage} — rerun P4/P5 (tools/upgrade_typology.py)"))
            continue
        reg = typ.registry()
        latest = reg.get(T.lineage[-1].split("@")[0], {}).get("version")
        if latest and latest != T.lineage[-1].split("@")[1]:
            fnd.append(F("info", "version", tag, f"{T.lineage[-1]} pinned; {latest} is available (tools/upgrade_typology.py {ctx.code} --scope {tag})"))
        if "layers" not in sel:
            fnd.append(F("warn", "trace", tag, "selected.json has no layer manifest (made before 0.3.0) — rerun P5 to record it"))
        for layer, path, how in trace.changed(ctx.pdir, sel.get("layers")):
            fnd.append(F("fail", "stale", f"{tag}/{layer}", f"{path} {how} since P5 — rerun P4/P5 (or restore the file)"))
        res = T.call("generate", sel["params"])
        if abs(res["total"] - sel["result"]["total"]) > 0.01: fnd.append(F("fail", "regen", tag, "regenerating the selection gives a different result — rerun P5"))
        acc = accepted_keys(c.sload("work", "selection.json") if c.shas("work", "selection.json") else None)
        for x in T.call("qc", res, rules, brief):
            if x["level"] == "fail" and (x["check"], x["ref"]) in acc: x["level"] = "warn"; x["msg"] += f" (accepted: {acc[(x['check'], x['ref'])]})"
            x["ref"] = f"{tag}/{x['ref']}"; fnd.append(x)
        units += len(T.call("to_plan_trace", res, ctx.project)["rooms"])
    tr = ctx.load("output", "plan_trace.json")
    if len(tr.get("rooms", [])) != units: fnd.append(F("fail", "handoff", "plan_trace", f"{len(tr.get('rooms', []))} rooms in plan_trace vs {units} from the selections — rerun P6"))
    n = summarize(fnd)
    md = [f"# QC — {ctx.code}", "", f"{n['fail']} fail, {n['warn']} warn, {n['info']} info.", "", "| Level | Check | Ref | Finding |", "|---|---|---|---|"] + \
         [f"| {x['level']} | {x['check']} | {x['ref']} | {x['msg']} |" for x in fnd]
    outs = [ctx.save_text("output/qc.md", "\n".join(md) + "\n"), ctx.save("output/qc.json", fnd)]
    return result("failed" if n["fail"] else "done", f"QC: {n['fail']} fail, {n['warn']} warn", outs, fnd)
