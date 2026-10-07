"""Run the task sheet (system Python) — the shared pipeline_kit runner with the walkthrough's stages and context.

    python tools/run_task.py <CODE>                         preview the next task
    python tools/run_task.py <CODE> --task S2_SHOTLIST      run one task
    python tools/run_task.py <CODE> --task S5_PREVIEW_REVIEW --approved "<the user's words, date>"     gated stages
    python tools/run_task.py <CODE> --all                   run until an agent stage or a gate needs input
Blender stages launch Blender headless themselves. Re-running a done task resets every task downstream of it.
Never approve on the user's behalf; fixture projects take approvals starting with FIXTURE.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, tasks, stage as S
from pipeline_kit.runner import Runner

RUNNER = Runner(paths.LAYOUT, tasks.FIELDS, S.STAGES, ctx_class=S.Ctx, stage_key="stage", agent_default="agent")
def run_one(code, tid, approved=""): return RUNNER.run_one(code, tid, approved)
def preview(code, row=None): return RUNNER.preview(code, row)

if __name__ == "__main__":
    RUNNER.cli(sys.argv[1:])
