"""S7 — exports + a canvas round trip (canvas → plan model again must give the same counts and areas)."""
import os
from core import paths, units as U
from core.stage import result
from core.model import F
from exporters import canvas, drawing, plan_trace
from tools.import_canvas import convert

def run(ctx):
    plan = ctx.load("plan.json"); std = ctx.standards(); emit = ctx.scope.get("emit", ["canvas", "svg", "plan_trace"]); outs, fnd = [], []
    reading = ctx.load("reading.json", default={}); manifest = paths.load_json(ctx.w("manifest.json"), {})
    lay = ctx.load("layout.json", default={})
    if "canvas" in emit:
        und = None
        if ctx.branch == "drawing" and manifest.get("pages") and len(plan["levels"]) == 1:
            pg = manifest["pages"][0]; fr = (lay.get("levels") or [{}])[0].get("frame") or lay.get("frame") or {}
            ox, oy = fr.get("origin_px", [pg["size"][0] / 2, pg["size"][1] / 2])
            und = {"id": f"img-{ctx.code}", "src": ctx.project.get("underlay_src", os.path.basename(pg["file"])), "x": -ox, "y": -oy, "width": pg["size"][0], "height": pg["size"][1],
                   "opacity": 0.55, "scale": 1, "locked": True, "layerId": "image"}
        doc = canvas.export(plan, std, und); p = ctx.w("out", f"{ctx.code}.canvas.json"); paths.save_json(p, doc, compact=True); outs.append(ctx.wrel(p))
        back = convert(doc, std, ctx.branch)
        for L0, L1 in zip(plan["levels"], back["levels"]):
            a0 = sorted(round(s["area"], 3) for s in L0["spaces"]); a1 = sorted(round(s["area"], 3) for s in L1["spaces"])
            c0 = (len(L0["walls"]), len(L0["openings"]), len(L0["spaces"]), len(L0["fixtures"]) + len(L0["columns"]))
            c1 = (len(L1["walls"]), len(L1["openings"]), len(L1["spaces"]), len(L1["fixtures"]) + len(L1["columns"]))
            ok = c0 == c1 and all(abs(x - y) < 2e-3 for x, y in zip(a0, a1))
            fnd.append(F("info" if ok else "fail", "roundtrip", L0["id"], f"canvas round trip {'identical' if ok else 'DIFFERS'}: walls/openings/spaces/objects {c0} → {c1}"))
    if "svg" in emit:
        for L in plan["levels"]:
            p = ctx.w("out", f"{ctx.code}_{L['id']}.svg"); open(p, "w", encoding="utf-8").write(drawing.svg(L, f"{ctx.code} · {L['name']}")); outs.append(ctx.wrel(p))
    if "overlay" in emit and ctx.branch == "drawing" and manifest.get("pages"):
        for L, sh in zip(plan["levels"], reading.get("sheets", [])):
            pg = next((x for x in manifest["pages"] if x["id"] == sh.get("page")), manifest["pages"][0])
            fr = {"px_per_m": plan["scale"]["px_per_m"], "origin_px": sh["origin_px"]}
            p = ctx.w("out", f"{ctx.code}_{L['id']}_overlay.png"); drawing.overlay_png(L, ctx.p(pg["file"]), fr, p); outs.append(ctx.wrel(p))
    if "plan_trace" in emit:
        p = ctx.w("out", "plan_trace.json"); paths.save_json(p, plan_trace.export(plan)); outs.append(ctx.wrel(p))
    qc = paths.load_json(ctx.w("qc.json"), [])
    rep = [f"# {ctx.code} — trace report", "", f"Branch: **{ctx.branch}** · tracer {plan['source'].get('tracer_version')} · standards {plan['source'].get('standards')}"]
    if plan.get("scale"): rep.append(f"Scale: {plan['scale'].get('px_per_m')} px/m ({plan['scale'].get('method')}, max residual {plan['scale'].get('max_residual_ft')} ft over {plan['scale'].get('n_pairs')} pairs)")
    for L in plan["levels"]:
        rep += ["", f"## {L['name']}", "", "| room | clear | net area | printed |", "|---|---|---|---|"]
        for s in L["spaces"]:
            rep.append(f"| {s['name']} | {U.ftin(s['clear'][0]) + ' × ' + U.ftin(s['clear'][1]) if s.get('clear') else '—'} | {U.sqft(s['net_area']):.0f} sq ft | {U.ftin(s['printed'][0]) + ' × ' + U.ftin(s['printed'][1]) if s.get('printed') else ''} |")
        conv = [o.get("label") or o["id"] for o in L["openings"] if o.get("sill_src") == "convention"]
        if conv: rep.append(f"\nConventions used (not measured): window sills on {', '.join(conv)}.")
        if L.get("not_placed"): rep.append("\nNot placed: " + "; ".join(f"{x['kind']} ({x['why']})" for x in L["not_placed"]))
    rep += ["", "## Assumptions", ""] + [f"- {a}" for a in reading.get("assumptions", []) + reading.get("inferred", [])]
    rep += ["", f"QC: {sum(1 for f in qc if f['level']=='fail')} fail, {sum(1 for f in qc if f['level']=='warn')} warn (work/qc.md)."]
    p = ctx.w("out", "report.md"); open(p, "w", encoding="utf-8").write("\n".join(rep) + "\n"); outs.append(ctx.wrel(p))
    return result("failed" if any(f["level"] == "fail" for f in fnd) else "done", f"{len(outs)} files", outs, fnd)
