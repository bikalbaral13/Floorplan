"""S10 — gate: the user approves the final video; record the hand-off."""
import core
from core.stage import result

def run(ctx):
    fin = ctx.load("final.json")
    h = {"approved": ctx.approved, "pipeline_version": core.__version__, "video": fin["video"], "seconds": fin["seconds"],
         "shots": "shots.json", "prompts": "prompts.json", "blend": ctx.load("build.json")["out_blend"],
         "next": "publish with: python tools/run_task.py <CODE> --publish  (outputs.keep → Projects/{CODE}/walkthrough/)"}
    ctx.save("handoff.json", h)
    return result("done", "final video approved", ["handoff.json"], decisions=[f"final video approved by the user: {ctx.approved}"])
