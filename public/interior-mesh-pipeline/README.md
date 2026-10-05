# Interior mesh pipeline

Parametric, geometry-only mesh generation for interior projects, run task-by-task by agents in Blender.

- **Agents start with `AGENTS.md`.**
- Shared library: `core/` · mesh families: `families/` (see `families/REGISTRY.json`) · tools: `tools/` · projects: `projects/<CODE>/`.
- New project: `python tools/new_project.py <CODE> "<title>"`, add the workbook, `python tools/workbook_to_project.py <CODE>`, then run tasks in Blender with `tools.run_task.run_next("<CODE>")`.
- Status of a project: `python tools/project_status.py <CODE>`.

Requirements: Blender 4.2+ (tested target 5.x API), Python 3.10+ with `openpyxl` for the workbook tool.
