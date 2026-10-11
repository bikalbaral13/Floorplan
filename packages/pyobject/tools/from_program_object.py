"""Program-pipeline object (objects/<ID>/object.json + object.py, feet) → object/2 JSON the editor can place.

    python tools/from_program_object.py <objects/<ID>> <out.json>

The object's own source is kept verbatim (its place / qc / compute / lines / schedule still work for the program
pipeline); a `build(params)` is appended that draws the object's plan symbol in METRES from those same functions.
Parameters keep their feet / inch units (`units` says so); only build()'s output is converted.
"""
import json, os, sys
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

FT = 0.3048

BUILDS = {
    "DOOR_HINGED": '''

# ── object/2 entry: plan symbol in metres (leaf + quarter swing), hinge at the origin, wall along +x ──
def build(params):
    import math
    w = params["width_ft"] * 0.3048
    leaf = [[0.0, 0.0], [0.0, w]]
    arc = [[w * math.sin(math.radians(a)), w * math.cos(math.radians(a))] for a in range(0, 91, 10)]
    opening = [[0.0, -0.05], [w, -0.05], [w, 0.05], [0.0, 0.05]]
    return {"meshes": [], "plan": [opening, leaf, arc], "stats": {"width_m": round(w, 4)}}
''',
    "STAIR_DOGLEG": '''

# ── object/2 entry: plan symbol in metres from compute() / place() / lines(), centred on the origin ──
def build(params):
    s = place(compute(params), 0.0, 0.0)
    cx, cy = s["w"] / 2, s["h"] / 2
    m = lambda q: [(q[0] - cx) * 0.3048, (q[1] - cy) * 0.3048]
    outline = [m((0, 0)), m((s["w"], 0)), m((s["w"], s["h"])), m((0, s["h"]))]
    rings = [outline] + [[m(a), m(b)] for kind, a, b in lines(s)]
    return {"meshes": [], "plan": rings, "stats": {"risers": s["risers"], "riser_in": round(s["rAct"], 3), "treads_per_flight": s["treads"],
                                                    "footprint_m": [round(s["w"] * 0.3048, 3), round(s["h"] * 0.3048, 3)]}}
''',
}


def convert(src_dir):
    spec = json.load(open(os.path.join(src_dir, "object.json"), encoding="utf-8"))
    code = open(os.path.join(src_dir, "object.py"), encoding="utf-8").read()
    oid = spec["id"]
    if oid not in BUILDS: raise SystemExit(f"no build() template for {oid} yet (known: {', '.join(BUILDS)})")
    params = []
    for k, p in spec["parameters"].items():
        q = {"key": k, "label": p.get("label", k)}
        if p["type"] == "choice": q.update(kind="select", default=p["default"], options=p["options"])
        else: q.update(kind="number", default=p["default"], **{x: p[x] for x in ("min", "max") if x in p})
        if p.get("unit"): q["unit"] = p["unit"]
        params.append(q)
    params.append({"key": "rotation", "label": "Rotation", "kind": "number", "default": 0, "min": 0, "max": 360, "step": 90, "unit": "deg"})
    return {
        "kind": "parametric-object", "version": 2,
        "meta": {"id": oid.lower(), "name": spec["title"], "category": "Architectural", "units": "m", "source": f"program_pipeline objects/{oid}@{spec['version']}"},
        "hostKind": "node", "description": spec["title"] + ". " + spec.get("frame", ""),
        "units": "ft", "functions": ["build"] + [f for f in spec.get("functions", []) if f != "build"], "rule_keys": spec.get("rule_keys", {}),
        "parameters": params,
        "python": {"runtime": "pyodide", "entry": "build", "source": code.rstrip() + "\n" + BUILDS[oid]},
    }


if __name__ == "__main__":
    obj = convert(sys.argv[1])
    with open(sys.argv[2], "w", encoding="utf-8", newline="\n") as f: json.dump(obj, f, ensure_ascii=False, indent=1)
    print(f"{obj['meta']['id']} → {sys.argv[2]}")
