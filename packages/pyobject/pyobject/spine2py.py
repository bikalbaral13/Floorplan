"""Six-node (spine) object → object/2 with a Python source that needs no Math Engine.

    python -m pyobject.spine2py <spine.json> <out.json>         one object
    python -m pyobject.spine2py --all <dir> <out dir>           every spine object under <dir> (+ report.json)

The Math Engine body is translated statement by statement (same grammar and precedence as
packages/engine/src/expr/expr.ts — the parser below mirrors its recursive descent), and every value operation
goes through the embedded runtime (exprlang_runtime.py), which ports the engine's semantics. The 2D/3D Render
rows and Output slots become build()'s plan rings, meshes and stats exactly as resolveSpineObject reads them.

Refused (stays on the engine): a body that calls an unported builtin (2D/3D booleans, curves, inv/solve), a named
Algorithm (`Inset.…`), decode/encode blocks, detection nodes, or a canvas/image host.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUNTIME = open(os.path.join(HERE, "exprlang_runtime.py"), encoding="utf-8").read()
_NS = {}; exec(compile(RUNTIME, "exprlang_runtime", "exec"), _NS)
UNPORTED = set(_NS["_UNPORTED"])
ALG = json.load(open(os.path.join(HERE, "algorithms.json"), encoding="utf-8"))
ALGOS = {a["qualified"].lower(): a for a in ALG["algorithms"]}
ALIASES = ALG["aliases"]
SUPPORTED = (set(_NS["_MATRIX"]) - UNPORTED) | set(_NS["_SCALAR"])
DEF = re.compile(r"^([A-Za-z_]\w*)\s*=(?!=)\s*(.+)$")
LOOP = re.compile(r"^loop\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:?\s*$", re.I)
END = re.compile(r"^end$", re.I)


SOURCE_TOOLS = {"source", "node-source", "segment-source", "space-creator", "graph-source", "canvas-source", "freehand-source", "image"}  # spineObject.ts
SYMBOLS = {"door", "window", "staircase", "floor", "wall", "massing", "titleblock", "settings"}   # editor's symOk


class Refuse(Exception):
    pass


# ── tokenizer + parser: expr.ts, line for line ──
def tokenize(src):
    toks, i, two = [], 0, {"==", "!=", "<=", ">=", "&&", "||"}
    while i < len(src):
        c = src[i]
        if c in " \t\n\r": i += 1; continue
        if c in "'\"":
            j = i + 1; s = ""
            while j < len(src) and src[j] != c: s += src[j]; j += 1
            toks.append(("str", s)); i = j + 1; continue
        if c.isdigit() and c.isascii() or c == "." and i + 1 < len(src) and src[i + 1].isdigit():
            j = i; s = ""
            while j < len(src) and (src[j].isdigit() and src[j].isascii() or src[j] == "."): s += src[j]; j += 1
            if j < len(src) and src[j] in "eE":
                k = j + 1
                if k < len(src) and src[k] in "+-": k += 1
                if k < len(src) and src[k].isdigit():
                    s += src[j:k]
                    while k < len(src) and src[k].isdigit(): s += src[k]; k += 1
                    j = k
            toks.append(("num", s)); i = j; continue
        if c.isascii() and (c.isalpha() or c == "_"):
            j = i; s = ""
            while j < len(src):
                if src[j].isascii() and (src[j].isalnum() or src[j] == "_"): s += src[j]; j += 1; continue
                if src[j] == "." and j + 1 < len(src) and src[j + 1].isascii() and (src[j + 1].isalpha() or src[j + 1] == "_"): s += "."; j += 1; continue
                break
            toks.append(("id", s)); i = j; continue
        if src[i:i + 2] in two: toks.append(("op", src[i:i + 2])); i += 2; continue
        toks.append(("op", c)); i += 1
    return toks


def js_parsefloat(s):
    m = re.match(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", s)
    return float(m.group(0)) if m else math.nan


def compile_expr(src, calls):
    """→ Python expression text, or raise (the engine's compile throws → evalValue returns 0)."""
    toks = tokenize(src); pos = [0]
    peek = lambda: toks[pos[0]] if pos[0] < len(toks) else None
    def eat(v=None):
        t = peek()
        if v is not None and (t is None or t[1] != v): raise SyntaxError(f"expected {v}")
        pos[0] += 1; return t
    def binl(nxt, ops):
        left = nxt()
        while peek() and peek()[1] in ops:
            op = eat()[1]; right = nxt(); left = f"_bin({op!r}, {left}, {right})"
        return left
    def primary():
        t = peek()
        if t is None: raise SyntaxError("unexpected end")
        if t[1] == "(":
            eat("("); e = ternary(); eat(")"); return e
        if t[1] == "-":
            eat("-"); return f"_neg({pw()})"
        if t[1] == "!":
            eat("!"); return f"(not _truthy({primary()}))"
        if t[0] == "num":
            eat(); n = js_parsefloat(t[1]); return repr(n) if math.isfinite(n) else "float('nan')"
        if t[0] == "str":
            eat(); return repr(t[1])
        if t[0] == "id":
            eat()
            if peek() and peek()[1] == "(":
                eat("("); args = []
                if not peek() or peek()[1] != ")":
                    args.append(ternary())
                    while peek() and peek()[1] == ",": eat(","); args.append(ternary())
                eat(")"); calls.add(t[1]); return f"_call({t[1]!r}, [{', '.join(args)}])"
            return f"_var(sc, {t[1]!r})"
        raise SyntaxError(f"unexpected {t[1]}")
    def pw():
        l = primary()
        if peek() and peek()[1] == "^":
            eat("^"); r = pw(); return f"_bin('^', {l}, {r})"
        return l
    mul = lambda: binl(pw, ["*", "/", "%", "@"])
    add = lambda: binl(mul, ["+", "-"])
    cmp = lambda: binl(add, ["<", "<=", ">", ">="])
    equ = lambda: binl(cmp, ["==", "!="])
    def and_():
        l = equ()
        while peek() and peek()[1] == "&&": eat(); r = equ(); l = f"(_truthy({l}) and _truthy({r}))"
        return l
    def or_():
        l = and_()
        while peek() and peek()[1] == "||": eat(); r = and_(); l = f"(_truthy({l}) or _truthy({r}))"
        return l
    def ternary():
        c = or_()
        if peek() and peek()[1] == "?":
            eat("?"); a = ternary(); eat(":"); b = ternary(); return f"({a} if _truthy({c}) else {b})"
        return c
    return ternary()


def parse_stmts(body):
    root = []; stack = [root]
    for line in (l.strip() for l in body.split("\n")):
        if not line: continue
        cur = stack[-1]
        m = LOOP.match(line)
        if m: st = {"kind": "loop", "name": m.group(1), "count": m.group(2).strip(), "body": []}; cur.append(st); stack.append(st["body"]); continue
        if END.match(line):
            if len(stack) > 1: stack.pop()
            continue
        m = DEF.match(line)
        if m: cur.append({"kind": "def", "name": m.group(1), "expr": m.group(2).strip()})
    return root


def emit_body(stmts, calls, ind="    "):
    out = []
    def expr(e):
        try: return compile_expr(e, calls)
        except (SyntaxError, IndexError, TypeError): return "0"
    def walk(lst, d):
        p = ind * d
        for s in lst:
            out.append(f"{p}_steps[0] += 1")
            out.append(f"{p}if _steps[0] > 200000: return")
            if s["kind"] == "def":
                out.append(f"{p}try: _v = {expr(s['expr'])}")
                out.append(f"{p}except Exception: _v = 0")
                out.append(f"{p}sc[{s['name']!r}] = _v")
                if not s["name"].startswith("_"): out.append(f"{p}out[{s['name']!r}] = _v")
            else:
                out.append(f"{p}try: _raw = _num({expr(s['count'])})")
                out.append(f"{p}except Exception: _raw = 0")
                out.append(f"{p}_n = min(10000, max(0, int(math.floor(_raw)) if _raw == _raw and _raw not in (math.inf, -math.inf) else 0))")
                v = f"_k{d}"
                out.append(f"{p}for {v} in range(_n):")
                out.append(f"{p}{ind}sc[{s['name']!r}] = {v}")
                walk(s["body"], d + 1) if s["body"] else out.append(f"{p}{ind}pass")
                out.append(f"{p}{ind}if _steps[0] > 200000: return")
    walk(stmts, 1)
    return out


def emit_algorithm(a, calls):
    """A named algorithm (exprAlgorithms.ts) → a Python function: fresh scope {PI, params}, returns out[returns]."""
    fn = "_alg_" + re.sub(r"\W", "_", a["qualified"].lower())
    stmts = parse_stmts(a["body"])
    body = emit_body(stmts, calls)
    decl = [n for n in dict.fromkeys(declared(stmts)) if not n.startswith("_")]
    return "\n".join([
        f"def {fn}_run(sc, out, _steps):", *(body or ["    pass"]), "",
        f"def {fn}(args):",
        "    sc = {'PI': math.pi}",
        f"    for i, p in enumerate({a['params']!r}): sc[p] = args[i] if i < len(args) else 0",
        f"    out = {{n: 0 for n in {decl!r}}}",
        f"    {fn}_run(sc, out, [0])",
        f"    return out.get({a['returns']!r}, 0)", "",
        f"_ALGOS[{a['qualified'].lower()!r}] = {fn}", ""])


def declared(stmts, acc=None):
    acc = [] if acc is None else acc
    for s in stmts:
        if s["kind"] == "def": acc.append(s["name"])
        else: declared(s["body"], acc)
    return acc


# ── the spine file ──
def tool(f, t): return next((n for n in f["nodes"] if isinstance(n, dict) and n.get("data", {}).get("tool") == t), None)


def params_of(n):
    p = (n or {}).get("data", {}).get("params")
    return json.loads(p) if isinstance(p, str) else (p or {})


def spine_of(raw):
    if isinstance(raw.get("nodes"), list): return raw
    if isinstance(raw.get("spine"), dict) and isinstance(raw["spine"].get("nodes"), list): return {**raw["spine"], "id": raw.get("id"), "title": raw.get("title"), "category": raw.get("category")}
    return None


def convert(raw):
    f = spine_of(raw)
    if not f or not isinstance(f.get("object"), dict): raise Refuse("not a spine object")
    nodes, edges = f["nodes"], f.get("edges", [])
    math_n, out_n = tool(f, "expr"), tool(f, "output")
    mp = params_of(math_n)
    body = mp.get("expr")
    if not isinstance(body, str) or not body.strip(): raise Refuse("empty Math Engine")
    if mp.get("decode") or mp.get("encode"): raise Refuse("decode/encode block")
    if any(n.get("data", {}).get("tool") == "object-detection" for n in nodes): raise Refuse("detection node")
    props = params_of(tool(f, "input-props")).get("props", []) or []
    if f["object"].get("hostKind") in ("image", "canvas"): raise Refuse(f"{f['object']['hostKind']} host (needs the picture / the whole drawing)")
    src_ids = {n["id"] for n in nodes if n.get("data", {}).get("tool") in SOURCE_TOOLS}
    pnode = tool(f, "input-props")
    host = next((e["targetHandle"][6:] for e in edges if pnode and e.get("source") in src_ids and e.get("target") == pnode["id"]
                 and str(e.get("targetHandle", "")).startswith("valin-")), None)
    srcn = next((n for n in nodes if n["id"] in src_ids), None)
    if srcn and srcn["data"]["tool"] in ("canvas-source", "image"): raise Refuse(f"{srcn['data']['tool']} host")
    calls = set()
    stmts = parse_stmts(body)
    lines = emit_body(stmts, calls)
    algos, alg_src, todo = [], [], sorted(calls)
    while todo:                                           # named algorithms, transitively
        c = todo.pop()
        a = ALGOS.get(c.lower()) if "." in c else None
        if a and a["qualified"] not in algos:
            algos.append(a["qualified"]); inner = set()
            alg_src.append(emit_algorithm(a, inner)); calls |= inner; todo += sorted(inner)
    def resolved(c): return ALIASES.get(c.lower(), c) if "." in c and c.lower() not in ALGOS else c
    bad = sorted({resolved(c) for c in calls if resolved(c) in UNPORTED})
    if bad: raise Refuse("unported: " + ", ".join(bad))
    # wiring (spineObject.ts wiring())
    slot2name, row2slot = {}, {}
    for e in edges:
        sh, th = str(e.get("sourceHandle", "")), str(e.get("targetHandle", ""))
        if math_n and out_n and e.get("source") == math_n["id"] and e.get("target") == out_n["id"]: slot2name[th[6:]] = sh[4:]
    for e in edges:
        sh, th = str(e.get("sourceHandle", "")), str(e.get("targetHandle", ""))
        if out_n and e.get("source") == out_n["id"] and th.startswith("valin-"): row2slot[th[6:]] = sh[4:]
        if math_n and e.get("source") == math_n["id"] and th.startswith("valin-") and e.get("target") != (out_n or {}).get("id"):
            row2slot[th[6:]] = ""; slot2name["__direct__" + th[6:]] = sh[4:]
    def name_for(rid):
        if rid not in row2slot: return None
        s = row2slot[rid]
        return slot2name.get("__direct__" + rid) if s == "" else slot2name.get(s)
    mats = {}
    r3d = tool(f, "render-3d")
    for e in edges:
        if r3d and e.get("target") == r3d["id"] and str(e.get("targetHandle", "")).startswith("matin-"):
            s = next((n for n in nodes if n["id"] == e["source"]), None)
            if s and s["data"].get("tool") == "material" and str(params_of(s).get("path", "")).strip(): mats[e["targetHandle"][6:]] = params_of(s)["path"].strip()
    rows2 = [r for r in params_of(tool(f, "render-2d")).get("prims", []) if isinstance(r, dict) and r.get("show") is not False and isinstance(r.get("id"), str)]
    rows3 = [r for r in params_of(r3d).get("prims", []) if isinstance(r, dict) and r.get("show") is not False and isinstance(r.get("id"), str)]
    slots = [s for s in (params_of(out_n).get("slots") or []) if isinstance(s, dict) and isinstance(s.get("id"), str)]
    o = f["object"]
    pdefs = []
    for p in props:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str): continue
        pdefs.append({"id": p["id"], "value": p.get("value") if isinstance(p.get("value"), (int, float, str, bool)) else 0})
    spec = {"props": pdefs, "host": host, "hostKind": o.get("hostKind"),
            "rows2": [{"id": r["id"], "kind": r.get("kind"), "var": name_for(r["id"]), "color": r.get("color") if isinstance(r.get("color"), str) else None,
                       "width": r.get("width") if isinstance(r.get("width"), (int, float)) else 0.1, "radius": r.get("radius") if isinstance(r.get("radius"), (int, float)) else 1} for r in rows2],
            "rows3": [{"id": r["id"], "kind": r.get("kind"), "var": name_for(r["id"]), "name": r.get("name") or r["id"],
                       "color": r.get("color") if isinstance(r.get("color"), str) else "#94a3b8", "material": mats.get(r["id"]),
                       "radius": r.get("radius") if isinstance(r.get("radius"), (int, float)) else 1,
                       "tube": r.get("tubeRadius") if isinstance(r.get("tubeRadius"), (int, float)) else 0.1} for r in rows3],
            "slots": [{"id": s["id"], "label": (s.get("label") or "").strip(), "var": slot2name.get(s["id"])} for s in slots],
            "declared": [n for n in dict.fromkeys(declared(stmts)) if not n.startswith("_")]}
    src = (f'"""{o.get("name") or f.get("title") or f.get("id")} — translated from the six-node (Math Engine) object by pyobject.spine2py.\n'
           f'build(params, host=None): host = the host element\'s points in anchor-relative metres (node: [[0, 0]]).\n'
           f'Output is already in the object\'s own placement (the Math Engine handled its own rotation param)."""\n'
           "import math\n" + RUNTIME + "\n\nimport json as _json\nSPEC = _json.loads(" + repr(json.dumps(spec, ensure_ascii=False)) + ")\n\n"
           "_ALIASES.update(_json.loads(" + repr(json.dumps(ALIASES)) + "))\n\n" + "\n".join(alg_src) + "\n"
           "def _run(sc, out, _steps):\n" + "\n".join(lines or ["    pass"]) + "\n\n" + BUILD)
    ptypes = {"select": "select", "checkbox": "checkbox", "color": "color", "text": "text"}
    params = []
    for p in props:
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or p["id"] == host: continue
        q = {"key": p["id"], "label": p.get("name") or p["id"], "kind": ptypes.get(p.get("type"), "number"),
             "default": p.get("value") if isinstance(p.get("value"), (int, float, str, bool)) else 0}
        for k in ("min", "max", "step"):
            if isinstance(p.get(k), (int, float)) and q["kind"] == "number": q[k] = p[k]
        if q["kind"] == "select":                          # {value, label} pairs, as the editor's spineParams gives them
            q["options"] = [{"value": x, "label": x} if isinstance(x, str) else {"value": str(x.get("value", "")), "label": str(x.get("label", x.get("value", "")))}
                            for x in (p.get("options") or [])]
        if p.get("showInCanvas") is True: q["showInCanvas"] = True
        if p.get("necessary") is False: q["necessary"] = False
        params.append(q)
    return {"kind": "parametric-object", "version": 2,
            "meta": {"id": f.get("id") or raw.get("id"), "name": o.get("name") or f.get("title"), "category": f.get("category") or raw.get("category") or "",
                     "units": o.get("units") if isinstance(o.get("units"), str) else "m", "source": "spine2py (six-node Math Engine object)",
                     **({"symbol": o["symbol"]} if o.get("symbol") in SYMBOLS else {}),
                     **({"icon": {"paths": [d for d in o["icon"]["paths"] if isinstance(d, str) and d]}}
                        if isinstance(o.get("icon"), dict) and isinstance(o["icon"].get("paths"), list) else {})},
            "hostKind": o.get("hostKind"), "description": f.get("description") or raw.get("description") or "",
            "functions": ["build"], "parameters": params,
            "python": {"runtime": "pyodide", "entry": "build", "rotates": "self", "source": src}}


