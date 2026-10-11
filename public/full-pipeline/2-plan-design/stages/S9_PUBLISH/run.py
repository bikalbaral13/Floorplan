import datetime, glob, json, os, shutil, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from pipeline_kit import tasks as T
from core.ctx import sha256, validate, VERSION

SELF = "S9_PUBLISH"

def run(ctx):
    pj = json.load(open(os.path.join(ROOT, "pipeline.json"), encoding="utf-8")); rid = ctx.run_id(); fs = []
    stage = ctx.w("publish"); shutil.rmtree(stage, ignore_errors=True)
    rows = {r["task_id"]: r for r in T.load(ctx.pdir)}
    outputs = []
    for k in pj["outputs"]["keep"]:
        if k.get("after") and k["after"] != SELF and rows.get(k["after"], {}).get("status") != "done":
            fs.append(F("warn", "keep", k["id"], f"waits for {k['after']}")); continue
        pat = k["local"].replace("{CODE}", ctx.code)
        srcs = glob.glob(ctx.p(pat[8:])) if pat.startswith("project:") else glob.glob(os.path.join(ctx.layout.work_dir(ctx.code), pat))
        if not srcs: fs.append(F("fail", "keep", k["id"], f"nothing matches {pat}")); continue
        for sp in srcs:
            to = k["to"].replace("{CODE}", ctx.code)
            key = to + os.path.basename(sp) if to.endswith("/") else to
            dst = os.path.join(stage, key); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy(sp, dst)
            o = {"id": k["id"], "key": key, "local": os.path.relpath(sp, ctx.pdir), "sha256": sha256(sp), "bytes": os.path.getsize(sp)}
            if k.get("schema"): o["schema"] = k["schema"]
            if k.get("binary"): o["binary"] = True
            outputs.append(o)
    intake = ctx.load("intake.json", default={"inputs": []})
    kit = json.load(open(os.path.join(ROOT, "_vendor", "KIT.json"), encoding="utf-8")); st = ctx.load("run.state.json")
    smap = {"doing": "running"}
    tasks = []
    for r in rows.values():
        t = {"task_id": r["task_id"], "status": "done" if r["task_id"] == SELF else smap.get(r["status"], r["status"])}
        if r.get("approved"): t["approved"] = r["approved"]
        if r.get("notes"): t["notes"] = r["notes"][:300]
        tasks.append(t)
    lib = [{"path": "library/Pipelines/_kit/", "version": kit["version"], "source": "vendored"},
           {"path": "library/Standards/DEFAULT.json", "version": ctx.standards["version"], "sha256": sha256(os.path.join(ROOT, "standards", "DEFAULT.json")), "source": "local_copy"},
           {"path": "library/Schemas/canvas.v1.schema.json", "source": "local_copy", "sha256": sha256(os.path.join(ROOT, "schemas", "library", "canvas.v1.schema.json"))},
           {"path": "library/Schemas/run.v1.schema.json", "source": "local_copy", "sha256": sha256(os.path.join(ROOT, "schemas", "library", "run.v1.schema.json"))}]
    decks = ctx.load("decks.json", default={}).get("versions", [])
    runj = {"schema": "run/1", "run_id": rid, "project": ctx.code, "pipeline": {"id": pj["id"], "version": VERSION, "kit": kit["version"]}, "agent": "claude",
            "fixture": ctx.fixture, "started": st["started"], "finished": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
            "status": "done" if all(t["status"] in ("done", "skipped") for t in tasks) else "partial",
            "inputs": intake["inputs"], "library": lib, "outputs": outputs, "tasks": tasks,
            "notes": f"apps: {ctx.load('apps.json', default={}).get('url', 'not published')}; decks: " + (", ".join(f"v{d['k']} I{d['issue']}" for d in decks) or "none")}
    ok, msg = validate(runj, "run.v1"); fs.append(F("info" if ok else "fail", "run.v1", "run.json", msg))
    ctx.save("run.json", runj)
    rk = f"Projects/{ctx.code}/runs/space-brief/{rid}/run.json"; dst = os.path.join(stage, rk); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy(ctx.p("run.json"), dst)
    up = os.environ.get("BP_R2_UPLOAD")   # e.g.  node ../../tools/r2.mjs put {src} {key}
    if up:
        for dp, _, fl in os.walk(stage):
            for f in fl:
                p = os.path.join(dp, f); key = os.path.relpath(p, stage).replace(os.sep, "/")
                r = subprocess.run(up.format(src=p, key=key), shell=True, capture_output=True, text=True, encoding="utf-8")
                if r.returncode: fs.append(F("fail", "upload", key, r.stderr.strip()[:200]))
        how = "uploaded to R2"
    else:
        fs.append(F("warn", "upload", "R2", "BP_R2_UPLOAD not set — outputs staged in work/publish/, not uploaded")); how = "staged (not uploaded)"
    return result(status_from(fs), f"{len(outputs)} outputs + run.json {how} under Projects/{ctx.code}/", ["publish/", "run.json"], fs)
