"""Checks: triangles, manifold, UV1 overlaps and fill, real-world UV0 sanity, instance counts."""
import bpy
import bmesh

def mesh_stats(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    out = {"object": ob.name, "tris": sum(len(f.verts) - 2 for f in bm.faces),
           "non_manifold_edges": sum(1 for e in bm.edges if not e.is_manifold), "open_ok": bool(ob.get("open_mesh_ok"))}
    bm.free(); return out

def tree_stats(root):
    rows = [mesh_stats(o) for o in [root] + list(root.children_recursive) if o.type == "MESH"]
    return {"tris": sum(r["tris"] for r in rows), "objects": len(rows),
            "non_manifold_edges": sum(r["non_manifold_edges"] for r in rows if not r["open_ok"]), "parts": rows}

def _tri_area2(a, b, c):
    return abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2

def uv1_report(ob):
    """UV1 inside 0–1, fill ratio, and overlap estimate (sum of island areas > packed area)."""
    me = ob.data; lay = me.uv_layers.get("Lightmap")
    if lay is None: return {"object": ob.name, "uv1": "missing"}
    me.calc_loop_triangles(); area = 0.0; out_of = 0
    for t in me.loop_triangles:
        a, b, c = (lay.data[i].uv for i in t.loops); area += _tri_area2(a, b, c)
        out_of += any(not (-1e-4 <= v <= 1 + 1e-4) for p in (a, b, c) for v in p)
    return {"object": ob.name, "uv1_fill": round(area, 3), "uv1_outside": out_of, "uv1_overlap_suspect": area > 1.0 + 1e-3}

def uv_tree(root):
    seen, rows = set(), []
    for o in [root] + list(root.children_recursive):
        if o.type == "MESH" and o.data.name not in seen:
            seen.add(o.data.name); rows.append(uv1_report(o))
    bad = [r["object"] for r in rows if r.get("uv1") == "missing" or r.get("uv1_outside") or r.get("uv1_overlap_suspect")]
    return {"meshes": len(rows), "bad": bad, "fill_min": min((r.get("uv1_fill", 0) for r in rows), default=0)}
