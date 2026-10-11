"""Locations — a thin layer over pipeline_kit.paths. Heavy files (blends, renders, AI clips) live in
project.json → work_dir, OUTSIDE public/ (default ../../../../../pipeline-work/walkthrough/<CODE>)."""
import os
from pipeline_kit.paths import find_root, load_json, save_json, Layout   # noqa: F401

ROOT = find_root(os.path.dirname(os.path.abspath(__file__)))
LAYOUT = Layout(ROOT, work_default="work")
BSCRIPTS = os.path.join(ROOT, "bscripts")

def project_dir(code): return LAYOUT.project_dir(code)
def stage_dir(sid): return os.path.join(ROOT, "stages", sid)
def work_dir(code): return LAYOUT.work_dir(code)
def wpath(code, *parts): return LAYOUT.wpath(code, *parts)
def standards(name="DEFAULT"): return load_json(os.path.join(ROOT, "standards", f"{name}.json"))
