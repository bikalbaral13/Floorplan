"""Canvas standard-plan JSON → plan.json (tracer-plan/1). Brings existing traces (Windsor, Cyber1, Casa1, Villa 1…)
into the neutral model so they can be checked, re-exported and used as regression fixtures.

    python tools/import_canvas.py <canvas.json> <plan.json> [--kind drawing]
Inverse of exporters/canvas.py: y flipped, px ÷ pixelsPerMeter, door hinge/swing mapped back (canvas
"left" swing = world right), fixture rotation mapped back to the back-wall compass via the TURN tables.
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import model as M, paths
from core.build import space_type
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union

def _att(seg, oid): return next((a for a in seg.get("attachments", []) if a.get("objectId") == oid), None)

def convert(doc, std, kind="drawing"):
    ppm = float(doc.get("settings", {}).get("pixelsPerMeter") or 100)
    BACK = std["fixture_backs"]["BACK"]; TURN = std["fixture_backs"]["TURN"]
    inv = {k: {v: c for c, v in d.items()} for k, d in TURN.items()}
    levels = doc.get("levels") or [dict(id="L0", name="Ground floor", elevation=0, height=3.0, nodes=doc["nodes"], segments=doc["segments"], spaces=doc["spaces"])]
    plan = M.empty_plan({"kind": kind, "imported_from": doc.get("settings", {}).get("keywords", ""), "tracer_version": "import"})
    plan["scale"] = {"px_per_m": ppm, "method": "imported", "max_residual_ft": None}
    for lv in levels:
        L = M.empty_level(lv.get("id", "L0"), lv.get("name", "Level"), float(lv.get("elevation", 0)), float(lv.get("height", 3.0)))
        nodes = {n["id"]: n for n in lv["nodes"]}
        P = lambda nid: [round(nodes[nid]["x"] / ppm, 4), round(-nodes[nid]["y"] / ppm, 4)]
        for s in lv["segments"]:
            if s.get("fromNodeId") == s.get("toNodeId"): continue
            a, b = P(s["fromNodeId"]), P(s["toNodeId"]); t = round(float(s.get("thickness", 0)) / ppm, 4)
            wa = _att(s, "wall-with-math"); lab = s.get("label", "")
            if s.get("isObjectOpening"):
                d, w, op, g = _att(s, "door-with-math"), _att(s, "window-with-math"), _att(s, "opening-with-math"), _att(s, "channel-gate-with-math")
                width = round(math.dist(a, b), 4)
                if d:
                    p = d["params"]
                    L["openings"].append(dict(id=s["id"], a=a, b=b, t=t, kind="door", width=width, sill=0.0, head=float(p.get("lintelHeight", 2.1)),
                                              hinge="a" if p.get("hinge", "left") == "left" else "b", swing="R" if p.get("swing", "left") == "left" else "L",
                                              leaves=2 if p.get("leaves") == "Double" else 1, panes=1, label=lab, src="imported"))
                elif w:
                    p = w["params"]; sliding = p.get("operation") == "Sliding"
                    L["openings"].append(dict(id=s["id"], a=a, b=b, t=t, kind="sliding" if sliding else "window", width=width, sill=float(p.get("sillHeight", 0.9)),
                                              head=float(p.get("lintelHeight", 2.1)), hinge=None, swing=None, leaves=1, panes=int(p.get("panes", 2)), label=lab, src="imported"))
                elif g:
                    L["openings"].append(dict(id=s["id"], a=a, b=b, t=t, kind="gate", width=width, sill=0.0, head=float(g["params"].get("height", 2.1)), hinge=None, swing=None, leaves=1, panes=1, label=lab, src="imported"))
                else:
                    L["openings"].append(dict(id=s["id"], a=a, b=b, t=t, kind="opening", width=width, sill=0.0, head=float((op or {}).get("params", {}).get("lintelHeight", 2.1)),
                                              hinge=None, swing=None, leaves=1, panes=1, label=lab, src="imported"))
            elif s.get("mode") == "line" and not wa:
                L["walls"].append(dict(id=s["id"], a=a, b=b, t=t, h=0.0, kind="line", layer=s.get("layer", "ledge"), label=lab, src="imported"))
            elif wa or s.get("layer") == "wall":
                h = float((wa or {}).get("params", {}).get("height", L["height"]))
                kind_w = "wall" if s.get("hatch", True) else ("parapet" if h >= 0.8 else "kerb")
                L["walls"].append(dict(id=s["id"], a=a, b=b, t=t, h=h, kind=kind_w, label=lab, src="imported"))
        bands = unary_union([LineString([e["a"], e["b"]]).buffer(e["t"] / 2, cap_style=2) for e in L["walls"] + L["openings"]] + [Polygon()])
        from core.build import _clear
        for sp in lv["spaces"]:
            ring = [P(i) for i in sp["nodeIds"] if i in nodes]
            if len(ring) < 3: continue
            poly = Polygon(ring); typ = "toilet" if sp.get("region") == "Toilet" else ("balcony" if sp.get("region") == "Balcony" else ("area" if sp.get("roomType") == "area" else space_type(sp.get("label", ""))))
            clear, nb = _clear(ring, [(e["a"], e["b"], e["t"]) for e in L["walls"] + L["openings"]])
            L["spaces"].append(dict(id=sp["id"], name=sp.get("label", ""), type=typ, ring=ring, area=round(poly.area, 4), net_area=round(poly.difference(bands).area, 4),
                                    clear=clear, printed=None, src="imported"))
        for n in lv["nodes"]:
            for a in n.get("attachments", []):
                k = a["objectId"].replace("-with-math", ""); p = a.get("params", {}); c = [round(n["x"] / ppm, 4), round(-n["y"] / ppm, 4)]
                if k == "column":
                    L["columns"].append(dict(id=a["id"], c=c, size=[p.get("length", 0.3), p.get("breadth", 0.3)], rot=p.get("rotation", 0), src="imported"))
                elif k == "staircase":
                    L["stairs"].append(dict(id=a["id"], bay=None, footprint=None, risers=p.get("steps"), riser=p.get("riser"), tread=p.get("tread"), flight_w=p.get("width"),
                                            mid=p.get("midSpace"), landing=p.get("landingWidth"), config="dogleg" if "U" in str(p.get("config")) else "straight",
                                            toe={270: "S", 90: "N", 0: "W", 180: "E"}.get(int(p.get("rotation", 0)) % 360, "S"), first_flight=None, src="imported"))
                elif k == "north-arrow":
                    L["fixtures"].append(dict(id=a["id"], kind=k, c=c, size=[0.6, 0.6], back=None, rot=(-float(p.get("rotation", 0))) % 360, room=None, label="", src="imported"))
                else:
                    rot = float(p.get("rotation", 0)); back = inv.get(BACK.get(k, ""), {}).get(int(round(rot)) % 360) if k in BACK else None
                    dims = [p.get("width", p.get("length", 0.5)), p.get("length", p.get("depth", p.get("width", 0.5)))]
                    if k in ("bed", "toilet"): dims = [p.get("width", 0.9), p.get("length", 1.9)]
                    elif k in ("chair", "wardrobe", "cabinet"): dims = [p.get("width", 0.5), p.get("depth", 0.5)]
                    elif k == "sofa": dims = [p.get("length", 2.0), p.get("depth", 0.9)]
                    elif k in ("washbasin", "armchair", "tv-unit", "nightstand", "dressing-table", "kitchen-sink", "stove", "refrigerator", "table", "stool", "shoe-rack", "washing-machine"):
                        dims = [p.get("length", 0.5), p.get("width", 0.5)]
                    room = next((s["name"] for s in L["spaces"] if Polygon(s["ring"]).contains(Point(c))), None)
                    L["fixtures"].append(dict(id=a["id"], kind=k, c=c, size=[round(float(dims[0]), 4), round(float(dims[1]), 4)], back=back,
                                              rot={"S": 0, "E": 90, "N": 180, "W": 270}.get(back, (-rot) % 360), room=room, label="", src="imported"))
        plan["levels"].append(L)
    return plan

if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    std = paths.load_json(os.path.join(paths.ROOT, "standards", "DEFAULT.json"))
    plan = convert(paths.load_json(src), std, sys.argv[sys.argv.index("--kind") + 1] if "--kind" in sys.argv else "drawing")
    paths.save_json(dst, plan)
    L = plan["levels"][0]; print(f"imported: {len(L['walls'])} walls, {len(L['openings'])} openings, {len(L['spaces'])} spaces, {len(L['columns'])} columns, {len(L['fixtures'])} fixtures")
