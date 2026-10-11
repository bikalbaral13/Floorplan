"""core — shared library of the Walkthrough Video generation pipeline (pure Python 3.10+, no extra packages).

    paths     root / project / work-dir locations
    shots     the shot-list model (walkthrough-shots/1) and prompt sheet (walkthrough-prompts/1): load, frames, validation
    blender   find blender.exe, run a bscripts/ job headless, read its JSON result back
    krea      Krea REST client (upload, submit, poll, download) for S8_GENERATE in api mode
    stage / tasks   thin layers over the shared pipeline_kit (_vendor/, see _vendor/KIT.json)
"""
import os as _os, sys as _sys
_V = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), "_vendor")
if _V not in _sys.path: _sys.path.insert(0, _V)   # the shared pipeline kit (vendored; master in the app repo packages/pipeline-kit)
import pipeline_kit                              # noqa: F401  (also switches Windows consoles to UTF-8)
__version__ = open(_os.path.join(_os.path.dirname(__file__), "VERSION"), encoding="utf-8").read().strip()
