"""S4 — validate layout.json: parses, grid references resolve, builds without structural failures."""
from core import paths, build
from core.stage import result
from core.model import F, LAYOUT_SCHEMA

def run(ctx):
    if not ctx.has("layout.json"): return result("blocked", "layout.json missing — author it per stages/S4_LAYOUT/prompt.md")
    lay = ctx.load("layout.json"); fnd = []
    if lay.get("schema") != LAYOUT_SCHEMA: fnd.append(F("fail", "layout", "schema", f"schema must be {LAYOUT_SCHEMA}"))
    g = paths.load_json(ctx.w("dims.resolved.json"), {}).get("grid", {})
    lay.setdefault("grid", {"x": {}, "y": {}})
    for ax in ("x", "y"): lay["grid"].setdefault(ax, {}); lay["grid"][ax] = {**g.get(ax, {}), **lay["grid"][ax]}
    try:
        plan, bf = build.build(lay, ctx.standards(), {"kind": ctx.branch})
    except (KeyError, ValueError) as e:
        return result("failed", f"layout does not build: {e}", ["layout.json"], [F("fail", "layout", "build", str(e))])
    fnd += bf
    cal = paths.load_json(ctx.w("calib.json"), {}); fr = (lay.get("levels") or [{}])[0].get("frame") or lay.get("frame") or {}
    if ctx.branch == "drawing" and cal.get("px_per_m") and fr.get("type") == "image":
        d = abs(fr["px_per_m"] - cal["px_per_m"]) / cal["px_per_m"] * 100
        if d > 0.3: fnd.append(F("warn" if d < 1.5 else "fail", "scale", "frame", f"layout frame {fr['px_per_m']} px/m vs calibrated {cal['px_per_m']} px/m ({d:.2f} %) — author the layout in the calibrated frame, or say why not"))
    L = plan["levels"]
    msg = " · ".join(f"{l['name']}: {len(l['walls'])} walls, {len(l['openings'])} openings, {len(l['spaces'])} spaces, {len(l['fixtures'])} fixtures" for l in L)
    st = "failed" if any(f["level"] == "fail" for f in fnd) else "done"
    return result(st, msg, ["layout.json"], fnd)
