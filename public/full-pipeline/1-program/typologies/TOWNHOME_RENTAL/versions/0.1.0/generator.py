"""TOWNHOME_RENTAL generator — Python twin of compute() in planner/town_home_rental_planner.html.
Keep the two in step: tools/selftest.py compares this file with tests/fixtures/townhome_parity.json,
which was exported from the planner. Any change here needs the same change in the planner (and a
new parity export), plus a typology version bump.
"""
import math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
from core.units import fmt as f, FT_MM, SQFT_M2
from core.svg import Svg
from core.stage import F

HERE = Path(__file__).resolve().parent
import json
SCHEMA = json.loads((HERE / "typology.json").read_text(encoding="utf-8"))
VERSION = SCHEMA["version"]

def generate(p):
    W, E, Fr, R = p["setback_west_ft"], p["setback_east_ft"], p["setback_front_ft"], p["setback_rear_ft"]
    G, PS, SH = p["court_ft"], p["passage_ft"], p["front_share_pct"] / 100
    FH, RS, TD, FW = p["floor_height_ft"], p["max_riser_in"], p["tread_in"], p["flight_width_ft"]
    risers = math.ceil(FH * 12 / RS - 1e-9); r_act = FH * 12 / risers; per_f = math.ceil(risers / 2)
    treads = per_f - 1; run = treads * TD / 12; SL = run + FW; SW = 2 * FW + 1 / 3
    PW, west, east = p["plot_width_ft"], p["plot_west_ft"], p["plot_east_ft"]
    D = min(west, east); area = PW * (west + east) / 2
    bw, bd, x0, opt = PW - W - E, D - Fr - R, W, p["option"]
    d1 = (bd - G) * SH; d2 = (bd - G) - d1; cy = Fr + d1; ry = cy + G; half = bw / 2; cw = (bw - PS) / 2
    zones, units = [], []
    uses_east = opt in "CDEFGHIJ"
    lane = "E" if uses_east else ("E" if E >= W else "W")
    zones.append(dict(x=0, y=0, w=PW, h=Fr, k="access", lab="FRONT SETBACK " + f(Fr)))
    zones.append(dict(x=0, y=D - R, w=PW, h=R, k="open", lab="REAR SETBACK " + f(R)))
    if W > 0: zones.append(dict(x=0, y=Fr, w=W, h=bd, k="access" if lane == "W" else "open", lab=("LANE " if lane == "W" else "SETBACK ") + f(W), v=1))
    if E > 0: zones.append(dict(x=PW - E, y=Fr, w=E, h=bd, k="access" if lane == "E" else "open", lab=("LANE " if lane == "E" else "SETBACK ") + f(E), v=1))
    if G > 0: zones.append(dict(x=x0, y=cy, w=bw, h=G, k="court", lab="OPEN COURT " + f(G)))
    def U(x, y, w, h, d): units.append(dict(n=len(units) + 1, x=x, y=y, w=w, h=h, d=d))
    def pas(y, h): zones.append(dict(x=x0 + cw, y=y, w=PS, h=h, k="access", lab="PASSAGE " + f(PS), v=1))
    def front_pair(d): U(x0, Fr, half, d1, d[0]); U(x0 + half, Fr, half, d1, d[1])
    def rear_pair(d): U(x0, ry, half, d2, d[0]); U(x0 + half, ry, half, d2, d[1])
    def front_stack(d): U(x0, Fr, bw, d1 / 2, d[0]); U(x0, Fr + d1 / 2, bw, d1 / 2, d[1])
    def rear_stack(d): U(x0, ry, bw, d2 / 2, d[0]); U(x0, ry + d2 / 2, bw, d2 / 2, d[1])
    def rear_twins(): pas(ry, d2); U(x0, ry, cw, d2, "E"); U(x0 + cw + PS, ry, cw, d2, "E")
    if opt == "A": front_pair("NN"); rear_pair("NN")
    elif opt == "B":
        fw = (bw - PS) / 2; pas(Fr, d1); U(x0, Fr, fw, d1, "N"); U(x0 + fw + PS, Fr, fw, d1, "N"); rear_pair("NN")
    elif opt == "C": front_stack("EE"); rear_stack("EE")
    elif opt == "D": front_stack("NE"); rear_stack("EE")
    elif opt == "E": front_pair("NN"); rear_stack("EE")
    elif opt == "F": front_stack("EE"); rear_pair("NN")
    elif opt == "G": pas(Fr, d1); U(x0, Fr, cw, d1, "E"); U(x0 + cw + PS, Fr, cw, d1, "E"); rear_twins()
    elif opt == "H": front_pair("NN"); rear_twins()
    elif opt == "I": front_stack("EE"); rear_twins()
    elif opt == "J": front_pair("NE"); rear_pair("NN")
    else: raise ValueError(f"unknown option {opt!r}")
    for u in units:
        u["face"] = "North" if u["d"] == "N" else "East"
        u["a"] = u["w"] * u["h"]
        u["dp"] = p[f"door{u['n']}_pct"] / 100
        u["door"] = door_geom(u)
    # stair
    DV = {"E": (1, 0), "W": (-1, 0), "N": (0, -1), "S": (0, 1)}[p["stair_first_flight"]]
    LN = (DV[1], -DV[0]); SV = LN if p["stair_turn"] == "L" else (-LN[0], -LN[1])
    along = DV[0] != 0; wX = SL if along else SW; hY = SW if along else SL
    pos = p["stair_position"]
    sx = x0 if pos == "W" else (x0 + bw - wX if pos == "E" else x0 + (bw - wX) / 2)
    stair = None
    if G > 0:
        pt0 = lambda u, v: (DV[0] * u + SV[0] * v, DV[1] * u + SV[1] * v)
        cs = [pt0(0, 0), pt0(SL, 0), pt0(0, SW), pt0(SL, SW)]
        ox, oy = sx - min(c[0] for c in cs), cy - min(c[1] for c in cs)
        stair = dict(x=sx, y=cy, w=wX, h=hY, o=[ox, oy], d=list(DV), sv=list(SV), run=run, FW=FW, TD=TD / 12, treads=treads,
                     risers=risers, rAct=r_act, perF=per_f, SL=SL, SW=SW)
        e = (ox + DV[0] * -2.5 + SV[0] * FW / 2, oy + DV[1] * -2.5 + SV[1] * FW / 2)
        stair["entryOK"] = any(z["k"] in ("court", "access") and z["x"] + 0.05 < e[0] < z["x"] + z["w"] - 0.05 and z["y"] + 0.05 < e[1] < z["y"] + z["h"] - 0.05 for z in zones)
    total = sum(u["a"] for u in units)
    w = []; lane_w = W if lane == "W" else E
    if uses_east and E == 0: w.append("This option needs an east setback. With 0 on the east, the east-facing units have no way in.")
    elif lane_w < 4: w.append(f"The {f(lane_w)} lane is walk-only, no two-wheelers to the court or rear units.")
    w2 = []
    if G == 0:
        w2.append("No court, so the staircase is not placed.")
        if any(u["d"] == "N" and u["y"] > Fr + 0.01 for u in units):
            w.append("The rear north-facing units open onto the court. With no court they have no entrance.")
    elif G < hY: w2.append(f"The court ({f(G)}) is shallower than the staircase ({f(hY)} north to south). Widen the court, turn the stair, or narrow the flights.")
    elif G - hY < 3.5: w2.append(f"Only {f(G - hY)} is left beside the staircase in the court. Keep at least 3'-6\" clear for access.")
    if G > 0 and wX > bw: w2.append(f"The staircase ({f(wX)} east to west) is wider than the court ({f(bw)}).")
    if stair and not stair["entryOK"]: w2.append("The first step faces a wall or the edge of the court. Change the direction, turn or position so the stair starts from open court.")
    if any(min(u["w"], u["h"]) < 12 for u in units): w.append("Some units are under 12' in one direction, which is cramped.")
    if total / area > 0.75: w.append("Ground coverage is above 75%. Check the limit your local authority allows.")
    return dict(typology="TOWNHOME_RENTAL", version=VERSION, option=opt, option_title=SCHEMA["options"][opt]["title"], params=dict(p),
                site=dict(width_ft=PW, west_ft=west, east_ft=east, depth_ft=D, area_sqft=area),
                W=W, E=E, F=Fr, R=R, G=G, PS=PS, SH=SH, SW=SW, SL=SL, D=D, bw=bw, bd=bd, lane=lane, zones=zones, units=units, stair=stair,
                total=total, coverage_pct=total / area * 100, warn=w, warn2=w2,
                sp=dict(risers=risers, rAct=r_act, perF=per_f, treads=treads, run=run, SL=SL, SW=SW, TD=TD, FW=FW, FH=FH))

