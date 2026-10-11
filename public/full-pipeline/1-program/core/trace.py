"""Parameter traceability: layer manifests, file fingerprints, staleness, usage.

A manifest is stored in every options/<ID>/option.json and selected.json under "layers":
  [{"layer": "project", "source": "params.json",
    "files": [{"base": "project", "path": "params.json", "sha256": "..."}],
    "supplied": ["court_ft"], "survived": ["court_ft"]}, ...]
base "project" = relative to projects/<CODE>/, base "root" = relative to the pipeline root.
"""
from pathlib import Path
from . import paths

def ref(base, path):
    return {"base": base, "path": str(path).replace("\\", "/")}

def file_of(pdir, r):
    return (Path(pdir) if r["base"] == "project" else paths.ROOT) / r["path"]

def fingerprint(pdir, refs):
    out = []
    for r in refs:
        f = file_of(pdir, r)
        out.append(dict(r, sha256=paths.sha256(f) if f.exists() else None))
    return out

def stamp(pdir, manifest):
    for m in manifest:
        m["files"] = fingerprint(pdir, m.get("files", []))
    return manifest

def changed(pdir, manifest):
    """[(layer, path, 'changed' | 'missing' | 'new')] for files whose content differs from the manifest."""
    out = []
    for m in manifest or []:
        for f in m.get("files", []):
            p = file_of(pdir, f); now = paths.sha256(p) if p.exists() else None
            if now != f.get("sha256"):
                out.append((m["layer"], f["path"], "missing" if now is None else ("new" if f.get("sha256") is None else "changed")))
    return out

def scope_dirs(pdir):
    pdir = Path(pdir); out = [("PROJECT", pdir)]
    out += [(d.name, d) for d in sorted((pdir / "parcels").glob("*")) if (d / "parcel.json").exists()]
    return out

def records(pdir):
    """Every stored resolution in a project: (scope, kind, path, data). kind = 'selected' or 'option:<ID>'."""
    out = []
    for scope, d in scope_dirs(pdir):
        if (d / "selected.json").exists(): out.append((scope, "selected", d / "selected.json", paths.load_json(d / "selected.json")))
        for f in sorted(d.glob("options/*/option.json")):
            out.append((scope, f"option:{f.parent.name}", f, paths.load_json(f)))
    return out

def all_projects():
    return [p for p in sorted((paths.ROOT / "projects").iterdir()) if p.is_dir() and p.name != "_TEMPLATE" and (p / "project.json").exists()]

def same_file(pdir, r, target):
    """Does manifest file ref r point at target (Path)?"""
    return file_of(pdir, r).resolve() == Path(target).resolve()
