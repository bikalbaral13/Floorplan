"""Task runner (Blender). Executes TASKS.csv rows top-down by dependency.

    import sys; sys.path.insert(0, r"<pipeline root>")
    from tools.run_task import run_next, run_all
    print(run_next("RMD_EXT", agent="<name>"))      # one task
    print(run_all("RMD_EXT", agent="<name>"))       # until nothing is runnable

Headless:  blender -b --factory-startup --python tools/run_task.py -- RMD_EXT [--all] [--agent NAME]

State lives in projects/<CODE>/output/blend/<CODE>.blend: each task opens it (if this session is not
already on it) and saves it afterwards, so tasks can run in separate sessions or in one.
"""
import json, os, sys, traceback
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))   # runnable as a script too
from tools._boot import boot
ROOT = boot()
import bpy
from core import paths, tasks, report, place, checks, uv as UV

def _blend(code):
    return os.path.join(paths.output_dir(code, "blend"), f"{code}.blend")

def _open(code):
    f = _blend(code)
    if bpy.data.filepath and os.path.normcase(os.path.abspath(bpy.data.filepath)) == os.path.normcase(os.path.abspath(f)): return
    if os.path.exists(f): bpy.ops.wm.open_mainfile(filepath=f)
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.context.scene.unit_settings.system = "METRIC"; bpy.context.scene.unit_settings.scale_length = 1.0
        bpy.ops.wm.save_as_mainfile(filepath=f)

def _save(code):
    bpy.ops.wm.save_as_mainfile(filepath=_blend(code), compress=True)

def _registry_set(family, **kw):
    f = os.path.join(ROOT, "families", "REGISTRY.json"); reg = json.load(open(f, encoding="utf-8"))
    reg.setdefault(family, {}).update(kw); json.dump(reg, open(f, "w", encoding="utf-8"), indent=1)

# ------------------------------------------------------------------------------------- task types --
def t_selftest(code, row):
    from tools.selftest import run as st
    r = st(quick=True)
    return ("done" if r["ok"] else "blocked"), f"{r['passed']}/{r['total']} checks", r.get("failed", [])

def t_family_verify(code, row):
    from tools.run_item import verify_family
    r = verify_family(row["family"])
    place.set_excluded("VERIFY", True)
    if r["status"] == "tested":
        _registry_set(row["family"], status="tested", verified_tris=r["tris"])
        return "done", f"{r['tris']} tris, {r['objects']} parts, UV1 ok", []
    return "blocked", "verify failed", [f"uv1 bad {r['uv1_bad']}", f"tris {r['tris']} budget {r['tri_budget']}"]

def t_item(code, row):
    from tools.run_item import run_item
    r = run_item(os.path.join(paths.project_dir(code), "items", row["target"], "item.json"))
    if r["status"] == "failed": return "blocked", "; ".join(r["errors"][:2]), r["errors"]
    return "done", r.get("output", ""), r.get("flags", [])

def t_instances(code, row):
    pdir = paths.project_dir(code); proj = json.load(open(os.path.join(pdir, "project.json"), encoding="utf-8"))
    inst = json.load(open(os.path.join(pdir, "instances.json"), encoding="utf-8"))[row["target"]]
    coll = place.collection_path(proj["collection_root"], f"{proj['collection_root']}_inst_{row['target']}")
    place.clear_collection(coll); missing = set()
    for x in inst:
        if x["proto"] not in bpy.data.collections: missing.add(x["proto"]); continue
        place.instance(x["proto"], x["name"], coll, place.matrix(x["x"], x["y"], x["z"], x.get("rot", 0), x.get("scale", 1.0)))
    if missing: return "blocked", f"prototypes not built: {sorted(missing)}", []
    report.log(pdir, f"instances {row['target']}: {len(inst)} placed from {len({x['proto'] for x in inst})} prototype(s)")
    return "done", f"{len(inst)} instances of {len({x['proto'] for x in inst})} prototypes", []

def prune(code):
    """Remove scene roots whose item the plan no longer produces (plan_to_project deletes the item folder)."""
    pdir = paths.project_dir(code); proj = json.load(open(os.path.join(pdir, "project.json"), encoding="utf-8"))
    live = {f"{proj.get('name_prefix', 'SM_')}{c.replace('-', '_')}" for c in os.listdir(os.path.join(pdir, "items"))}
    root = bpy.data.collections.get(proj["collection_root"]); gone = []
    for c in (root.children if root else []):
        if "_inst_" in c.name: continue
        for o in [o for o in c.objects if o.parent is None and o.name not in live]:
            gone.append(o.name)
            for x in list(o.children_recursive) + [o]: bpy.data.objects.remove(x, do_unlink=True)
    if gone: report.log(pdir, f"pruned {len(gone)} orphan object tree(s): {gone[:10]}")
    return gone

