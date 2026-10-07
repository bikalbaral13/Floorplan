"""Scaffold projects/<CODE> from projects/_TEMPLATE. Pure Python.

    python tools/new_project.py MY_SITE "Title"
Then: put the master plan files in inputs/, fill project.json → source / site, run tools/plan_to_project.py.
"""
import json, os, shutil, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths

def main(code, title):
    src, dst = paths.project_dir("_TEMPLATE"), paths.project_dir(code)
    if os.path.exists(dst): sys.exit(f"{dst} exists")
    shutil.copytree(src, dst)
    pj = os.path.join(dst, "project.json"); d = json.load(open(pj, encoding="utf-8")); d.update(code=code, title=title)
    json.dump(d, open(pj, "w", encoding="utf-8"), indent=1)
    for f in ("PROJECT.md", "REPORT.md"):
        p = os.path.join(dst, f); open(p, "w", encoding="utf-8").write(open(p, encoding="utf-8").read().replace("<CODE>", code).replace("<TITLE>", title))
    print(f"created {dst}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
