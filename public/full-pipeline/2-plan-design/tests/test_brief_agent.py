"""python tests/test_brief_agent.py — the briefing agent's patch → run compiler keeps its promises.

Pins: every change cites an instruction; drafts only (issued snapshot and rev untouched); writes stay in their lane;
undo restores exactly; the app (core.js) and the tool agree on refKey() and on what a library pick does."""
import copy, json, os, re, shutil, subprocess, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from tools import brief_agent as A
res = []
def check(c, m): res.append((bool(c), m))
def refused(patch, db, cat=None, part=""):
    try: A.compile_patch(patch, db, cat or {}, ROOT); return False
    except A.PatchError as e: return part.lower() in str(e).lower()

iss = {"rev": 1, "code": "FL-01", "name": "Floor", "cat": "floor", "shapes": [], "spec": {"material": "", "finish": "", "colourName": "", "hex": "", "link": ""}, "dims": [], "notes": "", "refs": [], "options": []}
db = A.db_from_local({"meta": {"sheets": [{"id": "plan", "name": "Plan"}], "space": {"label": "Lobby"}, "project": {"title": "T"}},
      "elements": {"e1": dict(copy.deepcopy(iss), id="e1", order=1, issued=copy.deepcopy(iss), updatedAt=100),
                   "e2": {"id": "e2", "order": 2, "code": "PL-01", "name": "Planter", "cat": "planting", "shapes": [], "spec": dict(iss["spec"]), "notes": "", "refs": [], "options": [], "rev": 0, "updatedAt": 200,
                          "dims": [{"k": "Size (L × D × H)", "v": "4465 × 400 × 900 mm", "src": "plan"}]}},
      "requests": {"q1": {"id": "q1", "element": "e1", "prompt": "marble floor", "status": "queued", "style": "closeup"}}, "agent": {}, "runs": {}})
cat = {"Materials/Finishes/marble.json": {"id": "x", "kind": "material", "path": "Materials/Finishes/marble.json", "title": "Marble — large-format floor", "group": "Finishes", "hex": "#EFEAE0", "colors": ["#ffffff"], "finish": "gloss", "pattern": "voronoi"},
       "Objects/Architectural/planter-box.json": {"id": "y", "kind": "object", "path": "Objects/Architectural/planter-box.json", "title": "Planter Box", "group": "Outdoor", "hex": "#7c2d12", "colors": ["#7c2d12"], "icon": [],
                                                  "dims": [{"k": "Length", "id": "length", "v": 1.2}], "material": "corten trough", "semantics": "corten planter", "finishes": []}}
I = [{"id": "i1", "kind": "text", "summary": "marble floor"}]
P = lambda ops: {"schema": "spacebrief-patch/1", "session": "t-session", "mode": "one-shot", "instructions": I, "ops": ops}

run = A.compile_patch(P([{"op": "library", "el": "FL-01", "path": "Materials/Finishes/marble.json", "cites": ["i1"]},
                         {"op": "spec", "el": "FL-01", "set": {"finish": "Honed"}, "cites": ["i1"]},
                         {"op": "library", "el": "PL-01", "path": "Objects/Architectural/planter-box.json", "cites": ["i1"]},
                         {"op": "request", "el": "e1", "prompt": "marble in the room", "cites": ["i1"]},
                         {"op": "new", "name": "Pendant", "cat": "light", "place": {"sheet": "Plan", "type": "pin", "pts": [[0.5, 0.5]]}, "cites": ["i1"]},
                         {"op": "dims", "el": "LT-01", "set": [{"k": "Bottom", "v": "+2400 mm"}], "cites": ["i1"]}]), db, cat, ROOT, now_ms=1000)
w = {x["path"]: x for x in run["writes"]}
e1 = w["elements/e1"]["data"]
check(e1["spec"]["material"] == "Marble, large-format floor" and e1["spec"]["finish"] == "Honed" and e1["spec"]["hex"] == "#efeae0", "library material fills the spec, a later spec op refines it")
check(e1["issued"] == db["elements"]["e1"]["issued"] and e1["rev"] == 1 and e1["dirty"] is True, "an agent change is a draft: issued snapshot and rev untouched")
check(e1["refInfo"][A.ref_key(e1["refs"][-1])]["source"] == "library", "the swatch reference records its library source")
check(e1["agent"]["cites"] == ["i1"] and "specification" in e1["agent"]["fields"], "the element records which run and instructions changed it")
pl = w["elements/e2"]["data"]
check(len(pl["dims"]) == 1 and pl["lib"]["object"]["path"].endswith("planter-box.json"), "a library object does not add its default sizes when the plan fixes the size")
new = [x for x in run["writes"] if x["path"].startswith("elements/ag-")]
check(len(new) == 1 and new[0]["data"]["code"] == "LT-01" and new[0]["data"]["dims"][0]["v"] == "+2400 mm", "a new element gets the next code and later ops can address it")
check(any(p.startswith("requests/") for p in w) and any(p.startswith("agent/") for p in w), "requests and a report message are written")
check(run["base"] == {"e1": 100, "e2": 200}, "the run records what the agent read (for conflict checks)")
u = {x["path"]: x for x in run["undo"]}
check(u["elements/e1"]["data"] == db["elements"]["e1"] and u[new[0]["path"]]["op"] == "delete", "undo restores the exact previous documents and removes created ones")
check(A.check_writes(run, db) == [], "a compiled run passes the write checks")

