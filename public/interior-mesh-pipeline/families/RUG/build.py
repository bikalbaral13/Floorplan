"""Family RUG — rug slab L×W×pile with bevelled edges. STATUS: implemented (reference family; shag / waffle relief = TODO v0.2).
Pivot bottom-centre on the floor."""
from core import geom

def build(p, name, coll):
    L, W, H = p["L"], p["W"], max(p["H"], 4)
    e = min(float(p.get("edge_bevel", 5)), H / 2 - 0.5)
    root = geom.empty_root(name, coll)
    bm = geom.new(); geom.rounded_box(bm, -L / 2, -W / 2, 0, L / 2, W / 2, H, e, segments=2); geom.to_object(name + "_rug", bm, coll, root)
    return root
