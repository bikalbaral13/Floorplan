"""Stage plans -> TASKS.csv rows.

A plan is a list of stage ids: shared ('P4_OPTIONS', in stages/) or typology-owned ('+P5b_STAIR_SCHEDULE',
in typologies/<ID>/stages/). stage.json 'scope': project | parcel | either.
Task id: first '_' -> '-' ('P4_OPTIONS' -> 'P4-OPTIONS'); parcel rows are prefixed '<P>:'.
"""
from . import paths

def task_id(sid, scope="PROJECT"):
    t = sid.lstrip("+").replace("_", "-", 1)
    return t if scope == "PROJECT" else f"{scope}:{t}"

def shared_meta(sid):
    p = paths.ROOT / "stages" / sid / "stage.json"
    return paths.load_json(p) if p.exists() else None

def meta(sid, T=None):
    if sid.startswith("+"):
        return paths.load_json(T.stage_dir(sid) / "stage.json")
    m = shared_meta(sid)
    if not m: raise KeyError(f"shared stage {sid} not in stages/")
    return m

def rows(plan, scope, first_dep="", existing=(), T=None, titles=True):
    out, prev = [], first_dep
    for sid in plan:
        tid = task_id(sid, scope)
        if tid in existing:
            prev = tid; continue
        m = meta(sid, T)
        out.append(dict(task_id=tid, stage=sid, scope=scope, title=m.get("title") or m["summary"][:80], depends_on=prev, status="todo"))
        prev = tid
    return out

def parcel_plan(T):
    """Stages of a typology's plan that run per parcel."""
    return [s for s in T.plan if s not in ("P1_SITE", "P1b_PARCELS") and meta(s, T).get("scope") in ("parcel", "either")]

def project_tail(T):
    return [s for s in T.plan if meta(s, T).get("scope") == "project" and s not in ("P1_SITE", "P1b_PARCELS", "P2_BRIEF")]
