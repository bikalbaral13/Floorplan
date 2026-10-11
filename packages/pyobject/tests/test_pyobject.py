"""python tests/test_pyobject.py — object/2: the converted program objects build, validate, and keep their program functions."""
import json, os, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, HERE)
import pyobject as O
res = []
def check(c, m): res.append((bool(c), m))
door, stair = (O.load(os.path.join(HERE, "objects", f)) for f in ("door_hinged.json", "stair_dogleg.json"))
for o in (door, stair): check(not O.validate_file(o), f"{o['meta']['id']}: valid object/2")
try:
    import jsonschema
    S = json.load(open(os.path.join(HERE, "schemas", "object.v2.schema.json"), encoding="utf-8"))
    bed = O.load(os.path.join(HERE, "..", "..", "tools", "pyobj", "bed_python.json"))
    check(all(not list(jsonschema.Draft202012Validator(S).iter_errors(o)) for o in (door, stair, bed)), "door, stair and bed_python.json validate against object.v2")
except ImportError: pass
r = O.build(door, {"width_ft": 3}); check(abs(r["stats"]["width_m"] - 0.9144) < 1e-9 and len(r["plan"]) == 3, "door: 3 ft leaf → 0.9144 m plan symbol")
r = O.build(stair, {}); check(r["stats"]["risers"] == 18 and r["stats"]["footprint_m"] == [3.099, 2.235], "stair: 10 ft / 7 in → 18 risers; 8 treads x 10 in + 3.5 ft landing = 3.099 m")
c = O.run(stair, "compute")
F = lambda lvl, cat, ref, msg: {"level": lvl, "msg": msg}
check(O.module(stair)["qc"](c, {"stair_max_riser_in": 6.5}, F) != [], "the program's own qc() still runs from the object/2 file")
check(O.module(door)["qc"]({"width_ft": 2.5}, {"door_min_width_ft": 3}, F, "d1") != [], "door qc flags a narrow door")
check(O.bake_key(stair, O.coerce(stair, {})) == O.bake_key(stair, O.coerce(stair, {"floor_height_ft": 10})) and
      O.bake_key(stair, O.coerce(stair, {})) != O.bake_key(stair, O.coerce(stair, {"floor_height_ft": 11})), "bake key depends on resolved params only")
check(O.coerce(stair, {"floor_height_ft": 99})["floor_height_ft"] == 12, "numbers are clamped to max")
try: O.coerce(stair, {"direction": "X"}); check(False, "bad select refused")
except O.ObjectError: check(True, "bad select refused")
check(O.validate_result({"meshes": [{"positions": [0, 0, 0, 1, 0, 0], "indices": [0, 1, 2]}]}) != [], "an out-of-range index is caught")
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
