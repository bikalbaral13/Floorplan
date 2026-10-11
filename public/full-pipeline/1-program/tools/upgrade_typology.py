"""Compare a scope's pinned typology version with another version, then (with approval) move the pin.

    python tools/upgrade_typology.py <CODE> [--scope PA] [--to 0.2.0]                 diff report only
    python tools/upgrade_typology.py <CODE> [--scope PA] [--to 0.2.0] --approved "user: upgrade, 2026-10-06"

The diff regenerates the selection (or every generated option) with both versions — migrating the
parameters with the new version's migrate() — and lists unit areas, coverage and QC changes.
Approval re-pins with tools/set_typology.py, which resets the scope's tasks after P2.
"""
import argparse, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, report, typology as typ
from core.stage import Ctx, summarize

ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--scope", default="PROJECT"); ap.add_argument("--to"); ap.add_argument("--approved")
a = ap.parse_args()
ctx = Ctx(a.code, {"scope": a.scope}); pin = ctx.pin()
if pin.get("variant"): sys.exit("this scope runs a project variant: change its typology.json 'extends' instead, then rerun P4 (AGENTS.md section 2)")
T1 = ctx.typology(); T2 = typ.load(T1.id, a.to)
if T1.version == T2.version: sys.exit(f"already on {T1.ref}")
rules = ctx.sload("rules.json") if ctx.shas("rules.json") else {}; brief = ctx.sload("brief.json") if ctx.shas("brief.json") else {}
sets = []
if ctx.shas("selected.json"): sets.append(("selected", ctx.sload("selected.json")["params"]))
else: sets += [(p.parent.name, paths.load_json(p)["params"]) for p in sorted(ctx.s("options").glob("*/option.json"))]
if not sets: sys.exit("nothing generated yet in this scope — just re-pin with tools/set_typology.py")
md = [f"# Upgrade {T1.ref} -> {T2.ref} ({a.code} / {a.scope})", "", "| Set | Units sq ft (old -> new) | Coverage % | QC fails | Notes |", "|---|---|---|---|---|"]
for name, p in sets:
    r1 = T1.call("generate", p)
    p2, notes = T2.call("migrate", p, T1.version) if T2.has("migrate") else (dict(p), [])
    p2, errs, assumed = typ.resolve(T2.schema, p2)
    if errs: md.append(f"| {name} | — | — | — | cannot migrate: {'; '.join(errs)} |"); continue
    r2 = T2.call("generate", p2)
    q1 = summarize(T1.call("qc", r1, rules, brief))["fail"] if rules.get("status") == "confirmed" else "-"
    q2 = summarize(T2.call("qc", r2, rules, brief))["fail"] if rules.get("status") == "confirmed" else "-"
    u = " / ".join(f"{a1['a']:.0f}->{a2['a']:.0f}" if abs(a1["a"] - a2["a"]) > 0.5 else f"{a1['a']:.0f}" for a1, a2 in zip(r1["units"], r2["units"]))
    md.append(f"| {name} | {u} | {r1['coverage_pct']:.1f} -> {r2['coverage_pct']:.1f} | {q1} -> {q2} | {'; '.join(notes + ['new defaults: ' + ', '.join(assumed)] if assumed else notes)} |")
out = ctx.s("work", f"upgrade_{T1.version}_to_{T2.version}.md"); paths.save_text(out, "\n".join(md) + "\n")
print("\n".join(md)); print("\nwrote", ctx.rel(out))
if a.approved:
    report.log(ctx.pdir, f"{a.scope} upgrade {T1.ref} -> {T2.ref} approved: {a.approved}", "approval")
    r = subprocess.run([sys.executable, str(paths.ROOT / "tools" / "set_typology.py"), a.code, T2.ref] + ([] if a.scope == "PROJECT" else ["--scope", a.scope]), capture_output=True, text=True, encoding="utf-8")
    print(r.stdout or r.stderr)
else:
    print(f"Show this to the user. To apply: --approved \"<their words, date>\"")
