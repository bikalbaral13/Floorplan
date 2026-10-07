"""S8 — the user reviews the drawing / overlay / report and approves; the hand-off is recorded."""
import core
from core import paths
from core.stage import result

def run(ctx):
    plan = ctx.load("plan.json")
    import os
    outdir = ctx.w("out", "x"); outdir = os.path.dirname(outdir)
    h = {"approved": ctx.approved, "tracer_version": core.__version__, "plan": "plan.json", "outputs": sorted(os.listdir(outdir)),
         "next": {"design": "plan_trace.json / canvas JSON → Design phase (Floorplan Improver)", "program": "plan_trace.json"},
         "levels": [{"id": L["id"], "spaces": len(L["spaces"])} for L in plan["levels"]]}
    ctx.save("handoff.json", h)
    return result("done", "approved and handed off", ["handoff.json"], decisions=[f"trace approved by the user: {ctx.approved}"])