BUILD = '''def build(params, host=None):
    sc = {"PI": math.pi}
    for p in SPEC["props"]:
        sc[p["id"]] = _lift(params[p["id"]] if p["id"] in params else p["value"])
    if SPEC["host"]:
        pts = host if host is not None else ([[0, 0]] if SPEC["hostKind"] == "node" else None)
        if pts: sc[SPEC["host"]] = [[round(q[0] * 1e4) / 1e4, round(q[1] * 1e4) / 1e4] for q in pts]
    out = {n: 0 for n in SPEC["declared"]}
    _run(sc, out, [0])
    plan, colors, meshes, stats = [], [], [], {}
    for r in SPEC["rows2"]:
        v = out.get(r["var"]) if r["var"] else None
        if not _isM(v): continue
        rings = []
        if r["kind"] == "stroke":
            for s in v:
                if len(s) < 4: continue
                w = max(0.001, s[4] if len(s) >= 5 else r["width"]); dx, dy = s[2] - s[0], s[3] - s[1]; L = math.hypot(dx, dy)
                if L < 1e-9: continue
                nx, ny = -dy / L * w / 2, dx / L * w / 2
                rings.append([[s[0] + nx, s[1] + ny], [s[2] + nx, s[3] + ny], [s[2] - nx, s[3] - ny], [s[0] - nx, s[1] - ny]])
        elif r["kind"] == "circle":
            for c in v:
                if len(c) < 2: continue
                rr = max(0.001, c[2] if len(c) >= 3 else r["radius"])
                rings.append([[c[0] + rr * math.cos(2 * math.pi * k / 48), c[1] + rr * math.sin(2 * math.pi * k / 48)] for k in range(48)])
        else:
            rings = _rings(v)
        for g in rings:
            if len(g) >= 3: plan.append(g); colors.append(r["color"])
    for r in SPEC["rows3"]:
        v = out.get(r["var"]) if r["var"] else None
        if not _isM(v): continue
        if r["kind"] == "loft": faces = _loft_faces(_faces_from_matrix(v))
        elif r["kind"] in ("tube", "ring"):
            faces = []
            for s in v:
                if len(s) < 6: continue
                a, b = [s[0], s[1], s[2]], [s[3], s[4], s[5]]
                faces += _tube_faces(a, b, s[6] if len(s) >= 7 else r["radius"]) if r["kind"] == "tube" else \\
                         _ring_faces(a, b, s[6] if len(s) >= 7 else r["radius"], s[7] if len(s) >= 8 else r["tube"])
        else: faces = _faces_from_matrix(v)
        if faces: meshes.append(_tris(faces, r["color"], r["name"], r["material"]))
    for s in SPEC["slots"]:
        v = out.get(s["var"]) if s["var"] else None
        if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v): stats[s["label"] or s["var"]] = v
    return {"meshes": meshes, "plan": plan, "planColors": colors, "stats": stats}
'''


