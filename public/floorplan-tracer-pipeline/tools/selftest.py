"""python tools/selftest.py — run after ANY change to core/, checks/, exporters/, standards/ or a stage.

 1 units and parsing                      5 checks FAIL when a rule is broken (negative cases):
 2 dimension chains (close / refuse)         hierarchy inverted · opening on a perpendicular junction ·
 3 Windsor B1 regression: canvas → model     symbol not accounted · stair larger than its bay ·
   → canvas identical; 7 / 8 printed exact   room unreachable · free wall end
 4 Scribble 2BHK regression: skill numbers  6 door convention survives model ↔ canvas both ways
   (hall 154, kitchen 149, beds 106 / 114,
   stair 88 %), QC clean
"""
import copy, json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, units as U, dims, build, model as M
from checks import plan_checks
from exporters import canvas
from tools.import_canvas import convert
from tools.plan_to_layout import convert as to_layout

FX = os.path.join(paths.ROOT, "tests", "fixtures"); STD = paths.load_json(os.path.join(paths.ROOT, "standards", "DEFAULT.json"))
res = []
def check(c, msg): res.append((bool(c), msg))
def fails(fnd, check_name): return [f for f in fnd if f["level"] == "fail" and f["check"] == check_name]

# 1 units
check(abs(U.parse_len("10'-6\"") - 3.2004) < 1e-9 and abs(U.parse_len("9in") - 0.2286) < 1e-9 and abs(U.parse_len("3200mm") - 3.2) < 1e-9, "feet-inches / inches / mm parse")
check(U.ftin(3.2004) == "10'-6\"" and U.parse_size("12'5\" x 16'6\"")[1] == U.parse_len("16'6\""), "ftin + size parse")
# 2 chains
c = dims.close_chain({"outer": "36'", "wall_out": "9in", "lines": ["A", "B", "C", "D"], "bays": [{"value": "10'"}, {"value": None, "px": 236}, {"value": None, "px": 262}], "round": "3in"})
check(c["bays_ftin"] == ["10'-0\"", "12'-0\"", "13'-3\""] and abs(c["cc_m"] - U.parse_len("35'3\"")) < 1e-9, f"chain: 36' outer, 9\" walls → 10' + 12' + 13'3\" ({c['bays_ftin']})")
try: dims.close_chain({"outer": "25'", "wall_out": "9in", "bays": [{"value": "13'"}, {"value": "11'"}]}); check(False, "a chain that does not close is refused")
except ValueError: check(True, "a chain that does not close is refused (no nudging)")
cal = dims.calibrate([["a", 200, 10], ["b", 400, 20], ["c", 310, 15]])
worst = max(cal["pairs"], key=lambda p: abs(p["residual_ft"]))
check(abs(cal["px_per_ft"] - 20.0) < 0.3 and worst["name"] == "c" and abs(worst["residual_ft"]) > 0.3, f"least-squares scale {cal['px_per_ft']} px/ft; the mis-read pair has the largest residual ({worst['residual_ft']:+.2f} ft)")
# 3 Windsor regression
src = paths.load_json(os.path.join(FX, "windsor_B1.canvas.json")); plan = convert(src, STD)
doc = canvas.export(plan, STD)
def stats(d):
    n = {x["id"]: x for x in d["nodes"]}
    L = sum(math.dist((n[s["fromNodeId"]]["x"], n[s["fromNodeId"]]["y"]), (n[s["toNodeId"]]["x"], n[s["toNodeId"]]["y"])) for s in d["segments"] if s["fromNodeId"] != s["toNodeId"])
    return (len(d["nodes"]), len(d["segments"]), len(d["spaces"]), sum(len(x.get("attachments", [])) for x in d["nodes"]) + sum(len(s.get("attachments", [])) for s in d["segments"]), round(L, 0))
check(stats(src) == stats(doc), f"Windsor canvas → model → canvas identical {stats(doc)}")
doors = lambda d: sorted((s.get("label"), a["params"]["hinge"], a["params"]["swing"]) for s in d["segments"] for a in s.get("attachments", []) if a["objectId"] == "door-with-math")
check(doors(src) == doors(doc), "Windsor door hinge / swing survive the round trip")
lay = to_layout(plan, 66.36, [750, 543], paths.load_json(os.path.join(FX, "windsor_B1.printed.json")))
p2, bf = build.build(lay, STD, {"kind": "drawing"}); fnd = plan_checks.run(p2, STD)
pr = [f for f in fnd if f["check"] == "printed"]; exact = [f for f in pr if f["level"] == "info"]
check(len(pr) == 8 and len(exact) == 7 and any("KITCHEN" == f["ref"] for f in pr if f["level"] != "info"), f"Windsor rebuilt from its layout: {len(exact)}/8 printed rooms exact, kitchen the known exception")
check(not [f for f in fnd if f["level"] == "fail"], "Windsor: no failing check")
# 4 Scribble regression
g = {"x": {}, "y": {}}
dj = paths.load_json(os.path.join(FX, "scribble_2bhk.dims.json"))
for ax in ("x", "y"): g[ax].update(dims.close_chain(dj[ax])["lines"])
from core.layout import Frame
for ax in ("x", "y"):
    for k, v in dj.get("extra", {}).get(ax, {}).items(): g[ax][k] = Frame({"type": "metric"}, g).val(v, ax)
