# AGENTS.md — Full Pipeline (read first)

You orchestrate ONE project through four phases, for several people on several machines. The phase folders are
complete pipelines with their own AGENTS.md; this file says how they connect.

## Every session starts the same way
1. `python tools/project.py status <CODE>` — the manifest in R2 (`Projects/<CODE>/project.json`) is the truth:
   current phase, who is a member with which role, what was handed over, what is open.
2. If the current phase is not on this machine: `python tools/project.py resume <CODE> --by <person>`.
3. `cd <phase dir>` and follow THAT pipeline's AGENTS.md (`python tools/run_task.py <SUB>`).

## Rules
- **The user answers the questions.** Program P2 brief / P3 rules, Plan/Design S3 scope, Build's room choice,
  Present's S0 scope are forms for a person. Never answer them yourself; drafts are fine, confirmation is theirs.
- **Never hand over an unfinished phase on your own.** `handover` refuses while tasks are open; `--force "<reason>"`
  exists for the user's explicit decision, and the reason is recorded in the manifest.
- **Stopping mid-phase?** `project.py save` — the next person (or you, in a later chat) continues with `resume`.
- **Private stays private.** Uploads under `projects/<SUB>/inputs/` and the work dirs never leave the machine. Only
  `outputs.keep`, the packed state and files the user explicitly `share`s go to R2.
- **The canvas is the single source of truth.** Each handover commits a revision of `Projects/<CODE>/canvas/`
  (one packed multi-level canvas). Open it in the editor with `project.py canvas <CODE>`; `project.py revs <CODE>`
  says which phase changed which level.
- **Roles.** Only a member whose role fits the phase may save / hand over / resume / share in it (owner: every
  phase). The owner adds people: `project.py member <CODE> add <name> <role> --by <owner>`.
- **Objects are Python (object/2).** New or changed objects are written as object/2 (`packages/pyobject`); a plan's
  Python objects are BAKED before it is shown (`python -m pyobject.bake`) so the editor never waits on Pyodide.
- **Windows:** every text file is UTF-8 (`encoding="utf-8"`); `selftest.py` must stay green on Windows.

## Self-test
`python tools/selftest.py` — each phase's own self-test, kit drift, and the cross-machine handover (two machines,
five people, four phases through a local store).
