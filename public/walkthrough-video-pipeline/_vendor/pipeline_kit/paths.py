"""Pipeline locations. A pipeline's root is the folder holding the PIPELINE_ROOT marker."""
import json, os

def find_root(start, marker="PIPELINE_ROOT"):
    d = os.path.abspath(start)
    while not os.path.exists(os.path.join(d, marker)):
        if os.path.dirname(d) == d: raise FileNotFoundError(f"{marker} not found above {start}")
        d = os.path.dirname(d)
    return d

def load_json(p, default=None):
    if not os.path.exists(p):
        if default is not None: return default
        raise FileNotFoundError(p)
    with open(p, encoding="utf-8") as f: return json.load(f)

def save_json(p, data, compact=False):
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=None if compact else 1, separators=(",", ":") if compact else None)
    return p

class Layout:
    """Where a pipeline keeps things. `work_default` is the work dir used when project.json has no work_dir
    (relative to the project folder); heavy files belong OUTSIDE a web app's public/ — set work_dir."""
    def __init__(self, root, work_default="work"):
        self.root = root; self.work_default = work_default
    def project_dir(self, code): return os.path.join(self.root, "projects", code)
    def project(self, code): return load_json(os.path.join(self.project_dir(code), "project.json"), {})
    def work_dir(self, code, create=True):
        rel = self.project(code).get("work_dir", "") or self.work_default
        d = os.path.normpath(os.path.join(self.project_dir(code), rel))
        if create: os.makedirs(d, exist_ok=True)
        return d
    def wpath(self, code, *parts):
        p = os.path.join(self.work_dir(code), *parts); os.makedirs(os.path.dirname(p), exist_ok=True); return p
    def output_dir(self, code, *sub):
        d = os.path.join(self.work_dir(code), "output", *sub); os.makedirs(d, exist_ok=True); return d
