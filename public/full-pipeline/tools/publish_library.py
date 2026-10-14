"""Publish the four phases of this Full Pipeline to the shared library as standalone pipelines.

    python tools/publish_library.py [--only <phase id>] [--dry-run] [--store local:<dir>]

For each phase in full.json (program, plan, build, present) it writes
        library/Pipelines/<Phase>/<pipeline id>-pipeline/<every file of that phase folder>
        library/Pipelines/<Phase>/<pipeline id>-pipeline/release.json   (pipeline-release/1: version, files + sha256)
e.g. 1-program → library/Pipelines/Program/program-pipeline/, beside Program/floorplan-tracer-pipeline.
Pipelines are grouped by phase (Program, Plan, Build, Present); library/Pipelines/index.json has each path.

The Full Pipeline itself is NOT published (its R2 copy was removed 2026-10-13; local backup in
backups/r2-full-pipeline-2026-10-13). It stays in the repo as the composer of the four phases.
Run `node tools/gen-pipeline-manifest.mjs` from the repo root first so each phase's manifest.json is current.
Files are overwritten in place; a file deleted locally is not removed from R2.
`project.py` compares each phase's pipeline.json version with its release.json and says when they differ.
"""
import argparse, datetime, json, os, sys

FULL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(FULL, "_vendor"))
from pipeline_kit import r2   # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

ROOT = "library/Pipelines/"
PHASE_DIR = {"program": "Program", "plan": "Plan", "build": "Build", "present": "Present"}
SKIP_DIRS = {"__pycache__", "upstream", "cache", "output", "work"}


def prefix(phase):
    """R2 folder of one phase: library/Pipelines/<Phase>/<pipeline id>-pipeline/."""
    return f"{ROOT}{PHASE_DIR[phase['id']]}/{phase['pipeline']}-pipeline/"


def files(root):
    out = []
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith("ZZ_")]
        for f in fns:
            out.append(os.path.relpath(os.path.join(dp, f), root).replace(os.sep, "/"))
    return sorted(out)


def publish(store, phase, dry):
    root = os.path.join(FULL, phase["dir"])
    pj = json.load(open(os.path.join(root, "pipeline.json"), encoding="utf-8"))
    base = prefix(phase)
    rel = {"schema": "pipeline-release/1", "id": pj["id"], "title": pj.get("title"), "version": pj.get("version"),
           "phase": phase["id"], "source": f"app repo public/full-pipeline/{phase['dir']}",
           "published": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "files": {}}
    total = 0
    for rel_path in files(root):
        data = open(os.path.join(root, rel_path), "rb").read(); total += len(data)
        rel["files"][rel_path] = {"sha256": r2.sha256(data), "bytes": len(data)}
        if not dry: store.put(base + rel_path, data, r2.content_type(rel_path))
    if not dry: store.put(base + "release.json", json.dumps(rel, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
    print(f"{'(dry run) ' if dry else ''}{pj['id']} {pj.get('version')}: {len(rel['files'])} files, {total / 1e6:.1f} MB → {base}  (+ release.json)")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="one phase id from full.json (program, plan, build, present)")
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--store", default="")
    a = ap.parse_args(argv)
    store = r2.LocalStore(a.store[6:]) if a.store.startswith("local:") else r2.default_store(FULL)
    phases = json.load(open(os.path.join(FULL, "full.json"), encoding="utf-8"))["phases"]
    if a.only:
        phases = [p for p in phases if a.only in (p["id"], p["pipeline"], p["dir"])]
        if not phases: sys.exit(f"no phase {a.only!r} in full.json")
    for p in phases: publish(store, p, a.dry_run)


if __name__ == "__main__":
    main()
