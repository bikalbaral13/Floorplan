"""Family PLANT_SMALL — generator (STATUS: spec, not implemented yet).
Contract: build(p, name, coll) -> root object at the origin, Z up, front toward -Y, pivot per family.json.
p = resolved parameters in mm (L, W, H + family parameters). Geometry only: no materials.
Implement from the recipe in family.json using core.geom; keep parts as separate child objects.
"""
from core import geom

def build(p, name, coll):
    raise NotImplementedError("Family PLANT_SMALL is a spec — implement families/PLANT_SMALL/build.py from family.json recipe")
