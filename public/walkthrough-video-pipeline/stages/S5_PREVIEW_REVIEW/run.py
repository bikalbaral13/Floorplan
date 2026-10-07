"""S5 — gate: the user has watched the preview and approves framing and timing."""
from core.stage import result

def run(ctx):
    pv = ctx.load("preview.json"); pv["approved"] = ctx.approved; ctx.save("preview.json", pv)
    return result("done", f"preview approved ({pv['preview']})", ["preview.json"], decisions=[f"preview approved by the user: {ctx.approved}"])
