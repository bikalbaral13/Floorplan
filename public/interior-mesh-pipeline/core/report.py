"""Item reports (report.md + report.json) and the project log. Pure Python."""
import json, os, datetime

def write_item_report(item_dir, result):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    result = dict(result, timestamp=now)
    hist_path = os.path.join(item_dir, "report.json")
    history = []
    if os.path.exists(hist_path):
        try:
            history = json.load(open(hist_path, encoding="utf-8")).get("history", [])
        except Exception:
            history = []
    history.append({k: result.get(k) for k in ("timestamp", "status", "family_version", "tris", "instances")})
    json.dump(dict(result, history=history), open(hist_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    md = [f"# {result['code']} — build report", "",
          f"- **Status:** {result['status']}", f"- **Family:** {result['family']} v{result.get('family_version', '?')}",
          f"- **Triangles:** {result.get('tris', '—')}  ·  **Non-manifold edges:** {result.get('non_manifold_edges', '—')}",
          f"- **Instances placed:** {result.get('instances', 0)}", f"- **Output:** {result.get('output', '—')}", f"- **Last run:** {now}", ""]
    for title, key in (("Overlaps", "overlaps"), ("Flags", "flags"), ("Assumed (defaults used)", "assumed"), ("Errors", "errors")):
        vals = result.get(key) or []
        md.append(f"## {title}"); md += [f"- {v}" for v in vals] if vals else ["- none"]; md.append("")
    md.append("## History"); md += [f"- {h['timestamp']} · {h['status']} · v{h['family_version']} · {h['tris']} tris · {h['instances']} inst" for h in history]
    open(os.path.join(item_dir, "report.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")

def log(project_dir, line):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    with open(os.path.join(project_dir, "REPORT.md"), "a", encoding="utf-8") as f:
        f.write(f"- {now} — {line}\n")
