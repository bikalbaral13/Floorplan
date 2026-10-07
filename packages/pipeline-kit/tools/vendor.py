"""Copy the kit into a pipeline, or check that a pipeline's copy matches the master.

    python packages/pipeline-kit/tools/vendor.py <pipeline root>            write <root>/_vendor/pipeline_kit + KIT.json
    python packages/pipeline-kit/tools/vendor.py <pipeline root> --check    exit 1 if the copy drifted from the master
KIT.json records the version and the sha256 of every file, so a pipeline's self-test can detect a hand-edited copy.
"""
import hashlib, json, os, shutil, sys

MASTER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline_kit")

def files(d):
    return sorted(f for f in os.listdir(d) if f.endswith(".py") or f == "VERSION")

def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()

def manifest(d): return {f: sha(os.path.join(d, f)) for f in files(d)}

def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    root = os.path.abspath(sys.argv[1]); dst = os.path.join(root, "_vendor", "pipeline_kit")
    want = manifest(MASTER); ver = open(os.path.join(MASTER, "VERSION")).read().strip()
    if "--check" in sys.argv:
        have = manifest(dst) if os.path.isdir(dst) else {}
        diff = sorted(set(want) ^ set(have) | {f for f in want if f in have and want[f] != have[f]})
        print(f"kit {ver}: " + ("vendored copy matches the master" if not diff else f"DRIFT in {diff}")); sys.exit(1 if diff else 0)
    if os.path.isdir(dst): shutil.rmtree(dst)
    os.makedirs(dst)
    for f in files(MASTER): shutil.copy(os.path.join(MASTER, f), os.path.join(dst, f))
    json.dump({"kit": "pipeline_kit", "version": ver, "source": "app repo packages/pipeline-kit", "files": want,
               "rule": "never edit — change the master, run its tests, re-vendor"}, open(os.path.join(root, "_vendor", "KIT.json"), "w"), indent=1)
    print(f"vendored pipeline_kit {ver} → {dst} ({len(want)} files)")

if __name__ == "__main__":
    main()
