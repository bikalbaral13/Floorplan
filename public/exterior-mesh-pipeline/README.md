# Exterior mesh pipeline

Master plan → meticulous, geometry-only exterior meshes in Blender → Unreal FBX. Roads, kerbs, compound and plot walls, gates, plots and driveways, open space, rough terrain with earth dumps, building envelopes (outline, outer windows and doors, slabs, roofs, parapets, railings, sunshades, sills, steps) at LOD2 + LOD1, and instanced trees, shrubs and street lights.

- **Agents start with `AGENTS.md`.**
- New project: `python tools/new_project.py <CODE> "<title>"`, put the master plan in `inputs/`, set `project.json → source`, then `python tools/plan_to_project.py <CODE>`.
- Build: `blender -b --factory-startup --python tools/run_task.py -- <CODE> --all`.
- Status: `python tools/project_status.py <CODE>`. Self-test: `blender -b --factory-startup --python tools/selftest.py`.
- Unreal: copy `projects/<CODE>/output/unreal/` next to your Unreal project and run `unreal_import.py` in the Editor's Python console.

Requirements: Blender 4.2+ (tested 4.5), Python 3.10+ with `shapely` for the adapter.
