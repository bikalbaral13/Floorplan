"""Family parameter schemas (family.json) and validation. Pure Python."""
import json, os
from . import paths

def load_family(name):
    with open(os.path.join(paths.family_dir(name), "family.json"), encoding="utf-8") as f:
        return json.load(f)

def resolve(schema, values):
    """Defaults from schema['parameters'] overlaid with values; every value checked
    against min / max / options. Unknown keys are an error (add them to the schema).
    Returns (params, assumed_keys)."""
    decl = schema["parameters"]
    unknown = sorted(set(values) - set(decl))
    if unknown:
        raise ValueError(f"{schema['family']}: unknown parameter(s) {unknown} — add them to family.json")
    p = {k: d.get("value") for k, d in decl.items()}
    p.update(values)
    errs = []
    for k, d in decl.items():
        v = p[k]
        if "options" in d and v not in d["options"]:
            errs.append(f"{k}={v!r} not in {d['options']}")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if "min" in d and v < d["min"]:
                errs.append(f"{k}={v} < min {d['min']}")
            if "max" in d and v > d["max"]:
                errs.append(f"{k}={v} > max {d['max']}")
    if errs:
        raise ValueError(f"{schema['family']}: parameter check failed:\n  - " + "\n  - ".join(errs))
    assumed = [k for k in decl if k not in values]
    return p, assumed
