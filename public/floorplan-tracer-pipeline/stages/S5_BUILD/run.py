"""S5 — layout.json → plan.json (tracer-plan/1)."""
import core
from core import paths, build
from core.stage import result

def run(ctx):
    lay = ctx.load("layout.json")
    g = paths.load_json(ctx.w("dims.resolved.json"), {}).get("grid", {})
    lay.setdefault("grid", {"x": {}, "y": {}})
    for ax in ("x", "y"): lay["grid"][ax] = {**g.get(ax, {}), **lay["grid"].get(ax, {})}
    src = {"kind": ctx.branch, "files": ctx.scope.get("sources", []), "tracer_version": core.__version__, "standards": ctx.project.get("standards", "DEFAULT"), "project": ctx.code}
    plan, fnd = build.build(lay, ctx.standards(), src)
    cal = paths.load_json(ctx.w("calib.json"), {})
    fr = (lay.get("levels") or [{}])[0].get("frame") or lay.get("frame") or {}
    if ctx.branch == "drawing" and fr.get("type") == "image":
        # the frame the geometry was authored in is the truth (canvas + underlay must agree with it)
        plan["scale"] = {"px_per_m": fr["px_per_m"], "method": cal.get("method", "frame"), "calibrated_px_per_m": cal.get("px_per_m"),
                         "max_residual_ft": cal.get("max_residual_ft"), "n_pairs": cal.get("n_pairs")}
    ctx.save("plan.json", plan)
    n = sum(len(L["walls"]) for L in plan["levels"]); s = sum(len(L["spaces"]) for L in plan["levels"])
    return result("failed" if any(f["level"] == "fail" for f in fnd) else "done", f"plan.json: {len(plan['levels'])} level(s), {n} wall pieces, {s} spaces", ["plan.json"], fnd)
