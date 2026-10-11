"""Create projects/<CODE> from projects/_TEMPLATE.

    python tools/new_project.py <CODE> --title "..."                         typology decided at P2 (fit + match)
    python tools/new_project.py <CODE> --title "..." --typology ID[@ver]     typology already known
    python tools/new_project.py <CODE> --title "..." --parcels               site split into parcels at P1b
    options: --standards SET (standards/<SET>.json, default DEFAULT) --wall-mm 230 --design-code CODE
"""
import argparse, shutil, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, tasks, report, plan, typology as typ, objects

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--title", default=""); ap.add_argument("--typology")
    ap.add_argument("--parcels", action="store_true"); ap.add_argument("--standards", default="DEFAULT")
    ap.add_argument("--wall-mm", type=int, default=230); ap.add_argument("--design-code", default="")
    a = ap.parse_args()
    objects.standards(a.standards)
    dst = paths.project_dir(a.code)
    if dst.exists(): sys.exit(f"{dst} exists")
    T = None
    if a.typology:
        T = typ.load(*typ.split_ref(a.typology))
        if typ.registry().get(T.id, {}).get("status") != "tested": sys.exit(f"{T.ref} is not tested yet")
    shutil.copytree(paths.project_dir("_TEMPLATE"), dst)
    pj = paths.load_json(dst / "project.json")
    pj.update(code=a.code, title=a.title or a.code, typology=T.id if T else "", typology_version=T.version if T else "", variant="",
              parcels=a.parcels, standards=a.standards, wall_mm=a.wall_mm)
    pj["handoff"]["design_code"] = a.design_code or a.code
    paths.save_json(dst / "project.json", pj)
    for f in ("PROJECT.md", "REPORT.md"):
        p = dst / f; p.write_text(p.read_text(encoding="utf-8").replace("<PROJECT_CODE>", a.code).replace("<Project title>", pj["title"])
                                  .replace("<TYPOLOGY>", T.ref if T else ("per parcel (P1b)" if a.parcels else "to be matched at P2")), encoding="utf-8")
    if a.parcels: pl = ["P1_SITE", "P1b_PARCELS"]
    elif T: pl = T.plan
    else: pl = ["P1_SITE", "P2_BRIEF"]
    tasks.save(dst, plan.rows(pl, "PROJECT", T=T))
    if T:
        reg = typ.registry(); reg[T.id]["projects"] = sorted(set(reg[T.id].get("projects", [])) | {a.code})
        paths.save_json(paths.ROOT / "typologies" / "REGISTRY.json", reg)
    report.log(dst, f"project created ({T.ref if T else 'typology open'}, parcels={a.parcels}, standards {a.standards}, wall {a.wall_mm} mm)", "setup")
    print(f"created {dst.relative_to(paths.ROOT)} — sources into inputs/, then: python tools/run_task.py {a.code}")

if __name__ == "__main__":
    main()
