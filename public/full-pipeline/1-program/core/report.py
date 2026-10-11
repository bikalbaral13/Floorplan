"""Append-only project REPORT.md — from the shared pipeline_kit; entries are tagged [kind]."""
from pipeline_kit import report as _K

def log(pdir, text, kind="run"):
    _K.log(str(pdir), f"[{kind}] {text}")
