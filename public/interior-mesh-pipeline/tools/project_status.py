"""Print a project's task summary and the next runnable task. Pure Python.
    python tools/project_status.py RMD_FF"""
import sys, json
from _boot import boot
boot()
from core import tasks as T, paths
if __name__ == "__main__":
    pdir = paths.project_dir(sys.argv[1]); rows = T.load(pdir)
    print(json.dumps(T.summary(rows), indent=1)); n = T.next_runnable(rows)
    print("next:", n["task_id"] + " " + n["type"] + " " + n["target"] if n else "none")
    print("blocked:", [r["task_id"] for r in rows if r["status"] == "blocked"])
