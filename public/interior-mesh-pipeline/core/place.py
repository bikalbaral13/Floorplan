"""Placement: plan mm → world, facing rotation, collections, linked-duplicate instancing, naming."""
import math
import bpy
from mathutils import Vector, Matrix

FACING = {"S": 0, "E": 90, "N": 180, "W": 270, "SE": 45, "NE": 135, "NW": 225, "SW": 315, "—": 0, "": 0, None: 0}

def collection_path(*names):
    parent = bpy.context.scene.collection
    for n in names:
        c = bpy.data.collections.get(n) or bpy.data.collections.new(n)
        if c.name not in [x.name for x in parent.children]:
            parent.children.link(c)
        parent = c
    return parent

def world_matrix(x_mm, y_mm, z_mm, ffl_mm, rot_deg):
    return Matrix.Translation(Vector((x_mm, y_mm, ffl_mm + z_mm)) * 0.001) @ Matrix.Rotation(math.radians(rot_deg), 4, "Z")

def _copy_tree(root, coll, name):
    """Linked duplicate of an asset hierarchy (mesh data shared, not copied)."""
    new_root = root.copy(); new_root.name = name; coll.objects.link(new_root)
    def rec(src, dst_parent):
        for ch in src.children:
            c = ch.copy(); c.parent = dst_parent; coll.objects.link(c); rec(ch, c)
    rec(root, new_root)
    return new_root

def place_instances(root, code, placements, ffl_mm, rot_deg, coll, prefix="SM_"):
    """placements: [{inst, x, y, z[, rot]}]; z may be 'host' (placed at 0 and flagged)."""
    out, flags = [], []
    for i, p in enumerate(placements):
        name = f"{prefix}{code.replace('-', '_')}_{int(p.get('inst', i + 1)):02d}"
        z = p.get("z", 0)
        if not isinstance(z, (int, float)):
            flags.append(f"{name}: Z '{z}' — snapped with checks.snap_to_host"); z = None
        ob = root if i == 0 else _copy_tree(root, coll, name)
        if i == 0:
            ob.name = name
        ob.matrix_world = world_matrix(p["x"], p["y"], 0 if z is None else z, ffl_mm, p.get("rot", rot_deg))
        out.append((ob, z is None))
    return out, flags
