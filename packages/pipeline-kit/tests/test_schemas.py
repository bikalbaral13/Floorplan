"""python packages/pipeline-kit/tests/test_schemas.py — pipeline/1 and run/1: every pipeline.json in the app repo
validates, its keep-paths resolve on a real project, a real run.json example validates, and deliberate breakages fail.
Writes schemas/examples/*.example.json (the files published next to the schemas)."""
import copy, glob, hashlib, json, os, sys
from jsonschema import Draft202012Validator

KIT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(KIT))
SCH = os.path.join(KIT, "schemas")
res = []
def check(c, msg): res.append((bool(c), msg))
def load(p): return json.load(open(p, encoding="utf-8"))
def ok(v, doc): return not list(v.iter_errors(doc))

PV = Draft202012Validator(load(os.path.join(SCH, "pipeline.v1.schema.json")))
RV = Draft202012Validator(load(os.path.join(SCH, "run.v1.schema.json")), format_checker=Draft202012Validator.FORMAT_CHECKER)

# 1. every pipeline.json in the app repo
pjs = sorted(glob.glob(os.path.join(REPO, "public", "*-pipeline", "pipeline.json")))
check(len(pjs) == 3, f"3 pipeline.json files found ({len(pjs)})")
for p in pjs:
    errs = [e.message for e in PV.iter_errors(load(p))]
    check(not errs, f"{os.path.basename(os.path.dirname(p))}/pipeline.json valid {errs[:2]}")
pipes = {load(p)["id"]: (os.path.dirname(p), load(p)) for p in pjs}

# 2. tracer keep-paths resolve on WINDSOR_B1 (outputs whose gate is still todo may be missing)
root, man = pipes["floorplan-tracer"]
code = "WINDSOR_B1"; pdir = os.path.join(root, "projects", code)
proj = load(os.path.join(pdir, "project.json")); wdir = os.path.normpath(os.path.join(pdir, proj["work_dir"]))
done = {r["task_id"] for r in __import__("csv").DictReader(open(os.path.join(pdir, "TASKS.csv"), encoding="utf-8")) if r["status"] == "done"}
def resolve(local):
    local = local.replace("{CODE}", code)
    return glob.glob(os.path.join(pdir, local[8:]) if local.startswith("project:") else os.path.join(wdir, local))
outs = []
for k in man["outputs"]["keep"]:
    hits = resolve(k["local"])
    if not hits and k.get("after") and k["after"] not in done:
        check(True, f"tracer keep '{k['id']}' not made yet (waits for {k['after']})"); continue
    check(hits, f"tracer keep '{k['id']}' resolves ({len(hits)} file(s))")
for k in man["outputs"]["keep"]:
    for h in resolve(k["local"]):
        b = open(h, "rb").read()
        to = k["to"].replace("{CODE}", code)
        outs.append({"id": k["id"], "key": to + os.path.basename(h) if to.endswith("/") else to, "local": os.path.relpath(h, REPO).replace("\\", "/"),
                     "sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b), **({"schema": k["schema"]} if "schema" in k else {}), **({"binary": True} if k.get("binary") else {})})
check(len({o["key"] for o in outs}) == len(outs), "no two kept files map to the same R2 key")
check(not any(o["key"].startswith("library/") for o in outs), "a run never writes into library/ through keep")

# 3. a real run.json example (WINDSOR_B1, from its task sheet)
std = open(os.path.join(root, "standards", "DEFAULT.json"), "rb").read()
rows = list(__import__("csv").DictReader(open(os.path.join(pdir, "TASKS.csv"), encoding="utf-8")))
run = {"schema": "run/1", "run_id": "20261006T161606Z", "project": code,
       "pipeline": {"id": man["id"], "version": man["version"], "kit": man["kit"]}, "agent": "claude-code", "fixture": True,
       "started": "2026-10-06T14:44:45Z", "finished": "2026-10-06T16:16:06Z", "status": "partial",
       "inputs": [{"id": "source", "key": proj["underlay_src"].split(".r2.dev/")[-1], "sha256": hashlib.sha256(open(os.path.join(wdir, "pages", "Windsor_park.jpeg"), "rb").read()).hexdigest(),
                   "bytes": os.path.getsize(os.path.join(wdir, "pages", "Windsor_park.jpeg"))}],
       "library": [{"path": "library/Standards/DEFAULT.json", "sha256": hashlib.sha256(std).hexdigest(), "source": "local_copy"},
                   {"path": "library/Pipelines/_kit/", "version": man["kit"], "source": "vendored"}],
       "outputs": outs,
       "tasks": [{"task_id": r["task_id"], "status": r["status"], **({"approved": r["approved"]} if r["approved"] else {})} for r in rows],
       "notes": "example built from the 2026-10-06 regression run; S8_REVIEW not approved, so only ungated outputs would publish"}
errs = [e.message for e in RV.iter_errors(run)]
check(not errs, f"run.json example valid {errs[:2]}")

# 4. deliberate breakages must fail
def broken(v, doc, mut, msg):
    d = copy.deepcopy(doc); mut(d); check(not ok(v, d), "rejects: " + msg)
broken(PV, man, lambda d: d.update(schema="pipeline/2"), "wrong pipeline schema version")
broken(PV, man, lambda d: d["outputs"].pop("keep"), "outputs without keep")
broken(PV, man, lambda d: d["outputs"]["keep"][0].update(to="library/Designs/x.json"), "keep that writes into library/")
broken(PV, man, lambda d: d["library_pins"].append({"path": "Designs/x.json"}), "pin outside library/")
broken(PV, man, lambda d: d.update(phase="render"), "unknown phase")
broken(PV, man, lambda d: d.update(version="1.0"), "non-semver version")
broken(RV, run, lambda d: d["outputs"][0].update(sha256="abc"), "output with a bad hash")
broken(RV, run, lambda d: d["outputs"][0].update(key="library/x.json"), "run output keyed into library/")
broken(RV, run, lambda d: d.update(status="ok"), "unknown run status")
broken(RV, run, lambda d: d.update(started="yesterday"), "non-ISO timestamp")
broken(RV, run, lambda d: d.update(promoted=[{"path": "library/Families/X/", "version": "1.0.0"}]), "promotion without an approval")

os.makedirs(os.path.join(SCH, "examples"), exist_ok=True)
json.dump(run, open(os.path.join(SCH, "examples", "run.v1.example.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
json.dump(man, open(os.path.join(SCH, "examples", "pipeline.v1.example.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)

for g, m in res: print(("PASS " if g else "FAIL ") + m)
n = sum(g for g, _ in res); print(f"{n}/{len(res)}"); sys.exit(0 if n == len(res) else 1)
