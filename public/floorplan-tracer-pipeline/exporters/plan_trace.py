"""plan.json → plan_trace.json (mm, X east, Y north, origin = the plan's south-west corner) — the hand-off format
the program / design pipelines read: rooms as inner-face polygons, doors with hinge + latch points, windows,
fixtures by type. Rooms are the space rings shrunk by the bounding bands (shapely difference)."""
from shapely.geometry import Polygon, LineString
from shapely.ops import unary_union

def export(plan):
    out = {"source": f"floorplan-tracer {plan['source'].get('tracer_version', '')} ({plan['source'].get('kind')})", "units": "mm", "levels": []}
    allp = [p for L in plan["levels"] for s in L["spaces"] for p in s["ring"]] or [[0, 0]]
    x0, y0 = min(p[0] for p in allp), min(p[1] for p in allp)
    T = lambda p: [round((p[0] - x0) * 1000), round((p[1] - y0) * 1000)]
    for L in plan["levels"]:
        bands = unary_union([LineString([e["a"], e["b"]]).buffer(e["t"] / 2, cap_style=2) for e in L["walls"] + L["openings"]] + [Polygon()])
        rooms = []
        for s in L["spaces"]:
            net = Polygon(s["ring"]).difference(bands)
            big = max(getattr(net, "geoms", [net]), key=lambda g: g.area) if not net.is_empty else None
            rooms.append({"code": s["id"], "name": s["name"], "type": s["type"], "area_m2": round(s["net_area"], 3),
                          "polygon": [T(p) for p in (list(big.exterior.coords)[:-1] if big else s["ring"])]})
        doors = [{"id": o["id"], "type": o["kind"], "width_mm": round(o["width"] * 1000), "hinge": T(o["a"] if o["hinge"] == "a" else o["b"]),
                  "latch": T(o["b"] if o["hinge"] == "a" else o["a"]), "swing": o["swing"], "label": o.get("label", "")}
                 for o in L["openings"] if o["kind"] in ("door", "sliding", "gate", "opening")]
        windows = [{"id": o["id"], "a": T(o["a"]), "b": T(o["b"]), "sill_mm": round((o["sill"] or 0) * 1000), "head_mm": round(o["head"] * 1000), "label": o.get("label", "")}
                   for o in L["openings"] if o["kind"] == "window"]
        fixtures = [{"id": f["id"], "type": f["kind"], "c": T(f["c"]), "size_mm": [round(v * 1000) for v in f["size"]], "back": f.get("back"), "rot_deg": f["rot"], "room": f.get("room")} for f in L["fixtures"]]
        out["levels"].append({"id": L["id"], "name": L["name"], "elevation_mm": round(L["elevation"] * 1000), "rooms": rooms, "doors": doors, "windows": windows, "fixtures": fixtures,
                              "columns": [{"c": T(c["c"]), "size_mm": [round(v * 1000) for v in c["size"]]} for c in L["columns"]],
                              "stairs": [{"footprint_mm": T(st["footprint"][:2]) + T(st["footprint"][2:]), "risers": st["risers"], "toe": st["toe"]} for st in L["stairs"]]})
    out["assumptions"] = ["Origin: south-west corner of all space rings. X east, Y north, mm.", "Room polygons are inner faces (rings minus wall / opening bands)."]
    return out
