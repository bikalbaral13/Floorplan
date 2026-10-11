"""Promote a project variant to a registered typology (status 'implemented').

    python tools/promote_variant.py <CODE> --id NEW_ID [--scope PA]

Copies the variant folder to typologies/NEW_ID (keeps "extends"). Next: add a fixture + self-test block,
set status 'tested' in REGISTRY.json, then re-pin projects with tools/set_typology.py <CODE> NEW_ID@0.1.0.
If the change should instead become a minor version of the parent, merge it by hand (AGENTS.md section 2).
"""
import argparse, shutil, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, report, typology as typ

ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--id", required=True); ap.add_argument("--scope", default="PROJECT")
a = ap.parse_args()
pdir = paths.project_dir(a.code); src = pdir / ("typology" if a.scope == "PROJECT" else f"parcels/{a.scope}/typology")
if not src.exists(): sys.exit(f"no variant at {src}")
dst = paths.typology_dir(a.id)
if dst.exists(): sys.exit(f"{dst} exists")
shutil.copytree(src, dst)
sch = paths.load_json(dst / "typology.json"); sch["id"] = a.id; sch["title"] = sch.get("title", "").replace(f"{a.code} variant", "variant"); paths.save_json(dst / "typology.json", sch)
T = typ.load(a.id)
reg = typ.registry(); reg[a.id] = {"title": sch["title"], "version": sch["version"], "status": "implemented", "extends": sch["extends"], "planner": "", "projects": [], "promoted_from": f"{a.code}/{a.scope}"}
paths.save_json(paths.ROOT / "typologies" / "REGISTRY.json", reg)
report.log(pdir, f"variant promoted to typologies/{a.id} ({' -> '.join(T.lineage)})", "decision")
print(f"promoted to typologies/{a.id}: {' -> '.join(T.lineage)} — add tests, then set status tested")
