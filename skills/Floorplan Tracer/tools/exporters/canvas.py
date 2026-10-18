"""plan.json → BuilderPluss canvas "standard plan" JSON (what the editor imports). The ONLY place that knows
the editor's format and its object library; the tracer's model and rules never depend on it.

Frame: canvas px = world m × ppm, canvas y DOWN (y_c = −Y·ppm). ppm = the image's px/m for traced drawings
(keep the image-native scale — the underlay then needs no rescale), 100 otherwise.
Doors: canvas `hinge: "right"` = END node, `"left"` = START node; canvas `swing: "left"` opens toward (−uy, ux)
in canvas coordinates, which is the WORLD RIGHT of a→b — so model swing R → "left", L → "right".
Fixtures: rotation from the measured-back tables (standards → fixture_backs) so the back sits on the wall
the model says; backless kinds take −rot (canvas angles turn clockwise on screen).
Stairs: Objects/Structural/staircase.json is NOT centred on its node: at rotation 270 ("Left to right") the
node is the footprint's south-west corner with the first tread at the south (Scribble skill, measured);
the other toes are the same box turned — verify with a bake.
"""
import math

LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library"
SIZE = {
    "bed": lambda a, l: {"length": l, "width": a}, "toilet": lambda a, l: {"length": l, "width": a}, "chair": lambda a, l: {"width": a, "depth": l},
    "washbasin": lambda a, l: {"length": a, "width": l}, "armchair": lambda a, l: {"length": a, "width": l},
    "wardrobe": lambda a, l: {"width": a, "depth": l}, "cabinet": lambda a, l: {"width": a, "depth": l}, "sofa": lambda a, l: {"length": a, "depth": l},
    "tv-unit": lambda a, l: {"length": a, "width": l}, "nightstand": lambda a, l: {"length": a, "width": l}, "dressing-table": lambda a, l: {"length": a, "width": l},
    "kitchen-sink": lambda a, l: {"length": a, "width": l}, "stove": lambda a, l: {"length": a, "width": l}, "refrigerator": lambda a, l: {"length": a, "width": l},
    "table": lambda a, l: {"length": a, "width": l}, "stool": lambda a, l: {"length": a, "width": l}, "shoe-rack": lambda a, l: {"length": a, "width": l},
    "washing-machine": lambda a, l: {"length": a, "width": l},
}
LAYERS = [("0", "0", "#000000", True), ("image", "Image", "#a855f7", True), ("map", "Map", "#0284c7", False), ("dimension", "Dimension", "#b45309", True),
          ("wall", "Wall", "#1e293b", True), ("door", "Door", "#b91c1c", True), ("window", "Window", "#0e7490", True), ("opening", "Opening", "#64748b", True),
          ("space", "Space", "#16a34a", True), ("column", "Column", "#7c3aed", True), ("staircase", "Staircase", "#7c2d12", True)]
FILL = {"toilet": ("rgba(147,197,253,0.45)", "Blue", "Toilet"), "balcony": ("rgba(134,239,172,0.35)", "Green", "Balcony"), "area": ("rgba(203,213,225,0.35)", "Grey", None), "room": ("rgba(148,163,184,0.25)", "Grey", None)}

