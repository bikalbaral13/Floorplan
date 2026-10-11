"""Stages and the task context.

A stage is a folder <stages_dir>/<ID>/ with
  stage.json  {id, version, title, kind: script|agent|blender, gate: bool, summary, inputs, outputs, checks}
  run.py      run(ctx) -> findings.result(...)
  prompt.md   (agent stages) what the agent must author, carrying the domain rules
kind  script — deterministic · agent — validates a file the agent wrote · blender — runs inside Blender
gate  true   — needs the USER's words (--approved "…"); the runner refuses otherwise
"""
import importlib.util, os
from . import paths as P

def meta(stages_dir, sid): return P.load_json(os.path.join(stages_dir, sid, "stage.json"))

def load(stages_dir, sid, modname=None):
    spec = importlib.util.spec_from_file_location(modname or f"stage_{sid}", os.path.join(stages_dir, sid, "run.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

class Ctx:
    """What a stage sees: the project, its files, its work dir, the approval text. Pipelines subclass it
    to add their own conveniences (branch, standards …)."""
    def __init__(self, layout, code, task, approved=""):
        self.layout, self.code, self.task, self.approved = layout, code, task, approved
        self.pdir = layout.project_dir(code)
        self.project = P.load_json(os.path.join(self.pdir, "project.json"), {})
    @property
    def fixture(self): return bool(self.project.get("fixture"))
    # project files (small, versioned)
    def p(self, *parts): return os.path.join(self.pdir, *parts)
    def has(self, *parts): return os.path.exists(self.p(*parts))
    def load(self, *parts, default=None): return P.load_json(self.p(*parts), default)
    def save(self, rel, data, compact=False): P.save_json(self.p(rel), data, compact); return rel
    # work files (heavy, regenerable)
    def w(self, *parts): return self.layout.wpath(self.code, *parts)
    def wrel(self, p): return os.path.relpath(p, self.pdir)
