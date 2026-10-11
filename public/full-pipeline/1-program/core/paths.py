"""Locate the pipeline root (folder holding PIPELINE_ROOT); JSON / text IO — from the shared pipeline_kit.
Writes into any project's inputs/ folder raise PermissionError (inputs are read-only)."""
from pathlib import Path
from pipeline_kit import paths as _K

ROOT = Path(_K.find_root(__file__))

def project_dir(code):
    return ROOT / "projects" / code

def typology_dir(tid):
    return ROOT / "typologies" / tid

_guard = _K.check_writable
load_json = _K.load_json
sha256 = _K.sha256
inputs_snapshot = _K.inputs_snapshot

def save_json(path, data):
    _K.save_json(path, data, newline=True, guard=True)

def save_text(path, text):
    _K.save_text(path, text, guard=True)
