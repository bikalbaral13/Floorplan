"""Dump a room .blend as world-space, modifier-applied geometry for write_skp.py.
blender -b NE_Bedroom.blend -P dump_for_skp.py -- <out.json> <textures dir>
One record per visible mesh object: verts (metres, Z up), polys [indices], per-poly material and smooth flag.
Materials carry an sRGB colour, an alpha and — if the glTF flatten baked one — a 1 m swatch texture."""
import bpy, sys, os, re, json

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, TEX = os.path.abspath(argv[0]), os.path.abspath(argv[1])
dg = bpy.context.evaluated_depsgraph_get()


def srgb(c):
    return [round(255 * (x * 12.92 if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055)) for x in c[:3]]


mats, objs = {}, []
for o in bpy.data.objects:
    if o.type != "MESH" or o.hide_render:
        continue
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    M = o.matrix_world
    verts = [[round(v, 5) for v in (M @ v.co)] for v in me.vertices]
    names = [s.material.name if s.material else "Default" for s in o.material_slots] or ["Default"]
    polys = [[list(p.vertices), names[min(p.material_index, len(names) - 1)], int(p.use_smooth)] for p in me.polygons]
    for s in o.material_slots:
        m = s.material
        if not m or m.name in mats:
            continue
        col, alpha = list(m.diffuse_color), 1.0
        b = m.node_tree.nodes.get("Principled BSDF") if m.use_nodes else None
        if b and not b.inputs["Base Color"].is_linked:
            col = list(b.inputs["Base Color"].default_value)
        if "Glass" in m.name or "Glazing" in m.name:
            alpha = 0.3
        tex = os.path.join(TEX, re.sub(r"[^A-Za-z0-9_-]+", "_", "bake · " + m.name).strip("_") + ".png")
        mats[m.name] = {"rgb": srgb(col), "alpha": alpha, "texture": tex if os.path.exists(tex) else None}
    objs.append({"name": o.name, "verts": verts, "polys": polys})
    ev.to_mesh_clear()

json.dump({"materials": mats, "objects": objs}, open(OUT, "w"))
print("[dump]", len(objs), "objects", sum(len(o["polys"]) for o in objs), "faces", len(mats), "materials",
      sum(1 for m in mats.values() if m["texture"]), "textured")
