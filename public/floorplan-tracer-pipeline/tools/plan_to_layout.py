"""plan.json → layout.json in an IMAGE frame: migrates an existing trace (imported with tools/import_canvas.py)
into the layout spec, so the whole pipeline (build → verify → export) runs on it and it becomes a fixture.

    python tools/plan_to_layout.py <plan.json> <layout.json> --ppm 66.36 --origin 750,543
Walls and openings are grouped into lines by orientation and centreline; runs keep their own thickness
(opts.t) when it differs from the line's median; doors keep hinge / swing (converted to s|e, +|−).
"""
import argparse, json, os, statistics, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, model as M

def convert(plan, ppm, origin, printed=None):
    ox, oy = origin; px = lambda x: round(x * ppm + ox, 2); py = lambda y: round(-y * ppm + oy, 2)
    levels = []
    for L in plan["levels"]:
        groups = {}
        for e in L["walls"] + L["openings"]:
            horiz = abs(e["a"][1] - e["b"][1]) < 1e-6
            if not horiz and abs(e["a"][0] - e["b"][0]) > 1e-6: continue          # oblique pieces are not supported by the layout spec (v0.1)
            o = "H" if horiz else "V"; c = py(e["a"][1]) if horiz else px(e["a"][0])
            groups.setdefault((o, c), []).append(e)
        lines = []
        for (o, c), es in sorted(groups.items()):
            t = statistics.median([e["t"] * ppm for e in es]); runs = []
            for e in es:
                if o == "H": s, en = sorted((px(e["a"][0]), px(e["b"][0])))
                else: s, en = sorted((py(e["a"][1]), py(e["b"][1])))
                kind = {"wall": "w", "parapet": "r", "kerb": "k", "line": "l", "door": "d", "window": "win", "sliding": "g", "opening": "o", "gate": "gate"}[e.get("kind")]
                opt = {}
                if abs(e["t"] * ppm - t) > 0.5: opt["t"] = round(e["t"] * ppm, 2)
                if e.get("label"): opt["label"] = e["label"]
                if kind in ("r", "k"): opt["h"] = e.get("h", 1.0)
                if kind == "l" and e.get("layer"): opt["layer"] = e["layer"]
                if kind == "win": opt.update(sill=e["sill"], head=e["head"], panes=e["panes"])
                if kind == "d":
                    hinge_pt = e["a"] if e["hinge"] == "a" else e["b"]
                    hv = px(hinge_pt[0]) if o == "H" else py(hinge_pt[1])
                    opt["hinge"] = "s" if abs(hv - s) < abs(hv - en) else "e"
                    nx, ny = M.left_normal(e["a"], e["b"]); sw = (nx, ny) if e["swing"] == "L" else (-nx, -ny)
                    opt["swing"] = ("+" if sw[1] < 0 else "-") if o == "H" else ("+" if sw[0] > 0 else "-")   # frame +y = world −Y
                    opt["leaves"] = e["leaves"]
                runs.append([kind, s, en, opt])
            runs.sort(key=lambda r: r[1]); lines.append([o, c, round(t, 2), runs])
        pr = printed or {}
        spaces = [[s["name"], [[px(p[0]), py(p[1])] for p in s["ring"]], {"type": s["type"], **({"printed": pr[s["name"]]} if s["name"] in pr else {})}] for s in L["spaces"]]
        cols = [[px(c["c"][0]), py(c["c"][1]), round(c["size"][0] * ppm, 2), round(c["size"][1] * ppm, 2)] for c in L["columns"]]
        fx = [[f["kind"], px(f["c"][0]), py(f["c"][1]), round(f["size"][0] * ppm, 2), round(f["size"][1] * ppm, 2), f.get("back"), {"rot": f["rot"]} if not f.get("back") else {}] for f in L["fixtures"]]
        levels.append({"id": L["id"], "name": L["name"], "elevation": L["elevation"], "height": L["height"], "wall_h": max([w["h"] for w in L["walls"] if w["kind"] == "wall"] or [L["height"]]),
                       "snap": 0.5, "lines": lines, "spaces": spaces, "columns": cols, "fixtures": fx, "not_placed": [[n["kind"], n["why"]] for n in L.get("not_placed", [])]})
    return {"schema": M.LAYOUT_SCHEMA, "frame": {"type": "image", "px_per_m": ppm, "origin_px": [ox, oy]}, "src": "measured", "levels": levels}

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("plan"); ap.add_argument("out"); ap.add_argument("--ppm", type=float, required=True); ap.add_argument("--origin", required=True)
    ap.add_argument("--printed", help="json file {room name: \"L x B\"}")
    a = ap.parse_args()
    lay = convert(paths.load_json(a.plan), a.ppm, [float(v) for v in a.origin.split(",")], paths.load_json(a.printed) if a.printed else None)
    paths.save_json(a.out, lay); print(f"layout: {sum(len(L['lines']) for L in lay['levels'])} lines, {sum(len(L['spaces']) for L in lay['levels'])} spaces → {a.out}")
