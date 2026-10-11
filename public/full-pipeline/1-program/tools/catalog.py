"""python tools/catalog.py — typologies (with frozen versions, lineage, stage plans), objects, standards, shared stages."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, objects, trace, typology as typ

print("TYPOLOGIES")
for tid, info in typ.registry().items():
    d = paths.typology_dir(tid); frozen = sorted(p.name for p in (d / "versions").glob("*")) if (d / "versions").exists() else []
    try:
        T = typ.load(tid); line = " -> ".join(T.lineage); pl = ", ".join(T.plan); fns = ", ".join(f for f in typ.FUNCTIONS if T.has(f))
    except Exception as e:
        line, pl, fns = f"(cannot load: {e})", "", ""
    print(f"  {tid} {info['version']} [{info['status']}] {line}\n    frozen: {frozen or '-'}  projects: {info.get('projects', [])}\n    plan: {pl}\n    functions: {fns}")
print("OBJECTS")
for oid, info in objects.registry().items():
    d = paths.ROOT / "objects" / oid; frozen = sorted(p.name for p in (d / "versions").glob("*")) if (d / "versions").exists() else []
    print(f"  {oid} {info['version']} [{info['status']}] frozen {frozen or '-'} used by {info.get('used_by', [])}")
print("STANDARDS:", ", ".join(p.stem for p in sorted((paths.ROOT / "standards").glob("*.json"))))
print("SHARED STAGES")
for d in sorted((paths.ROOT / "stages").iterdir()):
    if (d / "stage.json").exists():
        m = paths.load_json(d / "stage.json"); print(f"  {m['id']} {m['version']} scope={m['scope']} requires={m.get('requires', [])}")

print("USAGE (from the layer manifests of every selection and option)")
use = {}
for pdir in trace.all_projects():
    pj = paths.load_json(pdir / "project.json")
    pins = [("PROJECT", pj.get("variant") or (f"{pj.get('typology')}@{pj.get('typology_version')}" if pj.get("typology") else "-"))]
    pins += [(d.name, paths.load_json(d / "parcel.json").get("resolved", "?")) for d in sorted((pdir / "parcels").glob("*")) if (d / "parcel.json").exists()]
    print(f"  {pdir.name}: standards {pj.get('standards', 'DEFAULT')}; pins " + ", ".join(f"{s}={r}" for s, r in pins))
    for scope, kind, f, rec in trace.records(pdir):
        stale = trace.changed(pdir, rec.get("layers"))
        for m in rec.get("layers", []):
            if m["layer"] in ("standards", "project", "parcel", "option"):
                for fr in m["files"]:
                    key = fr["path"] if fr["base"] == "root" else f"projects/{pdir.name}/{fr['path']}"
                    use.setdefault(key, []).append(f"{pdir.name}/{scope}/{kind}{' (survived %d)' % len(m['survived'])}{' STALE' if any(p == fr['path'] for _, p, _ in stale) else ''}")
for k in sorted(use):
    print(f"  {k}\n    " + "\n    ".join(use[k]))
