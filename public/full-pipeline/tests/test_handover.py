"""python tests/test_handover.py — one project handed from person to person, machine to machine, through the store.

Two copies of the Full Pipeline stand in for two machines and a LocalStore folder stands in for R2. Program comes
from the program self-test (villa ZZ_E, G+1, kept with --keep), so Plan/Design gets one brief per floor.
Plan/Design's S3 needs the architect's answers (never self-answered), so the test hands it over with --force and
puts the INFRA fixture roombrief where Plan/Design would publish it; Build likewise with a stand-in .blend."""
import json, os, shutil, subprocess, sys, tempfile
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

FULL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
res = []
def check(c, m): res.append((bool(c), m)); return c

def copy_machine(dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copytree(FULL, dst, ignore=shutil.ignore_patterns("__pycache__", "ZZ_*", "_ZZ_*", "upstream"))

def sh(cwd, *args):
    r = subprocess.run([sys.executable, *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    return r.returncode, r.stdout + r.stderr

tmp = tempfile.mkdtemp(prefix="full-handover-")
try:
    # <machine>/repo/public/full-pipeline: work dirs (../../../../../pipeline-work from a project) stay inside tmp
    A, B = (os.path.join(tmp, m, "repo", "public", "full-pipeline") for m in ("A", "B"))
    R2 = os.path.join(tmp, "r2")
    copy_machine(A); copy_machine(B)
    lib = os.path.join(R2, "library", "Schemas"); os.makedirs(lib)
    sb = os.path.join(FULL, "2-plan-design", "schemas")
    for f in ("canvas", "plan_trace", "run", "pipeline"): shutil.copy(os.path.join(sb, "library", f"{f}.v1.schema.json"), lib)
    shutil.copy(os.path.join(sb, "spacebrief.v1.schema.json"), lib)
    shutil.copy(os.path.join(FULL, "3-build", "schema", "roombrief.schema.json"), os.path.join(lib, "roombrief.v1.schema.json"))
    ST = ["--store", "local:" + R2]
    P = lambda m, *a: sh(m, "tools/project.py", *ST, *a)

    rc, out = sh(os.path.join(A, "1-program"), "tools/selftest.py", "--keep")
    check(rc == 0 and os.path.exists(os.path.join(A, "1-program", "projects", "ZZ_E", "output", "plan_trace.json")), "machine A: program villa ZZ_E finished (P1–P7)")

    rc, out = P(A, "new", "ZZ_E", "--title", "30x40 villa", "--by", "Asha"); check(rc == 0, "Asha: new project, manifest in the store")
    rc, out = P(A, "new", "ZZ_E", "--by", "Asha"); check(rc != 0 and "already exists" in out, "a second `new` for the same code is refused")
    rc, out = P(A, "member", "ZZ_E", "add", "Ravi", "architect", "--by", "Ravi"); check(rc != 0 and "only an owner" in out, "only an owner adds members")
    for n, r in (("Ravi", "architect"), ("Meera", "architect"), ("Kiran", "modeler"), ("Dev", "presenter")): P(A, "member", "ZZ_E", "add", n, r, "--by", "Asha")
    rc, out = P(A, "member", "ZZ_E", "remove", "Asha", "--by", "Asha"); check(rc != 0 and "last owner" in out, "the last owner cannot be removed")
    rc, out = P(B, "handover", "ZZ_E", "--by", "Kiran"); check(rc != 0 and "Program is for" in out, "a modeler cannot hand over Program")
    rc, out = P(B, "resume", "ZZ_E", "--by", "Mallory"); check(rc != 0 and "not a member" in out, "a non-member cannot resume")
    rc, out = P(A, "handover", "ZZ_E", "--by", "Asha", "--note", "client approved"); check(rc == 0 and "DONE" in out, "Asha: program handed over (outputs published)")
    check(os.path.exists(os.path.join(R2, "Projects", "ZZ_E", "1-program", "program", "output", "plan_trace.json")), "plan_trace.json is shared in Projects/ZZ_E/1-program/program/output/")
    ho = json.load(open(os.path.join(R2, "Projects", "ZZ_E", "handoff", "program.json"), encoding="utf-8"))
    check(ho["from"] == "program" and ho["to"] == "plan" and any(f["path"].endswith("output/plan_trace.json") and len(f["sha256"]) == 64 for f in ho["files"]),
          "handoff/program.json lists the published files with sha256")
    ci = json.load(open(os.path.join(R2, "Projects", "ZZ_E", "shared", "index.json"), encoding="utf-8"))
    cur = json.load(open(os.path.join(R2, "Projects", "ZZ_E", "shared", "canvas.json"), encoding="utf-8"))
    check(ci["current"] == 1 and sorted(ci["revs"][0]["levels"]) == ["FF", "GF"] and [l["name"] for l in cur["levels"]] == ["GF", "FF"]
          and "model" in cur["levels"][1] and cur.get("segments"), "canvas r1: ONE packed canvas, GF active + FF level, from plan_trace")
    used = {g.get("layer", "0") for g in cur["segments"]} | {g.get("layer", "0") for g in cur["levels"][1]["model"]["segments"]}
    check(used <= {l["id"] for l in cur["layers"]} and all(l.get("visible") is True for l in cur["layers"]),
          "the project canvas declares every layer visible (else the editor imports it empty)")
    check(any(k.endswith("1-program/program/answers/brief.json") for k in json.load(open(os.path.join(R2, "Projects", "ZZ_E", "project.json"), encoding="utf-8"))["phases"]["program"].get("answers", [])),
          "the program's answers (brief.json) are kept in 1-program/program/answers/")
    st = json.load(open(os.path.join(R2, "Projects", "ZZ_E", "1-program", "program", "state.json"), encoding="utf-8"))
    check(not any(k.startswith(("inputs/", "work/")) for k in st["files"]), "private inputs/ and work/ are not in the shared state")

    rc, out = P(B, "resume", "ZZ_E", "--by", "Ravi")
    pb = os.path.join(B, "2-plan-design", "projects")
    check(rc == 0 and os.path.isdir(os.path.join(pb, "ZZ_E_GF")) and os.path.isdir(os.path.join(pb, "ZZ_E_FF")), "Ravi on machine B: one brief per floor from the shared plan_trace")
    rc, out = P(B, "handover", "ZZ_E", "--by", "Ravi"); check(rc != 0 and "not finished" in out, "an unfinished phase cannot be handed over")
    for t in ("S1_INTAKE", "S2_GEOMETRY"): sh(os.path.join(B, "2-plan-design"), "tools/run_task.py", "ZZ_E_GF", "--task", t)
    rc, out = P(B, "save", "ZZ_E", "--by", "Ravi", "--note", "GF geometry"); check(rc == 0 and "saved by Ravi" in out, "Ravi: unfinished phase saved")

    rc, out = P(A, "resume", "ZZ_E", "--by", "Meera")
    gf = os.path.join(A, "2-plan-design", "projects", "ZZ_E_GF")
    rows = open(os.path.join(gf, "TASKS.csv"), encoding="utf-8").read()
    check(rc == 0 and "S2_GEOMETRY,S2_GEOMETRY" in rows and ",done," in rows and os.path.exists(os.path.join(gf, "inputs", "plan.canvas.json")),
          "Meera on machine A: continues Plan/Design where Ravi stopped (tasks + generated canvas restored)")
    rc, out = sh(os.path.join(A, "2-plan-design"), "tools/run_task.py", "ZZ_E_GF"); check("S3_SCOPE" in out, "the next task on machine A is S3_SCOPE")

    for c in ("ZZ_E_GF", "ZZ_E_FF"):          # stand-in for space-brief S8: the roombrief it would publish
        d = os.path.join(R2, "Projects", "ZZ_E", "2-plan", "space-brief", c, "output"); os.makedirs(d, exist_ok=True)
        shutil.copy(os.path.join(FULL, "3-build", "projects", "INFRA_RECEPTION", "roombrief.json"), os.path.join(d, "roombrief.json"))
    rc, out = P(A, "handover", "ZZ_E", "--by", "Meera", "--force", "test: no scope answers"); check(rc == 0, "Meera: forced handover is allowed and recorded")
    m = json.load(open(os.path.join(R2, "Projects", "ZZ_E", "project.json"), encoding="utf-8"))
    check(m["phases"]["plan"].get("forced", {}).get("reason") == "test: no scope answers" and m["current"] == "build", "the manifest records the forced reason; Build is current")
    check(m["phases"]["plan"].get("based_on_rev") == 1, "Plan/Design records the canvas revision it started from")
    rc, out = P(A, "revs", "ZZ_E"); check(rc == 0 and "r1" in out and "program" in out, "revs lists the canvas history")
    cvf = os.path.join(tmp, "out.canvas.json"); rc, out = P(A, "canvas", "ZZ_E", "--out", cvf)
    check(rc == 0 and json.load(open(cvf, encoding="utf-8"))["levels"][0]["name"] == "GF", "canvas exports the current revision for the editor")

    rc, out = P(B, "resume", "ZZ_E", "--by", "Kiran")
    bp = os.path.join(B, "3-build", "projects", "ZZ_E_GF")
    rows = open(os.path.join(bp, "TASKS.csv"), encoding="utf-8").read()
    check(rc == 0 and os.path.exists(os.path.join(bp, "roombrief.json")), "Kiran: Build gets roombrief.json straight from Plan/Design (no deck)")
    check("S1_INTAKE,S1_INTAKE" in rows and rows.count("skipped") == 2, "deck intake S1–S2 marked skipped")

    for c in ("ZZ_E_GF", "ZZ_E_FF"):
        d = os.path.join(R2, "Projects", "ZZ_E", "3-build", "build-from-deck", c, "output"); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, f"{c}.blend"), "wb").write(b"BLENDER-v405 stand-in")
    rc, out = P(B, "handover", "ZZ_E", "--by", "Kiran", "--force", "test: no modelling"); check(rc == 0, "Kiran: Build handed over")
    rc, out = P(A, "resume", "ZZ_E", "--by", "Dev")
    pp = os.path.join(A, "4-present", "projects", "ZZ_E_GF")
    pj = json.load(open(os.path.join(pp, "project.json"), encoding="utf-8")) if os.path.exists(os.path.join(pp, "project.json")) else {}
    wd = os.path.normpath(os.path.join(pp, pj.get("work_dir", "work")))
    check(rc == 0 and os.path.exists(os.path.join(wd, "input", "ZZ_E_GF.blend")), "Dev: Present gets the Build .blend in its work dir (outside public/)")
    rc, out = P(A, "status", "ZZ_E")
    check(rc == 0 and all(n in out for n in ("Asha", "Ravi", "Meera", "Kiran", "Dev")), "status shows everyone who worked on the project")
    check(all(os.path.commonpath([tmp, os.path.normpath(w)]) == tmp for w in [wd]), "work dirs stay inside the machine folder")
finally:
    if os.environ.get("KEEP_STORE"):                   # leave the store for a look (e.g. the editor's Project panel)
        shutil.copytree(R2, os.environ["KEEP_STORE"], dirs_exist_ok=True); print(f"store kept → {os.environ['KEEP_STORE']}")
    shutil.rmtree(tmp, ignore_errors=True)

bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
