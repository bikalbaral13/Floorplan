"""Family TABLE_DRUM — cylindrical drum body with a separate top slab. STATUS: implemented (reference family)."""
import importlib.util, os
from core import geom
_spec = importlib.util.spec_from_file_location("tr", os.path.join(os.path.dirname(__file__), "..", "TABLE_ROUND", "build.py"))
_tr = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_tr)

def build(p, name, coll):
    R, H, tt = p["L"] / 2, p["H"], p["top_t"]
    root = geom.empty_root(name, coll)
    bm = geom.new(); geom.revolve(bm, _tr.eased_disc_profile(R - 2, 0, H - tt, 2), segments=96); geom.to_object(name + "_body", bm, coll, root)
    bm = geom.new(); geom.revolve(bm, _tr.eased_disc_profile(R, H - tt, H, 2), segments=96); geom.to_object(name + "_top", bm, coll, root)
    return root
