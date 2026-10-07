"""Collections, prototypes and instancing.

Prototypes (a building design at one LOD, a tree species at one LOD, a street light) are built ONCE
at the origin inside  PROTOTYPES › <PROTO_NAME>  (excluded from the view layer). Every placement is a
collection-instance empty in  EXT › <group>  carrying its transform. Mirrored placements use a
separately built mirrored prototype (never a negative scale: it flips normals and breaks lightmaps /
Unreal instancing). For FBX the exporter realises instances as linked duplicates (shared mesh data).
"""
import math
import bpy
from mathutils import Matrix, Vector

def collection_path(*names, exclude=False):
    parent = bpy.context.scene.collection
    for n in names:
        c = bpy.data.collections.get(n) or bpy.data.collections.new(n)
        if c.name not in [x.name for x in parent.children]: parent.children.link(c)
        parent = c
    if exclude: set_excluded(names[0], True)
    return parent

def set_excluded(name, value=True):
    def rec(lc):
        if lc.collection.name == name: lc.exclude = value; return True
        return any(rec(ch) for ch in lc.children)
    rec(bpy.context.view_layer.layer_collection)

def prototype_collection(proto):
    root = collection_path("PROTOTYPES", exclude=True)
    c = bpy.data.collections.get(proto)
    if c is None:
        c = bpy.data.collections.new(proto); root.children.link(c)
    return c

def clear_collection(c):
    for ob in list(c.all_objects): bpy.data.objects.remove(ob, do_unlink=True)
    for ch in list(c.children): clear_collection(ch); bpy.data.collections.remove(ch)

def matrix(x, y, z=0.0, rot_deg=0.0, scale=1.0):
    return Matrix.Translation(Vector((x, y, z))) @ Matrix.Rotation(math.radians(rot_deg), 4, "Z") @ Matrix.Scale(scale, 4)

def instance(proto, name, coll, mat):
    e = bpy.data.objects.new(name, None)
    e.instance_type = "COLLECTION"; e.instance_collection = bpy.data.collections[proto]
    e.empty_display_size = 0.5; e.matrix_world = mat; e["proto"] = proto
    coll.objects.link(e); return e

def realise(empty, coll):
    """Linked duplicates of an instance's prototype objects at the instance transform (for FBX)."""
    out = []; src = empty.instance_collection; M = empty.matrix_world
    tops = [o for o in src.all_objects if o.parent is None or o.parent.name not in src.all_objects]
    def rec(o, parent):
        c = o.copy(); c.name = f"{empty.name}__{o.name}"; coll.objects.link(c)
        if parent is None: c.parent = None; c.matrix_world = M @ o.matrix_world
        else: c.parent = parent; c.matrix_parent_inverse = o.matrix_parent_inverse.copy()
        out.append(c)
        for ch in o.children: rec(ch, c)
    for t in tops: rec(t, None)
    return out
