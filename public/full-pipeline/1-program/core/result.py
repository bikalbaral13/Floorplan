"""Generic view of a typology result, used by shared stages.

A generator may return (0.3+ contract):
  schedule       [{code, name, level, kind, face, size, area_sqft}]   one row per unit / room
  headline       one line for the options table
  summary_lines  markdown bullet lines for PROGRAM.md
  far            floor area ratio (optional), total = built-up used for the statement, coverage_pct
Older results (TOWNHOME_RENTAL 0.1.0 / 0.2.0) only have `units`; they are mapped here.
"""
from .units import fmt

def schedule(res):
    if "schedule" in res: return res["schedule"]
    return [{"code": f"U{u['n']}", "name": f"Unit {u['n']}", "level": "GF", "kind": "unit", "face": u["face"],
             "size": f"{fmt(u['w'])} x {fmt(u['h'])}", "area_sqft": u["a"]} for u in res.get("units", [])]

def headline(res):
    if "headline" in res: return res["headline"]
    s = schedule(res)
    return f"{len(s)} units {''.join(r['face'][0] for r in s)}: " + " / ".join(f"{r['area_sqft']:.0f}" for r in s)

def summary_lines(res):
    if "summary_lines" in res: return res["summary_lines"]
    st = res.get("stair"); p = res["params"]
    return [f"- Setbacks front {fmt(res['F'])}, rear {fmt(res['R'])}, west {fmt(res['W'])}, east {fmt(res['E'])}; court {fmt(res['G'])}.",
            f"- Built-up {res['total']:.0f} sq ft, coverage {res['coverage_pct']:.1f}%.",
            (f"- Staircase {fmt(st['SL'])} x {fmt(st['SW'])}, {st['risers']} risers of {st['rAct']:.2f}\", up towards "
             f"{st.get('direction', p.get('stair_first_flight'))}, turns {st.get('turn', p.get('stair_turn'))}." if st else "- No staircase.")]
