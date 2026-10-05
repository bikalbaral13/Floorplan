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
