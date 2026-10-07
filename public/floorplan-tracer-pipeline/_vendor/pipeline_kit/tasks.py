"""The task sheet (TASKS.csv). Each pipeline names its columns; the kit only needs
task_id, depends_on (';'-separated), status, and — when used — started / finished / output / notes / agent / approved."""
import csv, datetime, os

STATUSES = ("todo", "doing", "done", "blocked", "failed", "skipped")
def now(): return datetime.datetime.now().isoformat(timespec="seconds")
def path(pdir): return os.path.join(pdir, "TASKS.csv")

def load(pdir):
    with open(path(pdir), newline="", encoding="utf-8") as f: return list(csv.DictReader(f))

def save(pdir, rows, fields):
    with open(path(pdir), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader()
        for r in rows: w.writerow({k: r.get(k, "") for k in fields})

def get(rows, tid): return next(r for r in rows if r["task_id"] == tid)
def deps(row): return [d for d in (row.get("depends_on") or "").split(";") if d]

def next_runnable(rows, retry=("todo", "blocked", "failed")):
    """First row in `retry` states whose dependencies are all done / skipped (sheet order = priority)."""
    done = {r["task_id"] for r in rows if r["status"] in ("done", "skipped")}
    return next((r for r in rows if r["status"] in retry and all(d in done for d in deps(r))), None)

def waiting_for(rows, row):
    return [d for d in deps(row) if get(rows, d)["status"] not in ("done", "skipped")]

def set_status(pdir, fields, task_id, status, **kw):
    """kw: agent, output, notes (appended), approved. Stamps started / finished."""
    assert status in STATUSES, status
    rows = load(pdir); r = get(rows, task_id); t = now()
    r["status"] = status
    if status == "doing" and "started" in fields: r["started"] = t
    if status in ("done", "blocked", "failed", "skipped") and "finished" in fields: r["finished"] = t
    for k, v in kw.items():
        if v in (None, ""): continue
        r[k] = (r.get(k) + " | " + v) if k == "notes" and r.get(k) else v
    save(pdir, rows, fields); return r

def reset_after(rows, tid, note=None):
    """Re-running a task resets every task that (transitively) depends on it. Returns the reset ids."""
    out, frontier = [], {tid}
    while frontier:
        nxt = set()
        for r in rows:
            if r["task_id"] not in out and set(deps(r)) & frontier and r["status"] != "todo":
                r["status"] = "todo"; r["notes"] = note or f"reset: {tid} re-ran {now()}"; out.append(r["task_id"]); nxt.add(r["task_id"])
        frontier = nxt
    return out

def summary(rows, key="phase"):
    out = {}
    for r in rows: out.setdefault(r.get(key, ""), {}).setdefault(r["status"], 0); out[r.get(key, "")][r["status"]] += 1
    return out
