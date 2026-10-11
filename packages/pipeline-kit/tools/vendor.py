"""Copy the kit into a pipeline, or check that a pipeline's copy matches the master.

    python packages/pipeline-kit/tools/vendor.py <pipeline root>            write <root>/_vendor/pipeline_kit + KIT.json
    python packages/pipeline-kit/tools/vendor.py <pipeline root> --check    exit 1 if the copy drifted from the master
    python packages/pipeline-kit/tools/vendor.py --bundle <kit.json>         the whole package as ONE JSON (library snapshot)
    python tools/vendor.py <pipeline root> --from-bundle <kit.json>          vendor from a library snapshot (hashes checked)
    python tools/vendor.py --unpack <kit.json> <dir>                         rebuild the package folder from a snapshot
    python packages/pipeline-kit/tools/vendor.py --bundle-split <dir>        snapshot as kit.json (manifest) + parts/*.json,
                                                                             one small file per kit file (connector-sized)
KIT.json records the version and the sha256 of every file, so a pipeline's self-test can detect a hand-edited copy.
The library takes only .json / .md / images through the connector, so a snapshot travels as kit.json
(pipeline-kit-bundle/1: every file's text and sha256); R2 users may also upload the raw files.
"""
import hashlib, json, os, shutil, sys

MASTER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline_kit")

def files(d):
    return sorted(f for f in os.listdir(d) if f.endswith(".py") or f == "VERSION")

def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()

def manifest(d): return {f: sha(os.path.join(d, f)) for f in files(d)}

PKG = os.path.dirname(MASTER)
PKG_FILES = ["README.md", "CHANGELOG.md", "tests/test_kit.py", "tools/vendor.py"]

def bundle():
    ver = open(os.path.join(MASTER, "VERSION"), encoding="utf-8").read().strip()
    rels = [f"pipeline_kit/{f}" for f in files(MASTER)] + [f for f in PKG_FILES if os.path.exists(os.path.join(PKG, f))]
    txt = {r: open(os.path.join(PKG, r), encoding="utf-8").read() for r in rels}
    return {"schema": "pipeline-kit-bundle/1", "kit": "pipeline_kit", "version": ver, "files": txt, "sha256": {r: sha(os.path.join(PKG, r)) for r in rels}}

def part_name(rel): return "parts/" + rel.replace("/", "__") + ".json"

def bundle_split(d):
    b = bundle(); os.makedirs(os.path.join(d, "parts"), exist_ok=True)
    for r, t in b["files"].items():
        json.dump({"path": r, "sha256": b["sha256"][r], "text": t}, open(os.path.join(d, part_name(r)), "w", encoding="utf-8"), ensure_ascii=False, indent=None)
    man = {k: b[k] for k in ("schema", "kit", "version", "sha256")}; man["parts"] = {r: part_name(r) for r in b["files"]}
    json.dump(man, open(os.path.join(d, "kit.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return man

def load_bundle(p):
    """A whole snapshot (files inline) or a manifest whose parts sit next to it (parts/*.json)."""
    b = json.load(open(p, encoding="utf-8"))
    if "parts" in b and "files" not in b:
        base = os.path.dirname(os.path.abspath(p)); b["files"] = {}
        for r, rel in b["parts"].items():
            part = json.load(open(os.path.join(base, rel), encoding="utf-8"))
            if part["path"] != r: raise SystemExit(f"part {rel} holds {part['path']}, expected {r}")
            b["files"][r] = part["text"]
    return b

def check_bundle(b):
    import hashlib as H
    bad = [r for r, t in b["files"].items() if H.sha256(t.encode("utf-8")).hexdigest() != b["sha256"].get(r)]
    if bad: raise SystemExit(f"bundle hashes do not match for {bad} — not using it")

def unpack(b, d):
    check_bundle(b)
    for r, t in b["files"].items():
        p = os.path.join(d, r); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="") as f: f.write(t)

def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    if sys.argv[1] == "--bundle":
        b = bundle(); json.dump(b, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, indent=None, separators=(",", ":"))
        print(f"bundle pipeline_kit {b['version']}: {len(b['files'])} files → {sys.argv[2]}"); return
    if sys.argv[1] == "--bundle-split":
        m = bundle_split(sys.argv[2]); print(f"bundle pipeline_kit {m['version']}: manifest + {len(m['parts'])} parts → {sys.argv[2]}"); return
    if sys.argv[1] == "--unpack":
        unpack(load_bundle(sys.argv[2]), sys.argv[3]); print(f"unpacked → {sys.argv[3]}"); return
    root = os.path.abspath(sys.argv[1]); dst = os.path.join(root, "_vendor", "pipeline_kit")
    if "--from-bundle" in sys.argv:
        b = load_bundle(sys.argv[sys.argv.index("--from-bundle") + 1]); check_bundle(b)
        if os.path.isdir(dst): shutil.rmtree(dst)
        os.makedirs(dst); kit = {r[len("pipeline_kit/"):]: t for r, t in b["files"].items() if r.startswith("pipeline_kit/")}
        for f, t in kit.items():
            with open(os.path.join(dst, f), "w", encoding="utf-8", newline="") as fh: fh.write(t)
        json.dump({"kit": "pipeline_kit", "version": b["version"], "source": f"library/Pipelines/_kit/{b['version']}/kit.json", "files": manifest(dst),
                   "rule": "never edit — change the master, run its tests, re-vendor"}, open(os.path.join(root, "_vendor", "KIT.json"), "w", encoding="utf-8"), indent=1)
        print(f"vendored pipeline_kit {b['version']} from the library snapshot → {dst} ({len(kit)} files)"); return
    want = manifest(MASTER); ver = open(os.path.join(MASTER, "VERSION"), encoding="utf-8").read().strip()
    if "--check" in sys.argv:
        have = manifest(dst) if os.path.isdir(dst) else {}
        diff = sorted(set(want) ^ set(have) | {f for f in want if f in have and want[f] != have[f]})
        print(f"kit {ver}: " + ("vendored copy matches the master" if not diff else f"DRIFT in {diff}")); sys.exit(1 if diff else 0)
    if os.path.isdir(dst): shutil.rmtree(dst)
    os.makedirs(dst)
    for f in files(MASTER): shutil.copy(os.path.join(MASTER, f), os.path.join(dst, f))
    json.dump({"kit": "pipeline_kit", "version": ver, "source": "app repo packages/pipeline-kit", "files": want,
               "rule": "never edit — change the master, run its tests, re-vendor"}, open(os.path.join(root, "_vendor", "KIT.json"), "w", encoding="utf-8"), indent=1)
    print(f"vendored pipeline_kit {ver} → {dst} ({len(want)} files)")

if __name__ == "__main__":
    main()
