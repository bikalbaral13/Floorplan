"""Layered parameters with provenance and locks.

Layer order (lowest first) — later layers override earlier ones:
  object     defaults of the objects the typology uses (objects/<ID>/object.json)
  typology   the typology's own defaults
  standards  the project's standards set (standards/<SET>.json), object parameters mapped to typology keys
  site       plot dimensions from site.json
  rules      confirmed rules clamp values that came from the layers above (typology.json rule_params)
  project    projects/<CODE>/params.json
  parcel     parcels/<P>/params.json
  option     work/options/<ID>.json (scope folder)
  selection  work/selection.json params (P5)

A layer value is either plain or {"value": v, "lock": true, "unlock": "<reason>", "note": "..."}.
A locked key can only be changed by a later layer entry that carries "unlock" with the user's reason.
"""

def _norm(v):
    if isinstance(v, dict) and "value" in v:
        return v["value"], bool(v.get("lock")), v.get("unlock"), v.get("note", "")
    return v, False, None, ""

def object_layer(T):
    return {k: s["default"] for k, s in T.schema["parameters"].items() if s.get("_default_from", "").startswith("object:")}

def typology_layer(T):
    return {k: s["default"] for k, s in T.schema["parameters"].items() if s.get("_default_from") == "typology"}

def standards_layer(T, std):
    out = {}
    for (oid, okey), keys in T.object_param_map().items():
        if okey in std.get(oid, {}):
            for k in keys: out[k] = std[oid][okey]
    return out

def site_layer(T, site):
    m = T.schema.get("site_params", {"plot_width_ft": "width_ft", "plot_west_ft": "west_ft", "plot_east_ft": "east_ft"})
    return {k: site[v] for k, v in m.items() if k in T.schema["parameters"] and v in site}

def resolve(T, layers, rules=None, rules_files=None):
    """layers: [(name, source, dict[, file refs])]; 'rules' is applied after 'site'. Returns dict with
    params, provenance, locks, errors, notes, assumed, manifest (core/trace.py; files not yet hashed)."""
    from .typology import resolve as check
    spec = T.schema["parameters"]; vals, prov, locks, errs, notes = {}, {}, {}, [], []
    def apply_rules():
        for key, lim in T.schema.get("rule_params", {}).items():
            if key not in vals or not rules: continue
            for kind, rk in lim.items():
                rv = rules.get(rk)
                if rv is None: continue
                bad = (kind == "min" and vals[key] < rv - 1e-9) or (kind == "max" and vals[key] > rv + 1e-9)
                if bad and key not in locks:
                    notes.append(f"{key}: {vals[key]} -> {rv} ({kind} from rules.{rk})")
                    vals[key] = rv; prov[key] = {"value": rv, "layer": "rules", "source": f"rules.json {rk}"}
    layers = [tuple(l) + (None,) * (4 - len(l)) for l in layers]
    for name, src, data, _files in layers:
        for k, raw in (data or {}).items():
            if k.startswith("_"): continue
            if k not in spec: errs.append(f"{name}: unknown parameter {k!r} ({src})"); continue
            v, lock, unlock, note = _norm(raw)
            if k in locks and v != vals.get(k):
                if not unlock:
                    errs.append(f"{name}: {k} is locked by {locks[k]} at {vals[k]!r}; add \"unlock\": \"<user's reason>\" to change it ({src})"); continue
                notes.append(f"{k} unlocked by {name}: {unlock}"); locks.pop(k)
            vals[k] = v; prov[k] = {"value": v, "layer": name, "source": src, **({"note": note} if note else {})}
            if lock: locks[k] = name
        if name == "site": apply_rules()
    if not any(l[0] == "site" for l in layers): apply_rules()
    params, e2, assumed = check(T.schema, vals)
    for k in assumed: prov.setdefault(k, {"value": params.get(k), "layer": "schema", "source": "schema default"})
    manifest = []
    for name, src, data, files in layers:
        sup = sorted(k for k in (data or {}) if not k.startswith("_"))
        manifest.append({"layer": name, "source": src, "files": list(files or []), "supplied": sup,
                         "survived": sorted(k for k, v in prov.items() if v["layer"] == name)})
        if name == "site" and rules is not None:
            manifest.append({"layer": "rules", "source": "rules.json", "files": list(rules_files or []),
                             "supplied": sorted(k for k in T.schema.get("rule_params", {}) if any(rules.get(rk) is not None for rk in T.schema["rule_params"][k].values())),
                             "survived": sorted(k for k, v in prov.items() if v["layer"] == "rules")})
    return {"params": params, "provenance": prov, "locks": locks, "errors": errs + e2, "notes": notes, "assumed": assumed, "manifest": manifest}
