"""TASKS.csv — one row per job (status: todo / doing / done / blocked / failed / skipped) — from the shared pipeline_kit.
This pipeline's columns: HEADER (scope = PROJECT or a parcel code)."""
from pipeline_kit import tasks as _K

HEADER = ["task_id", "stage", "scope", "title", "depends_on", "status", "approved", "started", "finished", "output", "notes"]
now, load, get, deps_done, next_runnable = _K.now, _K.load, _K.get, _K.deps_done, _K.next_runnable

def save(pdir, rows):
    _K.save(pdir, rows, HEADER)

def reset_downstream(rows, tid):
    """A re-run of tid makes every task that depends on it (directly or not) todo again."""
    return _K.reset_after(rows, tid, note=f"reset: {tid} re-run {now()}")
