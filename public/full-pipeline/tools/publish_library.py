"""Publish this Full Pipeline as a versioned snapshot in the shared library.

    python tools/publish_library.py [--dry-run] [--store local:<dir>]

Writes  library/Pipelines/full-pipeline/<version>/<every file>   (the repo stays the place it is edited and tested)
        library/Pipelines/full-pipeline/<version>/release.json  (full-pipeline-release/1: version, kit, files + sha256)
        library/Pipelines/full-pipeline/latest.json             (which version is current)
A version that is already published is never overwritten: bump full.json "version" first.
`project.py` compares the local copy with latest.json and says when a newer release exists.
"""
import argparse, datetime, json, os, sys

FULL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(FULL, "_vendor"))
from pipeline_kit import r2   # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

PREFIX = "library/Pipelines/full-pipeline/"
SKIP_DIRS = {"__pycache__", "upstream"}


def files():
    out = []
    for dp, dns, fns in os.walk(FULL):
        dns[:] = [d for d in dns if d not in SKIP_DIRS and not d.startswith("ZZ_")]
        for f in fns:
            p = os.path.join(dp, f)
            out.append(os.path.relpath(p, FULL).replace(os.sep, "/"))
    return sorted(out)


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--store", default="")
    a = ap.parse_args(argv)
    store = r2.LocalStore(a.store[6:]) if a.store.startswith("local:") else r2.default_store(FULL)
    cfg = json.load(open(os.path.join(FULL, "full.json"), encoding="utf-8"))
    ver = cfg["version"]; base = f"{PREFIX}{ver}/"
    if store.head(base + "release.json") is not None:
        sys.exit(f"{base} is already published — bump full.json version before publishing again")
    rel = {"schema": "full-pipeline-release/1", "id": "full-pipeline", "version": ver, "kit": cfg.get("kit"),
           "published": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "phases": [{"id": p["id"], "label": p["label"], "dir": p["dir"], "pipeline": p["pipeline"]} for p in cfg["phases"]],
           "files": {}}
    total = 0
    for rel_path in files():
        data = open(os.path.join(FULL, rel_path), "rb").read(); total += len(data)
        rel["files"][rel_path] = {"sha256": r2.sha256(data), "bytes": len(data)}
        if not a.dry_run: store.put(base + rel_path, data, r2.content_type(rel_path))
    body = json.dumps(rel, ensure_ascii=False, indent=1).encode("utf-8")
    latest = json.dumps({"schema": "full-pipeline-latest/1", "version": ver, "release": base + "release.json", "published": rel["published"]}, indent=1).encode("utf-8")
    if not a.dry_run:
        store.put(base + "release.json", body, "application/json")
        store.put(PREFIX + "latest.json", latest, "application/json")
    print(f"{'(dry run) ' if a.dry_run else ''}full-pipeline {ver}: {len(rel['files'])} files, {total / 1e6:.1f} MB → {base}  (+ release.json, latest.json)")


if __name__ == "__main__":
    main()