DOOR_FT = 3.0
def door_geom(u):
    """Entrance opening on the unit's facing wall: [a, b] in feet along the wall line, site frame."""
    m = 0.5
    if u["d"] == "N":
        a = u["x"] + m + max(0, u["w"] - 2 * m - DOOR_FT) * u["dp"]
        return dict(wall="N", a=[a, u["y"]], b=[a + DOOR_FT, u["y"]])
    a = u["y"] + m + max(0, u["h"] - 2 * m - DOOR_FT) * u["dp"]
    x = u["x"] + u["w"]
    return dict(wall="E", a=[x, a], b=[x, a + DOOR_FT])

def stair_pt(s, u, v):
    return (s["o"][0] + s["d"][0] * u + s["sv"][0] * v, s["o"][1] + s["d"][1] * u + s["sv"][1] * v)

# ------------------------------------------------------------------ drawing
def render_svg(res, title=""):
    s = res["site"]; PW, D = s["width_ft"], res["D"]
    g = Svg(PW, D, scale=6.0, pad=46)
    g.items.append(f'<rect x="{g.X(-4)}" y="{g.Y(-6)}" width="{(PW+8)*g.k}" height="{4*g.k}" fill="#E8EBEE"/>')
    g.text(PW / 2, -3.4, "ROAD (NORTH)", 10, bold=True)
    for z in res["zones"]:
        fill = {"access": "#FFF2D2", "court": "#E3F1E4"}.get(z["k"], "#F1F3F5")
        g.rect(z["x"], z["y"], z["w"], z["h"], fill=fill, stroke="#9AA3AB", sw=0.4)
        if z["k"] != "court" and not z.get("v") and z["h"] * g.k > 14:
            g.text(z["x"] + z["w"] / 2, z["y"] + z["h"] / 2 + 0.6, z["lab"], 8, color="#4E5A66")
    st = res["stair"]
    if st:
        g.rect(st["x"], st["y"], st["w"], st["h"], fill="#ffffff", sw=1)
        FW, gap, run = st["FW"], 1 / 3, st["run"]
        for i in range(1, st["treads"] + 1):
            k = i * st["TD"]
            if k < run - 0.02:
                g.line(stair_pt(st, k, 0), stair_pt(st, k, FW), sw=0.4); g.line(stair_pt(st, k, FW + gap), stair_pt(st, k, st["SW"]), sw=0.4)
        g.line(stair_pt(st, 0, FW), stair_pt(st, run, FW)); g.line(stair_pt(st, run, 0), stair_pt(st, run, st["SW"]))
        sp = stair_pt(st, -1.4, FW / 2); g.text(sp[0], sp[1] + 0.5, "UP", 8, color="#0B6E99", bold=True)
    for z in res["zones"]:
        if z["k"] == "court":
            g.text(z["x"] + z["w"] * (0.3 if res["params"]["stair_position"] == "E" else 0.7), z["y"] + z["h"] / 2 + 0.6, z["lab"], 8, color="#2F6B3A")
    for u in res["units"]:
        g.rect(u["x"], u["y"], u["w"], u["h"], fill="#EAF4F8", sw=1.6)
        cx, cy = u["x"] + u["w"] / 2, u["y"] + u["h"] / 2
        g.text(cx, cy - 1.2, f"UNIT {u['n']}", 11, bold=True)
        g.text(cx, cy + 1.2, f"{f(u['w'])} x {f(u['h'])}", 8)
        g.text(cx, cy + 3.2, f"{u['a']:.0f} sq ft, faces {u['face']}", 8, color="#0B6E99")
        a, b = u["door"]["a"], u["door"]["b"]
        g.line(a, b, stroke="#ffffff", sw=3)
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        g.poly([(mx - 1, my - 2), (mx + 1, my - 2), (mx, my - 0.4)] if u["d"] == "N" else [(mx + 2, my - 1), (mx + 2, my + 1), (mx + 0.4, my)])
    g.rect(0, 0, PW, D, sw=2)
    g.text(PW / 2, D + 3.2, f"{f(PW)} plot width, depth {f(D)}", 9)
    if title:
        g.text(0, D + 6, title, 10, anchor="start", bold=True)
    return g.render()

