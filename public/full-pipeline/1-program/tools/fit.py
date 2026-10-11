"""Match a project's site / brief against the typology and object library.

    python tools/fit.py <CODE> [--scope PA]

Prints (and writes work/FIT.md) every registered typology's applicability, the objects library and
the standards sets — the starting point for the AGENTS.md section 2 decision (existing / variant / new).
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, objects, typology as typ
from core.stage import Ctx
sys.path.insert(0, str(paths.ROOT))
from stages.P2_BRIEF.run import fit_table

ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--scope", default="PROJECT")
a = ap.parse_args()
ctx = Ctx(a.code, {"scope": a.scope})
site = ctx.sload("site.json") if ctx.shas("site.json") else None
brief = ctx.sload("brief.json") if ctx.shas("brief.json") else None
md = [f"# Fit — {a.code} / {a.scope}", "", f"Site: {'%g x %g ft, road %s' % (site['width_ft'], site['depth_ft'], site['road_side']) if site else 'not ingested yet'}.",
      f"Brief: {('units %s, facings %s, future floors %s' % (brief.get('unit_count'), brief.get('facing_allowed'), brief.get('future_floors'))) if brief else 'none yet'}.", "",
      "## Typologies", "", "| Typology | Status | Fits | Checks |", "|---|---|---|---|"]
for r in fit_table(site, brief):
    md.append(f"| {r['ref']} | {r['status']} | {'yes' if r['fits'] else 'no'} | {'<br>'.join(r['notes'])} |")
md += ["", "## Objects", "", "| Object | Version | Parameters |", "|---|---|---|"]
for oid, info in objects.registry().items():
    s = objects.load_schema(oid); md.append(f"| {oid} | {s['version']} ({info['status']}) | {', '.join(s['parameters'])} |")
md += ["", "## Standards sets", ""] + [f"- {p.stem}" for p in sorted((paths.ROOT / "standards").glob("*.json"))]
md += ["", "Decide with the user: existing (parameters only) / variant / new — AGENTS.md section 2.", ""]
out = ctx.s("work", "FIT.md"); paths.save_text(out, "\n".join(md)); print("\n".join(md)); print("wrote", ctx.rel(out))
