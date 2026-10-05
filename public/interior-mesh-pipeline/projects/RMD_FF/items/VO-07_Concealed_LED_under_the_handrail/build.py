"""Build item VO-07 — Concealed LED under the handrail
Run inside Blender:
    P = r"<full path to this file>"; exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
d = HERE
while not os.path.exists(os.path.join(d, "PIPELINE_ROOT")):
    d = os.path.dirname(d)
if d not in sys.path:
    sys.path.insert(0, d)
from tools.run_item import run_item
result = run_item(os.path.join(HERE, "item.json"))
print(result["status"], result.get("tris"), "tris", result["instances"], "instances", result["errors"] or "")
