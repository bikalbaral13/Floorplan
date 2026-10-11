"""STAIR_DOGLEG 0.1.0 — sizing, placement, drawing lines, QC and schedule.
Independent of any typology or project: typologies map their parameters onto these keys."""
import math

DIRS = {"E": (1, 0), "W": (-1, 0), "N": (0, -1), "S": (0, 1)}   # site frame: x east, y south

def compute(p):
    risers = math.ceil(p["floor_height_ft"] * 12 / p["max_riser_in"] - 1e-9)
    r_act = p["floor_height_ft"] * 12 / risers
    per_f = math.ceil(risers / 2); treads = per_f - 1
    run = treads * p["tread_in"] / 12
    SL = run + p["flight_width_ft"]; SW = 2 * p["flight_width_ft"] + p["gap_ft"]
    d = DIRS[p["direction"]]; ln = (d[1], -d[0]); sv = ln if p["turn"] == "L" else (-ln[0], -ln[1])
    along = d[0] != 0
    return dict(risers=risers, rAct=r_act, perF=per_f, treads=treads, run=run, SL=SL, SW=SW, TD=p["tread_in"] / 12,
                FW=p["flight_width_ft"], FH=p["floor_height_ft"], gap=p["gap_ft"], d=list(d), sv=list(sv),
                wX=SL if along else SW, hY=SW if along else SL, direction=p["direction"], turn=p["turn"])

def place(c, x, y):
    """Put the footprint's north-west corner at (x, y). Returns the placed stair (adds o, x, y, w, h)."""
    d, sv = c["d"], c["sv"]
    cs = [(d[0] * u + sv[0] * v, d[1] * u + sv[1] * v) for u, v in ((0, 0), (c["SL"], 0), (0, c["SW"]), (c["SL"], c["SW"]))]
    o = [x - min(q[0] for q in cs), y - min(q[1] for q in cs)]
    return dict(c, o=o, x=x, y=y, w=c["wX"], h=c["hY"])

def pt(s, u, v):
    return (s["o"][0] + s["d"][0] * u + s["sv"][0] * v, s["o"][1] + s["d"][1] * u + s["sv"][1] * v)

def entry_point(s, back=2.5):
    """Point `back` ft before the first step, on the first flight's centre line."""
    return pt(s, -back, s["FW"] / 2)

def lines(s):
    """Drawing segments in site coordinates: (kind, a, b). kinds: outline, divider, landing, tread, path."""
    FW, g, run, SW, SL = s["FW"], s["gap"], s["run"], s["SW"], s["SL"]
    v2 = FW + g; out = [("divider", pt(s, 0, FW), pt(s, run, FW)), ("divider", pt(s, 0, v2), pt(s, run, v2)), ("landing", pt(s, run, 0), pt(s, run, SW))]
    for i in range(1, s["treads"] + 1):
        k = i * s["TD"]
        if k < run - 0.02:
            out += [("tread", pt(s, k, 0), pt(s, k, FW)), ("tread", pt(s, k, v2), pt(s, k, SW))]
    xl = run + (SL - run) / 2
    out += [("path", pt(s, 0.5, FW / 2), pt(s, xl, FW / 2)), ("path", pt(s, xl, FW / 2), pt(s, xl, v2 + FW / 2)), ("path", pt(s, xl, v2 + FW / 2), pt(s, 1.2, v2 + FW / 2))]
    return out

def qc(c, rules, F, ref="stair"):
    out = []
    if rules.get("stair_max_riser_in") is not None and c["rAct"] > rules["stair_max_riser_in"] + 1e-9:
        out.append(F("fail", "stair", "riser", f"riser {c['rAct']:.2f}\" above {rules['stair_max_riser_in']}\""))
    if rules.get("stair_min_tread_in") is not None and c["TD"] * 12 < rules["stair_min_tread_in"] - 1e-9:
        out.append(F("fail", "stair", "tread", f"tread {c['TD']*12:.1f}\" below {rules['stair_min_tread_in']}\""))
    if rules.get("stair_min_flight_ft") is not None and c["FW"] < rules["stair_min_flight_ft"] - 1e-9:
        out.append(F("fail", "stair", "flight", f"flight {c['FW']:.2f}' below {rules['stair_min_flight_ft']}'"))
    blondel = 2 * c["rAct"] + c["TD"] * 12
    if not (21.65 <= blondel <= 27.56):
        out.append(F("warn", "stair", "comfort", f"2R + T = {blondel:.1f}\" (comfortable 550-700 mm = 21.7\" to 27.6\")"))
    return out

def schedule(c):
    return [("Risers", c["risers"]), ("Riser height (in)", round(c["rAct"], 2)), ("Risers per flight", c["perF"]),
            ("Treads per flight", c["treads"]), ("Tread (in)", round(c["TD"] * 12, 2)), ("Flight run (ft)", round(c["run"], 3)),
            ("Flight width (ft)", c["FW"]), ("Landing depth (ft)", c["FW"]), ("Footprint L x W (ft)", f"{c['SL']:.3f} x {c['SW']:.3f}"),
            ("First flight up towards", c["direction"]), ("Turn", c["turn"])]