def main(argv):
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    if argv and argv[0] == "--all":
        src, dst = argv[1], argv[2]; os.makedirs(dst, exist_ok=True); rep = {"converted": [], "refused": {}}
        for dp, _, fs in os.walk(src):
            for fn in sorted(fs):
                if not fn.endswith(".json"): continue
                p = os.path.join(dp, fn)
                try: raw = json.load(open(p, encoding="utf-8"))
                except ValueError: continue
                if not isinstance(raw, dict) or not spine_of(raw): continue
                rel = os.path.relpath(p, src).replace(os.sep, "/")
                try:
                    obj = convert(raw)
                    o = os.path.join(dst, rel); os.makedirs(os.path.dirname(o), exist_ok=True)
                    json.dump(obj, open(o, "w", encoding="utf-8", newline="\n"), ensure_ascii=False)
                    rep["converted"].append(rel)
                except Refuse as e: rep["refused"][rel] = str(e)
        json.dump(rep, open(os.path.join(dst, "report.json"), "w", encoding="utf-8"), indent=1)
        print(f"converted {len(rep['converted'])}, refused {len(rep['refused'])} → {dst}")
        for k, v in sorted(rep["refused"].items()): print(f"  refused {k}: {v}")
        return 0
    obj = convert(json.load(open(argv[0], encoding="utf-8")))
    json.dump(obj, open(argv[1], "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=1); print(f"→ {argv[1]}"); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
