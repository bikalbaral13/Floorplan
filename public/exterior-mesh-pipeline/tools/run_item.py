"""Build + finish + UV + check + report one item (item.json) or a family's test values. Run inside Blender.

    from tools.run_item import run_item, verify_family
    run_item(r"<project>/items/<CODE>/item.json")
    verify_family("BUILDING")

Unique items (roads, walls, terrain …) are built in  EXT › <group>  at their world coordinates.
Prototype items (item.json → proto) are built at the origin in  PROTOTYPES › <proto>  (excluded
from the view layer) and placed later by instance tasks (tools/run_task.py, type instance_place).
"""
import importlib.util, json, os, traceback
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))   # runnable as a script too
from tools._boot import boot
ROOT = boot()
import bpy
from core import params as P, finish, uv, place, checks, report

def load_family_module(name):
    spec = importlib.util.spec_from_file_location(f"family_{name}", os.path.join(ROOT, "families", name, "build.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

def _remove(name):
    ob = bpy.data.objects.get(name)
    if ob is not None:
        for x in list(ob.children_recursive) + [ob]: bpy.data.objects.remove(x, do_unlink=True)

def build_one(family, values, geometry, name, coll, lightmap=True, base_z=None):
    schema = P.load_family(family)
    p, assumed = P.resolve(schema, values)
    fam = load_family_module(family)
    _remove(name)
    root = fam.build(p, geometry, name, coll)
    if base_z is not None: root.location.z = base_z
    finish.finish_tree(root)
    n_uv = uv.lightmap_tree(root) if lightmap else 0
    st = checks.tree_stats(root); uvr = checks.uv_tree(root) if lightmap else {"bad": [], "meshes": 0}
    budget = schema.get("tri_budget")
    if isinstance(budget, dict): budget = budget.get(str(p.get("lod", "")), max(budget.values()))
    return root, dict(family=family, family_version=schema["version"], assumed=assumed, tris=st["tris"], objects=st["objects"],
                      non_manifold_edges=st["non_manifold_edges"], uv0="real-world (1 u = 1 m)", uv1=f"{n_uv} meshes, {len(uvr['bad'])} bad",
                      uv1_bad=uvr["bad"], tri_budget=budget)

def run_item(item_json, lightmap=True):
    item_dir = os.path.dirname(os.path.abspath(item_json))
    it = json.load(open(item_json, encoding="utf-8"))
    project_dir = os.path.dirname(os.path.dirname(item_dir))
    proj = json.load(open(os.path.join(project_dir, "project.json"), encoding="utf-8"))
    res = dict(code=it["code"], family=it["family"], status="failed", errors=[], flags=[], instances=0)
    try:
        prefix = proj.get("name_prefix", "SM_")
        if it.get("proto"):
            coll = place.prototype_collection(it["proto"]); place.clear_collection(coll)
            name = f"{prefix}{it['proto']}"; base_z = None
        else:
            coll = place.collection_path(proj["collection_root"], f"{proj['collection_root']}_{it['group']}")
            name = f"{prefix}{it['code'].replace('-', '_')}"; base_z = it["params"].get("base_z") if it["family"] == "BUILDING" else None
        geo = it["geometry"]
        if isinstance(geo, dict) and "$ref" in geo:
            geo = json.load(open(os.path.join(project_dir, geo["$ref"]), encoding="utf-8"))
        root, info = build_one(it["family"], it["params"], geo, name, coll, lightmap, base_z)
        res.update(info)
        if info["non_manifold_edges"]: res["flags"].append(f"{info['non_manifold_edges']} non-manifold edges on closed parts")
        if info["uv1_bad"]: res["flags"].append(f"UV1 issues: {info['uv1_bad'][:6]}")
        if info["tri_budget"] and info["tris"] > info["tri_budget"]: res["flags"].append(f"triangles {info['tris']} over budget {info['tri_budget']}")
        res["status"] = "ok" if not res["flags"] else "ok_with_flags"
        res["output"] = (f"PROTOTYPES › {it['proto']}" if it.get("proto") else f"{proj['collection_root']} › {proj['collection_root']}_{it['group']}") + f" › {name}"
    except Exception as e:
        res["errors"].append("".join(traceback.format_exception_only(type(e), e)).strip())
        res["errors"] += traceback.format_exc().splitlines()[-6:]
    report.write_item_report(item_dir, res)
    it["status"] = res["status"]; json.dump(it, open(item_json, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    report.log(project_dir, f"{it['code']} {res['status']} ({res.get('tris', '—')} tris, {res.get('objects', '—')} objects)")
    return res

def verify_family(family, lightmap=True):
    """Build the family's test_values (+ test_geometry) in  VERIFY › <family>, check, and report."""
    schema = P.load_family(family)
    coll = place.collection_path("VERIFY", f"VERIFY_{family}")
    place.clear_collection(coll)
    root, info = build_one(family, schema.get("test_values", {}), schema.get("test_geometry"), f"TEST_{family}", coll, lightmap)
    ok = not info["uv1_bad"] and (not info["tri_budget"] or info["tris"] <= info["tri_budget"]) and info["tris"] > 0
    return dict(info, status="tested" if ok else "failed", root=root.name)
