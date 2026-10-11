"""Scaffold a new registered typology (status 'spec').

    python tools/new_typology.py ROWHOUSE_G2 --title "G+2 row houses"
    python tools/new_typology.py TOWNHOME_RENTAL_6 --title "6-unit town homes" --extends TOWNHOME_RENTAL@0.2.0

Then: fill typology.json, write generator.py, add a stage plan / own stages if needed, add a
parity or golden fixture and a self-test block, set registry status implemented -> tested.
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, typology as typ

ap = argparse.ArgumentParser(); ap.add_argument("id"); ap.add_argument("--title", required=True); ap.add_argument("--extends")
a = ap.parse_args()
if not a.id.isupper() or not a.id.replace("_", "").isalnum(): sys.exit("id: UPPER_CASE letters, digits, _")
d = paths.typology_dir(a.id)
if d.exists(): sys.exit(f"{d} exists")
if a.extends: typ.load(*typ.split_ref(a.extends))
(d / "stages").mkdir(parents=True); (d / "stages" / ".keep").write_text("", encoding="utf-8")
sch = {"id": a.id, "version": "0.1.0", "title": a.title}
if a.extends:
    sch.update({"extends": a.extends, "parameters": {}, "options": {}})
else:
    sch.update({"frame": "Feet. x east from the west plot edge, y south from the road edge.", "road_sides_supported": ["N"], "unit_count": None, "facings": [],
                "applicability": {}, "objects": {}, "parameters": {"option": {"type": "choice", "default": "A", "options": ["A"], "label": "Layout option"}},
                "site_params": {"plot_width_ft": "width_ft", "plot_west_ft": "west_ft", "plot_east_ft": "east_ft"}, "rule_params": {}, "options": {"A": {"title": "", "facing": "", "units": ""}},
                "rule_defaults": {"_note": "Placeholders until P3 confirms them."}, "brief_defaults": {"unit_count": None, "facing_allowed": [], "future_floors": False, "options": ["A"]},
                "stages": typ.SHARED_PLAN, "stage_versions": {s: "0.2" for s in typ.SHARED_PLAN}})
paths.save_json(d / "typology.json", sch)
gen = ('"""' + a.id + ' 0.1.0 generator."""\n'
       "import sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).resolve().parents[2]))\nfrom core.stage import F\n\n")
if a.extends:
    gen += ("# `base` is the parent's generator (injected). Define only what changes; the rest falls back to base.\n"
            "def generate(p, T):\n    return base.generate(p, T)\n")
else:
    gen += ("def generate(p, T):\n    raise NotImplementedError('units, zones, stair, total, coverage_pct, warn, warn2 in the site frame (see TOWNHOME_RENTAL)')\n\n"
            "def render_svg(res, title, T):\n    raise NotImplementedError\n\ndef to_plan_trace(res, project, T):\n    raise NotImplementedError\n\n"
            "def qc(res, rules, brief, T):\n    return []\n\ndef migrate(params, from_version):\n    return dict(params), []\n")
(d / "generator.py").write_text(gen, encoding="utf-8")
(d / "README.md").write_text(f"# {a.id}\n\n{a.title}\n\nStatus: spec. See ../README.md for the folder contract.\n", encoding="utf-8")
(d / "CHANGELOG.md").write_text(f"# {a.id} — changelog\n\n## 0.1.0\n- Scaffolded" + (f" on {a.extends}" if a.extends else "") + ".\n", encoding="utf-8")
reg = typ.registry(); reg[a.id] = {"title": a.title, "version": "0.1.0", "status": "spec", "extends": a.extends or "", "planner": "", "projects": []}
paths.save_json(paths.ROOT / "typologies" / "REGISTRY.json", reg)
print(f"scaffolded typologies/{a.id} (status spec)")
