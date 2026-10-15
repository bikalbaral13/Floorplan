"""Save a program project to the library and restore it in a later chat (pipeline_kit.state, shared by every pipeline).

  python tools/project_state.py pack <CODE>                 → work/state/state.json + index-entry.json + SAVE.md
  python tools/project_state.py index --entry <index-entry.json> [--current <index.json>] -o <new index.json>
  python tools/project_state.py unpack <state.json>         → projects/<CODE>/ (+ RESTORE.md: inputs to re-attach)
  python tools/project_state.py list --current <index.json>

Library: `Projects/<CODE>/1-program/program/state.json` and the shared `Projects/index.json` (every project, every pipeline).
Everything the pipeline wrote is text and travels in the bundle. The read-only inputs/ (site sketches, surveys) are
images: the bundle records their sha256; on restore the user re-attaches them (the connector cannot return image bytes),
and P1's inputs check confirms they are the same files.
"""
import argparse, csv, json, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths                                         # also puts _vendor/ on the path
from pipeline_kit import state as S, paths as PK

PIPE = "program"
PATTERNS = ["project.json", "PROJECT.md", "TASKS.csv", "REPORT.md", "*.json", "parcels/**", "work/*.json", "work/*.md", "output/*", "typology/**"]
EXCLUDE = ["work/options/*", "state/*"]

def pack(code):
    pd = str(paths.project_dir(code))
    if not os.path.isdir(pd): raise SystemExit(f"no project {code}")
    files = S.collect(pd, PATTERNS, EXCLUDE)
    proj = json.loads(files["project.json"])
    inputs = PK.inputs_snapshot(pd)
    fetch = [{"from": "user", "to": f"inputs/{k}", "sha256": v, "via": "re-attach"} for k, v in inputs.items()]
    rows = list(csv.DictReader(open(os.path.join(pd, "TASKS.csv"), encoding="utf-8")))
    nxt = next((r["task_id"] for r in rows if r.get("status") not in ("done", "skipped")), None)
    pin = f"{proj.get('typology') or proj.get('variant') or '-'}@{proj.get('typology_version') or '-'}"
    st = S.pack(PIPE, open(paths.ROOT / "VERSION", encoding="utf-8").read().strip(), code, proj.get("title", code), files, next_task=nxt, fetch=fetch,
                summary={"typology": pin, "standards": proj.get("standards"), "plan_trace": "output/plan_trace.json" in files}, fixture=proj.get("fixture"))
    out = os.path.join(pd, "work", "state"); os.makedirs(out, exist_ok=True)
    PK.save_json(os.path.join(out, "state.json"), st, compact=True); PK.save_json(os.path.join(out, "index-entry.json"), S.entry(st))
    open(os.path.join(out, "SAVE.md"), "w", encoding="utf-8").write(S.save_steps(st, out))
    print(f"packed {code}: {len(files)} files, {len(fetch)} inputs to re-attach on restore, {os.path.getsize(os.path.join(out, 'state.json')) / 1e3:.0f} kB → {out}/state.json\nnext: follow {out}/SAVE.md")

def unpack(sp):
    st = json.load(open(sp, encoding="utf-8")); code = st["code"]; pd = str(paths.project_dir(code))
    S.unpack(st, pd)
    for d in ("inputs", "work", "output", "options"): os.makedirs(os.path.join(pd, d), exist_ok=True)
    open(os.path.join(pd, "RESTORE.md"), "w", encoding="utf-8").write(f"# Restore {code}\nRe-attach these read-only inputs (same files: P1 compares sha256):\n" +
        "".join(f"- `{f['to']}`  sha256 {f['sha256'][:12]}…\n" for f in st["fetch"]) + f"\nNext task when saved: {st.get('next_task') or 'none — all done'}.\n")
    print(f"restored projects/{code}: {len(st['files'])} files; {len(st['fetch'])} inputs to re-attach (projects/{code}/RESTORE.md)")

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0]); sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("pack"); a.add_argument("code")
    b = sp.add_parser("index"); b.add_argument("--entry", required=True); b.add_argument("--current"); b.add_argument("-o", "--out", required=True)
    c = sp.add_parser("unpack"); c.add_argument("state")
    e = sp.add_parser("list"); e.add_argument("--current")
    ns = ap.parse_args()
    if ns.cmd == "pack": pack(ns.code)
    elif ns.cmd == "index":
        cur = json.load(open(ns.current, encoding="utf-8")) if ns.current and os.path.exists(ns.current) else None
        idx = S.merge_index(cur, json.load(open(ns.entry, encoding="utf-8"))); PK.save_json(ns.out, idx); print(f"index: {len(idx['projects'])} project(s) → {ns.out}")
    elif ns.cmd == "unpack": unpack(ns.state)
    elif ns.cmd == "list": print("\n".join(S.listing(json.load(open(ns.current, encoding="utf-8")) if ns.current else {})))

if __name__ == "__main__":
    main()
