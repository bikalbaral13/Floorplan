"""python packages/pipeline-kit/tests/test_sync.py — pull / publish against a LocalStore standing in for R2."""
import json, os, shutil, sys, tempfile
KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, KIT)
from pipeline_kit import paths as P, tasks as T, sync, r2

res = []
def check(c, msg): res.append((bool(c), msg))
tmp = tempfile.mkdtemp(prefix="sync_")
try:
    root = os.path.join(tmp, "pipe"); os.makedirs(root); open(os.path.join(root, "PIPELINE_ROOT"), "w").write("x")
    store = r2.LocalStore(os.path.join(tmp, "bucket"))
    for f in ("run.v1.schema.json",): store.put("library/Schemas/" + f, open(os.path.join(KIT, "schemas", f), "rb").read())
    store.put("library/Schemas/thing.v1.schema.json", json.dumps({"type": "object", "required": ["n"], "properties": {"n": {"type": "integer"}}}).encode())
    store.put("Projects/X/plan/handoff.json", b'{"n": 1}')
    P.save_json(os.path.join(root, "pipeline.json"), {
        "schema": "pipeline/1", "id": "demo", "title": "Demo", "version": "1.2.3", "phase": "plan", "kit": "0.2.0",
        "entry": {"agents": "AGENTS.md", "run": "x"},
        "inputs": [{"id": "handoff", "from": "Projects/{CODE}/plan/handoff.json", "required": True},
                   {"id": "brief", "from": "project:inputs/*.txt", "required": False}],
        "library_pins": [{"path": "library/Standards/DEFAULT.json", "local_copy": "standards/DEFAULT.json"}],
        "outputs": {"keep": [
            {"id": "thing", "local": "out/{CODE}.thing.json", "to": "Projects/{CODE}/demo/{CODE}.thing.json", "schema": "thing.v1"},
            {"id": "imgs", "local": "out/img/**/*.png", "to": "Projects/{CODE}/demo/img/", "binary": True},
            {"id": "final", "local": "project:final.json", "to": "Projects/{CODE}/demo/final.json", "after": "REVIEW"},
            {"id": "report", "local": "project:REPORT.md", "to": "Projects/{CODE}/runs/demo/"}], "temp": ["cache/**"]}})
    P.save_json(os.path.join(root, "standards", "DEFAULT.json"), {"a": 1})
    L = P.Layout(root); pdir = L.project_dir("X"); os.makedirs(pdir)
    P.save_json(os.path.join(pdir, "project.json"), {"code": "X", "work_dir": "../../../work/X"})
    fields = ["task_id", "stage", "title", "depends_on", "status", "approved"]
    T.save(pdir, [{"task_id": "BUILD", "stage": "BUILD", "status": "done"}, {"task_id": "REVIEW", "stage": "REVIEW", "depends_on": "BUILD", "status": "todo"}], fields)
    open(os.path.join(pdir, "REPORT.md"), "w").write("# report\n"); P.save_json(os.path.join(pdir, "final.json"), {"ok": True})
    wd = L.work_dir("X")
    P.save_json(os.path.join(wd, "out", "X.thing.json"), {"n": 3})
    for sub in ("a", "a/b"):
        os.makedirs(os.path.join(wd, "out", "img", sub), exist_ok=True); open(os.path.join(wd, "out", "img", sub, "p.png"), "wb").write(sub.encode())
    os.makedirs(os.path.join(wd, "cache"), exist_ok=True); open(os.path.join(wd, "cache", "junk.bin"), "wb").write(b"x")
    check(os.path.normpath(wd) == os.path.normpath(os.path.join(tmp, "work", "X")), "work dir resolves outside the pipeline")

    # pull
    r = sync.pull(L, "X", store, dry_run=True)
    check(r["status"] == "done" and not os.path.exists(os.path.join(wd, "cache", "Projects")), "pull dry run plans without downloading")
    r = sync.pull(L, "X", store)
    cp = os.path.join(wd, "cache", "Projects", "X", "plan", "handoff.json")
    check(r["status"] == "done" and open(cp, "rb").read() == b'{"n": 1}', "pull fetches an R2 input into cache/<key>")
    check(" same " in sync.pull(L, "X", store)["text"], "pull skips an input whose digest matches")
    check(P.load_json(os.path.join(wd, "cache", "pulled.json"))[0]["key"] == "Projects/X/plan/handoff.json", "pull records what it fetched")

    # publish: dry run
    n0 = len(store.puts); r = sync.publish(L, "X", store, dry_run=True)
    check(len(store.puts) == n0, "publish dry run uploads nothing (not even run.json)")
    fate = {i["key"]: i["fate"] for i in r["items"]}
    check(fate.get("Projects/X/demo/final.json") == "wait", "a gated output waits for its task")
    check(fate.get("Projects/X/demo/img/a/b/p.png") == "upload" and fate.get("Projects/X/demo/img/a/p.png") == "upload", "a ** glob keeps the sub-path under the key prefix")
    check(fate.get("Projects/X/runs/demo/REPORT.md") == "upload", "a folder key takes the file's name")
    check(not any("junk" in k or "cache" in k for k in fate), "temp files are never planned")

    # publish: partial (gate not done)
    r = sync.publish(L, "X", store, run_id="20261007T100000Z")
    check(r["status"] == "partial" and not r["run_errors"], f"first publish is partial and run.json validates {r['run_errors']}")
    check(store.get("Projects/X/demo/X.thing.json") == open(os.path.join(wd, "out", "X.thing.json"), "rb").read(), "kept file uploaded byte-identical")
    check(store.get("Projects/X/demo/final.json") is None, "the gated file is not uploaded")
    run = json.loads(store.get("Projects/X/runs/demo/20261007T100000Z/run.json"))
    check(run["inputs"][0]["key"] == "Projects/X/plan/handoff.json" and run["library"][0]["source"] == "local_copy" and "sha256" in run["library"][0],
          "run.json records the pulled input and the pinned standards digest")
    check(os.path.exists(os.path.join(wd, "runs", "20261007T100000Z.json")), "a local copy of run.json stays in the work dir")
    check(not any(k.startswith("library/") for k in store.puts[n0:]), "publish never writes into library/")

    # gate done → done; unchanged files skipped
    rows = T.load(pdir); T.get(rows, "REVIEW").update(status="done", approved="FIXTURE ok"); T.save(pdir, rows, fields)
    n1 = len(store.puts); r = sync.publish(L, "X", store, run_id="20261007T110000Z")
    up = store.puts[n1:]
    check(r["status"] == "done" and "Projects/X/demo/final.json" in up, "after the gate the output publishes and the run is done")
    check(set(up) == {"Projects/X/demo/final.json", "Projects/X/runs/demo/20261007T110000Z/run.json"}, f"unchanged files are skipped by digest ({len(up)} puts)")
    run = json.loads(store.get("Projects/X/runs/demo/20261007T110000Z/run.json"))
    check(any(o.get("skipped_unchanged") for o in run["outputs"]) and any(t.get("approved") == "FIXTURE ok" for t in run["tasks"]), "run.json marks skipped files and carries approvals")

    # a changed file re-uploads to the same key (latest only)
    open(os.path.join(wd, "out", "img", "a", "p.png"), "wb").write(b"new")
    n2 = len(store.puts); sync.publish(L, "X", store, run_id="20261007T120000Z")
    check("Projects/X/demo/img/a/p.png" in store.puts[n2:] and store.get("Projects/X/demo/img/a/p.png") == b"new", "a changed binary replaces the latest copy")

    # schema failure blocks that file
    P.save_json(os.path.join(wd, "out", "X.thing.json"), {"n": "three"})
    n3 = len(store.puts); r = sync.publish(L, "X", store, run_id="20261007T130000Z")
    check(r["status"] == "failed" and "Projects/X/demo/X.thing.json" not in store.puts[n3:], "an output that fails its schema is not uploaded and the run fails")
    check(json.loads(store.get("Projects/X/demo/X.thing.json"))["n"] == 3, "the last good copy in R2 is untouched")
    P.save_json(os.path.join(wd, "out", "X.thing.json"), {"n": 3})

    # contract breakages
    man = P.load_json(os.path.join(root, "pipeline.json"))
    man["outputs"]["keep"].append({"id": "bad", "local": "out/X.thing.json", "to": "Projects/OTHER/x.json"})
    man["outputs"]["keep"].append({"id": "many", "local": "out/img/**/*.png", "to": "Projects/{CODE}/one.png"})
    P.save_json(os.path.join(root, "pipeline.json"), man)
    fate = {i["id"]: (i["fate"], i.get("why", "")) for i in sync.plan(L, "X", store)}
    check(fate["bad"][0] == "invalid", "a keep outside Projects/<CODE>/ is refused")
    check(fate["many"][0] == "invalid" and "files for one key" in fate["many"][1], "many files to one key is refused")
    man["inputs"].append({"id": "gone", "from": "Projects/{CODE}/nope.json", "required": True}); P.save_json(os.path.join(root, "pipeline.json"), man)
    check(sync.pull(L, "X", store)["status"] == "blocked", "a missing required input blocks the pull")
    os.remove(os.path.join(root, "pipeline.json"))
    try: sync.load_contract(root); check(False, "a pipeline without pipeline.json is refused")
    except FileNotFoundError: check(True, "a pipeline without pipeline.json is refused")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

for g, m in res: print(("PASS " if g else "FAIL ") + m)
n = sum(g for g, _ in res); print(f"{n}/{len(res)} passed"); sys.exit(0 if n == len(res) else 1)
