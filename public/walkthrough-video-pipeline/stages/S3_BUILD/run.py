"""S3 — shots.json → <CODE>_walkthrough.blend (source .blend untouched)."""
from core.stage import result, F, status_from
from core import shots as SH

def run(ctx):
    s, doc, std = ctx.scope, ctx.load("shots.json"), ctx.standards()
    out = ctx.out(f"{ctx.code}_walkthrough.blend")
    r = ctx.blender("build_walkthrough.py", {"blend": s["blend_path"], "out_blend": out, "shots": doc, "std": std,
                                              "materials": s.get("materials", "keep"), "lamps": doc.get("lamps")})
    if not r.get("ok"): return result("failed", f"build: {r.get('error')}", findings=[F("fail", "blender", "build", r.get("tail") or str(r.get("trace", "")))])
    fnd = []
    if len(r["shots"]) != len(doc["shots"]): fnd.append(F("fail", "build", "cameras", f"{len(r['shots'])} cameras for {len(doc['shots'])} shots"))
    end = SH.frames(doc["shots"][-1], doc.get("fps", std["fps"]))[1]
    if r["frame_end"] != end: fnd.append(F("fail", "build", "frames", f"frame_end {r['frame_end']} != {end}"))
    ctx.save("build.json", {**r, "out_blend": ctx.wrel(out)})
    return result(status_from(fnd), f"{len(r['shots'])} cameras, {r['lamps']} lamps, props {r['props']}, frames 1–{r['frame_end']} → {ctx.wrel(out)}",
                  ["build.json", ctx.wrel(out)], fnd)
