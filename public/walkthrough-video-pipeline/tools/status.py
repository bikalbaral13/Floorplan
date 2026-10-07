"""Project status: task table, next runnable task, generation progress.   python tools/status.py <CODE>"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, tasks

def main(code):
    d = paths.project_dir(code); rows = tasks.load(d)
    for r in rows: print(f"  {r['task_id']:18} {r['status']:8} {r['notes'][:100]}")
    n = tasks.next_runnable(rows); print("next:", n["task_id"] if n else "none")
    jobs = paths.load_json(os.path.join(d, "jobs.json"), {})
    if jobs: print("clips:", ", ".join(f"{k}:{'ok' if v.get('file') else v.get('status') or 'todo'}" for k, v in jobs.items()))

if __name__ == "__main__":
    main(sys.argv[1])
