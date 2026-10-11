"""Firm standards sets (library/Standards/<SET>.json, schema standards/1).

One file per set holds both kinds of firm knowledge:
  conventions  walls, levels, openings, stairs … (metres) — used when a source is silent, tagged src=convention
  objects      object preferences by object id (program objects: DOOR_HINGED.width_ft …)
A set may `extends` another; keys merge deeply, child wins. Pipelines keep a byte-identical copy of the sets they
use in <pipeline>/standards/ (selftests compare it with the library master)."""
import json, os

def _merge(base, child):
    out = dict(base)
    for k, v in child.items():
        out[k] = _merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out

def chain(std_dir, name="DEFAULT"):
    """Set names, base first."""
    p = os.path.join(std_dir, f"{name}.json")
    if not os.path.exists(p): raise KeyError(f"standards set {name} not found in {std_dir}")
    s = json.load(open(p, encoding="utf-8"))
    return (chain(std_dir, s["extends"]) if s.get("extends") else []) + [name]

def load(std_dir, name="DEFAULT"):
    """The set with its extends chain merged (meta keys id/version/about from the named set)."""
    out = {}
    for n in chain(std_dir, name):
        out = _merge(out, json.load(open(os.path.join(std_dir, f"{n}.json"), encoding="utf-8")))
    out["_chain"] = chain(std_dir, name)
    return out

def objects(std_dir, name="DEFAULT"):
    """{object id: {param: value}} — the object preferences of a set, without note keys (_src …)."""
    o = load(std_dir, name).get("objects", {})
    return {k: {p: v for p, v in vals.items() if not p.startswith("_")} for k, vals in o.items() if not k.startswith("_") and isinstance(vals, dict)}

def files(std_dir, name="DEFAULT"):
    return [f"{n}.json" for n in chain(std_dir, name)]
