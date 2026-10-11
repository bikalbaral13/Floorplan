"""Typologies: versioned, extendable program generators.

typologies/<ID>/                     current version
typologies/<ID>/versions/<x.y.z>/    frozen older versions (still loadable for pinned projects)
projects/<CODE>/typology/            project-local variant: typology.json with "extends": "<ID>@<ver>"

typology.json may also say "extends" (a registered typology built on another). Loading merges the
schema (parameters, options, objects, rule/brief defaults, stages) and overlays the generator:
the child's generator.py gets `base` (the parent's generator) injected and may define any of
FUNCTIONS; missing ones fall back to the parent.
"""
import copy, importlib.util, inspect
from pathlib import Path
from types import SimpleNamespace
from . import paths, objects

FUNCTIONS = ["generate", "render_svg", "to_plan_trace", "qc", "migrate"]
SHARED_PLAN = ["P1_SITE", "P2_BRIEF", "P3_RULES", "P4_OPTIONS", "P5_SELECT", "P6_HANDOFF", "P7_QC"]

def registry():
    return paths.load_json(paths.ROOT / "typologies" / "REGISTRY.json")

def split_ref(ref):
    tid, _, ver = str(ref).partition("@")
    return tid, (ver or None)

def typ_dir(tid, version=None):
    cur = paths.typology_dir(tid)
    if not (cur / "typology.json").exists(): raise KeyError(f"typology {tid} not in typologies/")
    if version is None or paths.load_json(cur / "typology.json")["version"] == version:
        return cur
    d = cur / "versions" / version
    if not d.exists():
        raise KeyError(f"typology {tid}@{version} not found (current {paths.load_json(cur / 'typology.json')['version']}; keep old versions in versions/)")
    return d

def _merge(base, child):
    out = copy.deepcopy(base)
    for k, v in child.items():
        if k in ("parameters", "options", "objects", "rule_defaults", "brief_defaults", "applicability", "rule_params") and isinstance(v, dict):
            out.setdefault(k, {})
            for kk, vv in v.items():
                if vv is None: out[k].pop(kk, None)               # null removes an inherited entry
                elif isinstance(vv, dict) and isinstance(out[k].get(kk), dict) and k == "parameters": out[k][kk] = {**out[k][kk], **vv}
                else: out[k][kk] = copy.deepcopy(vv)
        else:
            out[k] = copy.deepcopy(v)
    return out

def _load_module(d, name, base=None):
    f = d / "generator.py"
    if not f.exists(): return None
    spec = importlib.util.spec_from_file_location(name, f)
    m = importlib.util.module_from_spec(spec)
    if base is not None: m.base = base
    spec.loader.exec_module(m)
    return m

class Typology:
    """Resolved typology: .id .version .dirs (child first) .schema .gen .objects .lineage"""
    def __init__(self, schema, dirs, gen, lineage):
        self.schema, self.dirs, self.lineage = schema, dirs, lineage
        self.id, self.version = schema["id"], schema["version"]
        self.objects = {}
        for slot, cfg in schema.get("objects", {}).items():
            self.objects[slot] = SimpleNamespace(id=cfg["object"], version=cfg["version"], cfg=cfg,
                                                 schema=objects.load_schema(cfg["object"], cfg["version"]),
                                                 mod=objects.load_module(cfg["object"], cfg["version"]))
        self._fill_from_objects()
        self.gen = gen
    @property
    def ref(self): return f"{self.id}@{self.version}"
    @property
    def plan(self): return self.schema.get("stages", SHARED_PLAN)
    def has(self, fn): return callable(getattr(self.gen, fn, None))
    def call(self, fn, *a):
        f = getattr(self.gen, fn)
        n = len(inspect.signature(f).parameters)
        return f(*a, self) if n > len(a) else f(*a)
    def _fill_from_objects(self):
        for k, s in self.schema["parameters"].items():
            src = s.get("from_object")
            if not src: s.setdefault("_default_from", "typology"); continue
            slot, okey = src.split(".", 1)
            o = self.objects[slot]; base = dict(o.schema["parameters"][okey])
            own_default = "default" in s
            merged = {**base, **{kk: vv for kk, vv in s.items()}}
            merged["_default_from"] = "typology" if own_default else f"object:{o.id}@{o.version}"
            self.schema["parameters"][k] = merged
    def stage_dir(self, sid):
        """'+P5b_X' -> the typology-owned stage folder (child variants first)."""
        name = sid.lstrip("+")
        for d in self.dirs:
            if (d / "stages" / name / "run.py").exists(): return d / "stages" / name
        raise KeyError(f"stage {sid} not found in {self.ref} ({[str(d) for d in self.dirs]})")
    def object_param_map(self):
        """{(object id, object param): [typology keys]} incl. instance patterns like door{n}_pct."""
        out = {}
        for slot, o in self.objects.items():
            n = o.cfg.get("instances", 1)
            for okey, tkey in o.cfg.get("params", {}).items():
                keys = [tkey.format(n=i) for i in range(1, n + 1)] if "{n}" in tkey else [tkey]
                out.setdefault((o.id, okey), []).extend(keys)
        return out

