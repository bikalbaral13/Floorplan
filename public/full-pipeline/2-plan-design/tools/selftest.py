"""python tools/selftest.py — everything that can be checked without a project: kit copy, contracts, rules, templates."""
import hashlib, json, os, re, shutil, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path[:0] = [ROOT]
from core.ctx import validate
res = []
def check(c, m): res.append((bool(c), m))
kit = json.load(open(os.path.join(ROOT, "_vendor", "KIT.json"), encoding="utf-8"))
d = os.path.join(ROOT, "_vendor", "pipeline_kit")
have = {f: hashlib.sha256(open(os.path.join(d, f), "rb").read()).hexdigest() for f in os.listdir(d) if f.endswith(".py") or f == "VERSION"}
check(have == kit["files"], "vendored pipeline_kit matches KIT.json (no hand edits)")
ok, msg = validate(json.load(open(os.path.join(ROOT, "pipeline.json"), encoding="utf-8")), "pipeline.v1"); check(ok, f"pipeline.json validates against pipeline.v1 ({msg})")
for sid in sorted(os.listdir(os.path.join(ROOT, "stages"))):
    m = json.load(open(os.path.join(ROOT, "stages", sid, "stage.json"), encoding="utf-8"))
    check(os.path.exists(os.path.join(ROOT, "stages", sid, "run.py")), f"{sid}: run.py present")
    if m["kind"] == "agent": check(os.path.exists(os.path.join(ROOT, "stages", sid, "prompt.md")), f"{sid}: agent stage has prompt.md")
node = shutil.which("node")
for f in ("core.js", "deck.js", "architect.js", "client.js", "modeler.js"):
    src = open(os.path.join(ROOT, "templates", "app", f), encoding="utf-8").read()
    check(not re.search(r"\son(change|click|input)=", src), f"{f}: no inline event handlers")
    if node: check(subprocess.run([node, "--check", os.path.join(ROOT, "templates", "app", f)], capture_output=True).returncode == 0, f"{f}: parses")
src = json.load(open(os.path.join(ROOT, "standards", "SOURCE.json"), encoding="utf-8"))
for f, m in src["files"].items():
    check(hashlib.sha256(open(os.path.join(ROOT, "standards", f), "rb").read()).hexdigest() == m["sha256"], f"standards/{f} is the library master {m['version']} (byte-identical)")
from core.apps import CAPABILITIES
rules = CAPABILITIES["db"]["rules"]
check({"path": "", "read": "view", "write": "admin"} in rules, "db rule: shared data is editor-only")
check(any(r["path"] == "inputs" and r.get("read") and r.get("write") for r in rules), "db rule: the inputs prefix sets both read and write (required beside a {self} rule)")
check({"path": "inputs/{self}", "write": "interact"} in rules, "db rule: each person writes only inputs/<self>")
for t in ("test_kit_vendored.py", "test_trust.py", "test_geometry.py", "test_archive.py", "test_brief_agent.py", "test_fresh_project.py", "test_project_state.py", "test_from_program.py"):
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tests", t)], capture_output=True, text=True, encoding="utf-8")
    check(r.returncode == 0, f"{t}: {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-200:]}")
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
