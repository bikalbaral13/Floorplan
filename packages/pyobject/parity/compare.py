"""Parity: every converted object's build() against the engine's resolveSpineObject (engine_dump.ts output).

    python parity/compare.py <engine.json> <converted dir> [--out parity.json]

Compared at the defaults and the engine's host (node [[0,0]], segment 4 m, space 4 x 3 m):
  2D  same number of rings, every point within 1e-6 m
  3D  same meshes (by order), each mesh's faces fan-triangulated exactly as build() does, positions within 1e-6 m
  metrics  every Output slot value, to the engine's 4-decimal display
"""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pyobject as O
try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass

TOL = 1e-6


def fan(faces):
    pos, idx = [], []
    for f in faces:
        if len(f) < 3: continue
        b = len(pos) // 3
        for p in f: pos += [p[0], p[1], p[2]]
        for i in range(1, len(f) - 1): idx += [b, b + i, b + i + 1]
    return pos, idx


def close(a, b): return len(a) == len(b) and all(abs(x - y) <= TOL * max(1, abs(x), abs(y)) for x, y in zip(a, b))


def fmt(v): return str(int(v)) if float(v).is_integer() else str(round(v * 1e4) / 1e4)


def compare(eng, obj, mod):
    ov = {k: (1 if v is True else 0 if v is False else v) for k, v in eng.get("overrides", {}).items()}
    params = {**O.defaults(obj), **ov}
    t0 = time.time(); res = mod["build"](params, eng["host"]); ms = (time.time() - t0) * 1000
    why = []
    fill = eng["fill"]
    if len(res["plan"]) != len(fill): why.append(f"2D rings {len(res['plan'])} vs engine {len(fill)}")
    else:
        for i, (a, b) in enumerate(zip(res["plan"], fill)):
            if not close([c for q in a for c in q], [c for q in b for c in q]): why.append(f"2D ring {i} differs"); break
    em = eng["meshes"]
    if len(res["meshes"]) != len(em): why.append(f"3D meshes {len(res['meshes'])} vs engine {len(em)}")
    else:
        for m, e in zip(res["meshes"], em):
            pos, idx = fan(e["faces"])
            if m["indices"] != idx or not close(m["positions"], pos): why.append(f"3D mesh {e['name']} differs ({len(m['positions']) // 3} vs {len(pos) // 3} verts)"); break
    es = dict(eng["stats"]); ps = res.get("stats", {})
    for k, v in es.items():
        if k not in ps: why.append(f"metric {k} missing"); break
        if fmt(ps[k]) != v and abs(float(v) - ps[k]) > 1.5e-4: why.append(f"metric {k} {fmt(ps[k])} vs engine {v}"); break
    return why, ms


def main(argv):
    cdir = argv[1]
    if os.path.isdir(argv[0]):                                     # engine_dump.ts writes one file per object
        class _Lazy(dict):
            def get(self, rel, default=None):
                f = os.path.join(argv[0], rel.replace("/", "__"))
                return json.load(open(f, encoding="utf-8")) if os.path.exists(f) else default
        eng = _Lazy()
    else: eng = json.load(open(argv[0], encoding="utf-8"))
    rep = json.load(open(os.path.join(cdir, "report.json"), encoding="utf-8"))
    out = {"pass": [], "fail": {}, "refused": rep["refused"], "timing_ms": {}, "cases": 0}
    for rel in rep["converted"]:
        cases = eng.get(rel)
        if not cases: out["fail"][rel] = ["engine gave no result"]; continue
        obj = O.load(os.path.join(cdir, rel)); mod = O.module(obj); why = []; tp = te = 0
        for e in cases:
            if "error" in e or e.get("null"): continue
            out["cases"] += 1
            try: w, ms = compare(e, obj, mod)
            except Exception as ex: w, ms = [f"python raised {type(ex).__name__}: {ex}"], 0
            tp += ms; te += e.get("ms", 0)
            if w: why.append(f"{json.dumps(e.get('overrides'))}: {'; '.join(w)}"); break
        out["timing_ms"][rel] = {"python": round(tp, 1), "engine": te, "cases": len(cases)}
        (out["pass"].append(rel) if not why else out["fail"].__setitem__(rel, why))
    n = len(rep["converted"]) + len(rep["refused"])
    print(f"{out['cases']} cases · {len(out['pass'])}/{n} objects identical to the engine ({len(out['fail'])} differ, {len(out['refused'])} refused)")
    for k, v in sorted(out["fail"].items()): print(f"  DIFF {k}: {'; '.join(v)}")
    if "--out" in argv: json.dump(out, open(argv[argv.index("--out") + 1], "w", encoding="utf-8"), indent=1)
    return 0 if not out["fail"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
