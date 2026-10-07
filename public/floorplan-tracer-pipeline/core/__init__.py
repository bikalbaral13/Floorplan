"""core — shared library of the Floorplan Tracer pipeline (pure Python 3.10+: numpy, Pillow, shapely, PyMuPDF).

    paths     root / project / work-dir locations
    units     feet-inches parsing and formatting, metres
    model     the neutral plan model (tracer-plan/1): ids, findings, validation helpers
    layout    the layout spec (tracer-layout/1) both branches write, and its coordinate resolution
    build     layout → plan model (snapping, junction splits, spaces, elements)
    dims      dimension chains: least-squares scale, chain closure, centreline solve
    stage / tasks / report   thin layers over the shared pipeline_kit (_vendor/, see _vendor/KIT.json)
"""
import os as _os, sys as _sys
_V = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "_vendor")
if _V not in _sys.path: _sys.path.insert(0, _V)   # the shared pipeline kit (vendored; master in the app repo packages/pipeline-kit)
import pipeline_kit                              # noqa: F401  (also switches Windows consoles to UTF-8)
__version__ = open(_os.path.join(_os.path.dirname(__file__), "VERSION")).read().strip()
