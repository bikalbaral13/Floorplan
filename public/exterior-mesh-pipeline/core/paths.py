"""Locate the pipeline root (folder holding PIPELINE_ROOT) and standard sub-folders."""
import os

def find_root(start=None):
    d = os.path.abspath(start or os.path.dirname(__file__))
    while True:
        if os.path.exists(os.path.join(d, "PIPELINE_ROOT")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            raise FileNotFoundError("PIPELINE_ROOT marker not found above " + str(start))
        d = parent

ROOT = find_root()

def family_dir(name):
    return os.path.join(ROOT, "families", name)

def project_dir(project):
    return os.path.join(ROOT, "projects", project)

def item_dir(project, folder):
    return os.path.join(project_dir(project), "items", folder)

def work_dir(project):
    """Heavy, regenerable files (output/, cache/). project.json → work_dir (relative to the project folder)
    moves them out of the repository — required when the pipeline lives under a web app's public/ folder,
    which would otherwise ship .blend / FBX / cached designs with the site. Default: the project folder."""
    import json
    pj = os.path.join(project_dir(project), "project.json")
    rel = json.load(open(pj, encoding="utf-8")).get("work_dir", "") if os.path.exists(pj) else ""
    return os.path.normpath(os.path.join(project_dir(project), rel)) if rel else project_dir(project)

def output_dir(project, *sub):
    d = os.path.join(work_dir(project), "output", *sub)
    os.makedirs(d, exist_ok=True)
    return d
