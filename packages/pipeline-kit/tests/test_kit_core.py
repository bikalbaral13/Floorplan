"""python packages/pipeline-kit/tests/test_kit.py — builds a throwaway pipeline in a temp dir and checks every runner rule."""
import json, os, shutil, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from pipeline_kit import paths as P, tasks as T, runner as R, findings as FN, report

res = []
def check(c, msg): res.append((bool(c), msg))

tmp = tempfile.mkdtemp(prefix="kit_")
try:
    open(os.path.join(tmp, "PIPELINE_ROOT"), "w", encoding="utf-8").write("x")
    st = os.path.join(tmp, "stages")
    def stage(sid, kind, gate, body):
        os.makedirs(os.path.join(st, sid)); json.dump({"id": sid, "title": sid, "kind": kind, "gate": gate}, open(os.path.join(st, sid, "stage.json"), "w", encoding="utf-8"))
        open(os.path.join(st, sid, "run.py"), "w", encoding="utf-8").write("from pipeline_kit.findings import result, F\n" + body)
    stage("A", "script", False, "def run(ctx):\n    open(ctx.w('a.txt'),'w').write('a')\n    return result('done','a ran',['a.txt'],decisions=['chose a'])\n")
    stage("B", "agent", False, "def run(ctx):\n    return result('done' if ctx.has('in.json') else 'blocked','needs in.json')\n")
    stage("C", "script", True, "def run(ctx):\n    return result('done','approved: '+ctx.approved)\n")
    stage("D", "script", False, "def run(ctx):\n    raise RuntimeError('boom')\n")
    L = P.Layout(tmp); fields = ["task_id", "stage", "title", "depends_on", "status", "approved", "started", "finished", "output", "notes"]
    pdir = L.project_dir("X"); os.makedirs(pdir)
    P.save_json(os.path.join(pdir, "project.json"), {"code": "X", "work_dir": "../../_work/X"})
    T.save(pdir, [{"task_id": s, "stage": s, "title": s, "depends_on": d, "status": "todo"} for s, d in (("A", ""), ("B", "A"), ("C", "B"), ("D", "C"))], fields)
    run = R.Runner(L, fields, st, log_sep=" ")
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    check("waits for A" in run.run_one("X", "B"), "a task waits for its dependencies")
    check(run.run_one("X", "A").startswith("A: DONE") and os.path.exists(os.path.join(tmp, "_work", "X", "a.txt")), "a script stage runs and writes into the work dir outside the project")
    msgs = run.run_all("X", log=lambda m: None)
    check(any("B: BLOCKED" in m for m in msgs) and T.get(T.load(pdir), "B")["status"] == "blocked", "run_all stops when an agent stage needs its file")
    P.save_json(os.path.join(pdir, "in.json"), {}); msgs = run.run_all("X", log=lambda m: None)
    check(any("GATE: needs the user" in m for m in msgs) and T.get(T.load(pdir), "C")["status"] == "todo", "run_all stops at a gate and never runs it")
    check("is a gate" in run.run_one("X", "C"), "a gate refuses to run without the user's words")
    check(run.run_one("X", "C", approved="yes, go — user 2026-10-06").startswith("C: DONE") and T.get(T.load(pdir), "C")["approved"].startswith("yes"), "a gate runs with the user's words, recorded on the row")
    out = run.run_one("X", "D")
    check(out.startswith("D: FAILED") and "boom" in out, "an exception becomes a failed task with the cause")
    run.run_one("X", "A")
    rows = T.load(pdir)
    check([T.get(rows, t)["status"] for t in "BCD"] == ["todo"] * 3, "re-running a done task resets everything downstream")
    log = open(os.path.join(pdir, "REPORT.md"), encoding="utf-8").read()
    check("[decision] chose a" in log and "C done: approved" in log, "results and decisions are appended to REPORT.md")
    P.save_json(os.path.join(pdir, "project.json"), {"code": "X", "work_dir": "../../_work/X", "fixture": True})
    run.run_one("X", "B")
    check("regression fixture" in run.run_one("X", "C", approved="yes"), "a FIXTURE project rejects approvals that could pass for a user's")
    check(run.run_one("X", "C", approved="FIXTURE — test").startswith("C: DONE"), "a FIXTURE project accepts FIXTURE approvals")
    item = os.path.join(tmp, "item"); os.makedirs(item)
    for k in range(2): report.write_item_report(item, {"code": "I1", "status": "ok", "tris": 10 + k, "flags": ["f"]}, lines=[lambda r: f"- tris {r['tris']}"], sections=[("flags", "flags")], history_keys=("status", "tris"))
    h = json.load(open(os.path.join(item, "report.json"), encoding="utf-8"))["history"]
    check(len(h) == 2 and h[-1]["tris"] == 11 and "## flags" in open(os.path.join(item, "report.md"), encoding="utf-8").read(), "item reports keep history")
    check(FN.status_from([FN.F("warn", "x", "y", "z")]) == "done" and FN.status_from([FN.F("fail", "x", "y", "z")]) == "failed", "status_from findings")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
