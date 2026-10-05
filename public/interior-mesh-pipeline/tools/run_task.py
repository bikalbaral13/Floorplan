"""Task runner (inside Blender). Picks the next runnable task of a project and executes it.

    from tools.run_task import run_next, run_task
    run_next("RMD_FF", agent="claude-blender-1")     # one task
"""
import glob, json, os, traceback
from tools._boot import boot
ROOT = boot()
import bpy
from core import tasks as T, report, params as P, paths

def _item_json(project_dir, code):
    hits = glob.glob(os.path.join(project_dir, "items", f"{code}_*", "item.json"))
    return hits[0] if hits else None

def verify_family(name):
    from tools.run_item import load_family_module
    from core import finish, checks, place
    schema = P.load_family(name); p, _ = P.resolve(schema, schema.get("test_values", {}))
    if schema.get("host") == "room":
        p["room"] = [0, 0, 3000, 3000]
    coll = place.collection_path("_family_tests")
    root = load_family_module(name).build(p, f"_test_{name}", coll)
    finish.finish_asset(root); st = checks.asset_stats(root)
    for o in list(root.children_recursive) + [root]: bpy.data.objects.remove(o, do_unlink=True)
    return st

def _mark_tested(name, st):
    """After a successful verify: family status implemented -> tested (family.json + REGISTRY.json)."""
    fj = os.path.join(ROOT, "families", name, "family.json"); spec = json.load(open(fj, encoding="utf-8"))
    if spec["status"] == "implemented":
        spec["status"] = "tested"; json.dump(spec, open(fj, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    rp = os.path.join(ROOT, "families", "REGISTRY.json"); reg = json.load(open(rp))
    reg.setdefault(name, {}).update(status=spec["status"], version=spec["version"], last_verify=f"{st['tris']} tris / {st['non_manifold_edges']} open edges")
    json.dump(reg, open(rp, "w"), indent=1)

def run_task(project, row, agent="agent"):
    pdir = paths.project_dir(project); tid = row["task_id"]
    T.set_status(pdir, tid, "doing", agent=agent)
    try:
        if row["type"] == "selftest":
            from tools.selftest import run
            r = run(); T.set_status(pdir, tid, "done" if r["ok"] else "blocked", notes=json.dumps(r)); return r
        if row["type"] in ("family_verify", "family_implement"):
            try:
                st = verify_family(row["family"])
            except NotImplementedError as e:
                T.set_status(pdir, tid, "todo", notes="family not implemented yet — agent must write families/%s/build.py per family.json" % row["family"])
                return {"action_required": f"Implement families/{row['family']}/build.py (see family.json recipe), bump version, set status 'implemented' in REGISTRY.json, then rerun this task."}
            _mark_tested(row["family"], st)
            T.set_status(pdir, tid, "done", notes=f"verified: {st['tris']} tris, {st['non_manifold_edges']} open edges"); return st
        if row["type"] == "item_build":
            from tools.run_item import run_item
            j = _item_json(pdir, row["target"]); r = run_item(j)
            status = "done" if r["status"].startswith("ok") else "blocked"
            T.set_status(pdir, tid, status, output=r.get("output", ""), notes=r["status"]); return r
        if row["type"] == "qc_space":
            from core import checks
            coll = bpy.data.collections.get(row["target"])
            objs = list(coll.all_objects) if coll else []
            roots = [o for o in objs if o.parent is None]
            hits = []
            for i, a in enumerate(roots):
                mine = [a] + list(a.children_recursive)
                others = [o for b in roots[i + 1:] for o in [b] + list(b.children_recursive)]
                hits += checks.overlaps(mine, others)
            report.log(pdir, f"QC {row['target']}: {len(roots)} assets, {len(hits)} overlaps" + (": " + "; ".join(hits[:20]) if hits else ""))
            T.set_status(pdir, tid, "done", notes=f"{len(hits)} overlaps"); return {"overlaps": hits}
        if row["type"] == "export":
            proj = json.load(open(os.path.join(pdir, "project.json")))
            out = os.path.join(pdir, "output", "fbx", f"{project}_meshes.fbx"); os.makedirs(os.path.dirname(out), exist_ok=True)
            coll = bpy.data.collections.get(proj["collection_root"])
            for o in bpy.context.scene.objects: o.select_set(False)
            for o in coll.all_objects: o.select_set(True)
            bpy.ops.export_scene.fbx(filepath=out, use_selection=True, object_types={"MESH", "EMPTY"}, apply_scale_options="FBX_SCALE_UNITS",
                                     axis_forward="-Y", axis_up="Z", mesh_smooth_type="FACE", use_mesh_modifiers=False, add_leaf_bones=False, bake_anim=False)
            T.set_status(pdir, tid, "done", output=out); return {"fbx": out}
        if row["type"] == "report":
            rows = T.load(pdir); report.log(pdir, "SUMMARY " + json.dumps(T.summary(rows)))
            T.set_status(pdir, tid, "done"); return T.summary(rows)
        raise ValueError(f"unknown task type {row['type']}")
    except Exception as e:
        T.set_status(pdir, tid, "blocked", notes=str(e)[:300]); report.log(pdir, f"{tid} blocked: {e}")
        return {"error": traceback.format_exc()}

def run_next(project, agent="agent"):
    rows = T.load(paths.project_dir(project)); row = T.next_runnable(rows)
    if row is None:
        return {"message": "no runnable task (all done, or waiting on blocked tasks)", "summary": T.summary(rows)}
    return {"task": row["task_id"], "result": run_task(project, row, agent)}
