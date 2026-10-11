"""python tests/test_fresh_project.py — a brand-new, non-fixture project runs S1 → S6 cleanly (in a temp copy).

The fixture always takes fixture-only branches; this catches code that only works there."""
import json, os, shutil, subprocess, sys, tempfile
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = []
def check(c, m): res.append((bool(c), m))
tmp = tempfile.mkdtemp(prefix="sb-fresh-")
try:
    pipe = os.path.join(tmp, "space-brief-pipeline")
    shutil.copytree(ROOT, pipe, ignore=shutil.ignore_patterns("__pycache__", "DEMO_*", "ZZ_*"))
    fx = os.path.join(pipe, "projects", "INFRA_RECEPTION", "inputs")
    run = lambda *a: subprocess.run([sys.executable, *a], cwd=pipe, capture_output=True, text=True, encoding="utf-8")
    r = run("tools/new_project.py", "ZZ_FRESH", "--title", "Fresh test", "--plan", os.path.join(fx, "plan.canvas.json"), "--refs", os.path.join(fx, "refs"), "--work-dir", os.path.join(tmp, "work"))
    check(r.returncode == 0, "new_project creates a project from a plan and references")
    r = run("tools/run_task.py", "ZZ_FRESH", "--all"); check("S3_SCOPE" in r.stdout and "GATE" in r.stdout, "the run stops at the scope gate")
    pj = os.path.join(pipe, "projects", "ZZ_FRESH")
    d = json.load(open(os.path.join(pj, "scope.draft.json"), encoding="utf-8"))
    json.dump({"spaces": [s["id"] for s in d["spaces"]], "label": d["label"], "client": "Test", "levels": d["levels"], "seed_issue": False,
               "team": [], "approved_words": "test", "approved_on": "2026-10-10"}, open(os.path.join(pj, "scope.json"), "w", encoding="utf-8"))
    r = run("tools/run_task.py", "ZZ_FRESH", "--task", "S3_SCOPE", "--approved", "test approval"); check("DONE" in r.stdout, "the scope gate takes an approval")
    r = run("tools/run_task.py", "ZZ_FRESH", "--all")
    for s in ("S4_VIEWS", "S5_SCHEDULE", "S6_APPS"): check(f"{s}: DONE" in r.stdout, f"{s} runs on a non-fixture project" + ("" if f"{s}: DONE" in r.stdout else " — " + r.stdout[-300:]))
    check("S7_PUBLISH_APPS: BLOCKED" in r.stdout, "then waits for the publish step")
    check(os.path.exists(os.path.join(tmp, "work", "apps", "ZZ_FRESH_architect_standalone.html")), "the standalone architect app is built")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
