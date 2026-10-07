"""The task sheet — pipeline_kit.tasks with this pipeline's columns."""
from pipeline_kit import tasks as _T
from pipeline_kit.tasks import STATUSES, now, path, load, get, next_runnable, reset_after, summary   # noqa: F401

FIELDS = ["task_id", "stage", "title", "depends_on", "status", "approved", "started", "finished", "output", "notes"]

def save(pdir, rows): _T.save(pdir, rows, FIELDS)
def set_status(pdir, task_id, status, **kw): return _T.set_status(pdir, FIELDS, task_id, status, **kw)