# ------------------------------------------------------------------ hand-off to design_pipeline
def to_plan_trace(res, project):
    """design_pipeline work/plan_trace.json (units mm, X east, Y north, origin = plot SW corner).
    Unit outlines are the program's gross lines taken as wall centrelines and inset by wall_mm/2."""
    t = project.get("wall_mm", 230); D = res["D"]
    X = lambda x: round(x * FT_MM); Y = lambda y: round((D - y) * FT_MM)
    rooms, doors = [], []
    for u in res["units"]:
        x1, x2, yN, yS = X(u["x"]) + t / 2, X(u["x"] + u["w"]) - t / 2, Y(u["y"]) - t / 2, Y(u["y"] + u["h"]) + t / 2
        code = f"U{u['n']}"
        rooms.append({"code": code, "name": f"Unit {u['n']} ({u['face'].lower()} facing)", "polygon": [[x1, yS], [x2, yS], [x2, yN], [x1, yN]],
                      "ceiling_mm": round(res["params"]["floor_height_ft"] * FT_MM - 150)})
        a, b = u["door"]["a"], u["door"]["b"]
        if u["door"]["wall"] == "N":
            hinge, latch = [X(a[0]), yN], [X(b[0]), yN]
        else:
            hinge, latch = [x2, Y(a[1])], [x2, Y(b[1])]
        doors.append({"id": f"D{u['n']}", "rooms": [code], "swing_room": code, "type": "hinged", "hinge": [round(v) for v in hinge],
                      "latch": [round(v) for v in latch], "note": f"main entrance from {'court / front yard' if u['d']=='N' else 'east lane / passage'} (outside not traced)"})
    st = res["stair"]
    extras = {"typology": res["typology"], "typology_version": res["version"], "option": res["option"],
              "court": next(({"x_mm": X(z["x"]), "y_mm": Y(z["y"] + z["h"]), "w_mm": X(z["w"]), "d_mm": X(z["h"])} for z in res["zones"] if z["k"] == "court"), None),
              "stair": ({"x_mm": X(st["x"]), "y_mm": Y(st["y"] + st["h"]), "w_mm": X(st["w"]), "d_mm": X(st["h"]), "risers": st["risers"],
                         "riser_in": round(st["rAct"], 2), "tread_in": round(st["TD"] * 12, 2), "flight_mm": X(st["FW"]),
                         "first_flight": res["params"]["stair_first_flight"], "turn": res["params"]["stair_turn"]} if st else None)}
    return {"source": f"program_pipeline {res['typology']} option {res['option']}", "units": "mm", "rooms": rooms, "doors": doors,
            "windows": [], "fixtures": [], "program": extras,
            "assumptions": [f"Unit outlines from the {res['typology']} program (option {res['option']}), gross lines taken as wall centrelines, inset {t/2:.0f} mm (wall_mm {t}).",
                            "Origin: south-west plot corner. X east, Y north. Planning depth = shorter plot side " + f(D) + ".",
                            "Internal rooms, windows and fixtures are not planned yet; add them to this trace before S1."]}

