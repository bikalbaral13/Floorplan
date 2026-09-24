# render_object.py — one baked parametric object → a low-sample Cycles still, a .blend and a GLB.
#
#   blender -b --python render_object.py -- <ABS baked.json> <ABS mats dir> <ABS out dir> \
#           [--samples 16] [--res 640] [--view front|side|back|top] [--front +x|-x|+y|-y]
#
# --front is the direction the object FACES in the PLAN frame at rotation 0: chairs face +x (back at -x);
# sofas, wardrobes and beds against a wall face -y (back at +y). Wrong, and "front" shoots the side.
#
# Input is the output of `npm run bake -- <object> --out <name>.baked.json`: resolved.meshes[] each carry
# `faces` (plan-frame metres), `name`, `color` and `material` (a Library-relative link such as
# "Materials/Finishes/leather-cream.json"). Materials are read from <mats dir> (fetch_materials.mjs puts them
# there, with bp_materials.py beside them), because r2.dev 403s urllib.
#
# The purpose is a CHECK, not a beauty render: does every row get the material it links, and does a GLB
# come out. report.json lists row → material id or "MISSING".

import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) < 3:
    raise SystemExit("usage: blender -b --python render_object.py -- <baked.json> <mats dir> <out dir> [--samples N] [--res PX] [--view V]")
baked_path, mats_dir, out_dir = (os.path.abspath(a) for a in argv[:3])   # background Blender: relative → drive root
opt = {argv[i][2:]: argv[i + 1] for i in range(3, len(argv) - 1) if argv[i].startswith("--")}
samples = int(opt.get("samples", 16))
res = int(opt.get("res", 640))
view = opt.get("view", "front")
front = opt.get("front", "+x")
os.makedirs(out_dir, exist_ok=True)

sys.path.insert(0, mats_dir)
import bp_materials  # from R2 Skills/Floorplan Renderer/, fetched by fetch_materials.mjs

data = json.load(open(baked_path, encoding="utf-8"))
resolved = data.get("resolved") or {}
meshes = resolved.get("meshes") or []
params = resolved.get("params") or {}
name = (data.get("object") or {}).get("name") or os.path.splitext(os.path.basename(baked_path))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)

# ── fallback bindings from the object's own text props (Material nodes, already in `material`, win) ──
fin_rules = []
for part in str(params.get("finishes") or "").split(";"):
    if "=" in part:
        k, v = part.split("=", 1)
        fin_rules.append((k.strip().lower(), "Materials/" + v.strip()))
default_path = ("Materials/" + params["materialPath"]) if params.get("materialPath") else None

def link_for(mesh):
    if mesh.get("material"):
        return mesh["material"], "node"
    rn = str(mesh.get("name") or "").lower()
    for k, p in fin_rules:
        if k and k in rn:
            return p, "finishes"
    return default_path, "materialPath" if default_path else None

def load_def(link):
    if not link:
        return None
    rel = link.lstrip("/")
    for pre in ("Library/", "library/"):
        if rel.startswith(pre):
            rel = rel[len(pre):]
    p = os.path.join(mats_dir, rel)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

cache, report_rows, flat_for_glb = {}, [], {}
all_pts = []
for m in meshes:
    faces = m.get("faces") or []
    verts, polys = [], []
    for f in faces:
        if len(f) < 3:
            continue
        idx = []
        for p in f:
            # plan frame is LEFT handed (x east, y south, z up) → Blender (x, -y, z)
            verts.append((p[0], -p[1], p[2]))
            idx.append(len(verts) - 1)
        polys.append(list(reversed(idx)))          # mirroring flips handedness, so flip winding back
    if not polys:
        continue
    me = bpy.data.meshes.new(m.get("name") or m.get("id") or "row")
    me.from_pydata(verts, [], polys)
    me.update()
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    all_pts += verts

    # weld the per-face vertices so smoothing has neighbours, then smooth by angle
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.00005)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    except Exception:
        bpy.ops.object.shade_smooth()
    ob.select_set(False)

    link, how = link_for(m)
    d = load_def(link)
    if d is not None:
        key = d.get("id") or link
        if key not in cache:
            # an emissive material (an LED strip, a halo) glows only when its kelvin is passed through —
            # without it bp_materials builds the dark base colour and every LED renders as a black bar
            ek = (d.get("emission") or {}).get("kelvin")
            cache[key] = bp_materials.material_from_def(d, fallback_hex=m.get("color") or "#94a3b8", name=key,
                                                        emissive_kelvin=ek)
            flat_for_glb[key] = d.get("pbr") or {}
        mat = cache[key]
        status = key
    else:
        mat = bp_materials.flat_material(m.get("color") or "#94a3b8", name="flat-" + me.name)
        status = "MISSING" + (f" ({link})" if link else " (no link)")
    ob.data.materials.append(mat)
    report_rows.append({"row": m.get("name"), "faces": len(polys), "material": status, "via": how})
    print(f"ROW {m.get('name')!s:<18} {len(polys):>6} faces  {status}")

