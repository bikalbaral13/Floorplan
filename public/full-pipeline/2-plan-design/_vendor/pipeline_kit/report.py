"""Append-only project log (REPORT.md) and per-item reports (report.json with history + report.md)."""
import datetime, json, os

def now(): return datetime.datetime.now().isoformat(timespec="seconds")

def log(project_dir, line, sep=" "):
    """Append one dated line to REPORT.md. Never rewrite the file."""
    with open(os.path.join(project_dir, "REPORT.md"), "a", encoding="utf-8") as f:
        f.write(f"- {now()}{sep}{line}\n")

def write_item_report(item_dir, res, title=None, lines=None, sections=None, history_keys=("status",), keep=20):
    """res: the item's result dict. title / lines: header text (callables of res allowed);
    sections: [(heading, key)] rendered as bullet lists of res[key]; history_keys: fields kept per run."""
    t = now(); jp = os.path.join(item_dir, "report.json")
    try: hist = json.load(open(jp, encoding="utf-8")).get("history", []) if os.path.exists(jp) else []
    except Exception: hist = []
    hist = (hist + [dict({"at": t}, **{k: res.get(k) for k in history_keys})])[-keep:]
    json.dump(dict(res, at=t, history=hist), open(jp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    md = [f"# {title(res) if callable(title) else (title or res.get('code', 'item'))}", ""]
    md += [(l(res) if callable(l) else l) for l in (lines or [])] + [f"- last run: {t}"]
    for head, key in (sections or []):
        vals = res.get(key) or []
        if vals: md += ["", f"## {head}", ""] + [f"- {v}" for v in vals]
    md += ["", "## history", ""] + ["- " + " · ".join(str(h.get(k)) for k in ("at",) + tuple(history_keys)) for h in hist]
    open(os.path.join(item_dir, "report.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
