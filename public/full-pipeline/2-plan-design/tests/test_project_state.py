"""python tests/test_project_state.py — a project saved with project_state.py and restored in a fresh copy reruns to the
same brief: same reference ids, same elements, same links, same library catalog (temp copies only, no library writes)."""
import json, os, shutil, subprocess, sys, tempfile
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = []
def check(c, m): res.append((bool(c), m))
tmp = tempfile.mkdtemp(prefix="sb-state-")
try:
    def copy(name):
        d = os.path.join(tmp, name, "space-brief-pipeline")
        shutil.copytree(ROOT, d, ignore=shutil.ignore_patterns("__pycache__", "DEMO_*", "ZZ_*")); return d
    a = copy("a"); fx = os.path.join(a, "projects", "INFRA_RECEPTION", "inputs")
    run = lambda cwd, *x: subprocess.run([sys.executable, *x], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    run(a, "tools/new_project.py", "ZZ_SAVE", "--title", "Save test", "--plan", os.path.join(fx, "plan.canvas.json"), "--refs", os.path.join(fx, "refs"), "--work-dir", os.path.join(tmp, "wa"))
    shutil.copytree(os.path.join(fx, "library"), os.path.join(a, "projects", "ZZ_SAVE", "inputs", "library"))
    run(a, "tools/run_task.py", "ZZ_SAVE", "--all"); pj = os.path.join(a, "projects", "ZZ_SAVE")
    d = json.load(open(os.path.join(pj, "scope.draft.json"), encoding="utf-8"))
    json.dump({"spaces": [s["id"] for s in d["spaces"]], "label": d["label"], "client": "T", "levels": d["levels"], "seed_issue": True, "team": [], "approved_words": "t", "approved_on": "2026-10-11"}, open(os.path.join(pj, "scope.json"), "w", encoding="utf-8"))
    run(a, "tools/run_task.py", "ZZ_SAVE", "--task", "S3_SCOPE", "--approved", "t"); r = run(a, "tools/run_task.py", "ZZ_SAVE", "--all")
    check("S6_APPS: DONE" in r.stdout, "source project builds")
    json.dump({"url": "https://claude.ai/artifact/TEST", "site_sha256": "x"}, open(os.path.join(pj, "apps.json"), "w", encoding="utf-8"))
    r = run(a, "tools/project_state.py", "pack", "ZZ_SAVE"); check(r.returncode == 0, "pack: " + (r.stdout.strip().splitlines() or [r.stderr[-200:]])[0])
    st = os.path.join(tmp, "wa", "state", "state.json"); size = os.path.getsize(st)
    check(size < 400_000, f"the bundle is small enough for one connector write ({size / 1e3:.0f} kB)")
    r = run(a, "tools/project_state.py", "index", "--entry", os.path.join(tmp, "wa", "state", "index-entry.json"), "-o", os.path.join(tmp, "index.json"))
    idx = json.load(open(os.path.join(tmp, "index.json"), encoding="utf-8"))
    check(idx["projects"]["ZZ_SAVE"]["pipelines"]["space-brief"]["link"] == "https://claude.ai/artifact/TEST", "the index records the brief link")
    b = copy("b"); shutil.rmtree(os.path.join(b, "projects")); os.makedirs(os.path.join(b, "projects"))
    r = run(b, "tools/project_state.py", "unpack", st, "--work-dir", os.path.join(tmp, "wb")); check(r.returncode == 0, "unpack in a fresh copy")
    pb = os.path.join(b, "projects", "ZZ_SAVE")
    for f in json.load(open(os.path.join(pb, "RESTORE.fetch.json"), encoding="utf-8")):          # stands in for Artifact read from the brief
        dst = os.path.join(pb, f["to"]); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy(os.path.join(tmp, "wa", "apps", "site", f["from"]), dst)
    check(run(b, "tools/project_state.py", "check", "ZZ_SAVE").returncode == 0, "every file to fetch is in place")
    run(b, "tools/run_task.py", "ZZ_SAVE", "--task", "S1_INTAKE"); run(b, "tools/run_task.py", "ZZ_SAVE", "--all")
    run(b, "tools/run_task.py", "ZZ_SAVE", "--task", "S3_SCOPE", "--approved", "t"); r = run(b, "tools/run_task.py", "ZZ_SAVE", "--all")
    check("S6_APPS: DONE" in r.stdout, "the restored project reruns S1 → S6")
    A = json.load(open(os.path.join(tmp, "wa", "brief.json"), encoding="utf-8")); B = json.load(open(os.path.join(tmp, "wb", "brief.json"), encoding="utf-8"))
    check(sorted(x["id"] for x in A["references"]) == sorted(x["id"] for x in B["references"]), "reference ids are unchanged after restore")
    check({e["id"]: e["refs"] for e in A["elements"]} == {e["id"]: e["refs"] for e in B["elements"]}, "elements and their reference links are unchanged")
    la = json.load(open(os.path.join(tmp, "wa", "apps", "site", "data", "library.json"), encoding="utf-8")); lb = json.load(open(os.path.join(tmp, "wb", "apps", "site", "data", "library.json"), encoding="utf-8"))
    check(la["items"] == lb["items"] and la["items"], "the library catalog is restored from the brief")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
