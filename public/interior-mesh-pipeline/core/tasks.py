"""Project task sheet (TASKS.csv). Pure Python."""
import csv, os, datetime

FIELDS = ["task_id", "phase", "type", "target", "family", "space", "depends_on", "status", "agent", "started", "finished", "output", "report", "notes"]
STATUSES = ("todo", "doing", "done", "blocked", "skipped")

def path(project_dir):
    return os.path.join(project_dir, "TASKS.csv")

def load(project_dir):
    with open(path(project_dir), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def save(project_dir, rows):
    with open(path(project_dir), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in FIELDS})

def next_runnable(rows):
    done = {r["task_id"] for r in rows if r["status"] in ("done", "skipped")}
    for r in rows:
        if r["status"] == "todo" and all(d in done for d in filter(None, r["depends_on"].split(";"))):
            return r
    return None

def set_status(project_dir, task_id, status, agent="", output="", notes=""):
    assert status in STATUSES, status
    rows = load(project_dir); now = datetime.datetime.now().isoformat(timespec="seconds")
    for r in rows:
        if r["task_id"] == task_id:
            r["status"] = status
            if agent: r["agent"] = agent
            if status == "doing": r["started"] = now
            if status in ("done", "blocked", "skipped"): r["finished"] = now
            if output: r["output"] = output
            if notes: r["notes"] = (r["notes"] + " | " if r["notes"] else "") + notes
    save(project_dir, rows)

def summary(rows):
    out = {}
    for r in rows:
        out.setdefault(r["phase"], {}).setdefault(r["status"], 0)
        out[r["phase"]][r["status"]] += 1
    return out
