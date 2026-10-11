"""Stages and the task context — pipeline_kit.stage plus the walkthrough's conveniences (scope, standards, Blender).

A stage is stages/<ID>/ with stage.json, run.py (run(ctx) -> result) and, for agent stages, prompt.md.
kind script | agent | blender;  gate true -> the runner needs the USER's words (--approved "...").
"""
import os
from pipeline_kit import stage as _S
from pipeline_kit.findings import result, F, status_from   # noqa: F401
from . import paths, blender

PLAN = ["S0_SCOPE", "S1_INTAKE", "S2_SHOTLIST", "S3_BUILD", "S4_PREVIEW", "S5_PREVIEW_REVIEW",
        "S6_PROMPTS", "S7_BUDGET", "S8_GENERATE", "S9_ASSEMBLE", "S10_REVIEW"]
STAGES = os.path.join(paths.ROOT, "stages")

def meta(sid): return _S.meta(STAGES, sid)
def load(sid): return _S.load(STAGES, sid)

class Ctx(_S.Ctx):
    @property
    def scope(self): return self.load("scope.json", default={})
    def standards(self): return paths.standards(self.project.get("standards", "DEFAULT"))
    def out(self, *parts): return self.layout.wpath(self.code, "output", *parts)
    def blender(self, script, job, timeout=None):
        """Run bscripts/<script> headless on job['blend'] (or an empty file); returns the script's JSON result."""
        std = self.standards()
        return blender.run(script, job, self.w("jobs", f"{os.path.splitext(script)[0]}.json"),
                           exe=self.scope.get("blender_exe") or std["blender"].get("exe", ""), timeout=timeout or std["blender"]["timeout_s"])
