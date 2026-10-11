"""Bake a plan's Python objects: run every placed instance once in CPython and store the results in the object
file (`python.baked`), so the editor shows them instantly and starts Pyodide only when a parameter is edited.

    python -m pyobject.bake <plan.json> <out.json> [--digits 4]

Hosts are computed exactly as the editor computes them (src/floorplan/FloorPlanEditor.tsx): a node has none, a
segment is its two endpoints about the midpoint, a space its outline about its area centroid — anchor-relative
metres. The editor re-derives the cache key from these, so nothing here has to reproduce the editor's key format.
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pyobject as O


def centroid(pts):
    """packages/engine geometry/polygon.ts polygonCentroid."""
    if not pts: return 0.0, 0.0
    if len(pts) < 3: return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    a2 = cx = cy = 0.0
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]; c = a[0] * b[1] - b[0] * a[1]
        a2 += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c
    if abs(a2) < 1e-9:
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return cx / (3 * a2), cy / (3 * a2)


def instances(plan):
    """(objectId, params, host) for every attachment: node / segment / space."""
    ppm = (plan.get("settings") or {}).get("pixelsPerMeter") or 1
    nodes = {n["id"]: n for n in plan.get("nodes", [])}
    for n in plan.get("nodes", []):
        for a in n.get("attachments") or []: yield a["objectId"], a.get("params") or {}, None
    for s in plan.get("segments", []):
        if not s.get("attachments"): continue
        p, q = nodes.get(s["fromNodeId"]), nodes.get(s["toNodeId"])
        if not p or not q: continue
        mx, my = (p["x"] + q["x"]) / 2, (p["y"] + q["y"]) / 2
        host = [[(p["x"] - mx) / ppm, (p["y"] - my) / ppm], [(q["x"] - mx) / ppm, (q["y"] - my) / ppm]]
        for a in s["attachments"]: yield a["objectId"], a.get("params") or {}, host
    for sp in plan.get("spaces", []):
        if not sp.get("attachments"): continue
        pts = [[nodes[i]["x"], nodes[i]["y"]] for i in sp.get("nodeIds", []) if i in nodes]
        if len(pts) < 3: continue
        cx, cy = centroid(pts)
        host = [[(x - cx) / ppm, (y - cy) / ppm] for x, y in pts]
        for a in sp["attachments"]: yield a["objectId"], a.get("params") or {}, host


def compact(res, digits):
    r = lambda v: round(v, digits)
    return {"meshes": [{**{k: m[k] for k in ("name", "color", "material") if m.get(k) is not None},
                        "positions": [r(v) for v in m["positions"]], "indices": m["indices"]} for m in res.get("meshes", [])],
            "plan": [[[r(x), r(y)] for x, y in ring] for ring in res.get("plan", [])],
            **({"planColors": res["planColors"]} if res.get("planColors") else {}),
            "stats": {k: v for k, v in (res.get("stats") or {}).items() if isinstance(v, (int, float))}}


def bake(plan, digits=4):
    lib = plan.get("objectLibrary") or {}
    mods, seen, report = {}, set(), {"baked": 0, "skipped": 0, "ms": 0, "objects": {}}
    for oid, params, host in instances(plan):
        obj = lib.get(oid)
        if not obj or not (obj.get("python") or {}).get("source"): report["skipped"] += 1; continue
        if obj["python"].get("rotates") != "self": host = None          # only Math Engine translations take a host
        sig = json.dumps([oid, {k: v for k, v in params.items() if k != "renderMode"}, host], sort_keys=True)
        if sig in seen: continue
        seen.add(sig)
        if oid not in mods: mods[oid] = O.module(obj)
        keys = {q["key"] for q in obj.get("parameters", [])} - {"renderMode"}       # what the editor's pyParams passes
        p = {**{k: v for k, v in O.defaults(obj).items() if k in keys}, **{k: v for k, v in params.items() if k in keys}}
        t0 = time.time()
        res = mods[oid]["build"](p, host) if host is not None else mods[oid]["build"](p)
        ms = (time.time() - t0) * 1000; report["ms"] += ms
        obj["python"].setdefault("baked", []).append({"params": params, **({"host": host} if host else {}), "result": compact(res, digits)})
        report["baked"] += 1; report["objects"][oid] = report["objects"].get(oid, 0) + 1
    report["ms"] = round(report["ms"])
    return report


def main(argv):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    digits = int(argv[argv.index("--digits") + 1]) if "--digits" in argv else 4
    plan = json.load(open(argv[0], encoding="utf-8"))
    for o in (plan.get("objectLibrary") or {}).values():
        if isinstance(o, dict) and isinstance(o.get("python"), dict): o["python"].pop("baked", None)
    rep = bake(plan, digits)
    json.dump(plan, open(argv[1], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"baked {rep['baked']} instance runs ({rep['skipped']} non-Python attachments) in {rep['ms']} ms → {argv[1]} "
          f"({os.path.getsize(argv[1]) / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
