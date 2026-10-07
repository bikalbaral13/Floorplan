"""S7 — gate: the user approves what generation will submit and spend."""
from core.stage import result, F, status_from

def run(ctx):
    s, std, p, pv, doc = ctx.scope, ctx.standards(), ctx.load("prompts.json"), ctx.load("preview.json"), ctx.load("shots.json")
    m = std["ai_models"][p["model"]]; fnd = []
    px = pv["res"][0] * pv["res"][1]
    if px < m.get("min_ref_pixels", 0): fnd.append(F("fail", "reference", "size", f"preview clips {pv['res']} below {m['min_ref_pixels']} px — rerun S4 with a larger preset"))
    if not pv.get("approved"): fnd.append(F("fail", "preview", "approved", "S5 preview not approved"))
    secs = sum(x["duration"] for x in doc["shots"])
    b = {"provider": s.get("ai_provider"), "mode": s.get("ai_mode"), "model": p["model"], "resolution": p["resolution"], "seed": p["seed"],
         "clips": len(doc["shots"]), "seconds": secs, "concurrency": m.get("concurrency", 1), "budget_units": s.get("budget_units"),
         "note": "credit cost per second varies by model, resolution and reference length — check the provider balance first; S8 stops cleanly when credits run out and resumes from that shot",
         "approved": ctx.approved}
    ctx.save("budget.json", b)
    st = status_from(fnd)
    return result(st, f"{b['clips']} clips, {secs:g} s of {p['model']} at {p['resolution']} (one at a time)", ["budget.json"], fnd,
                  [f"generation spend approved by the user: {ctx.approved}"] if st == "done" else [])
