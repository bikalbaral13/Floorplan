"""python packages/pipeline-kit/tests/test_kit.py — builds a throwaway pipeline in a temp dir and checks every runner rule,
then the 0.2.0 modules (units, semver, standards, state, interop, read-only inputs)."""
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

    # ---- 0.2.0 ----
    from pipeline_kit import units as U, semver as V, standards as STD, state as SS, interop as I
    try: T.get(rows, "nope"); ok = False
    except KeyError: ok = True
    check(ok and T.deps_done(rows, T.get(rows, "A")), "tasks.get raises KeyError for an unknown task; deps_done")
    os.makedirs(os.path.join(pdir, "inputs"), exist_ok=True)
    try: P.save_json(os.path.join(pdir, "inputs", "x.json"), {}, guard=True); ok = False
    except PermissionError: ok = True
    check(ok and P.save_json(os.path.join(pdir, "work.json"), {"a": 1}, newline=True, guard=True) and open(os.path.join(pdir, "work.json"), encoding="utf-8").read().endswith("\n"), "inputs/ is read-only for guarded writes; newline option")
    open(os.path.join(pdir, "inputs", "s.jpg"), "wb").write(b"x"); open(os.path.join(pdir, "inputs", ".keep"), "w", encoding="utf-8").write("")
    check(list(P.inputs_snapshot(pdir)) == ["s.jpg"] and P.sha256(os.path.join(pdir, "inputs", "s.jpg")) == P.inputs_snapshot(pdir)["s.jpg"], "inputs snapshot hashes every input except .keep")
    check(U.fmt(10.5) == "10'-6\"" and abs(U.parse_ft("10'-6\"") - 10.5) < 1e-9 and abs(U.parse_ft("3200mm") - 3200 / 304.8) < 1e-9 and U.js_round(2.5) == 3, "units: feet-inch format and parsing, JS rounding")
    check(V.compat("0.2", "0.2.3") and V.compat("0.2.0", "0.4.1") and not V.compat("0.3", "0.2.9") and not V.compat("1.0", "0.9.9"), "semver compat")
    sd = os.path.join(tmp, "standards"); os.makedirs(sd)
    json.dump({"id": "DEFAULT", "walls": {"height": 2.7, "outer_t": 0.23}, "objects": {"DOOR_HINGED": {"width_ft": 3}, "_src": "x"}}, open(os.path.join(sd, "DEFAULT.json"), "w", encoding="utf-8"))
    json.dump({"id": "FIRM", "extends": "DEFAULT", "walls": {"height": 3.0}, "objects": {"STAIR": {"tread_in": 10}}}, open(os.path.join(sd, "FIRM.json"), "w", encoding="utf-8"))
    s = STD.load(sd, "FIRM")
    check(s["walls"] == {"height": 3.0, "outer_t": 0.23} and s["_chain"] == ["DEFAULT", "FIRM"] and STD.objects(sd, "FIRM") == {"DOOR_HINGED": {"width_ft": 3}, "STAIR": {"tread_in": 10}}, "standards: extends merges deeply, child wins; objects view drops note keys")
    st1 = SS.pack("program", "0.5.0", "P1", "Plot", {"TASKS.csv": "a"}, next_task="P2-BRIEF")
    st2 = SS.pack("space-brief", "0.5.0", "P1", "Plot", {"x.json": "{}"}, link="https://claude.ai/artifact/X")
    idx = SS.merge_index(SS.merge_index(None, SS.entry(st1)), SS.entry(st2))
    check(set(idx["projects"]["P1"]["pipelines"]) == {"program", "space-brief"} and idx["projects"]["P1"]["pipelines"]["space-brief"]["link"].endswith("/X"), "state: one registry entry per project holds every pipeline")
    try: SS.pack("p", "1", "C", "T", {"big.json": "x" * 500_000}); ok = False
    except ValueError: ok = True
    check(ok, "state: a bundle too large for one connector write is refused")
    up = os.path.join(tmp, "restore"); SS.unpack(st1, up)
    check(open(os.path.join(up, "TASKS.csv"), encoding="utf-8").read() == "a", "state: unpack writes the files back")
    # interop: two rooms sharing a wall with a door, plus an open-air porch on the front; mm, Y north, inner faces
    tr = {"rooms": [{"code": "A", "name": "Living", "kind": "living", "polygon": [[115, 115], [3885, 115], [3885, 3885], [115, 3885]]},
                    {"code": "B", "name": "Bed", "kind": "bedroom", "polygon": [[4115, 115], [7885, 115], [7885, 3885], [4115, 3885]]},
                    {"code": "C", "name": "Porch", "kind": "porch", "polygon": [[115, 4115], [7885, 4115], [7885, 5885], [115, 5885]]}],
          "doors": [{"id": "D1", "rooms": ["A", "B"], "swing_room": "B", "hinge": [4115, 1500], "latch": [4115, 2400]}],
          "assumptions": ["room lines are wall centrelines, inset 115 mm (wall_mm 230)."]}
    cv, notes = I.plan_trace_to_canvas(tr)
    lay = {}; [lay.__setitem__(s["layer"], lay.get(s["layer"], 0) + 1) for s in cv["segments"]]
    door = next(s for s in cv["segments"] if s["layer"] == "door")
    check(len(cv["spaces"]) == 3 and lay.get("door") == 1 and abs(door["attachments"][1]["params"]["width"] - 0.9) < 1e-6, "interop: rooms become spaces, the door splits the shared wall at its width")
    check(lay.get("wall") == 8 and any("open-air" in n for n in notes), "interop: shared walls are drawn once; an open-air room's free edges get no wall")
    check(all(len(sp["nodeIds"]) >= 4 for sp in cv["spaces"]) and cv["settings"]["pixelsPerMeter"] == 50.0 and cv["nodes"][0]["y"] <= 0, "interop: closed space loops, canvas y down")
    used = {g.get("layer", "0") for g in cv["segments"]} | {"0"}
    check(used <= {l["id"] for l in cv["layers"]} and all(l.get("visible") is True and "name" in l for l in cv["layers"]),
          "interop: every used layer is declared and visible (a bare {id} layer imports hidden in the editor)")
    # a library snapshot (one JSON) rebuilds the same files, and a pipeline can vendor from it
    import subprocess
    V = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "vendor.py")
    bj = os.path.join(tmp, "kit.json"); subprocess.run([sys.executable, V, "--bundle", bj], check=True, capture_output=True)
    pr = os.path.join(tmp, "pipe"); os.makedirs(pr); open(os.path.join(pr, "PIPELINE_ROOT"), "w", encoding="utf-8").write("x")
    r = subprocess.run([sys.executable, V, pr, "--from-bundle", bj], capture_output=True, text=True)
    master = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline_kit")
    same = all(open(os.path.join(pr, "_vendor", "pipeline_kit", f), "rb").read() == open(os.path.join(master, f), "rb").read() for f in os.listdir(master) if f.endswith(".py") or f == "VERSION")
    check(r.returncode == 0 and same, "a kit.json library snapshot vendors byte-identical files")
    sd = os.path.join(tmp, "split"); subprocess.run([sys.executable, V, "--bundle-split", sd], check=True, capture_output=True)
    pr2 = os.path.join(tmp, "pipe2"); os.makedirs(pr2); open(os.path.join(pr2, "PIPELINE_ROOT"), "w", encoding="utf-8").write("x")
    r2 = subprocess.run([sys.executable, V, pr2, "--from-bundle", os.path.join(sd, "kit.json")], capture_output=True, text=True)
    big = max(os.path.getsize(os.path.join(sd, "parts", f)) for f in os.listdir(os.path.join(sd, "parts")))
    check(r2.returncode == 0 and json.load(open(os.path.join(pr2, "_vendor", "KIT.json"), encoding="utf-8"))["files"] == json.load(open(os.path.join(pr, "_vendor", "KIT.json"), encoding="utf-8"))["files"] and big < 20_000,
          f"a split snapshot (manifest + parts ≤ {big / 1e3:.0f} kB) vendors the same files")
    b = json.load(open(bj, encoding="utf-8")); b["files"]["pipeline_kit/paths.py"] += "# edited"; json.dump(b, open(bj, "w", encoding="utf-8"))
    check(subprocess.run([sys.executable, V, pr, "--from-bundle", bj], capture_output=True).returncode != 0, "a tampered snapshot is refused")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
