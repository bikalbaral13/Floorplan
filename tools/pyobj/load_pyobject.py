"""Generic loader: any Python parametric-object JSON (python block + optional matgraph/1 materials) → Blender.

    blender -b --python load_pyobject.py -- <object.json> [out.png] [params.json] [--samples N] [--res WxH]

Nothing in here knows about beds: it runs the file's own `python.source`, builds every mesh, builds each
material graph the mesh names (falling back to its plain colour), and — when out.png is given — drops it into a
neutral studio (floor, back wall, soft area light) and renders with Cycles. Without out.png it just leaves the
objects in the open scene (use it from Blender's Text editor: set ARGS below)."""
import bpy, sys, os, json, math
from mathutils import Vector

ARGS = None  # e.g. ["D:/.../bed_python_textures.json"] when run from Blender's Text editor


def hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def sock(coll, key):
    if isinstance(key, int):
        return coll[key]
    for s in coll:  # prefer an enabled socket with that name (Mix-type nodes repeat names)
        if s.name == key and s.enabled:
            return s
    return coll[key]


def set_value(s, v, color):
    if v == "$color":
        v = color
    if isinstance(v, str) and v.startswith("#"):
        v = hex_lin(v)
    if isinstance(v, (list, tuple)) and len(v) != len(s.default_value):
        v = tuple(v) + (1.0,) * (len(s.default_value) - len(v))
    s.default_value = v


def build_material(name, g, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nodes = {}
    for i, nd in enumerate(g["nodes"]):
        n = nt.nodes.new(nd["type"])
        n.location = (i * 220 - 1200, 0)
        for k, v in nd.get("props", {}).items():
            setattr(n, k, v)
        nodes[nd["id"]] = n
    for nd in g["nodes"]:
        n = nodes[nd["id"]]
        for k, v in nd.get("inputs", {}).items():
            set_value(sock(n.inputs, int(k) if str(k).isdigit() else k), v, color)
    for a, ao, b, bi in g["links"]:
        nt.links.new(sock(nodes[a].outputs, ao), sock(nodes[b].inputs, bi))
    return m


def plain_material(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = hex_lin(color)
    return m


def load(path, params=None, collection=None):
    d = json.load(open(path, encoding="utf-8"))
    py = d["python"]
    ns = {"__name__": "pyobject"}
    exec(compile(py["source"], d.get("meta", {}).get("name", "pyobject"), "exec"), ns)
    res = ns[py.get("entry", "build")](params or {})
    graphs = (d.get("materials") or {}).get("graphs", {})
    coll = collection or bpy.context.scene.collection
    mats, objs = {}, []
    for mm in res["meshes"]:
        color = mm.get("color") or "#999999"
        key = (mm.get("material") or "", color)
        if key not in mats:
            g = graphs.get(key[0])
            mats[key] = build_material(f"{mm['name']} · {key[0] or 'colour'}", g, color) if g else plain_material(mm["name"], color)
        me = bpy.data.meshes.new(mm["name"])
        p, ix = mm["positions"], mm["indices"]
        me.from_pydata([(p[i], p[i + 1], p[i + 2]) for i in range(0, len(p), 3)], [],
                       [(ix[i], ix[i + 1], ix[i + 2]) for i in range(0, len(ix), 3)])
        me.update()
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.materials.append(mats[key])
        ob = bpy.data.objects.new(mm["name"], me)
        coll.objects.link(ob)
        objs.append(ob)
    return d, res, objs


def studio_render(objs, out, samples=64, res=(900, 630), cam_at=None):
    scene = bpy.context.scene
    lo = Vector((min(v[i] for o in objs for v in o.bound_box) for i in range(3)))
    hi = Vector((max(v[i] for o in objs for v in o.bound_box) for i in range(3)))
    size, ctr = hi - lo, (hi + lo) / 2

    def flat(name, rgb, rough):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = hex_lin(rgb)
        b.inputs["Roughness"].default_value = rough
        return m
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    bpy.context.object.data.materials.append(flat("studio floor", "#c4b29a", 0.6))
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, lo.y - 0.005, 0), rotation=(math.pi / 2, 0, 0))
    bpy.context.object.data.materials.append(flat("studio wall", "#e6e4e0", 0.9))

    bpy.ops.object.light_add(type="AREA", location=(ctr.x - 2.5, hi.y + 2.5, 3.6))
    key = bpy.context.object
    key.data.energy, key.data.size = 650, 4
    key.rotation_euler = (Vector((ctr.x, ctr.y, 0.4)) - key.location).to_track_quat("-Z", "Y").to_euler()
    bpy.ops.object.light_add(type="AREA", location=(ctr.x + 3, ctr.y + 1, 2.5))
    fill = bpy.context.object
    fill.data.energy, fill.data.size = 180, 3
    fill.rotation_euler = (Vector((ctr.x, ctr.y, 0.4)) - fill.location).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("studio")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 35
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    r = max(size.x, size.y)
    cam.location = Vector((ctr.x + 0.85 * r, hi.y + 1.0 * r, 0.75 * r))
    tgt = Vector((ctr.x - 0.1 * r, ctr.y - 0.1 * r, 0.2 * size.z + 0.15))
    if cam_at:
        cam.location, tgt = Vector(cam_at[:3]), Vector(cam_at[3:])
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    argv = ARGS or (sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    flags = {argv[i]: argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}
    pos = [a for i, a in enumerate(argv) if not a.startswith("--") and not (i and argv[i - 1].startswith("--"))]
    out = pos[1] if len(pos) > 1 else None
    params = json.load(open(pos[2])) if len(pos) > 2 else {}
    if out:
        bpy.ops.wm.read_factory_settings(use_empty=True)
    d, res, objs = load(pos[0], params)
    print("STATS", json.dumps(res.get("stats", {})), "materials", len((d.get("materials") or {}).get("graphs", {})))
    if out:
        w, h = (int(x) for x in flags.get("--res", "900x630").split("x"))
        studio_render(objs, os.path.abspath(out), int(flags.get("--samples", 64)), (w, h),
                     [float(x) for x in flags["--cam"].split(",")] if "--cam" in flags else None)
