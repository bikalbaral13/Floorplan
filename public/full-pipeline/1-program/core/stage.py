"""Stage context, results, findings and stage loading.

Shared stages: stages/<ID>/ (stage.json + run.py). Typology-owned stages: typologies/<T>/stages/<ID>/,
referenced in a plan as '+<ID>'. Tasks carry a scope: PROJECT, or a parcel code (files under parcels/<P>/).
"""
import importlib.util
from dataclasses import dataclass, field
from pathlib import Path
from . import paths, typology as typ, objects

from pipeline_kit.findings import F, result, summarize      # one finding / result shape for every pipeline
from pipeline_kit.semver import compat                         # noqa: F401  (stage / typology version pins)

@dataclass
class Ctx:
    code: str
    task: dict
    approved: str = ""
    pdir: Path = field(init=False)
    project: dict = field(init=False)
    scope: str = field(init=False)
    sdir: Path = field(init=False)
    def __post_init__(self):
        self.pdir = paths.project_dir(self.code)
        self.project = paths.load_json(self.pdir / "project.json")
        self.scope = self.task.get("scope") or "PROJECT"
        self.sdir = self.pdir if self.scope == "PROJECT" else self.pdir / "parcels" / self.scope
        self._T = None
    # project-level paths
    def rel(self, p): return str(Path(p).resolve().relative_to(self.pdir.resolve()))
    def p(self, *parts): return self.pdir.joinpath(*parts)
    def has(self, *parts): return self.p(*parts).exists()
    def load(self, *parts): return paths.load_json(self.p(*parts))
    def save(self, rel, data): paths.save_json(self.p(rel), data); return rel
    def save_text(self, rel, text): paths.save_text(self.p(rel), text); return rel
    # scope-level paths (project root, or parcels/<P>/)
    def s(self, *parts): return self.sdir.joinpath(*parts)
    def shas(self, *parts): return self.s(*parts).exists()
    def sload(self, *parts): return paths.load_json(self.s(*parts))
    def ssave(self, rel, data): paths.save_json(self.s(rel), data); return self.rel(self.s(rel))
    def ssave_text(self, rel, text): paths.save_text(self.s(rel), text); return self.rel(self.s(rel))
    # typology pinned for this scope
    def pin(self):
        if self.scope != "PROJECT": return paths.load_json(self.sdir / "parcel.json")
        return {k: self.project.get(k, "") for k in ("typology", "typology_version", "variant")}
    def typology(self):
        if self._T is None:
            pin = self.pin()
            if not pin.get("typology") and not pin.get("variant"):
                raise LookupError("no typology pinned for this scope yet — P2 match decision, then tools/set_typology.py")
            self._T = typ.for_pin(self.pdir, pin)
        return self._T
    def standards(self):
        return objects.standards(self.project.get("standards", "DEFAULT"))

def stage_dir(sid, T=None):
    if sid.startswith("+"):
        if T is None: raise LookupError(f"{sid} is typology-owned; the scope has no typology")
        return T.stage_dir(sid)
    return paths.ROOT / "stages" / sid

def stage_meta(sid, T=None):
    return paths.load_json(stage_dir(sid, T) / "stage.json")

def load_stage(sid, T=None):
    d = stage_dir(sid, T)
    spec = importlib.util.spec_from_file_location(f"stage_{sid.lstrip('+')}", d / "run.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

def inputs_changed(ctx):
    snap = ctx.p("work", "inputs.sha.json")
    if not snap.exists(): return []
    before, now = paths.load_json(snap), paths.inputs_snapshot(ctx.pdir)
    return sorted(k for k in set(before) | set(now) if before.get(k) != now.get(k))

