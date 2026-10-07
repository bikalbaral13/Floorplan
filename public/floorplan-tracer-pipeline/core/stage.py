"""Stages and the task context — pipeline_kit.stage plus the tracer's conveniences (scope, branch, standards).

A stage is stages/<ID>/ with stage.json, run.py (run(ctx) -> result) and, for agent stages, prompt.md.
kind script | agent;  gate true -> the runner needs the USER's words (--approved "...").
"""
import os
from pipeline_kit import stage as _S
from pipeline_kit.findings import result   # noqa: F401
from . import paths

PLAN = ["S0_SCOPE", "S1_INTAKE", "S2_READ", "S3_DIMENSIONS", "S4_LAYOUT", "S5_BUILD", "S6_VERIFY", "S7_EXPORT", "S8_REVIEW"]
STAGES = os.path.join(paths.ROOT, "stages")

def meta(sid): return _S.meta(STAGES, sid)
def load(sid): return _S.load(STAGES, sid)

class Ctx(_S.Ctx):
    def __init__(self, layout_or_code, code_or_task=None, task=None, approved=""):
        if isinstance(layout_or_code, str):             # legacy call: Ctx(code, task, approved)
            layout_or_code, code_or_task, task, approved = paths.LAYOUT, layout_or_code, code_or_task, task or ""
        super().__init__(layout_or_code, code_or_task, task, approved)
    @property
    def scope(self): return self.load("scope.json", default={})
    @property
    def branch(self): return self.scope.get("source_kind", "drawing")
    def standards(self):
        return paths.load_json(os.path.join(paths.ROOT, "standards", f"{self.project.get('standards', 'DEFAULT')}.json"))
