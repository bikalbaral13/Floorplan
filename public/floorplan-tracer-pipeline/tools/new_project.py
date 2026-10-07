"""Scaffold projects/<CODE> and its task sheet.

    python tools/new_project.py <CODE> --title "..." [--standards DEFAULT] [--work-dir ../../../../pipeline-work/tracer/<CODE>]
Then: put the source files in inputs/, run S0_SCOPE (the user answers scope.json), and follow run_task.
"""
import argparse, json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, tasks, stage as S

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--title", default=""); ap.add_argument("--standards", default="DEFAULT"); ap.add_argument("--work-dir", default="")
    a = ap.parse_args(); d = paths.project_dir(a.code)
    if os.path.exists(d): sys.exit(f"{d} exists")
    shutil.copytree(paths.project_dir("_TEMPLATE"), d)
    pj = {"code": a.code, "title": a.title, "standards": a.standards, "work_dir": a.work_dir or f"../../../../pipeline-work/tracer/{a.code}", "underlay_src": ""}
    paths.save_json(os.path.join(d, "project.json"), pj)
    for f in ("PROJECT.md", "REPORT.md"):
        p = os.path.join(d, f); open(p, "w", encoding="utf-8").write(open(p, encoding="utf-8").read().replace("<CODE>", a.code).replace("<TITLE>", a.title))
    rows, prev = [], ""
    for sid in S.PLAN:
        m = S.meta(sid); rows.append({"task_id": sid, "stage": sid, "title": m["title"], "depends_on": prev, "status": "todo"}); prev = sid
    tasks.save(d, rows)
    print(f"created {d} — put sources in inputs/, then: python tools/run_task.py {a.code}")

if __name__ == "__main__":
    main()
