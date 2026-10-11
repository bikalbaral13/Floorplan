"""Pin a typology (or a project variant) for a project or a parcel and add its remaining stages to TASKS.csv.

    python tools/set_typology.py <CODE> TOWNHOME_RENTAL@0.2.0 [--scope PA]
    python tools/set_typology.py <CODE> --variant typology [--scope PA]      (folder under the project)

Changing an existing pin resets every task of that scope after P2 to todo (logged).
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, tasks, report, plan, typology as typ

ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("ref", nargs="?"); ap.add_argument("--variant"); ap.add_argument("--scope", default="PROJECT")
a = ap.parse_args()
pdir = paths.project_dir(a.code); pj = paths.load_json(pdir / "project.json")
if bool(a.ref) == bool(a.variant): sys.exit("give a typology ref OR --variant <folder>")
if a.variant:
    pin = {"typology": "", "typology_version": "", "variant": a.variant}
else:
    tid, ver = typ.split_ref(a.ref); ver = ver or typ.load(tid).version
    if typ.registry().get(tid, {}).get("status") != "tested": sys.exit(f"{tid} is not tested — finish it first (registry status)")
    pin = {"typology": tid, "typology_version": ver, "variant": ""}
T = typ.for_pin(pdir, pin)
if a.scope == "PROJECT":
    if pj.get("parcels"): sys.exit("this project uses parcels: pin with --scope <P>")
    old = {k: pj.get(k, "") for k in pin}; pj.update(pin); paths.save_json(pdir / "project.json", pj)
    stages = T.plan
else:
    pf = pdir / "parcels" / a.scope / "parcel.json"; d = paths.load_json(pf)
    old = {k: d.get(k, "") for k in pin}; d.update(pin, resolved=T.ref, lineage=T.lineage); paths.save_json(pf, d)
    stages = plan.parcel_plan(T)
rows = tasks.load(pdir); have = {r["task_id"] for r in rows}
reset = []
if any(old.values()) and old != pin:
    for r in rows:
        if r["scope"] == a.scope and r["stage"] not in ("P1_SITE", "P1b_PARCELS", "P2_BRIEF") and r["status"] in ("done", "blocked", "failed", "doing"):
            r["status"] = "todo"; r["notes"] = f"reset: typology pin changed {tasks.now()}"; reset.append(r["task_id"])
ids = [plan.task_id(s, a.scope) for s in stages]
prev = ""
new = []
for s, tid in zip(stages, ids):
    if tid not in have: new += plan.rows([s], a.scope, first_dep=prev, T=T)
    prev = tid
if a.scope != "PROJECT" and new and not new[0]["depends_on"]: new[0]["depends_on"] = "P1b-PARCELS"
# rows for stages the new typology no longer has
gone = [r for r in rows if r["scope"] == a.scope and r["stage"].startswith("+") and r["stage"] not in stages]
for r in gone: r["status"] = "skipped"; r["notes"] = f"not in {T.ref} plan"
# re-chain project tail tasks after the last new/existing row of this scope
rows += new
if a.scope == "PROJECT":
    order = {t: i for i, t in enumerate(ids)}
    rows.sort(key=lambda r: order.get(r["task_id"], -1) if r["scope"] == "PROJECT" else 1e9)
    for r in rows:
        if r["scope"] == "PROJECT" and r["task_id"] in order and order[r["task_id"]] > 0:
            r["depends_on"] = ids[order[r["task_id"]] - 1]
tasks.save(pdir, rows)
if a.scope == "PROJECT" and not pin["variant"]:
    reg = typ.registry(); reg[T.id]["projects"] = sorted(set(reg[T.id].get("projects", [])) | {a.code}); paths.save_json(paths.ROOT / "typologies" / "REGISTRY.json", reg)
report.log(pdir, f"{a.scope} typology pinned: {' -> '.join(T.lineage)} (was {old}); {len(new)} task(s) added" + (f"; reset {', '.join(reset)}" if reset else ""), "decision")
print(f"{a.scope}: {' -> '.join(T.lineage)}; added {[r['task_id'] for r in new]}" + (f"; reset {reset}" if reset else ""))
