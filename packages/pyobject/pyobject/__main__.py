import json, sys
from . import load, build, validate_file, summary, coerce, ObjectError

try: sys.stdout.reconfigure(encoding="utf-8")
except Exception: pass


def kv(args):
    out = {}
    for a in args:
        k, _, v = a.partition("=")
        out[k] = v
    return out


def main(argv):
    if len(argv) < 2 or argv[0] not in ("run", "check"): print(__import__("pyobject").__doc__); return 2
    cmd, path, rest = argv[0], argv[1], argv[2:]
    outp = None
    if "--out" in rest: i = rest.index("--out"); outp = rest[i + 1]; rest = rest[:i] + rest[i + 2:]
    obj = load(path)
    errs = validate_file(obj)
    if errs: print("INVALID " + "; ".join(errs)); return 1
    if cmd == "run":
        res = build(obj, kv(rest)); print(json.dumps(summary(res)))
        if outp: json.dump(res, open(outp, "w", encoding="utf-8"))
        return 0
    bad = 0
    cases = [("defaults", {})]
    for p in obj.get("parameters", []):
        if p.get("kind", "number") == "number" and "min" in p and "max" in p:
            cases += [(f"{p['key']}=min", {p["key"]: p["min"]}), (f"{p['key']}=max", {p["key"]: p["max"]})]
        elif p.get("kind") == "select":
            cases += [(f"{p['key']}={o}", {p["key"]: o}) for o in __import__("pyobject").option_values(p) if o != p.get("default")]
    for name, ov in cases:
        try:
            s = summary(build(obj, ov)); print(f"PASS {name}: {s['triangles']} tris, {s['plan_rings']} plan rings, bbox {s['bbox_m']}")
        except (ObjectError, Exception) as e:
            bad += 1; print(f"FAIL {name}: {type(e).__name__}: {e}")
    print(f"\n{len(cases) - bad}/{len(cases)} passed"); return 1 if bad else 0


sys.exit(main(sys.argv[1:]))
