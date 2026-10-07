"""Core self-test (Blender).  run(quick=True) → {"ok", "passed", "total", "failed"}

Checks MeshBuilder exactness (box / prism with holes / sweep topology and path-follow UVs), closed-solid
manifoldness after finish, Smart-UV lightmap inside 0–1 on a prototype in an excluded collection,
collection instancing + realisation, and (quick=False) every family's test values.
"""
import math
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))   # runnable as a script too
from tools._boot import boot
ROOT = boot()
import bpy
from core import geom, finish, uv, place, checks

def run(quick=True):
    res = []
    def check(c, msg): res.append((bool(c), msg))
    coll = place.collection_path("SELFTEST"); place.clear_collection(coll)
    mb = geom.MB(); mb.box(0, 0, 0, 2, 1, 3); ob = mb.to_object("ST_box", coll); finish.clean_mesh(ob)
    st = checks.mesh_stats(ob); check(st["tris"] == 12 and st["non_manifold_edges"] == 0, f"box: 12 tris, manifold ({st})")
    mb = geom.MB(); mb.prism_holes([(0, 0), (10, 0), (10, 10), (0, 10)], [[(3, 3), (7, 3), (7, 7), (3, 7)]], 0, 1); ob = mb.to_object("ST_prism", coll); finish.clean_mesh(ob)
    st = checks.mesh_stats(ob); vol = sum(p.area * p.normal.z * p.center.z for p in ob.data.polygons)
    check(st["non_manifold_edges"] == 0 and abs(vol - 84.0) < 1e-6, f"prism with hole: manifold, volume 84 m³ ({vol:.4f})")
    mb = geom.MB(); mb.sweep([(0, 0, 0), (10, 0, 0), (10, 10, 0)], [(0, 0), (0.2, 0), (0.2, 0.5), (0, 0.5)]); ob = mb.to_object("ST_sweep", coll); finish.clean_mesh(ob)
    st = checks.mesh_stats(ob); u = max(l.uv.x for l in ob.data.uv_layers["UVMap"].data)
    check(st["non_manifold_edges"] == 0 and abs(u - 20.0) < 1e-6, f"sweep: manifold, U = path length 20 m ({u:.4f})")
    mb = geom.MB(); mb.tube([(0, 0, 0), (0, 0, 1), (0.3, 0, 2)], [0.2, 0.15, 0.1], 10); ob = mb.to_object("ST_tube", coll); finish.clean_mesh(ob)
    check(checks.mesh_stats(ob)["non_manifold_edges"] == 0, "tube: capped and manifold")
    pc = place.prototype_collection("ST_PROTO"); place.clear_collection(pc)
    mb = geom.MB(); mb.box(0, 0, 0, 1, 1, 1); mb.box(2, 0, 0, 3, 1, 2); po = mb.to_object("ST_proto_part", pc); finish.clean_mesh(po); uv.smart_lightmap(po)
    r = checks.uv1_report(po); check(r["uv1_outside"] == 0 and not r["uv1_overlap_suspect"] and r["uv1_fill"] > 0.2, f"smart UV lightmap in an excluded collection ({r})")
    e = place.instance("ST_PROTO", "ST_inst", coll, place.matrix(5, 5, 0, 90)); made = place.realise(e, coll)
    check(len(made) == 1 and made[0].data == po.data and abs(made[0].matrix_world.translation.x - 5) < 1e-6, "instance → linked duplicate shares mesh data")
    if not quick:
        import json, os
        from tools.run_item import verify_family
        for f in sorted(json.load(open(os.path.join(ROOT, "families", "REGISTRY.json"))).keys()):
            v = verify_family(f); check(v["status"] == "tested", f"family {f}: {v['tris']} tris, UV1 {v['uv1']}")
    place.clear_collection(coll); bpy.data.collections.remove(coll)
    place.clear_collection(pc); bpy.data.collections.remove(pc)
    failed = [m for ok, m in res if not ok]
    return {"ok": not failed, "passed": len(res) - len(failed), "total": len(res), "failed": failed, "lines": [("PASS " if ok else "FAIL ") + m for ok, m in res]}

if __name__ == "__main__":
    import sys
    r = run(quick="--full" not in sys.argv)
    print("\n".join(r["lines"])); print("ALL PASS" if r["ok"] else "SOME CHECKS FAILED")
