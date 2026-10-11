import sys, math
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.units import fmt, SQFT_M2, FT_MM
from core import result as R
from core.stage import F, result
from stages._common import scopes

def poly_area(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2

def on_outline(pt, poly, tol=2):
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]; ab = (b[0] - a[0], b[1] - a[1]); L2 = ab[0] ** 2 + ab[1] ** 2
        t = max(0, min(1, ((pt[0] - a[0]) * ab[0] + (pt[1] - a[1]) * ab[1]) / L2)) if L2 else 0
        if math.dist(pt, (a[0] + t * ab[0], a[1] + t * ab[1])) <= tol: return True
    return False

def run(ctx):
    sc = scopes(ctx); fnd = []; merged = {"source": "", "units": "mm", "rooms": [], "doors": [], "windows": [], "fixtures": [], "program": [], "assumptions": []}
    site_D = ctx.load("site.json")["depth_ft"] if ctx.has("site.json") else None
    lines = ["scope,code,name,level,kind,facing,size,gross_sqft,gross_m2,trace_internal_m2"]; total = 0; md_units = []; srcs = []
    for c, parcel in sc:
        if not c.shas("selected.json"): return result("blocked", f"{c.rel(c.s('selected.json'))} missing — finish P5 for {c.scope}")
        sel = c.sload("selected.json"); T = c.typology(); res = sel["result"]
        tr = T.call("to_plan_trace", res, ctx.project)
        pre = "" if parcel is None else parcel["code"] + "-"
        dy = 0 if parcel is None else round((site_D - parcel["y_offset_ft"] - parcel["depth_ft"]) * FT_MM)
        trace_area = {}
        for r in tr["rooms"]:
            for k in [k for k, v in r.items() if v is None]: del r[k]      # plan_trace.v1: absent, never null (e.g. no ceiling over a porch)
            trace_area[r["code"]] = poly_area(r["polygon"]) / 1e6
            r["code"] = pre + r["code"]; r["polygon"] = [[x, y + dy] for x, y in r["polygon"]]
        for u in R.schedule(res):
            prog = u["area_sqft"] * SQFT_M2; a = trace_area.get(u["code"])
            if a is not None and prog > 0 and abs(a - prog) / prog > 0.15: fnd.append(F("warn", "room", pre + u["code"], f"trace {a:.1f} m² vs program {prog:.1f} m²"))
            lines.append(f"{c.scope},{pre + u['code']},\"{u['name']}\",{u.get('level', '')},{u.get('kind', '')},{u.get('face', '')},\"{u['size']}\",{u['area_sqft']:.1f},{prog:.2f},{'' if a is None else f'{a:.2f}'}")
            md_units.append(f"| {pre + u['code']} | {u['name']} | {u.get('level', '')} | {u['size']} | {u['area_sqft']:.0f} |")
        for d in tr["doors"]:
            d["id"] = pre + d["id"]; d["rooms"] = [pre + x for x in d["rooms"]]; d["swing_room"] = pre + d["swing_room"]
            d["hinge"][1] += dy; d["latch"][1] += dy
        merged["rooms"] += tr["rooms"]; merged["doors"] += tr["doors"]
        merged["program"].append(dict(tr["program"], scope=c.scope, y_shift_mm=dy)); merged["assumptions"] += [f"{c.scope}: {a}" for a in tr["assumptions"]]
        srcs.append(f"{c.scope}={tr['source']}"); total += res["total"]
    merged["source"] = "; ".join(srcs)
    byc = {r["code"]: r for r in merged["rooms"]}
    for d in merged["doors"]:
        poly = byc[d["swing_room"]]["polygon"]
        if not (on_outline(d["hinge"], poly) and on_outline(d["latch"], poly)): fnd.append(F("fail", "door", d["id"], "not on its room outline"))
    if not ctx.project.get("parcels"): merged["program"] = merged["program"][0]
    outs = [ctx.save("output/plan_trace.json", merged)]
    site = ctx.load("site.json")
    lines += [f"TOTAL_BUILT_UP,,,,,,,{total:.1f},{total*SQFT_M2:.2f},", f"PLOT,,,,,,\"{fmt(site['width_ft'])} x {fmt(site['depth_ft'])}\",{site['area_sqft']:.1f},{site['area_sqft']*SQFT_M2:.2f},"]
    outs.append(ctx.save_text("output/area_statement.csv", "\n".join(lines) + "\n"))
    md = [f"# {ctx.project.get('title', ctx.code)} — program", ""]
    for c, parcel in sc:
        sel = c.sload("selected.json"); res = sel["result"]
        md += [f"## {c.scope}: {' -> '.join(sel.get('lineage', [sel['typology']]))}, option {res['option']} ({res['option_title']})", "", R.headline(res), ""] + R.summary_lines(res) + [""]
    md += [f"Total built-up {total:.0f} sq ft on a {site['area_sqft']:.0f} sq ft plot.", "", "| Code | Name | Level | Size | Area (sq ft) |", "|---|---|---|---|---|"] + md_units
    md += ["", "Hand-off: `output/plan_trace.json` → design_pipeline (tools/handoff_to_design.py). Unit shells only.", ""]
    outs.append(ctx.save_text("output/PROGRAM.md", "\n".join(md)))
    return result("failed" if any(x["level"] == "fail" for x in fnd) else "done", f"hand-off written: {len(merged['rooms'])} unit shells from {len(sc)} scope(s)", outs, fnd)
