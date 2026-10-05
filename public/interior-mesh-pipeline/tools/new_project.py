"""Create a new project folder from projects/_TEMPLATE. Pure Python.
    python tools/new_project.py <PROJECT_CODE> "<Project title>"   """
import os, shutil, sys, json
from _boot import boot
ROOT = boot()
if __name__ == "__main__":
    code, title = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else sys.argv[1])
    dst = os.path.join(ROOT, "projects", code)
    if os.path.exists(dst):
        sys.exit(f"{dst} exists")
    shutil.copytree(os.path.join(ROOT, "projects", "_TEMPLATE"), dst)
    pj = os.path.join(dst, "project.json"); d = json.load(open(pj)); d.update(code=code, title=title, collection_root=f"{code}_Meshes", collection_prefix=f"{code}_")
    json.dump(d, open(pj, "w"), indent=1)
    md = os.path.join(dst, "PROJECT.md"); txt = open(md, encoding="utf-8").read()
    open(md, "w", encoding="utf-8").write(txt.replace("<PROJECT_CODE>", code).replace("<Project title>", title))
    print("created", dst)
