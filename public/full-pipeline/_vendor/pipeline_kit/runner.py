"""The task runner: preview → run one (with --approved for gates) → run all until input is needed.

Rules it enforces for every pipeline
  * a task waits until its dependencies are done / skipped;
  * a gate stage never runs without the user's words, and the runner never supplies them;
  * a FIXTURE project (project.json → fixture: true) only accepts approvals that start with "FIXTURE",
    so the agent's test inputs are never mistaken for user decisions;
  * re-running a done task resets everything downstream;
  * every result and every decision is appended to REPORT.md.
"""
import os, traceback
from . import tasks as T, report, stage as S, findings as FN

class Runner:
    def __init__(self, layout, fields, stages_dir, ctx_class=S.Ctx, stage_key="stage", agent_default="agent", log_sep=" "):
        self.layout, self.fields, self.stages_dir, self.ctx_class = layout, fields, stages_dir, ctx_class
        self.stage_key, self.agent_default, self.log_sep = stage_key, agent_default, log_sep

    def preview(self, code, row=None):
        pdir = self.layout.project_dir(code); row = row or T.next_runnable(T.load(pdir))
        if not row: return "nothing runnable — every task is done, skipped, or waiting"
        sid = row[self.stage_key]; m = S.meta(self.stages_dir, sid)
        out = [f"[{code}] next: {row['task_id']} — {m['title']}  ({m['kind']}{', GATE: needs the user' if m.get('gate') else ''}, status {row['status']})",
               f"  does:    {m.get('summary', '')}", f"  reads:   {', '.join(m.get('inputs', []))}", f"  writes:  {', '.join(m.get('outputs', []))}",
               f"  checks:  {'; '.join(m.get('checks', []))}"]
        if os.path.exists(os.path.join(self.stages_dir, sid, "prompt.md")): out.append(f"  agent:   follow stages/{sid}/prompt.md")
        out.append(f"  run:     --task {row['task_id']}" + (" --approved \"<the user's words, date>\"" if m.get("gate") else ""))
        return "\n".join(out)

    def run_one(self, code, tid, approved="", agent=None):
        pdir = self.layout.project_dir(code); rows = T.load(pdir); row = T.get(rows, tid); m = S.meta(self.stages_dir, row[self.stage_key])
        wait = T.waiting_for(rows, row)
        if wait: return f"{tid}: waits for {', '.join(wait)}"
        if approved and self.layout.project(code).get("fixture") and not approved.startswith("FIXTURE"):
            return f"{tid}: this project is a regression fixture — approvals must start with 'FIXTURE' so nobody mistakes them for a user decision"
        if m.get("gate") and not approved:
            return f"{tid} is a gate — show the user what it asks, then rerun with --approved \"<their words, date>\". Never approve on their behalf."
        was_done = row["status"] == "done"
        kw = {"agent": agent or self.agent_default} if "agent" in self.fields else {}
        if "approved" in self.fields and approved: kw["approved"] = approved
        T.set_status(pdir, self.fields, tid, "doing", **kw)
        ctx = self.ctx_class(self.layout, code, T.get(T.load(pdir), tid), approved)
        try:
            res = S.load(self.stages_dir, row[self.stage_key]).run(ctx)
        except Exception as e:
            res = FN.result("failed", f"{type(e).__name__}: {e}", findings=[FN.F("fail", "exception", tid, l) for l in traceback.format_exc().splitlines()[-4:]])
        rows = T.load(pdir); r = T.get(rows, tid); r["status"] = res["status"]
        if "finished" in self.fields: r["finished"] = T.now()
        if "output" in self.fields: r["output"] = ";".join(res["outputs"])[:400]
        if "notes" in self.fields: r["notes"] = res["message"][:400]
        reset = T.reset_after(rows, tid) if was_done and res["status"] == "done" else []
        T.save(pdir, rows, self.fields)
        n = FN.summarize(res["findings"])
        report.log(pdir, f"{tid} {res['status']}: {res['message']}" + (f" [{n['fail']} fail, {n['warn']} warn]" if res["findings"] else ""), self.log_sep)
        for d in res["decisions"]: report.log(pdir, f"[decision] {d}", self.log_sep)
        out = [f"{tid}: {res['status'].upper()} — {res['message']}"] + [f"  wrote {o}" for o in res["outputs"]]
        out += [f"  {f['level']:4} {f['check']}:{f['ref']} {f['msg']}" for f in res["findings"] if f["level"] != "info"][:40]
        if reset: out.append(f"  reset downstream: {', '.join(reset)}")
        return "\n".join(out)

    def run_all(self, code, agent=None, log=print):
        """Run until nothing is runnable, a gate needs the user, or a task does not finish."""
        pdir = self.layout.project_dir(code); msgs = []
        while True:
            row = T.next_runnable(T.load(pdir))
            if not row: msgs.append("nothing runnable"); break
            if S.meta(self.stages_dir, row[self.stage_key]).get("gate"): msgs.append(self.preview(code, row)); break
            msg = self.run_one(code, row["task_id"], agent=agent); msgs.append(msg)
            if not msg.split("\n")[0].split(": ", 1)[1].startswith("DONE"): break
        for m in msgs: log(m)
        return msgs

    def cli(self, argv):
        import argparse
        ap = argparse.ArgumentParser(); ap.add_argument("code"); ap.add_argument("--task"); ap.add_argument("--approved", default="")
        ap.add_argument("--all", action="store_true"); ap.add_argument("--agent", default=None)
        ap.add_argument("--pull", action="store_true", help="fetch R2 inputs (pipeline.json) into the work dir cache")
        ap.add_argument("--publish", action="store_true", help="publish outputs.keep to Projects/<CODE>/ + run.json")
        ap.add_argument("--dry-run", action="store_true", help="with --pull / --publish: plan only, upload nothing")
        ap.add_argument("--store", default="", help="local:<folder> stands in for R2 (tests)")
        a = ap.parse_args(argv)
        if a.pull or a.publish:
            from . import sync, r2
            store = r2.LocalStore(a.store[6:]) if a.store.startswith("local:") else r2.default_store(self.layout.root)
            if a.pull: print(sync.pull(self.layout, a.code, store, a.dry_run)["text"])
            if a.publish: print(sync.publish(self.layout, a.code, store, a.dry_run, agent=a.agent or self.agent_default)["text"])
        elif a.task: print(self.run_one(a.code, a.task, a.approved, a.agent))
        elif a.all: self.run_all(a.code, a.agent)
        else: print(self.preview(a.code))
