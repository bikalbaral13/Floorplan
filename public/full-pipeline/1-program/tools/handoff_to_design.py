"""Copy a program's output/plan_trace.json into design_pipeline.
(For a design brief use space-brief-pipeline/tools/from_program.py instead — it converts the trace to the editor plan.)

    python tools/handoff_to_design.py <CODE> [--design ../design_pipeline] [--design-code CODE] [--level GF] [--force]

--level: multi-level traces (e.g. VILLA_4BHK_G1) — hand one floor per design project (rooms, doors of that level only).

The design project must exist (create it there with design_pipeline/tools/new_project.py).
Writes <design>/projects/<DCODE>/work/plan_trace.json; refuses to overwrite without --force.
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, report

ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--design"); ap.add_argument("--design-code"); ap.add_argument("--force", action="store_true"); ap.add_argument("--level")
a = ap.parse_args()
pdir = paths.project_dir(a.code); pj = paths.load_json(pdir / "project.json")
src = pdir / "output" / "plan_trace.json"
if not src.exists(): sys.exit("output/plan_trace.json missing — run P6 first")
design = Path(a.design or (paths.ROOT / pj["handoff"]["design_pipeline"])).resolve()
dcode = a.design_code or pj["handoff"].get("design_code") or a.code
if not (design / "PIPELINE_ROOT").exists(): sys.exit(f"{design} is not a design_pipeline checkout")
dproj = design / "projects" / dcode
if not dproj.exists(): sys.exit(f"{dproj} missing — create it: python {design/'tools/new_project.py'} {dcode} --title \"...\"")
dst = dproj / "work" / "plan_trace.json"
if dst.exists() and not a.force: sys.exit(f"{dst} exists — rerun with --force to overwrite (ask the user first)")
dst.parent.mkdir(parents=True, exist_ok=True)
tr = paths.load_json(src)
levels = sorted({r.get("level") for r in tr["rooms"] if r.get("level")})
if len(levels) > 1 and not a.level: sys.exit(f"plan_trace has levels {levels}: pass --level (one design project per level)")
if a.level:
    if a.level not in levels: sys.exit(f"level {a.level} not in {levels}")
    tr["rooms"] = [r for r in tr["rooms"] if r.get("level") == a.level]
    tr["doors"] = [d for d in tr["doors"] if d.get("level", a.level) == a.level]
    tr["assumptions"] = tr.get("assumptions", []) + [f"Level {a.level} only (handoff_to_design --level)."]
paths.save_json(dst, tr)
report.log(pdir, f"plan_trace.json{' level ' + a.level if a.level else ''} handed to {dst}", "handoff")
print("copied ->", dst)
