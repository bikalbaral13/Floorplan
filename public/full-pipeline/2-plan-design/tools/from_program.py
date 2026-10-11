"""Start a design brief from a program pipeline's plan — the program → design-brief hand-off.

    python tools/from_program.py <plan_trace.json> --level GF [--code <CODE>] [--title "..."] [--program-project <project.json>]
                                 [--refs <folder>] [--work-dir <dir>]

<plan_trace.json> is the program pipeline's output (plan_trace.v1): `Projects/<CODE>/program/plan_trace.json` once
published, or `program_pipeline/projects/<CODE>/output/plan_trace.json` locally. One brief per level (as the program's
own hand-off): `--level GF`, `--level FF` … A single-level trace needs no --level.

What it does
  * converts the trace to the editor plan (canvas.v1) with pipeline_kit.interop — walls on centrelines at the
    program's wall thickness, doors in their walls, the trace's open connections as openings, no walls on the free
    edges of open-air rooms (porch, balcony …); every decision lands in REPORT.md;
  * creates projects/<CODE>/ like new_project.py, with the program project's title and standards set (same set name
    = same firm values in both pipelines) and `upstream` = {pipeline, code, level, trace sha256, typology, option};
  * the brief code defaults to <program code>_<level> (one brief per floor); the projects registry then lists the
    program and the brief under their own codes.
Then: python tools/run_task.py <CODE> --all  (S3 asks which spaces this brief covers — a whole floor or some rooms).
"""
import argparse, hashlib, json, os, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit import interop, report, standards as STD

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0]); ap.add_argument("trace"); ap.add_argument("--level")
    ap.add_argument("--code"); ap.add_argument("--title"); ap.add_argument("--program-project"); ap.add_argument("--refs"); ap.add_argument("--work-dir")
    a = ap.parse_args()
    raw = open(a.trace, "rb").read(); trace = json.loads(raw)
    try:                                                     # the library format the program pipeline promises
        import jsonschema
        errs = list(jsonschema.Draft202012Validator(json.load(open(os.path.join(ROOT, "schemas", "library", "plan_trace.v1.schema.json"), encoding="utf-8"))).iter_errors(trace))
        if errs: print(f"  warning: {a.trace} does not match library/Schemas/plan_trace.v1 — {errs[0].message} (at {'/'.join(map(str, errs[0].path))}); converting anyway")
    except ImportError: pass
    pproj = a.program_project or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(a.trace))), "project.json")
    pj = json.load(open(pproj, encoding="utf-8")) if os.path.exists(pproj) else {}
    pcode = pj.get("code") or "PROGRAM"
    levels = sorted({r.get("level") for r in trace.get("rooms", []) if r.get("level")})
    level = a.level or (levels[0] if len(levels) == 1 else None)
    try:
        std_set = pj.get("standards") or "DEFAULT"
        std = STD.load(os.path.join(ROOT, "standards"), std_set)
    except KeyError:
        sys.exit(f"standards set {pj.get('standards')} is not in standards/ — copy it from library/Standards first")
    try:
        canvas, notes = interop.plan_trace_to_canvas(trace, level, wall_mm=pj.get("wall_mm"), door_head_m=std.get("openings", {}).get("door_head", 2.1))
    except ValueError as e:
        sys.exit(str(e))
    code = a.code or f"{pcode}_{level}" if level else (a.code or pcode)
    title = a.title or f"{pj.get('title') or pcode}" + (f" · {level}" if level else "")
    with tempfile.TemporaryDirectory() as td:
        cp = os.path.join(td, "plan.canvas.json"); json.dump(canvas, open(cp, "w", encoding="utf-8"), indent=1)
        cmd = [sys.executable, os.path.join(ROOT, "tools", "new_project.py"), code, "--title", title, "--plan", cp, "--standards", std_set]
        if a.refs: cmd += ["--refs", a.refs]
        if a.work_dir: cmd += ["--work-dir", a.work_dir]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        if r.returncode: sys.exit(r.stdout + r.stderr)
    pdir = os.path.join(ROOT, "projects", code); pjp = os.path.join(pdir, "project.json"); proj = json.load(open(pjp, encoding="utf-8"))
    prog = trace.get("program") or {}
    proj["upstream"] = {"pipeline": "program", "code": pcode, "level": level, "plan_trace": os.path.basename(a.trace), "sha256": hashlib.sha256(raw).hexdigest(),
                        "typology": prog.get("typology"), "typology_version": prog.get("typology_version"), "option": prog.get("option"), "wall_mm": canvas["graphAttrs"]["wall_mm"]}
    json.dump(proj, open(pjp, "w", encoding="utf-8"), indent=1)
    report.log(pdir, f"[decision] plan from program {pcode}" + (f" level {level}" if level else "") + f" ({prog.get('typology')}@{prog.get('typology_version')} option {prog.get('option')}); " + "; ".join(notes))
    print(f"created projects/{code} from program {pcode}" + (f" level {level}" if level else "") + f": {len(canvas['spaces'])} rooms, "
          f"{sum(1 for s in canvas['segments'] if s['layer'] == 'door')} doors, {sum(1 for s in canvas['segments'] if s['layer'] == 'opening')} openings")
    for n in notes: print("  ·", n)
    print(f"next: python tools/run_task.py {code} --all")

if __name__ == "__main__":
    main()
