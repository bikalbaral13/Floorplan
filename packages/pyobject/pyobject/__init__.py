"""object/2 — one parametric object format, the same Python source in the browser (Pyodide), pipelines and Blender.

An object/2 file is the editor's Python object file (`tools/pyobj/bed_python.json` is the reference):

    {"kind": "parametric-object", "version": 2, "meta": {...}, "hostKind": "node", "parameters": [{key, kind, default, ...}],
     "python": {"runtime": "pyodide", "entry": "build", "source": "<pure Python, stdlib only>"},
     "units": "m",                                   (optional) the unit of length params; geometry out is ALWAYS metres
     "functions": ["build", "place", "qc", "bom"],   (optional) what the source defines beyond build
     "rule_keys": {"min_width": "door_min_width_m"}} (optional) object param → firm standards key used by qc

Functions (all optional except the entry):
    build(params) -> {"meshes": [{name, color, material?, positions:[x,y,z…], indices:[…]}], "plan": [[[x,y]…]…], "stats"?: {…}}
                     object-local metres: +x across, +y back→front, +z up
    place(params, ctx) -> dict          where it goes (program / design pipelines)
    qc(params, rules, F, ref) -> [finding]
    bom(params) -> [{item, qty, unit}]  quantities (build pipelines)

    python -m pyobject run   <object.json> [key=value …]      build() → summary (+ --out result.json)
    python -m pyobject check <object.json> […]                 validate the file and build() at defaults and at min/max
"""
import hashlib, json, math, numbers

KIND, VERSION = "parametric-object", 2
PARAM_KINDS = {"number", "select", "checkbox", "color", "text"}


class ObjectError(ValueError):
    pass


def load(path):
    with open(path, encoding="utf-8") as f: return json.load(f)


def defaults(obj):
    return {p["key"]: p.get("default") for p in obj.get("parameters", [])}


def option_values(p):
    """Select options as plain values — files carry either strings or the editor's {value, label} pairs."""
    return [o.get("value") if isinstance(o, dict) else o for o in p.get("options", [])]


def coerce(obj, overrides):
    """Defaults + overrides, numbers parsed, clamped to min/max, selects checked."""
    out = defaults(obj)
    spec = {p["key"]: p for p in obj.get("parameters", [])}
    for k, v in (overrides or {}).items():
        p = spec.get(k)
        if p is None: out[k] = v; continue
        kind = p.get("kind", "number")
        if kind == "number":
            v = float(v)
            if "min" in p: v = max(v, p["min"])
            if "max" in p: v = min(v, p["max"])
            if isinstance(p.get("default"), int) and float(v).is_integer() and p.get("step", 1) == 1: v = int(v)
        elif kind == "checkbox":
            v = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes", "on")
        elif kind == "select" and v not in option_values(p):
            raise ObjectError(f"{k}={v!r} is not one of {option_values(p)}")
        out[k] = v
    return out


def validate_file(obj):
    errs = []
    if obj.get("kind") != KIND: errs.append(f"kind must be {KIND!r}")
    if obj.get("version") != VERSION: errs.append(f"version must be {VERSION}")
    py = obj.get("python") or {}
    if not isinstance(py.get("source"), str) or not py["source"].strip(): errs.append("python.source is empty")
    if py.get("entry", "build") != "build" and "build" not in (obj.get("functions") or []): pass
    keys = set()
    for i, p in enumerate(obj.get("parameters", [])):
        if "key" not in p: errs.append(f"parameters[{i}] has no key"); continue
        if p["key"] in keys: errs.append(f"duplicate parameter {p['key']}")
        keys.add(p["key"])
        if p.get("kind", "number") not in PARAM_KINDS: errs.append(f"{p['key']}: kind {p.get('kind')!r} not in {sorted(PARAM_KINDS)}")
        if p.get("kind") == "select" and option_values(p) and p.get("default") not in option_values(p): errs.append(f"{p['key']}: default not in options")
    for k in (obj.get("rule_keys") or {}):
        if k not in keys and not k.startswith(("min_", "max_")): errs.append(f"rule_keys.{k} names no parameter")
    return errs


def module(obj):
    """Execute the source once in a fresh namespace (same as the Pyodide worker does)."""
    ns = {"__name__": f"pyobject_{(obj.get('meta') or {}).get('id', 'obj')}"}
    exec(compile(obj["python"]["source"], f"<{(obj.get('meta') or {}).get('id', 'object')}>", "exec"), ns)
    return ns


def bake_key(obj, params):
    """Cache key for a built result: the source and the resolved params (what the editor's worker cache keys on)."""
    h = hashlib.sha256(obj["python"]["source"].encode("utf-8")); h.update(json.dumps(params, sort_keys=True, default=str).encode())
    return h.hexdigest()


def _num(x): return isinstance(x, numbers.Real) and not isinstance(x, bool) and math.isfinite(x)


def validate_result(res):
    """Errors in a build() result (the contract the editor's 2D and 3D paths read)."""
    errs = []
    if not isinstance(res, dict): return ["build() must return a dict"]
    for i, m in enumerate(res.get("meshes", [])):
        pos, idx = m.get("positions", []), m.get("indices", [])
        if len(pos) % 3: errs.append(f"mesh {i} ({m.get('name')}): positions not a multiple of 3")
        elif not all(_num(v) for v in pos): errs.append(f"mesh {i}: non-finite position")
        n = len(pos) // 3
        if len(idx) % 3: errs.append(f"mesh {i}: indices not a multiple of 3")
        elif idx and (min(idx) < 0 or max(idx) >= n): errs.append(f"mesh {i}: index out of range (0..{n - 1})")
    for i, ring in enumerate(res.get("plan", [])):
        if not all(isinstance(q, (list, tuple)) and len(q) == 2 and all(_num(v) for v in q) for q in ring): errs.append(f"plan ring {i}: points must be [x, y]")
    if not res.get("meshes") and not res.get("plan"): errs.append("build() returned no meshes and no plan")
    return errs


def summary(res):
    tris = sum(len(m.get("indices", [])) // 3 for m in res.get("meshes", []))
    verts = sum(len(m.get("positions", [])) // 3 for m in res.get("meshes", []))
    pts = [v for m in res.get("meshes", []) for v in zip(*[iter(m.get("positions", []))] * 3)] or [(q[0], q[1], 0) for r in res.get("plan", []) for q in r]
    bbox = [[round(min(p[i] for p in pts), 4) for i in range(3)], [round(max(p[i] for p in pts), 4) for i in range(3)]] if pts else None
    return {"meshes": len(res.get("meshes", [])), "vertices": verts, "triangles": tris, "plan_rings": len(res.get("plan", [])), "bbox_m": bbox}


def run(obj, fn="build", params=None, *args):
    p = coerce(obj, params)
    ns = module(obj)
    if fn not in ns: raise ObjectError(f"the source defines no {fn}()")
    return ns[fn](p, *args)


def build(obj, params=None):
    res = run(obj, obj.get("python", {}).get("entry", "build"), params)
    errs = validate_result(res)
    if errs: raise ObjectError("; ".join(errs))
    return res