sl = paths.load_json(os.path.join(FX, "scribble_2bhk.layout.json")); sl["grid"] = g
sp, bf = build.build(sl, STD, {"kind": "sketch"}); sf = plan_checks.run(sp, STD)
area = {s["name"]: round(U.sqft(s["net_area"])) for s in sp["levels"][0]["spaces"]}
check(area["HALL"] == 154 and area["KITCHEN"] == 149 and area["BEDROOM 1"] == 106 and area["BEDROOM 2"] == 114, f"Scribble areas match the skill: {area}")
fill = next(f for f in sf if f["check"] == "stair")
check("88 %" in fill["msg"] and fill["level"] == "info", f"stair fills its bay: {fill['msg']}")
check(not [f for f in sf if f["level"] in ("fail", "warn")], "Scribble: QC clean (0 fail, 0 warn)")
# 5 negative cases — each rule must actually fail
bad = copy.deepcopy(sl); L0 = bad["levels"][0]
L0["spaces"] = [s if s[0] != "HALL" else ["HALL", ["B", "Y1", "P3", "T1"]] for s in L0["spaces"]]          # a shrunken hall
b1, _ = build.build(bad, STD, {"kind": "sketch"}); check(fails(plan_checks.run(b1, STD), "hierarchy"), "hierarchy: a hall smaller than a bedroom FAILS")
bad = copy.deepcopy(sl); y2 = next(l for l in bad["levels"][0]["lines"] if l[1] == "Y2")
y2[3][0:3] = [["gate", "A", "A+1.55", {"label": "gate on the corner"}], ["w", "A+1.55", "B"]]                 # gate ending on the A/Y2 junction
b2, _ = build.build(bad, STD, {"kind": "sketch"}); check(fails(plan_checks.run(b2, STD), "graph"), "an opening ending on a perpendicular junction (no stub) FAILS")
b3 = plan_checks.run(sp, STD, {"reading": {"symbols": [{"kind": "bed", "count": 1, "level": "L0"}]}}); check(fails(b3, "objects"), "a symbol read but neither placed nor listed FAILS")
bad = copy.deepcopy(sl); bad["levels"][0]["stairs"][0]["flight_w"] = 1.6
b4, _ = build.build(bad, STD, {"kind": "sketch"}); check(fails(plan_checks.run(b4, STD), "stair"), "a stair larger than its bay FAILS")
bad = copy.deepcopy(sl); vb = next(l for l in bad["levels"][0]["lines"] if l[0] == "V" and l[1] == "B")
vb[3] = [["w", "Y1", "Y3"]]; yy = next(l for l in bad["levels"][0]["lines"] if l[1] == "Y2"); yy[3][1] = ["w", "A+0.24", "A+1.55"]
b5, _ = build.build(bad, STD, {"kind": "sketch"}); check(fails(plan_checks.run(b5, STD), "circulation"), "a hall with no way in from outside FAILS circulation")
# 6 door convention both ways
d = {"id": "x", "a": [0, 0], "b": [1, 0], "t": 0.1, "kind": "door", "width": 1.0, "sill": 0, "head": 2.1, "hinge": "b", "swing": "L", "leaves": 1, "panes": 1, "label": "t"}
mini = M.empty_plan({"kind": "sketch"}); L = M.empty_level("L0", "t"); L["openings"].append(d); L["walls"] += [dict(id="w1", a=[-1, 0], b=[0, 0], t=0.1, h=2.7, kind="wall", label=""), dict(id="w2", a=[1, 0], b=[2, 0], t=0.1, h=2.7, kind="wall", label="")]
mini["levels"].append(L); cd = canvas.export(mini, STD); att = next(a for s in cd["segments"] for a in s.get("attachments", []) if a["objectId"] == "door-with-math")
back = convert(cd, STD)["levels"][0]["openings"][0]
check(att["params"]["hinge"] == "right" and att["params"]["swing"] == "right" and back["hinge"] == "b" and back["swing"] == "L", "door: model (hinge b, swing L) ↔ canvas (hinge right = END node, swing right) ↔ model")

# 7 the vendored pipeline kit is the published master (never hand-edited)
import hashlib
kj = paths.load_json(os.path.join(paths.ROOT, "_vendor", "KIT.json"))
vd = os.path.join(paths.ROOT, "_vendor", "pipeline_kit")
drift = [f for f, h in kj["files"].items() if hashlib.sha256(open(os.path.join(vd, f), "rb").read()).hexdigest() != h]
check(not drift and sorted(kj["files"]) == sorted(f for f in os.listdir(vd) if f.endswith(".py") or f == "VERSION"), f"vendored pipeline_kit {kj['version']} matches KIT.json" + (f" — DRIFT {drift}" if drift else ""))

bad_ = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad_)}/{len(res)} passed" + ("" if not bad_ else " — SOME CHECKS FAILED"))
sys.exit(1 if bad_ else 0)