check(refused(P([{"op": "spec", "el": "FL-01", "set": {"material": "Oak"}}]), db, part="cites"), "a change without a cited instruction is refused")
check(refused(P([{"op": "spec", "el": "FL-01", "set": {"material": "Oak"}, "cites": ["zz"]}]), db, part="unknown"), "citing an instruction that does not exist is refused")
check(refused(P([{"op": "spec", "el": "FL-01", "set": {"hex": "red"}, "cites": ["i1"]}]), db, part="hex"), "a bad colour is refused")
check(refused(P([{"op": "library", "el": "FL-01", "path": "Materials/x.json", "cites": ["i1"]}]), db, cat, "catalog"), "a library path that is not in the catalog is refused")
check(refused(P([{"op": "ref", "el": "FL-01", "file": "x.jpg", "source": "ai", "cites": ["i1"]}]), db, part="prompt"), "an AI image without prompt and model is refused")
check(refused(dict(P([]), instructions=[]), db, part="instructions"), "no instructions, no changes")
bad = copy.deepcopy(run); bad["writes"][0]["data"]["issued"] = None
check(A.check_writes(bad, db), "a run that would un-issue an element fails the write check")
bad = copy.deepcopy(run); bad["writes"].append({"op": "set", "path": "roster/x", "data": {"role": "client"}})
check(A.check_writes(bad, db), "a run that writes the roster fails the write check")
bad = copy.deepcopy(run); bad["writes"].append({"op": "update", "path": "brief/meta", "data": {"issue": {"n": 9}}})
check(A.check_writes(bad, db), "a run that changes the issue number fails the write check")

# fulfil an AI request with a generated file
tmp = os.path.join(ROOT, "tests", "_tmp_agent"); os.makedirs(tmp, exist_ok=True)
from PIL import Image; Image.new("RGB", (64, 48), "#808080").save(os.path.join(tmp, "gen.png"))
r2 = A.compile_patch(P([{"op": "fulfil", "request": "q1", "file": "gen.png", "model": "test-model", "cites": ["i1"]}]), db, {}, tmp, now_ms=2000)
q = next(x["data"] for x in r2["writes"] if x["path"] == "requests/q1"); e = next(x["data"] for x in r2["writes"] if x["path"] == "elements/e1")
inf = e["refInfo"][A.ref_key(e["refs"][-1])]
check(q["status"] == "done" and inf["source"] == "ai" and inf["prompt"] == "marble floor" and inf["model"] == "test-model", "a fulfilled request attaches the image as AI with its prompt and model")
shutil.rmtree(tmp)

# parity with the app: refKey() and libApply() from templates/app/core.js
node = shutil.which("node")
if node:
    js = open(os.path.join(ROOT, "templates", "app", "core.js"), encoding="utf-8").read()
    grab = lambda name: re.search(r"^function " + name + r"\(.*?^}$", js, re.S | re.M).group(0)
    fw = re.search(r"^function finishWord.*$", js, re.M).group(0) + "\n" + grab("matName"); rk = re.search(r"^function refKey.*$", js, re.M).group(0)
    e2 = db["elements"]["e2"]; e1o = db["elements"]["e1"]
    for t, want in (("Stone — terrazzo", "Terrazzo"), ("Lacquer — charcoal satin", "Lacquer, charcoal satin"), ("Fabric — bouclé", "Bouclé")):
        check(A.mat_name(t) == want, f"material name from library title: {t} → {want}")
    prog = (rk + "\n" + fw + "\nconst rid = () => 'ID'; const Date = {now: () => 0};\n" + grab("libApply") +
            f"\nconst cat = {json.dumps(cat)};\nconsole.log(JSON.stringify([refKey('data:image/jpeg;base64,AAAA'), refKey('asset:abc'), "
            f"libApply({json.dumps(e1o)}, cat['Materials/Finishes/marble.json'], 'spec', 'asset:s1'), libApply({json.dumps(e2)}, cat['Objects/Architectural/planter-box.json'], 'object', null), "
            f"libApply({json.dumps(e1o)}, cat['Materials/Finishes/marble.json'], 'option', null)]));")
    out = json.loads(subprocess.run([node, "-e", prog], capture_output=True, text=True, encoding="utf-8", check=True).stdout)
    py = [A.ref_key("data:image/jpeg;base64,AAAA"), A.ref_key("asset:abc"), A.lib_apply(e1o, cat["Materials/Finishes/marble.json"], "spec", "asset:s1", "ID"),
          A.lib_apply(e2, cat["Objects/Architectural/planter-box.json"], "object", None, "ID"), A.lib_apply(e1o, cat["Materials/Finishes/marble.json"], "option", None, "ID")]
    def strip(o):
        if isinstance(o, dict): return {k: strip(v) for k, v in o.items() if k != "at"}
        return [strip(x) for x in o] if isinstance(o, list) else o
    check(out[0] == py[0] and out[1] == py[1], "refKey() is the same in the app and the tool")
    check(strip(out[2]) == strip(py[2]) and strip(out[3]) == strip(py[3]) and strip(out[4]) == strip(py[4]), "a library pick does the same in the app and the tool")
else: check(True, "node not found — app/tool parity not checked")

bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