def export(plan, std, underlay=None):
    ppm = float((plan.get("scale") or {}).get("px_per_m") or 100.0)
    backs = std.get("fixture_backs", {}); BACK, TURN = backs.get("BACK", {}), backs.get("TURN", {})
    lv_out = []; extra_layers = []
    for L in plan["levels"]:
        seq = [0]
        def nid(p): seq[0] += 1; return f"{L['id']}-{p}{seq[0]:03x}"
        nodes, nidx = [], {}
        def N(p):
            k = (round(p[0], 4), round(p[1], 4))
            if k not in nidx:
                i = f"{L['id']}-n{len(nodes)}"; nidx[k] = i; nodes.append({"id": i, "x": round(p[0] * ppm, 3), "y": round(-p[1] * ppm, 3), "layer": "wall"})
            return nidx[k]
        def att(kind, params, path=None, t=0.5):
            return {"id": nid("att"), "objectId": f"{kind}-with-math", "objectPath": path or f"Objects/Architectural/{kind}.json", "params": params, "t": t, "flip": False}
        def base(t, layer, **kw):
            d = {"thickness": round(t * ppm, 2), "color": "#1e293b", "dashed": False, "lineStyle": "solid", "mode": "fill", "method": "center", "segmentType": "line",
                 "bufferStyle": "flat", "hatch": True, "hatchStyle": "diagonal", "hatchSpacing": 6, "showLabel": False, "layer": layer}
            d.update(kw); return d
        def wall_att(t, h, hatch=True): return att("wall", {"thickness": round(t, 4), "height": round(h, 3), "mode": "Buffered", "hatch": hatch, "fitMode": "Fill segment"})
        segs, spaces = [], []
        for w in L["walls"]:
            if w["kind"] == "line":                   # a drawn line that is not a wall (shower screen, duct edge)
                lay = w.get("layer", "ledge"); extra_layers.append(lay) if lay not in extra_layers else None
                seg = {"id": nid("s"), "fromNodeId": N(w["a"]), "toNodeId": N(w["b"]), **base(w["t"], lay, mode="line", hatch=False)}
                if w.get("label"): seg["label"] = w["label"]
                segs.append(seg); continue
            seg = {"id": nid("s"), "fromNodeId": N(w["a"]), "toNodeId": N(w["b"]), **base(w["t"], "wall", hatch=w["kind"] == "wall")}
            if w.get("label"): seg["label"] = w["label"]
            seg["attachments"] = [wall_att(w["t"], w["h"], w["kind"] == "wall")]; segs.append(seg)
        for o in L["openings"]:
            a, b, w = N(o["a"]), N(o["b"]), o["width"]
            if o["kind"] == "door":
                p = {"width": round(w, 4), "leaves": "Double" if o["leaves"] >= 2 else "Single", "hinge": "left" if o["hinge"] == "a" else "right",
                     "swing": "left" if o["swing"] == "R" else "right", "openAngle": 90, "fitMode": "Fill segment", "frameDepth": round(o["t"], 4), "lintelHeight": o["head"]}
                attachments, layer = [wall_att(o["t"], L["height"]), att("door", p)], "door"
            elif o["kind"] in ("window", "sliding"):
                p = {"width": round(w, 4), "fitMode": "Fill wall", "sillHeight": o["sill"] or 0.0, "lintelHeight": o["head"], "wallDepth": round(o["t"], 4),
                     "panes": o["panes"], "operation": "Sliding" if o["kind"] == "sliding" else "Casement", "showFrame": True}
                attachments, layer = [wall_att(o["t"], L["height"]), att("window", p)], "window"
            elif o["kind"] == "gate":
                attachments, layer = [wall_att(o["t"], L["height"]), att("channel-gate", {"width": round(w, 4), "fitMode": "Fill segment", "height": o["head"]})], "door"
            else:
                attachments, layer = [att("opening", {"width": round(w, 4), "fitMode": "Fill segment", "thickness": round(o["t"], 4), "lintelHeight": o["head"], "dashLength": 0.12, "dashGap": 0.08})], "opening"
            seg = {"id": nid("s"), "fromNodeId": a, "toNodeId": b, **base(o["t"], layer), "isObjectOpening": True, "attachments": attachments}
            if o.get("label"): seg["label"] = o["label"]
            segs.append(seg)
        for s in L["spaces"]:
            fill, colour, region = FILL.get(s["type"], FILL["room"])
            sp = {"id": nid("sp"), "nodeIds": [N(p) for p in s["ring"]], "layer": "space", "label": s["name"], "showLabel": True,
                  "roomType": "area" if s["type"] == "area" else "room", "fill": fill, "stroke": "#475569", "fillOpacity": 0.18,
                  "attachments": [att("room", {"color": colour}, t=0)]}
            if region: sp["region"] = region
            spaces.append(sp)
        graph = {}
        def node_object(p, kind, params, path, layer):
            n = N(p); segid = nid("obj")
            segs.append({"id": segid, "fromNodeId": n, "toNodeId": n, "layer": layer, "thickness": 0.5, "color": "#334155", "dashed": False, "mode": "line", "method": "center", "segmentType": "wall"})
            graph["|".join(sorted([f"{segid}:start", f"{segid}:end"]))] = {"node-type": "object"}
            nd = next(q for q in nodes if q["id"] == n); nd["layer"] = "0"; nd.setdefault("attachments", []).append(att(kind, params, path, t=0))
            if layer not in [x[0] for x in LAYERS] + extra_layers: extra_layers.append(layer)
        for c in L["columns"]:
            node_object(c["c"], "column", {"rotation": c["rot"], "anchorDir": "Center", "fitMode": "Off", "shape": "Rectangular", "length": c["size"][0], "breadth": c["size"][1], "height": L["height"]},
                        "Objects/Structural/column.json", "column")
        for st in L["stairs"]:
            x0, y0, x1, y1 = st["footprint"]
            rot, corner = {"S": (270, (x0, y0)), "N": (90, (x1, y1)), "W": (0, (x0, y1)), "E": (180, (x1, y0))}[st["toe"]]
            node_object(corner, "staircase", {"config": "U-shape" if st["config"] == "dogleg" else "Straight", "steps": st["risers"], "tread": st["tread"], "riser": st["riser"],
                                              "width": st["flight_w"], "landingWidth": st["landing"], "midSpace": st["mid"], "direction": "Left to right", "rotation": rot},
                        "Objects/Structural/staircase.json", "staircase")
        for fx in L["fixtures"]:
            kind = fx["kind"]; a, l = fx["size"]
            if fx.get("back") and kind in BACK: rot = TURN[BACK[kind]][fx["back"]]
            else: rot = (-fx.get("rot", 0)) % 360
            dims = SIZE[kind](a, l) if kind in SIZE else {}
            params = {"rotation": rot} if kind == "north-arrow" else {"rotation": rot, "anchorDir": "Center", "fitMode": "Off", **dims}
            node_object(fx["c"], kind, params, f"Objects/Architectural/{kind}.json", kind)
        lv = {"id": L["id"], "name": L["name"], "elevation": L["elevation"], "height": L["height"], "nodes": nodes, "segments": segs, "spaces": spaces,
              "rooms": [], "furniture": [], "objects": [], "graphAttrs": {"nodes": graph, "segments": {}}}
        lv_out.append(lv)
    layers = [{"id": i, "name": n, "color": c, "visible": v, "locked": False, "order": k} for k, (i, n, c, v) in enumerate(LAYERS)]
    layers += [{"id": x, "name": x.replace("-", " ").title(), "color": "#334155", "visible": True, "locked": False, "order": len(layers) + k} for k, x in enumerate(extra_layers)]
    settings = {"library_path": LIB, "units": "m", "northbearing": 0, "pixelsPerMeter": round(ppm, 4),
                "keywords": f"Floorplan Tracer pipeline {plan['source'].get('tracer_version', '')} — {plan['source'].get('kind')}", "source": plan.get("source", {})}
    doc = {"schemaVersion": 1, "settings": settings, "layers": layers}
    if underlay: doc["imageUnderlay"] = underlay
    if len(lv_out) == 1:
        L = lv_out[0]; doc.update(nodes=L["nodes"], segments=L["segments"], spaces=L["spaces"], graphAttrs=L["graphAttrs"])
    else:
        doc.update(nodes=[], segments=[], spaces=[], levels=lv_out, activeLevelId=lv_out[0]["id"])
    return doc
