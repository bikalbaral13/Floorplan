"""python tests/test_from_program.py — the program → design-brief hand-off: a program plan_trace (the villa fixture,
two levels) becomes a brief per floor that runs S1 → S6 (in a temp copy; nothing published)."""
import json, os, shutil, subprocess, sys, tempfile
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = []
def check(c, m): res.append((bool(c), m))
tmp = tempfile.mkdtemp(prefix="sb-prog-")
try:
    d = os.path.join(tmp, "space-brief-pipeline"); shutil.copytree(ROOT, d, ignore=shutil.ignore_patterns("__pycache__", "DEMO_*", "ZZ_*", "AD_*"))
    fx = os.path.join(d, "tests", "fixtures", "program")
    run = lambda *x: subprocess.run([sys.executable, *x], cwd=d, capture_output=True, text=True, encoding="utf-8")
    r = run("tools/from_program.py", os.path.join(fx, "plan_trace.json"), "--program-project", os.path.join(fx, "project.json"))
    check(r.returncode != 0 and "levels" in (r.stdout + r.stderr), "a two-level trace needs --level")
    for lv, rooms, doors in (("GF", 9, 6), ("FF", 10, 7)):
        r = run("tools/from_program.py", os.path.join(fx, "plan_trace.json"), "--level", lv, "--program-project", os.path.join(fx, "project.json"), "--work-dir", os.path.join(tmp, "w" + lv))
        check(r.returncode == 0 and f"{rooms} rooms, {doors} doors" in r.stdout, f"{lv}: {rooms} rooms, {doors} doors from the program's plan")
    pj = json.load(open(os.path.join(d, "projects", "AD_VL_TEST_GF", "project.json"), encoding="utf-8"))
    check(pj["standards"] == "AADITHYAA" and pj["upstream"]["pipeline"] == "program" and pj["upstream"]["typology"] == "VILLA_4BHK_G1" and len(pj["upstream"]["sha256"]) == 64,
          "the brief keeps the program's standards set and records where its plan came from")
    r = run("tools/run_task.py", "AD_VL_TEST_GF", "--all"); check("S2_GEOMETRY: DONE" in r.stdout and "GATE" in r.stdout, "S1 and S2 run on the converted plan, then the scope gate")
    sd = json.load(open(os.path.join(d, "projects", "AD_VL_TEST_GF", "scope.draft.json"), encoding="utf-8"))
    check(sd["levels"]["soffit_mm"] == 3200, "the slab soffit comes from the program's floor-to-floor (3.2 m)")
    ids = [s["id"] for s in sd["spaces"] if s["label"] in ("Living", "Dining")]
    json.dump({"spaces": ids, "label": "Living · Dining", "client": "T", "levels": sd["levels"], "seed_issue": False, "team": [], "approved_words": "t", "approved_on": "2026-10-11"},
              open(os.path.join(d, "projects", "AD_VL_TEST_GF", "scope.json"), "w", encoding="utf-8"))
    run("tools/run_task.py", "AD_VL_TEST_GF", "--task", "S3_SCOPE", "--approved", "t"); r = run("tools/run_task.py", "AD_VL_TEST_GF", "--all")
    check(all(f"{s}: DONE" in r.stdout for s in ("S4_VIEWS", "S5_SCHEDULE", "S6_APPS")), "views, schedule and apps build from the program's plan")
    el = [f for f in os.listdir(os.path.join(tmp, "wGF", "views")) if f.startswith("elev-") and f.endswith(".svg")]
    check(len(el) >= 4, f"interior elevations are derived for the scoped rooms ({len(el)})")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
