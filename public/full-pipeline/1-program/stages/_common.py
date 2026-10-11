"""Helpers shared by stage run.py files."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, params as prm, trace, objects
from core.stage import F

def confirmed(ctx, name):
    if not ctx.shas(name): return None, f"{ctx.rel(ctx.s(name))} missing — run its stage first"
    d = ctx.sload(name)
    if d.get("status") != "confirmed": return None, f"{ctx.rel(ctx.s(name))} is not confirmed by the user yet"
    return d, None

def site(ctx):
    return ctx.sload("site.json") if ctx.shas("site.json") else None

def layers(ctx, T, site_d, option=None, selection=None):
    """Parameter layers in order (see core/params.py)."""
    R = lambda p: trace.ref("root", Path(p).resolve().relative_to(paths.ROOT.resolve()))
    P = lambda p: trace.ref("project", ctx.rel(p))
    std = ctx.project.get("standards", "DEFAULT")
    L = [("object", ", ".join(f"{o.id}@{o.version}" for o in T.objects.values()) or "objects/", prm.object_layer(T),
          [R(objects.obj_dir(o.id, o.version) / f) for o in T.objects.values() for f in ("object.json", "object.py")]),
         ("typology", " -> ".join(T.lineage), prm.typology_layer(T), [R(d / f) for d in T.dirs for f in ("typology.json", "generator.py") if (d / f).exists()]),
         ("standards", f"standards/{std}.json", prm.standards_layer(T, ctx.standards()), [trace.ref("root", f) for f in objects.standards_files(std)]),
         ("site", ctx.rel(ctx.s("site.json")), prm.site_layer(T, site_d), [P(ctx.s("site.json"))])]
    if ctx.has("params.json"): L.append(("project", "params.json", ctx.load("params.json"), [P(ctx.p("params.json"))]))
    if ctx.scope != "PROJECT" and ctx.shas("params.json"): L.append(("parcel", ctx.rel(ctx.s("params.json")), ctx.sload("params.json"), [P(ctx.s("params.json"))]))
    if option and ctx.shas("work", "options", f"{option}.json"):
        f = ctx.s("work", "options", f"{option}.json"); L.append(("option", ctx.rel(f), paths.load_json(f), [P(f)]))
    if selection is not None: L.append(("selection", ctx.rel(ctx.s("work", "selection.json")), selection, [P(ctx.s("work", "selection.json"))]))
    return L

def resolved(ctx, T, site_d, rules, option, selection=None):
    L = layers(ctx, T, site_d, option, selection)
    opt_layer = ("brief", ctx.rel(ctx.s("brief.json")) + " options", {"option": option}, [trace.ref("project", ctx.rel(ctx.s("brief.json")))])
    r = prm.resolve(T, L[:4] + [opt_layer] + L[4:], rules, [trace.ref("project", ctx.rel(ctx.s("rules.json")))])
    trace.stamp(ctx.pdir, r["manifest"])
    return r

def site_matches(site_d, params, T=None, tol=0.01):
    """Values the typology takes from site.json (typology.json site_params) still equal site.json."""
    m = (T.schema.get("site_params") if T else None) or {"plot_width_ft": "width_ft", "plot_west_ft": "west_ft", "plot_east_ft": "east_ft"}
    for tk, sk in m.items():
        if tk not in params or sk not in site_d: continue
        a, b = site_d[sk], params[tk]
        if (abs(a - b) > tol) if isinstance(a, (int, float)) and isinstance(b, (int, float)) else (a != b): return False
    return True

def accepted_keys(sel):
    return {(a.get("check"), a.get("ref")): a.get("reason", "") for a in (sel or {}).get("accepted", [])}

def params_md(r):
    rows = ["| Parameter | Value | Layer | Source |", "|---|---|---|---|"]
    for k, v in r["params"].items():
        pv = r["provenance"].get(k, {}); lock = " (locked)" if k in r["locks"] else ""
        rows.append(f"| {k} | {v} | {pv.get('layer', '')}{lock} | {pv.get('source', '')} |")
    rows += ["", "## Layers read", "", "| Layer | Source | Supplied | Survived | Files (sha256) |", "|---|---|---|---|---|"]
    for m in r.get("manifest", []):
        files = "<br>".join(f"{f['path']} ({(f.get('sha256') or 'missing')[:12]})" for f in m["files"])
        rows.append(f"| {m['layer']} | {m['source']} | {len(m['supplied'])} | {len(m['survived'])}{' (all overridden)' if m['supplied'] and not m['survived'] else ''} | {files} |")
    return "\n".join(rows + ([""] + [f"- {n}" for n in r["notes"]] if r["notes"] else []))

def scopes(ctx):
    """[(scope Ctx, parcel.json or None)] — the project itself, or each parcel north to south."""
    from core.stage import Ctx
    if not ctx.project.get("parcels"):
        return [(ctx, None)]
    out = []
    for pj in sorted(ctx.p("parcels").glob("*/parcel.json")):
        d = paths.load_json(pj); out.append((Ctx(ctx.code, {"scope": d["code"], "stage": ctx.task.get("stage")}), d))
    return sorted(out, key=lambda t: t[1]["y_offset_ft"])
