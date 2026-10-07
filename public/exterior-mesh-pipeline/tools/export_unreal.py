"""Unreal export (Blender).  output/unreal/

    prototypes/SM_<PROTO>_LOD0.fbx   detailed prototype (pipeline LOD2) at its own origin
    prototypes/SM_<PROTO>_LOD1.fbx   massing / light prototype (pipeline LOD1), same origin
    site/SM_SITE_<group>.fbx         unique site meshes per group (terrain, roads, walls, gates, plots, open, buildings_unique)
    instances.json / instances.csv   every placement: prototype, Unreal location (cm, Y flipped), yaw (deg), scale
    unreal_import.py                 Editor Python: imports the FBX set (LOD1 into LOD slot 1, lightmap UV channel 1)
                                     and spawns instances as one HISM component per prototype
    <CODE>_review.fbx                whole site with instances realised as linked duplicates (review only)

FBX: metres → centimetres via FBX_SCALE_UNITS, -Z forward / Y up (Unreal's importer converts),
smoothing by face with sharp edges, no leaf bones, no animation. Parts are separate meshes carrying
one placeholder material slot each (M_<Part>, no shading) so a combined Unreal mesh keeps a section
per part; materials are assigned later.
"""
import csv, json, os, shutil
import bpy
from core import paths, place

FBX = dict(use_selection=True, apply_scale_options="FBX_SCALE_UNITS", global_scale=1.0, apply_unit_scale=True, axis_forward="-Z", axis_up="Y",
           object_types={"MESH", "EMPTY"}, use_mesh_modifiers=True, mesh_smooth_type="FACE", use_tspace=False, add_leaf_bones=False,
           bake_anim=False, use_custom_props=False, path_mode="AUTO", batch_mode="OFF")

def _slot(ob):
    if ob.type != "MESH" or ob.data.materials: return
    part = ob.name.split("_")[-1]
    m = bpy.data.materials.get(f"M_{part}") or bpy.data.materials.new(f"M_{part}")
    ob.data.materials.append(m)

def _select(objs):
    for o in list(bpy.context.selected_objects): o.select_set(False)
    for o in objs: o.select_set(True)
    if objs: bpy.context.view_layer.objects.active = objs[0]

def _export_proto(proto, path):
    c = bpy.data.collections[proto]; tmp = bpy.data.collections.new("_EXPORT_TMP"); bpy.context.scene.collection.children.link(tmp)
    objs = []
    for o in c.all_objects:
        tmp.objects.link(o); objs.append(o); _slot(o)
    _select(objs); bpy.ops.export_scene.fbx(filepath=path, **FBX)
    for o in objs: tmp.objects.unlink(o)
    bpy.data.collections.remove(tmp)

def export(code):
    pdir = paths.project_dir(code); proj = json.load(open(os.path.join(pdir, "project.json"), encoding="utf-8"))
    out = paths.output_dir(code, "unreal"); pdirp = paths.output_dir(code, "unreal", "prototypes"); sdir = paths.output_dir(code, "unreal", "site")
    n = 0; S = proj["export"]["unreal_scale"]
    protos = bpy.data.collections.get("PROTOTYPES")
    place.set_excluded("PROTOTYPES", False)
    for c in (protos.children if protos else []):
        base, lod = c.name.rsplit("_LOD", 1)
        _export_proto(c.name, os.path.join(pdirp, f"SM_{base}_LOD{0 if lod == '2' else 1}.fbx")); n += 1
    place.set_excluded("PROTOTYPES", True)
    root = bpy.data.collections[proj["collection_root"]]
    for c in root.children:
        if "_inst_" in c.name: continue
        objs = [o for o in c.all_objects]
        for o in objs: _slot(o)
        _select(objs); bpy.ops.export_scene.fbx(filepath=os.path.join(sdir, f"SM_SITE_{c.name.split('_', 1)[1]}.fbx"), **FBX); n += 1
    inst = json.load(open(os.path.join(pdir, "instances.json"), encoding="utf-8")); rows = []
    for g, lst in inst.items():
        for x in lst:
            base = x["proto"].rsplit("_LOD", 1)[0]
            rows.append(dict(group=g, name=x["name"], mesh=f"SM_{base}", x_cm=round(x["x"] * S, 2), y_cm=round(-x["y"] * S, 2), z_cm=round(x["z"] * S, 2),
                             yaw_deg=round(-x.get("rot", 0), 3), scale=x.get("scale", 1.0)))
    json.dump(rows, open(os.path.join(out, "instances.json"), "w", encoding="utf-8"), indent=0)
    with open(os.path.join(out, "instances.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    shutil.copy(os.path.join(paths.ROOT, "tools", "unreal_import.py"), os.path.join(out, "unreal_import.py"))
    # review FBX: realise instances as linked duplicates in a temporary collection
    tmp = bpy.data.collections.new("_REVIEW"); bpy.context.scene.collection.children.link(tmp); made = []
    place.set_excluded("PROTOTYPES", False)
    for c in root.children:
        if "_inst_" in c.name:
            for e in c.objects: made += place.realise(e, tmp)
    sel = [o for c in root.children if "_inst_" not in c.name for o in c.all_objects] + made
    _select(sel); bpy.ops.export_scene.fbx(filepath=os.path.join(out, f"{code}_review.fbx"), **FBX); n += 1
    for o in made: bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(tmp); place.set_excluded("PROTOTYPES", True)
    return {"files": n, "instances": len(rows)}
