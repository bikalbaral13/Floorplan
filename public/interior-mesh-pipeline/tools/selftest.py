"""Core library self-test inside Blender: builds a test box, revolve and tube, checks them, deletes them."""
from tools._boot import boot
ROOT = boot()
import bpy
from core import geom, finish, checks, __version__

def run():
    coll = bpy.data.collections.new("_selftest"); bpy.context.scene.collection.children.link(coll)
    root = geom.empty_root("_selftest_root", coll)
    bm = geom.new(); geom.rounded_box(bm, -200, -150, 0, 200, 150, 300, 20); a = geom.to_object("_box", bm, coll, root)
    bm = geom.new(); geom.revolve(bm, [(0, 0), (150, 0), (160, 100), (120, 250), (0, 260)], 48); b = geom.to_object("_rev", bm, coll, root)
    bm = geom.new(); geom.sweep_tube(bm, [(0, 0, 0), (0, 0, 500), (300, 0, 700)], 10); c = geom.to_object("_tube", bm, coll, root)
    finish.finish_asset(root)
    st = checks.asset_stats(root)
    ok = st["non_manifold_edges"] == 0 and st["tris"] > 0
    for o in list(coll.objects): bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(coll)
    return {"core_version": __version__, "ok": ok, **{k: st[k] for k in ("tris", "non_manifold_edges")}}