if not all_pts:
    raise SystemExit("no geometry in " + baked_path)

# ── stage: floor, soft world, key + fill area lights, camera framed on the bounds ──
lo = Vector((min(p[0] for p in all_pts), min(p[1] for p in all_pts), min(p[2] for p in all_pts)))
hi = Vector((max(p[0] for p in all_pts), max(p[1] for p in all_pts), max(p[2] for p in all_pts)))
ctr, size = (lo + hi) / 2, max((hi - lo).length, 0.2)

bpy.ops.mesh.primitive_plane_add(size=size * 8, location=(ctr.x, ctr.y, lo.z))
fl = bpy.context.object
fl.data.materials.append(bp_materials.flat_material("#b9aa98", name="floor"))
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.88, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35

def aim(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()

bpy.ops.object.light_add(type="AREA", location=ctr + Vector((size * 1.2, size * 1.4, size * 1.6)))
# Energy grows with the square of the throw (~2.4 x size) so the light ON the object stays constant.
# 300 x size^2 blew a 2 m grey sofa out to white — hiding exactly the colour this check exists for.
key = bpy.context.object; key.data.energy = 45 * size * size; key.data.size = size; aim(key, ctr)
bpy.ops.object.light_add(type="AREA", location=ctr + Vector((size * 1.4, -size * 1.2, size * 0.9)))
fill = bpy.context.object; fill.data.energy = 15 * size * size; fill.data.size = size * 1.4; aim(fill, ctr)

# Front direction in Blender: the plan frame maps to (x, -y, z), so a plan "-y" front is Blender +y.
fx, fy = {"+x": (1, 0), "-x": (-1, 0), "+y": (0, -1), "-y": (0, 1)}.get(front, (1, 0))
F = Vector((fx, fy, 0))
S = Vector((-fy, fx, 0))
dirs = {"front": F + S * 0.45 + Vector((0, 0, 0.45)), "side": S + F * 0.2 + Vector((0, 0, 0.3)),
        "back": -F + S * 0.6 + Vector((0, 0, 0.6)), "top": F * 0.5 + S * 0.25 + Vector((0, 0, 1.6))}
d = dirs.get(view, dirs["front"]).normalized()
bpy.ops.object.camera_add(location=ctr + d * size * 1.55)
cam = bpy.context.object; cam.data.lens = 50; aim(cam, ctr)

sc = bpy.context.scene
sc.camera = cam
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"      # EEVEE Next is magenta headless
sc.cycles.samples = samples; sc.cycles.use_denoising = True
wide = max((hi - lo).x, (hi - lo).y) > 1.6 * (hi - lo).z   # a sofa wants a landscape frame, a chair a portrait one
sc.render.resolution_x = res; sc.render.resolution_y = int(res * (0.62 if wide else 1.2))
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Base Contrast"
sc.render.filepath = os.path.join(out_dir, "still.png")
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, name + ".blend"))

# ── GLB: glTF cannot carry a procedural (Base Color fed by a texture → exported WHITE), so every
# library material is flattened to its pbr factors first. The .blend above keeps the procedurals. ──
def hex_rgba(h):
    h = (h or "#94a3b8").lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c) + (1.0,)

for key_, mat in cache.items():
    pbr = flat_for_glb.get(key_) or {}
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b is None:
        continue
    b.inputs["Base Color"].default_value = hex_rgba(pbr.get("baseColor"))
    b.inputs["Roughness"].default_value = float(pbr.get("roughness", 0.5))
    b.inputs["Metallic"].default_value = float(pbr.get("metallic", 0))

for o in (fl,):
    bpy.data.objects.remove(o, do_unlink=True)
glb = os.path.join(out_dir, name + ".glb")
bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False, export_lights=False, export_cameras=False)

report = {
    "object": name, "still": sc.render.filepath, "blend": os.path.join(out_dir, name + ".blend"),
    "glb": glb, "glbBytes": os.path.getsize(glb) if os.path.exists(glb) else 0,
    "rows": report_rows, "materials": sorted(cache.keys()),
    "missing": [r["row"] for r in report_rows if r["material"].startswith("MISSING")],
}
json.dump(report, open(os.path.join(out_dir, "report.json"), "w"), indent=2)
print("REPORT", json.dumps({k: report[k] for k in ("glbBytes", "materials", "missing")}))
