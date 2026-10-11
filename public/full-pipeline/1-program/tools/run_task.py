"""Preview or run one task.

    python tools/run_task.py <CODE>                               preview the next runnable task
    python tools/run_task.py <CODE> --task PA:P4-OPTIONS          preview a given task
    python tools/run_task.py <CODE> --task P2-BRIEF --approved "user: go ahead, 2026-10-06"

A task only runs with --approved (stored in TASKS.csv and REPORT.md). Before running, the stage's
version is checked against the typology's stage_versions and its 'requires' against the generator.
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import tasks, report, paths
from core.stage import Ctx, stage_meta, load_stage, summarize, compat

def scope_typology(ctx):
    try: return ctx.typology()
    except LookupError: return None

def gate(sid, m, T, ctx=None):
    """Reasons this stage cannot run with this typology (empty = ok). Project-scope stages of a parcel
    project check each parcel's typology themselves."""
    out = []
    if T is None and ctx is not None and ctx.project.get("parcels") and ctx.scope == "PROJECT" and not sid.startswith("+"):
        return out
    if T:
        want = T.schema.get("stage_versions", {}).get(sid)
        if want and not compat(want, m["version"]): out.append(f"{T.ref} needs {sid} {want}.x, stage is {m['version']}")
        for fn in m.get("requires", []):
            if not T.has(fn): out.append(f"{T.ref} has no {fn}() needed by {sid}")
    elif m.get("requires") or sid.startswith("+"):
        out.append(f"{sid} needs a typology pinned for this scope (P2 match decision, tools/set_typology.py)")
    return out

def preview(code, row):
    ctx = Ctx(code, row); T = scope_typology(ctx); m = stage_meta(row["stage"], T)
    print(f"[{code}] task {row['task_id']} — {m.get('title', '')}  (stage {m['id']} {m['version']}, scope {ctx.scope}, status {row['status']})")
    if T: print("  typology:", " -> ".join(T.lineage))
    for k in ("summary", "inputs", "outputs", "checks"):
        v = m[k]; print(f"  {k + ':':9}", v if isinstance(v, str) else "; ".join(v))
    if m.get("manual"): print("  manual:  ", m["manual"])
    for g in gate(row["stage"], m, T, ctx): print("  BLOCKER: ", g)
    if row.get("notes"): print("  notes:   ", row["notes"])
    print(f"Ask the user, then: python tools/run_task.py {code} --task {row['task_id']} --approved \"<their words, date>\"")

def run(code, tid, approved):
    pdir = paths.project_dir(code); rows = tasks.load(pdir); row = tasks.get(rows, tid)
    if not tasks.deps_done(rows, row): print(f"{tid} waits for {row['depends_on']}"); return 2
    ctx = Ctx(code, row, approved); T = scope_typology(ctx)
    try: m = stage_meta(row["stage"], T)
    except Exception as e: print(f"{tid}: cannot load stage {row['stage']}: {e}"); return 2
    g = gate(row["stage"], m, T, ctx)
    if g:
        print(f"{tid}: BLOCKED — " + "; ".join(g)); report.log(pdir, f"{tid} not run: " + "; ".join(g), "blocked"); return 1
    was_done = row["status"] == "done"
    row.update(status="doing", approved=approved, started=tasks.now(), finished="", output=""); tasks.save(pdir, rows)
    report.log(pdir, f"{tid} approved: {approved}", "approval")
    try:
        res = load_stage(row["stage"], T).run(ctx)
    except Exception as e:
        import traceback; traceback.print_exc()
        res = {"status": "failed", "message": f"{type(e).__name__}: {e}", "outputs": [], "findings": [], "decisions": []}
    rows = tasks.load(pdir); row = tasks.get(rows, tid)
    row.update(status=res["status"], finished=tasks.now(), output=";".join(res["outputs"])[:500], notes=res["message"][:300])
    if was_done:
        for t in tasks.reset_downstream(rows, tid): report.log(pdir, f"{t} reset to todo ({tid} re-run)", "reset")
    tasks.save(pdir, rows)
    for d in res.get("decisions", []): report.log(pdir, f"{tid}: {d}", "decision")
    n = summarize(res["findings"])
    report.log(pdir, f"{tid} {res['status']}: {res['message']} (fail {n['fail']}, warn {n['warn']})", res["status"])
    print(f"{tid}: {res['status'].upper()} — {res['message']}")
    for f in res["findings"]:
        if f["level"] != "info": print(f"  {f['level']:4} {f['check']}:{f['ref']} — {f['msg']}")
    for o in res["outputs"][:12]: print("  wrote", o)
    if len(res["outputs"]) > 12: print(f"  ... and {len(res['outputs']) - 12} more")
    return 0 if res["status"] == "done" else 1

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--task"); ap.add_argument("--approved")
    a = ap.parse_args(); rows = tasks.load(paths.project_dir(a.code))
    row = tasks.get(rows, a.task) if a.task else tasks.next_runnable(rows)
    if not row: print("nothing to run — every task is done or waiting"); sys.exit(0)
    if not a.approved: preview(a.code, row); sys.exit(0)
    sys.exit(run(a.code, row["task_id"], a.approved))
