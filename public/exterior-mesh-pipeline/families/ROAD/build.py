"""ROAD — asphalt carriageway slab (polygons with holes), top at top_z, on a sub-base, with the 40 mm
wearing course as a separate part (same outline) for its own material."""
from core.geom import MB, empty_root, part

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    base, wear = MB(), MB()
    for pg in geo["polygons"]:
        base.prism_holes(pg[0], pg[1], p["top_z"] - p["thickness"], p["top_z"] - 0.04)
        wear.prism_holes(pg[0], pg[1], p["top_z"] - 0.04, p["top_z"])
    part(root, coll, "Base", base); part(root, coll, "Asphalt", wear)
    return root
