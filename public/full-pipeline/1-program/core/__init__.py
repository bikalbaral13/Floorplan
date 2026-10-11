"""core — pure-Python library for the program pipeline (no third-party deps).

The generic plumbing (files, task sheet, report, findings, units, versions, standards) comes from the shared
pipeline_kit in _vendor/ — the modules below keep their names so typologies, objects and stages are unchanged.

Modules
    paths    root / project / typology locations; JSON + text IO with the inputs/ guard
    units    feet-inch formatting and parsing, ft <-> mm
    tasks    TASKS.csv: load, save, next runnable task, status updates
    report   append-only project REPORT.md
    stage    stage context, results, findings, stage loader and runner
    typology typology registry, schema resolve / validate, generator loader
    svg      tiny SVG writer used by typology renderers
"""
import os as _os, sys as _sys
_vendor = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "_vendor")
if _vendor not in _sys.path: _sys.path.insert(0, _vendor)        # the shared pipeline_kit (vendored, never edited)
__version__ = open(_os.path.join(_os.path.dirname(__file__), "VERSION"), encoding="utf-8").read().strip()
