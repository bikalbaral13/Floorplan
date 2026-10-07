"""Locations — a thin layer over pipeline_kit.paths (work dir defaults to <project>/work; set work_dir in project.json
to keep heavy files outside public/)."""
import os
from pipeline_kit.paths import find_root, load_json, save_json, Layout   # noqa: F401

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))
LAYOUT = Layout(ROOT, work_default="work")

def project_dir(code): return LAYOUT.project_dir(code)
def stage_dir(sid): return os.path.join(ROOT, "stages", sid)
def work_dir(code): return LAYOUT.work_dir(code)
def wpath(code, *parts): return LAYOUT.wpath(code, *parts)
