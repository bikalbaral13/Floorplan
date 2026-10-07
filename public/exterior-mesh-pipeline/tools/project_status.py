"""Project summary + next runnable task. Pure Python.

    python tools/project_status.py RMD_EXT
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, tasks

def main(code):
    pdir = paths.project_dir(code); rows = tasks.load(pdir)
    print(f"{code}: {len(rows)} tasks")
    for ph, st in sorted(tasks.summary(rows).items()):
        print(f"  phase {ph}: " + ", ".join(f"{k} {v}" for k, v in sorted(st.items())))
    for r in rows:
        if r["status"] == "blocked": print(f"  BLOCKED {r['task_id']}: {r['output']} {r['notes'][:160]}")
    n = tasks.next_runnable(rows)
    print("next:", f"{n['task_id']} ({n['type']} {n['target']})" if n else "none")
    q = os.path.join(paths.output_dir(code), "qc.json")
    if os.path.exists(q):
        d = json.load(open(q, encoding="utf-8")); print(f"qc: {d['unique_tris']} unique tris, instances {d['instances']}, flags {d['flags']}")

if __name__ == "__main__":
    main(sys.argv[1])
