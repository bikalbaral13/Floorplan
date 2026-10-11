"""Where did a parameter come from, and is that still true?

    python tools/trace_params.py <CODE>                         every scope's selection: value, layer, file, changed?, locked
    python tools/trace_params.py <CODE> --key court_ft          one parameter, in the selection and every option
    python tools/trace_params.py <CODE> --layers                the layer manifest of each selection (files read, hashes, supplied / survived)
    python tools/trace_params.py --file standards/AADITHYAA.json   every project / scope / option that read this file
    python tools/trace_params.py --file projects/AD_TH01/params.json

"changed" compares the file's current sha256 with the one recorded when the value was resolved.
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, trace

ap = argparse.ArgumentParser(); ap.add_argument("code", nargs="?"); ap.add_argument("--key"); ap.add_argument("--layers", action="store_true"); ap.add_argument("--file")
a = ap.parse_args()

def file_state(pdir, rec, layer):
    m = next((m for m in rec.get("layers", []) if m["layer"] == layer), None)
    if not m: return "", "no manifest"
    ch = [c for c in trace.changed(pdir, [m])]
    return ", ".join(f["path"] for f in m["files"]), ("CHANGED: " + "; ".join(f"{p} {h}" for _, p, h in ch)) if ch else "unchanged"

if a.file:
    target = (paths.ROOT / a.file) if not Path(a.file).is_absolute() else Path(a.file)
    if not target.exists(): sys.exit(f"{target} not found")
    hits = 0
    for pdir in trace.all_projects():
        for scope, kind, f, rec in trace.records(pdir):
            for m in rec.get("layers", []):
                for fr in m["files"]:
                    if trace.same_file(pdir, fr, target):
                        now = paths.sha256(target); hits += 1
                        print(f"{pdir.name:<10} {scope:<8} {kind:<10} layer {m['layer']:<9} supplied {len(m['supplied']):>2} survived {len(m['survived']):>2}"
                              f"  {'unchanged' if now == fr.get('sha256') else 'CHANGED since resolved'}  {', '.join(m['survived'][:6])}")
    print(f"\n{hits} use(s) of {a.file}"); sys.exit(0)

if not a.code: sys.exit(__doc__)
pdir = paths.project_dir(a.code); recs = trace.records(pdir)
if not recs: sys.exit("nothing resolved yet (run P4 / P5)")
for scope, kind, f, rec in recs:
    if a.key:
        pv = rec.get("provenance", {}).get(a.key)
        if not pv: print(f"{scope:<8} {kind:<10} {a.key}: not a parameter of {rec.get('typology')}"); continue
        files, st = file_state(pdir, rec, pv["layer"])
        lock = f" locked by {rec['locks'][a.key]}" if a.key in rec.get("locks", {}) else ""
        print(f"{scope:<8} {kind:<10} {a.key} = {pv['value']!r:<8} layer {pv['layer']:<9} {files or pv['source']:<34} {st}{lock}" + (f"  note: {pv['note']}" if pv.get("note") else ""))
    elif kind == "selected":
        print(f"\n{scope}: {' -> '.join(rec.get('lineage', [rec['typology']]))}  option {rec['params']['option']}")
        if a.layers:
            for m in rec.get("layers", []):
                ch = trace.changed(pdir, [m])
                print(f"  {m['layer']:<9} supplied {len(m['supplied']):>2} survived {len(m['survived']):>2}{' (all overridden)' if m['supplied'] and not m['survived'] else '':<17} "
                      f"{'CHANGED' if ch else 'ok':<8} " + ", ".join(f"{x['path']}:{(x.get('sha256') or 'missing')[:10]}" for x in m["files"]))
        else:
            for k, v in rec["params"].items():
                pv = rec.get("provenance", {}).get(k, {}); files, st = file_state(pdir, rec, pv.get("layer"))
                lock = " (locked)" if k in rec.get("locks", {}) else ""
                print(f"  {k:<20} {v!r:<8} {pv.get('layer', ''):<9}{lock:<9} {files:<40} {st}")
