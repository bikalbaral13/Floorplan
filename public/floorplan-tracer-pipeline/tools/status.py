"""Project status: task table, next runnable task, QC summary.   python tools/status.py <CODE>"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, tasks, model as M

def main(code):
    rows = tasks.load(paths.project_dir(code))
    for r in rows: print(f"  {r['task_id']:15} {r['status']:8} {r['notes'][:110]}")
    n = tasks.next_runnable(rows); print("next:", n["task_id"] if n else "none")
    q = os.path.join(paths.work_dir(code), "qc.json")
    if os.path.exists(q): print("qc:", M.summarize(paths.load_json(q)))

if __name__ == "__main__":
    main(sys.argv[1])
