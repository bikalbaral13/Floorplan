# Floorplan Tracer pipeline

Drawing or hand sketch → a correct, app-independent plan model → canvas JSON / SVG / overlay / plan_trace. Plan phase. Merges the Floorplan Tracer and Scribble to Floorplan skills. **Agents start with `AGENTS.md`.**

```bash
python tools/new_project.py MY_PLAN --title "..."     # then put the source in projects/MY_PLAN/inputs/
python tools/run_task.py MY_PLAN                       # preview the next stage
python tools/selftest.py                               # 18 checks: Windsor + Scribble regressions, negative cases
```
Requirements: Python 3.10+, numpy, Pillow, shapely, scipy, PyMuPDF (PDF intake only). No Blender, no app.
