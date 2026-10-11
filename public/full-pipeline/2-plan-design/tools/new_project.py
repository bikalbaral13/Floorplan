"""python tools/new_project.py <CODE> --title "Marian Office" --plan <plan.canvas.json> [--refs <folder>] [--work-dir <rel>] [--fixture]
Creates projects/<CODE>/ with project.json, TASKS.csv (all nine stages), inputs/plan.canvas.json and inputs/refs/."""
import argparse, json, os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor"), os.path.dirname(os.path.abspath(__file__))]
from pipeline_kit import tasks as T, report
from run_task import FIELDS

ORDER = ["S1_INTAKE", "S2_GEOMETRY", "S3_SCOPE", "S4_VIEWS", "S5_SCHEDULE", "S6_APPS", "S7_PUBLISH_APPS", "S8_ARCHIVE", "S9_PUBLISH"]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--title", required=True); ap.add_argument("--plan", required=True)
    ap.add_argument("--refs"); ap.add_argument("--work-dir", default=None); ap.add_argument("--fixture", action="store_true"); ap.add_argument("--standards", default="DEFAULT")
    a = ap.parse_args()
    if not a.code.replace("_", "").isalnum() or a.code.upper() != a.code: sys.exit("CODE must be UPPER_CASE letters, digits and _")
    pdir = os.path.join(ROOT, "projects", a.code)
    if os.path.exists(pdir): sys.exit(f"{pdir} exists")
    os.makedirs(os.path.join(pdir, "inputs", "refs"))
    shutil.copy(a.plan, os.path.join(pdir, "inputs", "plan.canvas.json"))
    if a.refs:
        for f in os.listdir(a.refs):
            if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".csv")): shutil.copy(os.path.join(a.refs, f), os.path.join(pdir, "inputs", "refs", f))
    # heavy files live outside the web app's public/ folder: <app>/pipeline-work/space-brief/<CODE>
    wd = a.work_dir or f"../../../../../pipeline-work/full/{a.code}/plan"
    json.dump({"code": a.code, "title": a.title, "fixture": a.fixture, "work_dir": wd, "standards": a.standards}, open(os.path.join(pdir, "project.json"), "w", encoding="utf-8"), indent=1)
    rows = []
    for i, sid in enumerate(ORDER):
        m = json.load(open(os.path.join(ROOT, "stages", sid, "stage.json"), encoding="utf-8"))
        rows.append({"task_id": sid, "stage": sid, "title": m["title"], "depends_on": ORDER[i - 1] if i else "", "status": "todo"})
    T.save(pdir, rows, FIELDS)
    report.log(pdir, f"project created: {a.title} ({'FIXTURE' if a.fixture else 'live'}); plan {os.path.basename(a.plan)}")
    print(f"created {pdir}\nnext: python tools/run_task.py {a.code} --all")

if __name__ == "__main__":
    main()
