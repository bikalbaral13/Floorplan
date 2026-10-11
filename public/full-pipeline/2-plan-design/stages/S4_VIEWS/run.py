import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from core import geometry as G, views as V

def run(ctx):
    sc = ctx.scope(); canvas = json.load(open(ctx.p("inputs", "plan.canvas.json"), encoding="utf-8"))
    geo = G.build(canvas, sc["spaces"], ctx.project.get("level")); ctx.sw("geo.json", geo)
    sheets = V.build(geo, sc["levels"], ctx.w("views")); ctx.sw("views.json", sheets); fs = []
    walls = {w["id"]: w for w in geo["walls"]}
    for r in geo["runs"]:
        for wid in r["walls"]:
            w = walls[wid]; fr = r["frame"]
            for p in (w["a"], w["b"]):
                t = (p[0] - fr["origin"][0]) * fr["right"][0] + (p[1] - fr["origin"][1]) * fr["right"][1]
                if t < -0.02 or t > r["length"] + 0.02: fs.append(F("fail", "elevation", r["letter"], f"{wid} projects outside its run ({t:.2f} m)"))
    el = [s for s in sheets if s["kind"] == "elevation"]
    if len(el) != len(geo["runs"]): fs.append(F("fail", "elevation", "count", f"{len(el)} sheets for {len(geo['runs'])} runs"))
    if len({round(s["xf"]["s"], 6) for s in el}) > 1: fs.append(F("fail", "elevation", "scale", "elevations at different scales"))
    for r in geo["runs"]: fs.append(F("info", "run", r["letter"], f"{r['looks']}, {r['length']:.2f} m, {len(r['walls'])} piece(s), faces {', '.join(r['spaces'])}"))
    return result(status_from(fs), f"plan + RCP + {len(el)} elevations ({', '.join(r['letter'] + ' ' + r['looks'] for r in geo['runs'])})",
                  ["geo.json", "views/", "views.json"], fs)