def t_qc(code, row):
    pdir = paths.project_dir(code); proj = json.load(open(os.path.join(pdir, "project.json"), encoding="utf-8"))
    inst = json.load(open(os.path.join(pdir, "instances.json"), encoding="utf-8"))
    out, flags = {}, []
    pruned = prune(code)
    if pruned: flags.append(f"pruned orphans: {pruned[:6]}")
    root = bpy.data.collections.get(proj["collection_root"])
    meshes = {o.data.name: o for o in root.all_objects if o.type == "MESH"} if root else {}
    protos = bpy.data.collections.get("PROTOTYPES")
    pm = {o.data.name: o for o in protos.all_objects if o.type == "MESH"} if protos else {}
    allm = {**meshes, **pm}
    nm = sum(checks.mesh_stats(o)["non_manifold_edges"] for o in allm.values() if not o.get("open_mesh_ok"))
    uvbad = [o.name for o in allm.values() if "Lightmap" not in o.data.uv_layers or checks.uv1_report(o).get("uv1_overlap_suspect")]
    unique_tris = sum(checks.mesh_stats(o)["tris"] for o in meshes.values())
    proto_tris = {c.name: sum(checks.mesh_stats(o)["tris"] for o in c.all_objects if o.type == "MESH") for c in (protos.children if protos else [])}
    placed = {g: len(bpy.data.collections.get(f"{proj['collection_root']}_inst_{g}").objects) if bpy.data.collections.get(f"{proj['collection_root']}_inst_{g}") else 0 for g in inst}
    scene_tris = unique_tris + sum(proto_tris.get(x["proto"], 0) for g in inst for x in inst[g])
    for g in inst:
        if placed[g] != len(inst[g]): flags.append(f"instances {g}: {placed[g]} placed of {len(inst[g])}")
    if nm: flags.append(f"{nm} non-manifold edges on closed parts")
    if uvbad: flags.append(f"UV1 missing / overlapping: {uvbad[:8]}")
    gz = proj["site"]["ground"]
    if not (gz["terrain"] + proj["site"]["roughness"] < gz["road"] < gz["plot"]): flags.append("ground level table does not keep terrain < road < plot (z-fighting risk)")
    out = dict(unique_meshes=len(meshes), prototype_meshes=len(pm), unique_tris=unique_tris, prototype_tris=proto_tris, scene_tris_if_realised=scene_tris,
               instances=placed, non_manifold=nm, uv1_bad=len(uvbad), flags=flags)
    json.dump(out, open(os.path.join(paths.output_dir(code), "qc.json"), "w", encoding="utf-8"), indent=1)
    report.log(pdir, f"QC: {len(meshes)} unique meshes ({unique_tris} tris), {len(pm)} prototype meshes, instances {placed}, {len(flags)} flag(s)")
    return ("done" if not nm and not uvbad else "blocked"), f"{unique_tris} unique tris, scene {scene_tris} realised, {len(flags)} flags", flags

def t_export(code, row):
    from tools.export_unreal import export
    r = export(code)
    return "done", f"{r['files']} FBX files, {r['instances']} instances → output/unreal", []

def t_report(code, row):
    from tools.preview import render
    pdir = paths.project_dir(code); prev = paths.output_dir(code, "previews")
    shots = []
    for v in ("iso", "top", "iso_nw"):
        f = os.path.join(prev, f"site_{v}.png"); render(f, None, v, (1920, 1200)); shots.append(os.path.relpath(f, pdir))
    qc = json.load(open(os.path.join(paths.output_dir(code), "qc.json"), encoding="utf-8"))
    rows = tasks.load(pdir); summ = tasks.summary(rows)
    lines = ["", f"## Summary {code}", "", f"- tasks: {json.dumps(summ)}", f"- unique meshes {qc['unique_meshes']} ({qc['unique_tris']} tris); prototypes {len(qc['prototype_tris'])}; instances {qc['instances']}",
             f"- scene triangles if every instance were realised: {qc['scene_tris_if_realised']}", f"- QC flags: {qc['flags'] or 'none'}", f"- previews: {', '.join(shots)}",
             "- Unreal: output/unreal (prototypes LOD0/LOD1 FBX, site FBX per group, instances.csv/json, unreal_import.py)", ""]
    open(os.path.join(pdir, "REPORT.md"), "a", encoding="utf-8").write("\n".join(lines))
    return "done", f"report + {len(shots)} previews", []

RUN = {"selftest": t_selftest, "family_verify": t_family_verify, "item_build": t_item, "proto_build": t_item,
       "instance_place": t_instances, "qc_site": t_qc, "export": t_export, "report": t_report}

def run_task(code, row, agent="agent"):
    pdir = paths.project_dir(code)
    _open(code)
    tasks.set_status(pdir, row["task_id"], "doing", agent=agent)
    try:
        status, output, notes = RUN[row["type"]](code, row)
    except Exception as e:
        status, output, notes = "blocked", f"{type(e).__name__}: {e}", traceback.format_exc().splitlines()[-4:]
    tasks.set_status(pdir, row["task_id"], status, output=output[:300], notes=" | ".join(map(str, notes))[:500])
    _save(code)
    return f"{row['task_id']}: {status} — {output}" + (f" [{len(notes)} note(s)]" if notes else "")

def run_next(code, agent="agent"):
    rows = tasks.load(paths.project_dir(code)); r = tasks.next_runnable(rows)
    return run_task(code, r, agent) if r else "no runnable task (see tools/project_status.py)"

def run_all(code, agent="agent", stop_on_block=False, log=print):
    out = []
    while True:
        rows = tasks.load(paths.project_dir(code)); r = tasks.next_runnable(rows)
        if not r: break
        msg = run_task(code, r, agent); out.append(msg); log(msg)
        if stop_on_block and ": blocked" in msg: break
    return out

if __name__ == "__main__" and "--" in sys.argv:
    a = sys.argv[sys.argv.index("--") + 1:]
    code = a[0]; agent = a[a.index("--agent") + 1] if "--agent" in a else "blender-cli"
    if "--all" in a: run_all(code, agent)
    else: print(run_next(code, agent))
