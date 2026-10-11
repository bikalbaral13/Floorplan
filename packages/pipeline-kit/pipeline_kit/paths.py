"""Pipeline locations. A pipeline's root is the folder holding the PIPELINE_ROOT marker."""
import hashlib, json, os

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

def check_writable(p):
    """Project inputs are read-only: refuse a write anywhere under projects/<CODE>/inputs/."""
    parts = os.path.normpath(os.path.abspath(p)).split(os.sep)
    if "projects" in parts:
        i = len(parts) - 1 - parts[::-1].index("projects")
        if len(parts) > i + 2 and parts[i + 2] == "inputs":
            raise PermissionError(f"{p} is inside inputs/ (read-only). Write to the work dir or output/ instead.")

def save_json(p, data, compact=False, newline=False, guard=False):
    """newline: end the file with \n · guard: refuse writes into a project's inputs/ (check_writable)."""
    if guard: check_writable(p)
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=None if compact else 1, separators=(",", ":") if compact else None)
        if newline: f.write("\n")
    return p

def save_text(p, text, guard=False):
    if guard: check_writable(p)
    os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f: f.write(text)
    return p

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""): h.update(chunk)
    return h.hexdigest()

def inputs_snapshot(pdir, sub="inputs"):
    """{relative path: sha256} of every file under <pdir>/inputs (except .keep)."""
    base = os.path.join(pdir, sub); out = {}
    for dp, _, fs in os.walk(base):
        for f in sorted(fs):
            if f == ".keep": continue
            full = os.path.join(dp, f); out[os.path.relpath(full, base).replace(os.sep, "/")] = sha256(full)
    return dict(sorted(out.items()))

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