# ------------------------------------------------------------------ QC against confirmed rules + brief
def qc(res, rules, brief):
    out = []; r = rules; P = res["params"]
    cov = res["coverage_pct"]
    if r.get("coverage_max_pct") is not None:
        out.append(F("fail" if cov > r["coverage_max_pct"] + 1e-9 else "info", "coverage", "site", f"ground coverage {cov:.1f}% (max {r['coverage_max_pct']}%)"))
    for side, v in (("west", res["W"]), ("east", res["E"])):
        if v == 0:
            other = res["E"] if side == "west" else res["W"]
            if not r.get("one_side_zero_allowed", False): out.append(F("fail", "setback", side, f"{side} setback is 0 but zero side setbacks are not allowed"))
            elif other == 0: out.append(F("fail", "setback", side, "both side setbacks are 0"))
        elif not (r["side_setback_min_ft"] - 1e-9 <= v <= r["side_setback_max_ft"] + 1e-9):
            out.append(F("fail", "setback", side, f"{side} setback {f(v)} outside {f(r['side_setback_min_ft'])} to {f(r['side_setback_max_ft'])}"))
    if res["F"] < r.get("front_setback_min_ft", 0) - 1e-9: out.append(F("fail", "setback", "front", f"front setback {f(res['F'])} below {f(r['front_setback_min_ft'])}"))
    if res["R"] < r.get("rear_setback_min_ft", 0) - 1e-9: out.append(F("fail", "setback", "rear", f"rear setback {f(res['R'])} below {f(r['rear_setback_min_ft'])}"))
    if len(res["units"]) != brief.get("unit_count", len(res["units"])):
        out.append(F("fail", "units", "count", f"{len(res['units'])} units, brief asks for {brief['unit_count']}"))
    allowed = set(brief.get("facing_allowed", ["North", "East"]))
    for u in res["units"]:
        ref = f"U{u['n']}"
        if u["a"] < r.get("min_unit_area_sqft", 0) - 1e-6: out.append(F("fail", "unit_area", ref, f"{u['a']:.0f} sq ft below {r['min_unit_area_sqft']}"))
        if min(u["w"], u["h"]) < r.get("min_unit_dim_ft", 0) - 1e-9: out.append(F("warn", "unit_dim", ref, f"{f(min(u['w'], u['h']))} narrow side below {f(r['min_unit_dim_ft'])}"))
        if u["face"] not in allowed: out.append(F("fail", "facing", ref, f"faces {u['face']}, brief allows {sorted(allowed)}"))
    needs_east = res["option"] in "CDEFGHIJ"
    if needs_east and res["E"] == 0: out.append(F("fail", "access", "east_lane", "east-facing units need an east setback (lane)"))
    if res["G"] == 0 and any(u["d"] == "N" and u["y"] > res["F"] + 0.01 for u in res["units"]):
        out.append(F("fail", "access", "court", "rear north-facing units have no court to open onto"))
    lane_w = res["W"] if res["lane"] == "W" else res["E"]
    if 0 < lane_w < r.get("two_wheeler_lane_min_ft", 0): out.append(F("warn", "access", "lane", f"lane {f(lane_w)} is walk-only (two-wheelers need {f(r['two_wheeler_lane_min_ft'])})"))
    if res["option"] in "BGHI" and res["PS"] < r.get("passage_min_ft", 0) - 1e-9: out.append(F("fail", "access", "passage", f"passage {f(res['PS'])} below {f(r['passage_min_ft'])}"))
    sp = res["sp"]
    if brief.get("future_floors", True):
        st = res["stair"]
        if not st:
            out.append(F("fail", "stair", "court", "future floors need the court and staircase; court is 0"))
        else:
            if sp["rAct"] > r["stair_max_riser_in"] + 1e-9: out.append(F("fail", "stair", "riser", f"riser {sp['rAct']:.2f}\" above {r['stair_max_riser_in']}\""))
            if sp["TD"] < r["stair_min_tread_in"] - 1e-9: out.append(F("fail", "stair", "tread", f"tread {sp['TD']}\" below {r['stair_min_tread_in']}\""))
            if sp["FW"] < r["stair_min_flight_ft"] - 1e-9: out.append(F("fail", "stair", "flight", f"flight {f(sp['FW'])} below {f(r['stair_min_flight_ft'])}"))
            if res["G"] < st["h"] - 1e-9: out.append(F("fail", "stair", "court_depth", f"stair {f(st['h'])} deep in a {f(res['G'])} court"))
            elif res["G"] - st["h"] < r.get("court_clear_min_ft", 0) - 1e-9: out.append(F("warn", "stair", "court_clear", f"{f(res['G'] - st['h'])} clear beside the stair (want {f(r['court_clear_min_ft'])})"))
            if st["w"] > res["bw"] + 1e-9: out.append(F("fail", "stair", "court_width", f"stair {f(st['w'])} wider than the court {f(res['bw'])}"))
            if not st["entryOK"]: out.append(F("fail", "stair", "entry", "first step does not start from open court, lane or passage"))
    return out
