"""Build + place + check + report one item from its item.json. Run inside Blender.

    from tools.run_item import run_item
    run_item(r"<project>/items/<CODE>_<slug>/item.json")
"""
import importlib.util, json, os, sys, traceback
from tools._boot import boot
ROOT = boot()
import bpy
from core import params as P, geom, finish, place, checks, report, tasks

def load_family_module(name):
    path = os.path.join(ROOT, "families", name, "build.py")
    spec = importlib.util.spec_from_file_location(f"family_{name}", path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

def _remove_previous(code, prefix):
    pref = f"{prefix}{code.replace('-', '_')}_"
    for ob in [o for o in bpy.data.objects if o.name.startswith(pref) and o.parent is None]:
        for x in list(ob.children_recursive) + [ob]:
            bpy.data.objects.remove(x, do_unlink=True)

def run_item(item_json, check_overlaps=True, rebuild=True):
    item_dir = os.path.dirname(os.path.abspath(item_json))
    it = json.load(open(item_json, encoding="utf-8"))
    project_dir = os.path.dirname(os.path.dirname(item_dir))
    proj = json.load(open(os.path.join(project_dir, "project.json"), encoding="utf-8"))
    res = dict(code=it["code"], family=it["family"], status="failed", errors=[], flags=[], overlaps=[], assumed=[], instances=0)
    try:
        schema = P.load_family(it["family"]); res["family_version"] = schema["version"]
        values = dict(it["params"], L=it["size"]["L"], W=it["size"]["W"], H=it["size"]["H"])
        if it["host"] == "room":
            values["room"] = it["room"]
        p, res["assumed"] = P.resolve(schema, values)
        fam = load_family_module(it["family"])
        coll = place.collection_path(proj["collection_root"], f"{proj['collection_prefix']}{it['space_code']}")
        prefix = proj.get("name_prefix", "SM_")
        if rebuild:
            _remove_previous(it["code"], prefix)
        root = fam.build(p, f"{prefix}{it['code'].replace('-', '_')}_01", coll)
        finish.finish_asset(root)
        st = checks.asset_stats(root); res["tris"], res["non_manifold_edges"] = st["tris"], st["non_manifold_edges"]
        if it["host"] == "room":
            placed, flags = [(root, False)], []
        else:
            placed, flags = place.place_instances(root, it["code"], it["placements"], proj["ffl_mm"], it["rot_z"], coll, prefix)
        res["flags"] += flags
        for ob, needs_snap in placed:
            if needs_snap and not checks.snap_to_host(ob):
                res["flags"].append(f"{ob.name}: no host surface found below — left at FFL")
        res["instances"] = len(placed)
        if check_overlaps:
            mine = [o for ob, _ in placed for o in [ob] + list(ob.children_recursive)]
            others = [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in mine]
            res["overlaps"] = checks.overlaps(mine, others)[:50]
        if res["tris"] > it.get("tri_budget", 60000):
            res["flags"].append(f"triangles {res['tris']} over budget {it.get('tri_budget')}")
        res["status"] = "ok" if not res["non_manifold_edges"] or it.get("open_mesh_ok") else "ok_with_open_edges"
        res["output"] = f"{proj['collection_root']} › {proj['collection_prefix']}{it['space_code']} › {prefix}{it['code'].replace('-', '_')}_NN"
    except NotImplementedError as e:
        res["status"] = "blocked_family_not_implemented"; res["errors"].append(str(e))
    except Exception as e:
        res["errors"].append("".join(traceback.format_exception_only(type(e), e)).strip())
        res["errors"].append(traceback.format_exc().splitlines()[-3] if traceback.format_exc() else "")
    report.write_item_report(item_dir, res)
    it["status"] = res["status"]; json.dump(it, open(item_json, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    report.log(project_dir, f"{it['code']} {res['status']} ({res.get('tris', '—')} tris, {res['instances']} inst, {len(res['overlaps'])} overlaps)")
    return res
