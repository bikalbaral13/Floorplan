"""Unreal Editor Python — import an exterior-mesh-pipeline export and place its instances.

Run in Unreal (Output Log → Python, or Tools → Execute Python Script) with this file inside the
export folder (output/unreal). Edit DEST if needed. Requires the Python Editor Script Plugin.

    1. imports prototypes/SM_*_LOD0.fbx as static meshes (combined, lightmap UV channel 1, no material import),
       then sets SM_*_LOD1.fbx as LOD 1 of the same mesh
    2. imports site/SM_SITE_*.fbx (one static mesh per object)
    3. spawns one actor "EXT_Instances" with a HierarchicalInstancedStaticMesh component per mesh and
       adds every row of instances.json (location cm, yaw deg, uniform scale)
Units: the FBX files are centimetre-correct; instance coordinates are already in Unreal space.
"""
import json, os, glob
import unreal

HERE = os.path.dirname(os.path.abspath(__file__))
DEST = "/Game/Exterior"

def _task(fbx, dest, combine=True):
    opts = unreal.FbxImportUI()
    opts.import_mesh = True; opts.import_materials = False; opts.import_textures = False; opts.import_as_skeletal = False
    opts.static_mesh_import_data.combine_meshes = combine
    opts.static_mesh_import_data.generate_lightmap_u_vs = False
    opts.static_mesh_import_data.auto_generate_collision = True
    opts.static_mesh_import_data.import_uniform_scale = 1.0
    t = unreal.AssetImportTask()
    t.filename = fbx; t.destination_path = dest; t.automated = True; t.replace_existing = True; t.save = True; t.options = opts
    return t

def run():
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    tasks = [_task(f, f"{DEST}/Prototypes") for f in sorted(glob.glob(os.path.join(HERE, "prototypes", "*_LOD0.fbx")))]
    tasks += [_task(f, f"{DEST}/Site", combine=False) for f in sorted(glob.glob(os.path.join(HERE, "site", "*.fbx")))]
    tools.import_asset_tasks(tasks)
    sub = unreal.get_editor_subsystem(unreal.StaticMeshEditorSubsystem)
    for f in sorted(glob.glob(os.path.join(HERE, "prototypes", "*_LOD1.fbx"))):
        name = os.path.basename(f).replace("_LOD1.fbx", "_LOD0")
        mesh = unreal.load_asset(f"{DEST}/Prototypes/{name}")
        if mesh:
            sub.import_lod(mesh, 1, f)
            mesh.set_editor_property("light_map_coordinate_index", 1)
    rows = json.load(open(os.path.join(HERE, "instances.json"), encoding="utf-8"))
    actor = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.Actor, unreal.Vector(0, 0, 0))
    actor.set_actor_label("EXT_Instances")
    sds = unreal.get_engine_subsystem(unreal.SubobjectDataSubsystem)
    root = sds.k2_gather_subobject_data_for_instance(actor)[0]
    BFL = unreal.SubobjectDataBlueprintFunctionLibrary
    comps = {}
    for r in rows:
        mesh_name = f"{r['mesh']}_LOD0"
        if mesh_name not in comps:
            mesh = unreal.load_asset(f"{DEST}/Prototypes/{mesh_name}")
            if not mesh: unreal.log_warning(f"missing {mesh_name}"); comps[mesh_name] = None; continue
            handle, _ = sds.add_new_subobject(unreal.AddNewSubobjectParams(parent_handle=root, new_class=unreal.HierarchicalInstancedStaticMeshComponent))
            sds.rename_subobject(handle, unreal.Text(mesh_name))
            comp = BFL.get_object(BFL.get_data(handle)); comp.set_static_mesh(mesh); comps[mesh_name] = comp
        if comps[mesh_name] is None: continue
        xf = unreal.Transform(unreal.Vector(r["x_cm"], r["y_cm"], r["z_cm"]), unreal.Rotator(0, 0, r["yaw_deg"]), unreal.Vector(r["scale"], r["scale"], r["scale"]))
        comps[mesh_name].add_instance(xf, True)
    unreal.log(f"exterior import: {len(tasks)} FBX, {len(rows)} instances in {len(comps)} HISM components")

run()
