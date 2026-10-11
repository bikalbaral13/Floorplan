"""python tools/status.py <CODE> — task table (with scope), pins and the next runnable task."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import tasks, paths

code = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
pdir = paths.project_dir(code); pj = paths.load_json(pdir / "project.json")
print(f"{code}: typology {pj.get('typology') or '-'}@{pj.get('typology_version') or '-'} variant {pj.get('variant') or '-'} parcels {pj.get('parcels')} standards {pj.get('standards')}")
for pf in sorted(pdir.glob("parcels/*/parcel.json")):
    d = paths.load_json(pf); print(f"  parcel {d['code']}: {' -> '.join(d.get('lineage', [])) or d.get('typology')} y {d['y_offset_ft']}..{d['y_offset_ft'] + d['depth_ft']} ft")
rows = tasks.load(pdir); w = max(len(r["task_id"]) for r in rows)
for r in rows:
    print(f"{r['task_id']:<{w}}  {r['status']:<8} {r['finished'] or '':<16} {(r['notes'] or '')[:90]}")
n = tasks.next_runnable(rows); print("\nnext:", n["task_id"] if n else "none")
