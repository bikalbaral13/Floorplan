"""Item reports (report.md + report.json, with history) and the append-only project log. Pure Python."""
import json, os, datetime

def write_item_report(item_dir, res):
    now = datetime.datetime.now().isoformat(timespec="seconds")
    jp = os.path.join(item_dir, "report.json")
    hist = []
    if os.path.exists(jp):
        try: hist = json.load(open(jp, encoding="utf-8")).get("history", [])
        except Exception: hist = []
    hist = (hist + [{"at": now, "status": res.get("status"), "tris": res.get("tris"), "family_version": res.get("family_version")}])[-20:]
    out = dict(res, at=now, history=hist)
    json.dump(out, open(jp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    lines = [f"# {res.get('code')} — {res.get('family')} {res.get('family_version', '')}", "",
             f"- status: **{res.get('status')}**  ({now})",
             f"- triangles: {res.get('tris', '—')}  · non-manifold edges: {res.get('non_manifold_edges', '—')}  · objects: {res.get('objects', '—')}",
             f"- UV0: {res.get('uv0', '—')}  · UV1 (lightmap): {res.get('uv1', '—')}",
             f"- instances: {res.get('instances', 0)}"]
    for k in ("assumed", "flags", "errors"):
        if res.get(k):
            lines += ["", f"## {k}", ""] + [f"- {x}" for x in res[k]]
    lines += ["", "## history", ""] + [f"- {h['at']} {h['status']} ({h.get('tris')} tris, v{h.get('family_version')})" for h in hist]
    open(os.path.join(item_dir, "report.md"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

def log(project_dir, line):
    with open(os.path.join(project_dir, "REPORT.md"), "a", encoding="utf-8") as f:
        f.write(f"- {datetime.datetime.now().isoformat(timespec='seconds')} {line}\n")
