import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import paths
from core.units import parse_ft, fmt, SQFT_M2
from core.stage import F, result
from core.svg import Svg

def run(ctx):
    src = None
    if ctx.has("inputs", "site.json"):
        raw, src = ctx.load("inputs", "site.json"), "inputs/site.json"
    elif ctx.has("work", "site_trace.json"):
        raw, src = ctx.load("work", "site_trace.json"), "work/site_trace.json"
    else:
        files = [p.name for p in ctx.p("inputs").iterdir() if p.is_file() and p.name != ".keep"]
        return result("blocked", "No site data. Add inputs/site.json, or have the agent read " + (", ".join(files) or "a sketch in inputs/") +
                      " into work/site_trace.json (format: stages/P1_SITE/TRACE.md) and confirm it with the user.")
    fnd, dec = [], []
    road = str(raw.get("road_side", "")).upper()
    if road not in ("N", "E", "S", "W"): return result("failed", f"road_side {road!r} not N/E/S/W")
    LR = {"N": ("west", "east"), "E": ("north", "south"), "S": ("east", "west"), "W": ("south", "north")}[road]
    try:
        d = {k: parse_ft(raw[k + "_ft"]) for k in ("front", "rear")}
        if "left_ft" in raw and "right_ft" in raw:
            d["left"], d["right"] = parse_ft(raw["left_ft"]), parse_ft(raw["right_ft"])
        else:
            d["left"], d["right"] = parse_ft(raw[LR[0] + "_ft"]), parse_ft(raw[LR[1] + "_ft"])
    except (KeyError, ValueError) as e:
        return result("failed", f"{src}: need front_ft, rear_ft and the two side lengths ({LR[0]}_ft / {LR[1]}_ft, or left_ft / right_ft as drawn with the road at the top): {e}")
    d[LR[0]], d[LR[1]] = d["left"], d["right"]
    for k in ("front", "rear", "left", "right"):
        if d[k] <= 0: fnd.append(F("fail", "dims", k, f"{k} = {d[k]}"))
    width = min(d["front"], d["rear"])
    if abs(d["front"] - d["rear"]) > 0.5:
        fnd.append(F("warn", "shape", "front/rear", f"front {fmt(d['front'])} and rear {fmt(d['rear'])} differ; typologies plan on the narrower {fmt(width)}"))
    area = width * (d["left"] + d["right"]) / 2
    stated = raw.get("stated_area_sqft")
    if stated:
        diff = abs(area - stated) / stated * 100
        fnd.append(F("warn" if diff > 1 else "info", "area", "site", f"computed {area:.0f} sq ft vs stated {stated} ({diff:.1f}% apart)"))
    for a in raw.get("assumptions", []):
        dec.append(f"site: {a}")
    site = {"units": "ft", "source": src, "road_side": road, "width_ft": width, "front_ft": d["front"], "rear_ft": d["rear"],
            "left_ft": d["left"], "right_ft": d["right"], f"{LR[0]}_ft": d["left"], f"{LR[1]}_ft": d["right"],
            "depth_ft": min(d["left"], d["right"]), "area_sqft": round(area, 1),
            "area_m2": round(area * SQFT_M2, 2), "stated_area_sqft": stated, "assumptions": raw.get("assumptions", [])}
    outs = [ctx.save("site.json", site)]
    g = Svg(width, site["depth_ft"], scale=5, pad=50)
    g.rect(0, 0, width, site["depth_ft"], fill="#F4F6F8", sw=2)
    g.text(width / 2, -2, f"ROAD ({road})", 10, bold=True)
    g.text(width / 2, site["depth_ft"] / 2, f"{site['area_sqft']:.0f} sq ft", 11, bold=True)
    g.text(width / 2, site["depth_ft"] + 4, f"front {fmt(d['front'])}, rear {fmt(d['rear'])}, {LR[0]} (left) {fmt(d['left'])}, {LR[1]} (right) {fmt(d['right'])}", 9)
    outs.append(ctx.save_text("output/site.svg", g.render()))
    outs.append(ctx.save("work/inputs.sha.json", paths.inputs_snapshot(ctx.pdir)))
    st = "failed" if any(x["level"] == "fail" for x in fnd) else "done"
    return result(st, f"site {fmt(width)} x {fmt(site['depth_ft'])}, {site['area_sqft']:.0f} sq ft, road {road}", outs, fnd, dec)
