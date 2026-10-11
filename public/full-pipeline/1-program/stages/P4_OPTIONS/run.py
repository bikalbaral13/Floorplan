import sys, csv, io
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.units import fmt
from core import result as R
from core.stage import F, result, summarize
from stages._common import confirmed, site, resolved

def run(ctx):
    s = site(ctx)
    if not s: return result("blocked", "site.json missing — run P1 (or P1b for parcels)")
    brief, e1 = confirmed(ctx, "brief.json"); rules, e2 = confirmed(ctx, "rules.json")
    if e1 or e2: return result("blocked", e1 or e2)
    T = ctx.typology()
    if T.schema.get("road_sides_supported") and s["road_side"] not in T.schema["road_sides_supported"]:
        return result("blocked", f"{T.ref} plans for a road on {T.schema['road_sides_supported']}; this site's road is {s['road_side']}. That needs a variant or a new typology version (AGENTS.md section 2).")
    rows, outs, ok, dec = [], [], [], []
    for opt in brief["options"]:
        r = resolved(ctx, T, s, rules, opt)
        if r["errors"]: return result("failed", f"option {opt}: " + "; ".join(r["errors"]))
        dec += [f"option {opt}: {n}" for n in r["notes"]]
        res = T.call("generate", r["params"]); q = T.call("qc", res, rules, brief); n = summarize(q)
        d = f"options/{opt}"
        outs += [ctx.ssave(f"{d}/option.json", {"typology": T.id, "typology_version": T.version, "lineage": T.lineage, "params": r["params"],
                                                 "provenance": r["provenance"], "locks": r["locks"], "layers": r["manifest"], "result": res}),
                 ctx.ssave_text(f"{d}/option.svg", T.call("render_svg", res, f"Option {opt}: {res['option_title']}")),
                 ctx.ssave(f"{d}/qc.json", q)]
        if n["fail"] == 0: ok.append(opt)
        rows.append({"option": opt, "title": res["option_title"], "headline": R.headline(res),
                     "schedule": "; ".join(f"{x['code']} {x['size']} {x['area_sqft']:.0f}" for x in R.schedule(res)),
                     "total_sqft": round(res["total"]), "coverage_pct": round(res["coverage_pct"], 1), "far": round(res["far"], 2) if res.get("far") is not None else "",
                     "fails": n["fail"], "warns": n["warn"],
                     "issues": " | ".join(f"{x['check']}:{x['ref']} {x['msg']}" for x in q if x["level"] != "info")})
    buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    outs.append(ctx.ssave_text("output/options.csv", buf.getvalue()))
    md = [f"# Options — {ctx.code}{'' if ctx.scope == 'PROJECT' else ' / ' + ctx.scope} ({T.ref}{' variant of ' + T.lineage[1] if len(T.lineage) > 1 else ''})", "",
          f"Site {fmt(s['width_ft'])} x {fmt(s['depth_ft'])}, {s['area_sqft']:.0f} sq ft. Rules: {rules.get('source')}.", "",
          "| Option | Layout | Summary | Built-up (sq ft) | Coverage | FAR | Fails | Warns |", "|---|---|---|---|---|---|---|---|"]
    md += [f"| {r['option']} | {r['title']} | {r['headline']} | {r['total_sqft']} | {r['coverage_pct']}% | {r['far'] or '-'} | {r['fails']} | {r['warns']} |" for r in rows]
    md += ["", "Drawings: `options/<ID>/option.svg`; parameter sources per option in option.json → provenance.", ""]
    outs.append(ctx.ssave_text("output/OPTIONS.md", "\n".join(md)))
    if not ok:
        return result("blocked", "No option passes QC. Agree changes with the user in params.json (project), parcels/<P>/params.json or work/options/<ID>.json, then rerun.", outs, [], dec)
    return result("done", f"{len(rows)} options generated with {T.ref}; passing QC: {''.join(ok)}", outs, [], dec)
