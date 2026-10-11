"""Project-local variant of a registered typology, pinned for the project or a parcel.

    python tools/new_variant.py <CODE> --extends TOWNHOME_RENTAL@0.2.0 --id TOWNHOME_RENTAL_AD1 [--scope PA]

Creates projects/<CODE>/typology/ (or parcels/<P>/typology/) with typology.json ("extends") and a
generator.py whose functions override the parent's; anything not defined falls back to `base`.
"""
import argparse, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, typology as typ

ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--extends", required=True); ap.add_argument("--id", required=True); ap.add_argument("--scope", default="PROJECT")
a = ap.parse_args()
base = typ.load(*typ.split_ref(a.extends))
if typ.registry().get(base.id, {}).get("status") != "tested": sys.exit(f"{base.id} is not tested — variants extend tested typologies only")
pdir = paths.project_dir(a.code); rel = "typology" if a.scope == "PROJECT" else f"parcels/{a.scope}/typology"
d = pdir / rel
if d.exists(): sys.exit(f"{d} exists")
(d / "stages").mkdir(parents=True); (d / "stages" / ".keep").write_text("", encoding="utf-8")
paths.save_json(d / "typology.json", {"id": a.id, "version": "0.1.0", "extends": base.ref, "title": f"{a.code} variant of {base.ref}",
    "_help": "Only what differs: parameters (new keys or changed ranges), options (new letters), rule_defaults, stages (full list). null removes an inherited entry.",
    "parameters": {}, "options": {}})
(d / "generator.py").write_text(f'''"""{a.id} — variant of {base.ref} for {a.code}.
`base` is the parent's generator (injected). Define only the functions that change.
Example — add option K:
    def generate(p, T):
        if p["option"] != "K":
            return base.generate(p, T)
        res = base.generate(dict(p, option="A"), T)
        ...  # change units / zones, recompute totals and warnings
        return res
"""
''', encoding="utf-8")
(d / "CHANGELOG.md").write_text(f"# {a.id} — changelog\n\n## 0.1.0\n- Variant of {base.ref} for {a.code}.\n", encoding="utf-8")
r = subprocess.run([sys.executable, str(paths.ROOT / "tools" / "set_typology.py"), a.code, "--variant", rel] + ([] if a.scope == "PROJECT" else ["--scope", a.scope]), capture_output=True, text=True, encoding="utf-8")
print(f"variant at {rel} extends {base.ref}"); print(r.stdout or r.stderr)
