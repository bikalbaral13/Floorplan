import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
from core.units import fmt, SQFT_M2
from core.stage import F, result
from stages._common import confirmed

def run(ctx):
    if not ctx.shas("selected.json"): return result("blocked", "selected.json missing — run P5")
    brief, e1 = confirmed(ctx, "brief.json"); rules, e2 = confirmed(ctx, "rules.json")
    if e1 or e2: return result("blocked", e1 or e2)
    res = ctx.sload("selected.json")["result"]; A = res["areas"]; plot = res["site"]["area_sqft"]; fnd = []
    ex = set(rules.get("far_excludes", ["porch", "void", "balcony"]))
    far_area = res["total"] - (A["porch"] if "porch" in ex else 0) + (0 if "balcony" in ex else A["balcony"])
    far = far_area / plot
    lines = ["level,code,name,kind,size,area_sqft,area_m2,in_far"]
    for lv in ("GF", "FF"):
        for rm in res["rooms"][lv]:
            infar = rm["kind"] not in ex
            lines.append(f"{lv},{lv}-{rm['code']},\"{rm['name']}\",{rm['kind']},\"{fmt(rm['w'])} x {fmt(rm['h'])}\",{rm['area_sqft']:.1f},{rm['area_sqft']*SQFT_M2:.2f},{'yes' if infar else 'no'}")
    lines += [f"GF,,FLOOR GROSS (footprint),,,{A['gf']:.1f},{A['gf']*SQFT_M2:.2f},", f"FF,,FLOOR GROSS (footprint less void),,,{A['ff']:.1f},{A['ff']*SQFT_M2:.2f},",
              f",,TOTAL BUILT-UP,,,{res['total']:.1f},{res['total']*SQFT_M2:.2f},", f",,FAR AREA (excl. {' '.join(sorted(ex))}),,,{far_area:.1f},{far_area*SQFT_M2:.2f},",
              f",,PLOT,,,{plot:.1f},{plot*SQFT_M2:.2f},", f",,FAR,,,{far:.3f},,", f",,GROUND COVERAGE %,,,{A['footprint']/plot*100:.2f},,"]
    outs = [ctx.ssave_text("output/area_statement_levels.csv", "\n".join(lines) + "\n")]
    if rules.get("far_max") is not None: fnd.append(F("fail" if far > rules["far_max"] + 1e-9 else "info", "far", "site", f"FAR {far:.2f} (max {rules['far_max']})"))
    cov = A["footprint"] / plot * 100
    if rules.get("coverage_max_pct") is not None: fnd.append(F("fail" if cov > rules["coverage_max_pct"] + 1e-9 else "info", "coverage", "site", f"coverage {cov:.1f}% (max {rules['coverage_max_pct']}%)"))
    md = [f"# Vastu — option {res['option']} ({res['facing']} facing{', mirrored' if res['mirror'] else ''})", "",
          f"Score {res['vastu_score']:+d} (good +2, acceptable +1, neutral 0, avoid -2). Zones are taken from each room's centre relative to the footprint centre.", "",
          "| Item | Room | Zone | Verdict |", "|---|---|---|---|"] + [f"| {v['item']} | {v['ref']} | {v['zone']} | {v['verdict']} |" for v in res["vastu"]]
    md += ["", "Traditional preferences used: kitchen SE (NW acceptable), master bedroom SW, puja NE, living N / E / NE, staircase S / W / SW, toilets NW / W, entrance N / E / NE.",
           "Vastu is advisory here: the client decides; it never overrides rules or room minimums.", ""]
    outs.append(ctx.ssave_text("output/VASTU.md", "\n".join(md)))
    if brief.get("vastu"):
        for v in res["vastu"]:
            if v["verdict"] == "avoid": fnd.append(F("warn", "vastu", v["ref"], f"{v['item']} in {v['zone']}"))
    st = "failed" if any(x["level"] == "fail" for x in fnd) else "done"
    return result(st, f"areas: GF {A['gf']:.0f} + FF {A['ff']:.0f} sq ft, FAR {far:.2f}, coverage {cov:.1f}%; vastu {res['vastu_score']:+d}", outs, fnd)
