import sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import paths, tasks, plan, typology as typ
from core.units import parse_ft, fmt
from core.stage import F, result
from core.svg import Svg

def run(ctx):
    if not ctx.has("site.json"): return result("blocked", "site.json missing — run P1")
    if not ctx.has("work", "parcels.json"): return result("blocked", "work/parcels.json missing — agree parcels and their typologies with the user (format: stages/P1b_PARCELS/stage.json)")
    site, spec = ctx.load("site.json"), ctx.load("work", "parcels.json")
    if spec.get("split", "depth") != "depth": return result("failed", "only split = depth is supported in 0.2.0")
    ps = spec["parcels"]; fnd = []
    codes = [p["code"] for p in ps]
    if len(set(codes)) != len(codes) or not all(re.fullmatch(r"[A-Z][A-Z0-9]{0,5}", c) for c in codes): return result("failed", f"parcel codes must be unique upper-case: {codes}")
    D = site["depth_ft"]; given = [parse_ft(p["depth_ft"]) for p in ps[:-1]]
    last = parse_ft(ps[-1]["depth_ft"]) if "depth_ft" in ps[-1] else D - sum(given)
    depths = given + [last]
    if any(d <= 0 for d in depths) or abs(sum(depths) - D) > 0.01: return result("failed", f"parcel depths {depths} must be > 0 and sum to {D}")
    rows = tasks.load(ctx.pdir); have = {r["task_id"] for r in rows}; outs, y = [], 0.0; lasts = []
    for p, d in zip(ps, depths):
        pin = {"typology": "", "typology_version": "", "variant": p.get("variant", "")}
        if not pin["variant"]:
            pin["typology"], pin["typology_version"] = (typ.split_ref(p["typology"])[0], typ.split_ref(p["typology"])[1] or typ.load(p["typology"]).version)
        T = typ.for_pin(ctx.pdir, pin)
        west_d = d if p is not ps[-1] else site["west_ft"] - sum(given); east_d = d if p is not ps[-1] else site["east_ft"] - sum(given)
        psite = dict(site, source=f"P1b split of site.json ({y:g}-{y+d:g} ft from the road)", west_ft=west_d, east_ft=east_d, depth_ft=min(west_d, east_d),
                     area_sqft=round(site["width_ft"] * (west_d + east_d) / 2, 1), frontage="road" if y == 0 else "internal")
        base = f"parcels/{p['code']}"
        outs += [ctx.save(f"{base}/site.json", psite), ctx.save(f"{base}/parcel.json", dict(pin, code=p["code"], y_offset_ft=y, depth_ft=d, resolved=T.ref, lineage=T.lineage))]
        if psite["frontage"] == "internal": fnd.append(F("warn", "access", p["code"], f"{p['code']} has no road frontage; its 'road' edge is the boundary with the parcel to the north — confirm access with the user"))
        new = plan.rows(plan.parcel_plan(T), p["code"], first_dep="P1b-PARCELS", existing=have, T=T)
        rows += new; have |= {r["task_id"] for r in new}
        lasts.append(plan.task_id(plan.parcel_plan(T)[-1], p["code"]))
        y += d
    tail = plan.rows(["P6_HANDOFF", "P7_QC"], "PROJECT", first_dep=";".join(lasts), existing=have)
    rows += tail; tasks.save(ctx.pdir, rows)
    g = Svg(site["width_ft"], D, scale=4, pad=40); y = 0
    for p, d in zip(ps, depths):
        g.rect(0, y, site["width_ft"], d, fill="#EAF4F8" if y == 0 else "#F4F6F8", sw=1.2); g.text(site["width_ft"] / 2, y + d / 2, f"{p['code']} {fmt(d)}", 11, bold=True); y += d
    outs.append(ctx.save_text("output/parcels.svg", g.render()))
    return result("done", f"{len(ps)} parcels: " + ", ".join(f"{p['code']} {fmt(d)}" for p, d in zip(ps, depths)), outs + ["TASKS.csv"], fnd)
