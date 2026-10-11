"""Rebuild a canvas.v1 plan from the connector's `design get` summary (metres, plan frame).

    python tools/summary_to_canvas.py <summary.json> <out.canvas.json> [--bare] [--labels labels.json]

Use it when the design is reachable only through the BuilderPluss connector (no R2 keys). The result is a
standard plan: nodes at x = m * ppm (the summary keeps the canvas's y-down frame), segments, spaces and node
objects with their params. With --bare everything that is not the DRAWING is removed — spec params copied in
from a deck (spec*, refImages, deckSlides, productUrl, materialPath, finishes), finish/ceiling/camera items
and spec-only zones — so the pipeline starts from what an architect would actually hand over.
"""
import json, re, sys

SPEC_KEYS = re.compile(r"^(spec|refImages|deckSlides|productUrl|materialPath|finishes)")
DROP_OBJECTS = {"camera-with-math", "cove-light-with-math", "upholstered-panel-with-math", "logo-signage-with-math",
                "fluted-panel-with-math", "tv-with-math", "baffle-ceiling-with-math", "services-ceiling-with-math", "pendant-with-math"}
DROP_LAYERS = {"finish", "camera", "ceiling", "lighting"}

def clean(params, bare):
    if not bare: return dict(params)
    return {k: v for k, v in params.items() if not SPEC_KEYS.match(k)}

def main():
    src, dst = sys.argv[1], sys.argv[2]; bare = "--bare" in sys.argv
    labels = {}
    if "--labels" in sys.argv: labels = json.load(open(sys.argv[sys.argv.index("--labels") + 1], encoding="utf-8"))
    d = json.load(open(src, encoding="utf-8")); ppm = float(d["pixelsPerMeter"])
    nodes, key2id = [], {}
    def node(pt):
        k = (round(pt[0], 4), round(pt[1], 4))
        if k not in key2id:
            key2id[k] = f"n{len(key2id) + 1:03d}"; nodes.append({"id": key2id[k], "x": round(k[0] * ppm, 3), "y": round(k[1] * ppm, 3)})
        return key2id[k]
    segs = []
    for s in d["segments"]:
        if bare and (s.get("layer") in DROP_LAYERS or all(o["object"] in DROP_OBJECTS for o in s.get("objects", []))): continue
        atts = [{"id": o["id"], "objectId": o["object"], "objectPath": f"Architectural/{o['object']}.json", "params": clean(o.get("params", {}), bare)} for o in s.get("objects", [])
                if not (bare and o["object"] in DROP_OBJECTS)]
        if bare: [a["params"].pop("specIds", None) for a in atts]
        rec = {"id": s["id"], "fromNodeId": node(s["from"]), "toNodeId": node(s["to"]), "layer": s.get("layer", "wall"),
               "thickness": round(float(s.get("thicknessM") or 0.1) * ppm, 4), "attachments": atts}
        if s.get("opening"): rec["isObjectOpening"] = True
        lab = labels.get(s["id"], s.get("label", ""))
        if lab: rec["label"] = lab
        segs.append(rec)
    for n in d.get("nodeObjects", []):
        objs = [o for o in n.get("objects", []) if not (bare and o["object"] in DROP_OBJECTS)]
        if not objs: continue
        nid = node(n["at"])
        nd = next(x for x in nodes if x["id"] == nid)
        nd["attachments"] = [{"id": o["id"], "objectId": o["object"], "objectPath": f"Architectural/{o['object']}.json", "params": clean(o.get("params", {}), bare)} for o in objs]
        mk = f"m{nid}"; segs.append({"id": mk, "fromNodeId": nid, "toNodeId": nid, "layer": "furniture", "thickness": 0, "attachments": []})
    spaces = []
    for sp in d["spaces"]:
        objs = sp.get("objects", [])
        if bare and objs and all(o["object"] in DROP_OBJECTS for o in objs): continue
        ids = [node(p) for p in sp["polygon"]]
        spaces.append({"id": sp["id"], "nodeIds": ids, "label": labels.get(sp["id"], sp.get("label", "")), "roomType": sp.get("roomType", "room"),
                       "attachments": [{"id": o["id"], "objectId": o["object"], "objectPath": f"Architectural/{o['object']}.json", "params": clean(o.get("params", {}), bare)} for o in objs if not (bare and o["object"] in DROP_OBJECTS)]})
    out = {"schemaVersion": 1, "settings": {"pixelsPerMeter": ppm, "units": "m"}, "nodes": nodes, "segments": segs, "spaces": spaces,
           "layers": [{"id": l} for l in d.get("layers", [])], "imageUnderlay": None,
           "graphAttrs": {"source": d.get("path", ""), "rebuilt_by": "space-brief tools/summary_to_canvas.py" + (" --bare" if bare else "")}}
    json.dump(out, open(dst, "w", encoding="utf-8"), indent=1)
    print(f"{dst}: {len(nodes)} nodes, {len(segs)} segments, {len(spaces)} spaces, {sum(len(n.get('attachments', [])) for n in nodes)} node objects")

if __name__ == "__main__":
    main()
