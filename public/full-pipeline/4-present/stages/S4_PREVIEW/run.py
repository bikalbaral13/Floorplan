"""S4 — render each shot (preview preset) + keyframes, join into <CODE>_preview.mp4."""
import os
from core.stage import result, F, status_from

def run(ctx):
    s, doc, std, b = ctx.scope, ctx.load("shots.json"), ctx.standards(), ctx.load("build.json")
    preset = std["render_presets"][s.get("preview_preset", "low")]
    out_dir = os.path.dirname(ctx.out("preview", "x"))
    r = ctx.blender("render_shots.py", {"blend": ctx.p(b["out_blend"]), "out_dir": out_dir, "preset": preset, "shots": doc, "std": std})
    if not r.get("ok"): return result("failed", f"render: {r.get('error')}", findings=[F("fail", "blender", "render", r.get("tail") or str(r.get("trace", "")))])
    clips = [x["clip"] for x in r["shots"]]
    final = ctx.out(f"{ctx.code}_preview.mp4")
    a = ctx.blender("assemble.py", {"clips": clips, "out": final})
    fnd = []
    if not a.get("ok"): fnd.append(F("fail", "blender", "assemble", a.get("tail") or a.get("error", "")))
    missing = [c for c in clips if not os.path.exists(c)]
    if missing: fnd.append(F("fail", "render", "clips", f"missing {missing}"))
    m = std["ai_models"].get(s.get("ai_model"), {})
    px = preset["res"][0] * preset["res"][1]
    if s.get("ai_provider") == "krea" and px < m.get("min_ref_pixels", 0):
        fnd.append(F("warn", "reference", "size", f"{preset['res']} = {px} px < {m['min_ref_pixels']} px — {s['ai_model']} will refuse these as reference videos; use the 'low' preset or larger before S8"))
    pv = {"preset": s.get("preview_preset"), "res": preset["res"], "fps": r["fps"], "engine": r["engine"],
          "shots": [{"id": x["id"], "clip": ctx.wrel(x["clip"]), "render_s": x["seconds"],
                     "first": ctx.wrel(os.path.join(out_dir, "keyframes", f"{x['id']}_first.png")),
                     "last": ctx.wrel(os.path.join(out_dir, "keyframes", f"{x['id']}_last.png"))} for x in r["shots"]],
          "preview": ctx.wrel(final), "seconds": a.get("seconds"), "approved": ""}
    ctx.save("preview.json", pv)
    return result(status_from(fnd), f"{len(clips)} clips at {preset['res'][0]}x{preset['res'][1]} {r['fps']} fps ({sum(x['seconds'] for x in r['shots']):.0f} s render) → {ctx.wrel(final)}",
                  ["preview.json", ctx.wrel(final)], fnd)
