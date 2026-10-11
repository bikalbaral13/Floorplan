"""python tools/run_task.py <CODE> [--task ID [--approved "<the user's words, date>"]] [--all]
No --task: preview the next runnable task. --all: run until a gate or an agent stage needs someone."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit import paths as P, runner as R
from core.ctx import BriefCtx

FIELDS = ["task_id", "stage", "title", "depends_on", "status", "agent", "approved", "started", "finished", "output", "notes"]

def runner():
    return R.Runner(P.Layout(ROOT, work_default="../../_work"), FIELDS, os.path.join(ROOT, "stages"), BriefCtx, agent_default="claude")

if __name__ == "__main__":
    runner().cli(sys.argv[1:])
