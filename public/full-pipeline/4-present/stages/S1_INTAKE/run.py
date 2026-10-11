"""S1 — inventory the source .blend (read-only) and render a top-down plan for the shot list."""
from core import paths
from core.stage import result, F, status_from

def run(ctx):
    s = ctx.scope
    inv_p, png = ctx.w("intake", "inventory.json"), ctx.w("intake", "topdown.png")
    r = ctx.blender("inspect_scene.py", {"blend": s["blend_path"], "topdown_png": png, "inventory_json": inv_p})
    if not r.get("ok"): return result("failed", f"inspect_scene: {r.get('error')}", findings=[F("fail", "blender", "inspect", r.get("tail") or str(r.get("trace", "")))])
    inv = paths.load_json(inv_p); fnd = []
    if inv["units"] != "METRIC" or abs(inv["scale_length"] - 1) > 1e-6: fnd.append(F("warn", "units", "scene", f"units {inv['units']} scale {inv['scale_length']} — shot coordinates assume metres"))
    if s["coverage"] in ("interior", "both") and not inv["interior_hints"]:
        fnd.append(F("warn", "coverage", "interior", "scope asks for interiors but no interior-looking objects were found — interior shots may show empty shells"))
    if s["coverage"] == "exterior" and inv["interior_hints"]: fnd.append(F("info", "coverage", "interior", f"{len(inv['interior_hints'])} interior-looking objects present (exterior film)"))
    if not inv["lamp_like"]: fnd.append(F("info", "lamps", "none", "no lamp-like objects — night shots will rely on the moon and glowing windows"))
    summary = {k: inv[k] for k in ("bbox", "counts", "cameras", "units", "scale_length")}
    summary.update({"collections": [c for c in inv["collections"] if not c["excluded"]], "lamp_like": len(inv["lamp_like"]),
                    "interior_hints": inv["interior_hints"][:20], "materials": len(inv["materials"]),
                    "topdown": inv["topdown"], "inventory": ctx.wrel(inv_p)})
    ctx.save("intake.json", summary)
    b = inv["bbox"]
    return result(status_from(fnd), f"{sum(inv['counts'].values())} objects, site {b[1][0]-b[0][0]:.0f} x {b[1][1]-b[0][1]:.0f} m, {len(inv['lamp_like'])} lamp-like; plan {ctx.wrel(png)}",
                  ["intake.json", ctx.wrel(inv_p), ctx.wrel(png)], fnd)