def load(tid, version=None, variant_dir=None, _seen=None):
    """Load ID[@version], or a variant folder whose typology.json extends a registered typology."""
    _seen = _seen or set()
    if variant_dir:
        vd = Path(variant_dir); child = paths.load_json(vd / "typology.json")
        if not child.get("extends"): raise ValueError(f"{vd}/typology.json needs 'extends': '<ID>@<version>'")
        btid, bver = split_ref(child["extends"]); base = load(btid, bver, _seen=_seen)
        return _derive(base, child, vd, f"var_{child['id']}")
    d = typ_dir(tid, version)
    key = (tid, str(d))
    if key in _seen: raise ValueError(f"extends cycle at {tid}")
    _seen.add(key)
    sch = paths.load_json(d / "typology.json")
    if sch.get("extends"):
        btid, bver = split_ref(sch["extends"]); base = load(btid, bver, _seen=_seen)
        return _derive(base, sch, d, f"typ_{tid}_{sch['version']}")
    mod = _load_module(d, f"typ_{tid}_{sch['version'].replace('.', '_')}")
    gen = SimpleNamespace(**{fn: getattr(mod, fn) for fn in FUNCTIONS if hasattr(mod, fn)}, module=mod)
    return Typology(sch, [d], gen, [f"{sch['id']}@{sch['version']}"])

def _derive(base, child, d, modname):
    sch = _merge({k: v for k, v in base.schema.items()}, {k: v for k, v in child.items() if k != "extends"})
    sch["extends"] = child["extends"]
    for k, s in sch["parameters"].items():       # re-derive inherited object defaults in the child
        s.pop("_default_from", None)
    mod = _load_module(d, modname, base=base.gen)
    gen = SimpleNamespace(**{fn: getattr(mod, fn, None) or getattr(base.gen, fn, None) for fn in FUNCTIONS}, module=mod)
    gen = SimpleNamespace(**{k: v for k, v in vars(gen).items() if v is not None})
    return Typology(sch, [d] + base.dirs, gen, [f"{sch['id']}@{sch['version']}"] + base.lineage)

def for_pin(pdir, pin):
    """pin = {"typology": ID, "typology_version": v, "variant": "typology" (folder under the project) or ""}."""
    if pin.get("variant"):
        return load(None, variant_dir=Path(pdir) / pin["variant"])
    return load(pin["typology"], pin.get("typology_version") or None)

def resolve(schema, values):
    """Range / option check of a complete value set. Returns (params, errors, assumed_keys)."""
    spec = schema["parameters"]; out, errs, assumed = {}, [], []
    for k in values:
        if k not in spec: errs.append(f"unknown parameter {k!r}")
    for k, s in spec.items():
        v = values[k] if values.get(k) is not None else s.get("default")
        if k not in values: assumed.append(k)
        if s["type"] == "number":
            try: v = float(v)
            except (TypeError, ValueError): errs.append(f"{k}: {v!r} is not a number"); continue
            if "min" in s and v < s["min"] - 1e-9: errs.append(f"{k}: {v} below min {s['min']}")
            if "max" in s and v > s["max"] + 1e-9: errs.append(f"{k}: {v} above max {s['max']}")
        elif s["type"] == "choice" and v not in s["options"]:
            errs.append(f"{k}: {v!r} not in {s['options']}")
        out[k] = v
    return out, errs, assumed

def applicability(T, site, brief=None):
    """Fit of a typology to a site / brief -> list of (ok, text)."""
    a = T.schema.get("applicability", {}); out = []
    if site:
        w, dpt = site["width_ft"], site["depth_ft"]
        if "plot_width_ft" in a: out.append((a["plot_width_ft"][0] <= w <= a["plot_width_ft"][1], f"plot width {w:g}' in {a['plot_width_ft']}"))
        if "plot_depth_ft" in a: out.append((a["plot_depth_ft"][0] <= dpt <= a["plot_depth_ft"][1], f"plot depth {dpt:g}' in {a['plot_depth_ft']}"))
        rs = T.schema.get("road_sides_supported")
        if rs: out.append((site.get("road_side") in rs, f"road side {site.get('road_side')} in {rs}"))
    if brief:
        if brief.get("unit_count") and "unit_count" in T.schema: out.append((brief["unit_count"] == T.schema["unit_count"], f"{T.schema['unit_count']} units (brief {brief['unit_count']})"))
        if brief.get("facing_allowed") and T.schema.get("facings"):
            ok = bool(set(brief["facing_allowed"]) & set(T.schema["facings"])); out.append((ok, f"facings {T.schema['facings']} vs brief {brief['facing_allowed']}"))
    return out
