"""One project through four phases, handed from person to person through R2.

    python tools/project.py new      <CODE> --title "30x40 villa" --by "Asha"         start at Program (local)
    python tools/project.py status   <CODE>                                            manifest from R2: who did what, what is next
    python tools/project.py handover <CODE> --by "Asha" [--note "..."] [--force "why"] publish this phase, mark the next one ready
    python tools/project.py save     <CODE> --by "Ravi" [--note "..."]                save an unfinished phase to R2 (no handover)
    python tools/project.py resume   <CODE> --by "Ravi"                                pull the current phase onto this machine
                                                                                       (restores a saved phase, or builds a new one)
    python tools/project.py share    <CODE> <local file> --by "Asha"                   make one private file shared (inbox/<phase>/)
    python tools/project.py canvas   <CODE> [--rev N] [--out f.json]                   the project canvas (packed levels) to open in the editor
    python tools/project.py revs     <CODE>                                            canvas revisions: phase, person, what changed
    python tools/project.py member   <CODE> add|remove|list [<name> <role>] --by <owner>  roles: owner client architect modeler presenter
    python tools/project.py list                                                       Projects/index.json

Every command takes --store local:<folder> (tests, offline) and --dry-run; default store = R2 from env / .env.

Shared (R2 Projects/<CODE>/): project.json (fullproject/1 manifest), every phase's outputs.keep (its pipeline.json),
each phase project's packed text state (Projects/<SUB>/<pipeline>/state.json) and run.json.
Private (this machine only): projects/<SUB>/inputs/, the work dirs, anything not in outputs.keep — unless `share`.
"""
import argparse, datetime, getpass, glob, json, os, shutil, subprocess, sys

FULL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(FULL, "_vendor"))
from pipeline_kit import paths as P, sync, state, r2, tasks as T, interop   # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from canvas_store import Canvas   # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

CFG = P.load_json(os.path.join(FULL, "full.json"))
PHASES = CFG["phases"]; IDS = [p["id"] for p in PHASES]
SCHEMA = "fullproject/1"
PACK = ["*.json", "*.md", "*.csv", "*.txt", "*/*.json", "*/*.md", "*/*.csv", "**/*.json", "**/*.md"]
PRIVATE = ["inputs/*", "inputs/**", "work/*", "work/**", "output/*", "output/**"]


def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
def phase(pid): return PHASES[IDS.index(pid)]
def proot(ph): return os.path.join(FULL, ph["dir"])
def layout(ph): return P.Layout(proot(ph))
def mkey(code): return f"Projects/{code}/project.json"
def sub(s, **kw):
    for k, v in kw.items(): s = s.replace("{" + k + "}", v)
    return s


def store_of(a):
    if a.store.startswith("local:"): return r2.LocalStore(a.store[6:])
    return r2.default_store(FULL)


def get_json(store, key):
    b = store.get(key)
    return json.loads(b) if b else None


def put_json(store, key, doc, dry):
    if dry: print(f"  (dry run) would write {key}"); return
    store.put(key, json.dumps(doc, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")


def manifest(store, code):
    m = get_json(store, mkey(code))
    if not m: sys.exit(f"{mkey(code)} not found in {store!r} — start with `project.py new {code}` on the first machine")
    return m


def save_manifest(store, m, dry):
    m["updated"] = now(); put_json(store, mkey(m["code"]), m, dry)


def run(cmd, cwd):
    print(f"  $ {' '.join(cmd)}   (in {os.path.relpath(cwd, FULL)})")
    r = subprocess.run([sys.executable if c == "python" else c for c in cmd], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    out = (r.stdout + r.stderr).strip()
    if out: print("    " + out.replace("\n", "\n    "))
    if r.returncode: sys.exit(f"command failed ({r.returncode})")


def task_gate(ph, code):
    """[] when every task is done/skipped, else the open ones."""
    pdir = layout(ph).project_dir(code)
    if not os.path.exists(os.path.join(pdir, "TASKS.csv")): return ["(no TASKS.csv)"]
    return [f"{r['task_id']}={r.get('status') or 'todo'}" for r in T.load(pdir) if r.get("status") not in ("done", "skipped")]


def local_codes(ph, code):
    d = os.path.join(proot(ph), "projects")
    if not os.path.isdir(d): return []
    return sorted(c for c in os.listdir(d) if (c == code or c.startswith(code + "_")) and os.path.isfile(os.path.join(d, c, "project.json")))


def level_of(code, sub): return sub[len(code) + 1:] if sub.startswith(code + "_") else "L1"


def contributions(a, ph, codes):
    """What this phase adds to the project canvas: ({level: model}, sources, {sub: room canvas path})."""
    levels, sources, rooms = {}, [], {}
    lay = layout(ph)
    for c in codes:
        pdir = lay.project_dir(c)
        if ph["id"] == "program":
            tp = os.path.join(pdir, "output", "plan_trace.json")
            if not os.path.exists(tp): continue
            trace = P.load_json(tp); pj = lay.project(c)
            std = P.load_json(os.path.join(proot(ph), "standards", f"{pj.get('standards', 'DEFAULT')}.json"), {})
            lv = sorted({r.get("level") for r in trace.get("rooms", []) if r.get("level")}) or [None]
            for L in lv:
                cv, _ = interop.plan_trace_to_canvas(trace, L, wall_mm=pj.get("wall_mm"), door_head_m=std.get("openings", {}).get("door_head", 2.1))
                levels[L or "L1"] = cv
            sources.append(f"Projects/{c}/program/plan_trace.json")
        elif ph["id"] == "plan":
            cp = os.path.join(pdir, "inputs", "plan.canvas.json")
            if os.path.exists(cp): levels[level_of(a.code, c)] = P.load_json(cp); sources.append(f"{ph['dir']}/projects/{c}/inputs/plan.canvas.json")
        elif ph["id"] == "build":
            rp = os.path.join(pdir, f"{c}.room.canvas.json")
            if os.path.exists(rp): rooms[c] = rp
    return levels, sources, rooms


def capture_answers(a, store, ph, codes):
    """The files the user's answers live in → Projects/<CODE>/qa/<phase>/<SUB>/ (reproducible runs)."""
    keys = []
    for c in codes:
        pdir = layout(ph).project_dir(c)
        for pat in ph.get("answers", []):
            for f in sorted(glob.glob(os.path.join(pdir, pat))):
                if not os.path.isfile(f): continue
                key = f"Projects/{a.code}/qa/{ph['id']}/{c}/{os.path.relpath(f, pdir).replace(os.sep, '/')}"
                if not a.dry_run: store.put(key, open(f, "rb").read(), r2.content_type(key))
                keys.append(key)
    return keys


def vtuple(v):
    try: return tuple(int(x) for x in str(v).split("."))
    except ValueError: return (0,)


def check_release(store):
    """Compare each phase folder with its standalone release (library/Pipelines/<pipeline>-pipeline/release.json)."""
    for ph in CFG.get("phases", []):
        try:
            mine = json.load(open(os.path.join(FULL, ph["dir"], "pipeline.json"), encoding="utf-8")).get("version")
            latest = get_json(store, f"library/Pipelines/{ph['pipeline']}-pipeline/release.json")
        except Exception: continue
        if not latest: continue
        theirs = latest.get("version")
        if vtuple(theirs) > vtuple(mine):
            print(f"  ! {ph['pipeline']} {theirs} is published (this copy of {ph['dir']} is {mine}). Update from library/Pipelines/{ph['pipeline']}-pipeline/ before working.")
        elif vtuple(mine) > vtuple(theirs):
            print(f"  ({ph['dir']} is {mine}, newer than the published {theirs}: publish it with tools/publish_library.py --only {ph['id']} when tested)")


def allowed(m, ph, who):
    """Raise SystemExit unless `who` may act in phase `ph`. Projects made before roles existed have no members: open."""
    mem = m.get("members")
    if not mem: return
    role = mem.get(who)
    if role is None: sys.exit(f"{who} is not a member of {m['code']} (members: {', '.join(f'{n}={r}' for n, r in mem.items())}). The owner adds people with `member add`.")
    if role != "owner" and role not in ph.get("roles", []):
        sys.exit(f"{who} is {role}; {ph['label']} is for {', '.join(ph.get('roles', []))}")


# ── commands ────────────────────────────────────────────────────────────────────────────────────────────────────
def cmd_new(a, store):
    if get_json(store, mkey(a.code)): sys.exit(f"{mkey(a.code)} already exists — use `status` / `resume`")
    ph = phase("program")
    if not os.path.exists(layout(ph).project_dir(a.code)):
        run([sub(x, CODE=a.code, SUB=a.code, TITLE=a.title or a.code) for x in ph["new"]], proot(ph))
    m = {"schema": SCHEMA, "code": a.code, "title": a.title or a.code, "created": now(), "created_by": a.by,
         "current": "program", "kit": CFG["kit"], "full_pipeline": CFG["version"],
         "phases": {p: {"status": "open" if p == "program" else "waiting", "codes": [a.code] if p == "program" else []} for p in IDS},
         "members": {a.by: "owner"},
         "history": [{"at": now(), "by": a.by, "event": "new", "phase": "program"}]}
    m["phases"]["program"].update(started_by=a.by, started=now())
    save_manifest(store, m, a.dry_run)
    print(f"[{a.code}] Program is open on this machine. Next:\n  cd {ph['dir']} && {sub(ph['next_steps'], CODE=a.code, SUB=a.code)}")


def cmd_status(a, store):
    check_release(store)
    m = manifest(store, a.code)
    print(f"{m['code']} — {m['title']}   (current phase: {m['current']}, updated {m.get('updated', '')[:19]})")
    for pid in IDS:
        s = m["phases"][pid]; ph = phase(pid)
        who = s.get("handed_over_by") or s.get("started_by") or ""
        print(f"  {ph['label']:12} {s['status']:12} codes={','.join(s.get('codes', [])) or '-':24} {who:12} {s.get('note', '')}")
        for c in s.get("codes", []):
            if os.path.isdir(layout(ph).project_dir(c)):
                open_ = task_gate(ph, c)
                print(f"      local {c}: " + ("all tasks done" if not open_ else "open: " + ", ".join(open_[:6]) + (" …" if len(open_) > 6 else "")))
    for h in m.get("history", [])[-6:]:
        print(f"  · {h['at'][:19]} {h['by']:12} {h['event']} {h.get('phase', '')} {h.get('note', '')}")


def cmd_handover(a, store):
    check_release(store)
    m = manifest(store, a.code); pid = a.phase or m["current"]; ph = phase(pid)
    allowed(m, ph, a.by)
    codes = local_codes(ph, a.code)
    only = [c.strip() for c in (getattr(a, "only", None) or "").split(",") if c.strip()]
    if only:
        missing = [c for c in only if c not in codes]
        if missing: sys.exit(f"--only names {', '.join(missing)}, not on this machine ({', '.join(codes)})")
        why = getattr(a, "why", None)
        if not why: sys.exit("--only leaves floors out: say why with --why \"<reason>\" (recorded in the manifest)")
        excluded = [c for c in codes if c not in only]; codes = only
        m["phases"][pid]["excluded"] = {"codes": excluded, "reason": why, "by": a.by, "at": now()}
    if not codes: sys.exit(f"no local {ph['label']} project for {a.code} in {ph['dir']}/projects/ — run `resume` first")
    open_ = {c: task_gate(ph, c) for c in codes}
    blocked = {c: o for c, o in open_.items() if o}
    saving = a.cmd == "save"
    if blocked and not a.force and not saving:
        sys.exit(f"{ph['label']} is not finished: " + "; ".join(f"{c}: {', '.join(o)}" for c, o in blocked.items())
                 + "\nFinish the tasks, or hand over anyway with --force \"<reason>\" (recorded in the manifest).")
    lay = layout(ph); published = []
    for c in codes:
        res = sync.publish(lay, c, store, a.dry_run, agent=a.by)
        print(res["text"]); published += [i["key"] for i in res["items"] if i["fate"] in ("upload", "same")]
        if res["status"] == "failed" and not saving: sys.exit(f"publish failed for {c} — fix the invalid/missing outputs above")
        pdir = lay.project_dir(c); proj = lay.project(c)
        files = state.collect(pdir, PACK, exclude=PRIVATE)
        files.update(state.collect(pdir, ph.get("share_inputs", []), max_file=state.LIMIT))
        st = state.pack(ph["pipeline"], P.load_json(os.path.join(proot(ph), "pipeline.json"))["version"], c, proj.get("title", c), files,
                        next_task=(blocked.get(c) or [None])[0], summary={"phase": pid, ("saved_by" if saving else "handed_over_by"): a.by}, fixture=bool(proj.get("fixture")))
        put_json(store, state.library_path(c, ph["pipeline"]), st, a.dry_run)
        idx = state.merge_index(get_json(store, "Projects/index.json"), state.entry(st)); put_json(store, "Projects/index.json", idx, a.dry_run)
        print(f"  state → {state.library_path(c, ph['pipeline'])} ({len(files)} text files; inputs/ and work dir stay private)")
    cv = Canvas(store, a.code)
    lv, sources, rooms = contributions(a, ph, codes)
    rev = cv.commit(lv, pid, a.by, sources, note=a.note or "", dry=a.dry_run) if lv else None
    for c, rp in rooms.items(): cv.add_room(c, open(rp, "rb").read(), pid, a.by, a.dry_run)
    if rev: print(f"  canvas r{rev['rev']} ← levels {', '.join(rev['levels_changed'])}  change {json.dumps(rev['change'])}")
    elif lv: print("  canvas unchanged (same as the current revision)")
    if rooms: print(f"  room canvases linked: {', '.join(rooms)}")
    answers = capture_answers(a, store, ph, codes)
    if answers: print(f"  answers → Projects/{a.code}/qa/{pid}/ ({len(answers)} files)")
    s = m["phases"][pid]
    s["canvas_rev"] = cv.index()["current"] if not a.dry_run else s.get("canvas_rev")
    if answers: s["answers"] = answers
    if saving:
        s.update(codes=sorted(set(s.get("codes", [])) | set(codes)), saved_by=a.by, saved=now(), note=a.note or s.get("note", ""))
        if s["status"] in ("ready", "waiting"): s["status"] = "open"
        m["history"].append({"at": now(), "by": a.by, "event": "save", "phase": pid, "note": a.note or ""})
        save_manifest(store, m, a.dry_run)
        print(f"[{a.code}] {ph['label']} saved by {a.by} (still open: " + ("; ".join(f"{c}: {len(o)} tasks" for c, o in blocked.items()) or "nothing") + ")."
              f" Anyone can continue it with `project.py resume {a.code}`."); return
    nxt = IDS[IDS.index(pid) + 1] if pid != IDS[-1] else None
    s.update(status="handed_over", codes=codes, handed_over_by=a.by, handed_over=now(), note=a.note or "", outputs=published)
    if a.force: s["forced"] = {"reason": a.force, "open_tasks": blocked}
    if nxt:
        m["phases"][nxt]["status"] = "ready"; m["current"] = nxt
    else:
        m["current"] = "done"
    m["history"].append({"at": now(), "by": a.by, "event": "handover", "phase": pid, "note": a.note or "", **({"forced": a.force} if a.force else {})})
    save_manifest(store, m, a.dry_run)
    print(f"[{a.code}] {ph['label']} handed over by {a.by}. " + (f"{phase(nxt)['label']} is ready: the next person runs\n  python tools/project.py resume {a.code} --by <name>" if nxt else "All four phases are done."))


def place(ph, sc, target):
    if target.startswith("@phase/"): return os.path.join(proot(ph), *target[7:].split("/"))
    if target.startswith("@project/"): return os.path.join(layout(ph).project_dir(sc), *target[9:].split("/"))
    if target.startswith("@work/"): return os.path.join(layout(ph).work_dir(sc), *target[6:].split("/"))
    raise ValueError(target)


def fetch(store, key, dst, dry):
    data = store.get(key)
    if data is None: return False
    if not dry:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f: f.write(data)
    print(f"  ← {key}  →  {os.path.relpath(dst, FULL)}  ({len(data):,} B)"); return True


def cmd_resume(a, store):
    check_release(store)
    m = manifest(store, a.code); pid = a.phase or m["current"]
    if pid == "done": sys.exit(f"{a.code}: all phases are handed over")
    ph = phase(pid); s = m["phases"][pid]
    allowed(m, ph, a.by)
    # 1. someone already worked on this phase → restore their packed state
    if s.get("codes"):
        for c in s.get("codes", []):
            st = get_json(store, state.library_path(c, ph["pipeline"]))
            pdir = layout(ph).project_dir(c)
            if os.path.exists(os.path.join(pdir, "project.json")): print(f"  {c}: already on this machine"); continue
            if not st: print(f"  {c}: no saved state in {store!r} yet (the previous person has not handed over or saved)"); continue
            if not a.dry_run: state.unpack(st, pdir)
            print(f"  {c}: restored {len(st['files'])} files from {state.library_path(c, ph['pipeline'])}")
        print(f"[{a.code}] {ph['label']} restored. Private inputs were not shared; ask the previous person or `share` them.")
        return _mark(a, store, m, pid, s["codes"])
    # 2. a fresh phase → build it from the previous phase's published outputs
    prev = IDS[IDS.index(pid) - 1]; ups = m["phases"][prev].get("codes", [])
    if m["phases"][prev]["status"] != "handed_over" and not a.force:
        sys.exit(f"{phase(prev)['label']} has not been handed over yet (status {m['phases'][prev]['status']}). --force \"why\" starts on its draft outputs.")
    made = []
    for up in ups:
        for b in ph["bridge"]:
            key = sub(b["from"], UP=up, CODE=a.code)
            if ph["new"] == "from_program":
                dst = place(ph, up, sub(b["to"], UP=up))
                if not fetch(store, key, dst, a.dry_run):
                    if b["required"]: sys.exit(f"missing {key} — the {phase(prev)['label']} phase did not publish it")
                    continue
                pj = os.path.join(os.path.dirname(dst), "program.project.json")
                have_pj = fetch(store, f"Projects/{up}/program/project.json", pj, a.dry_run)
                trace = P.load_json(dst) if not a.dry_run else {"rooms": []}
                levels = sorted({r.get("level") for r in trace.get("rooms", []) if r.get("level")}) or [None]
                for lv in levels:
                    sc = up if len(levels) == 1 else f"{up}_{lv}"
                    if os.path.exists(layout(ph).project_dir(sc)): print(f"  {sc}: already on this machine"); made.append(sc); continue
                    cmd = ["python", "tools/from_program.py", os.path.relpath(dst, proot(ph)), "--code", sc] + (["--level", lv] if lv else []) \
                          + (["--program-project", os.path.relpath(pj, proot(ph))] if have_pj else [])
                    if a.dry_run: print("  (dry run) would run " + " ".join(cmd))
                    else: run(cmd, proot(ph))
                    made.append(sc)
                continue
            sc = up
            pdir = layout(ph).project_dir(sc)
            if not os.path.exists(os.path.join(pdir, "project.json")) and not a.dry_run:
                if ph["new"] == "template":
                    shutil.copytree(os.path.join(proot(ph), "projects", "_TEMPLATE"), pdir)
                    pj = P.load_json(os.path.join(pdir, "project.json")); pj.update(code=sc, title=m["title"])
                    pj["work_dir"] = pj.get("work_dir", "").replace("{CODE}", sc); P.save_json(os.path.join(pdir, "project.json"), pj)
                else:
                    run([sub(x, CODE=sc, SUB=sc, TITLE=m["title"]) for x in ph["new"]], proot(ph))
            dst = place(ph, sc, sub(b["to"], UP=up)) if not a.dry_run else sub(b["to"], UP=up)
            if not fetch(store, key, dst, a.dry_run) and b["required"]:
                sys.exit(f"missing {key} — the {phase(prev)['label']} phase did not publish it")
            skip = ph.get("skip_when_bridged", {})
            if skip and not a.dry_run and os.path.exists(os.path.join(pdir, "TASKS.csv")):
                rows = T.load(pdir)
                for r in rows:
                    if r["task_id"] in skip and r.get("status") in ("", "todo"):
                        r.update(status="skipped", notes=skip[r["task_id"]], finished=now())
                T.save(pdir, rows, list(rows[0].keys()))
            if sc not in made: made.append(sc)
    print(f"[{a.code}] {ph['label']} is set up on this machine for {', '.join(made)}. Next:")
    for sc in made: print(f"  cd {ph['dir']} && {sub(ph['next_steps'], CODE=sc, SUB=sc)}")
    _mark(a, store, m, pid, made)


def _mark(a, store, m, pid, codes):
    s = m["phases"][pid]
    s["based_on_rev"] = Canvas(store, a.code).index()["current"] or None
    if s["status"] in ("ready", "waiting"): s.update(status="open", started_by=a.by, started=now())
    s["codes"] = sorted(set(s.get("codes", [])) | set(codes))
    m["current"] = pid
    m["history"].append({"at": now(), "by": a.by, "event": "resume", "phase": pid})
    save_manifest(store, m, a.dry_run)


def cmd_share(a, store):
    m = manifest(store, a.code); pid = a.phase or m["current"]
    allowed(m, phase(pid), a.by)
    src = os.path.abspath(a.file)
    if not os.path.isfile(src): sys.exit(f"{a.file} is not a file")
    key = f"Projects/{a.code}/inbox/{pid}/{a.by}/{os.path.basename(src)}"
    data = open(src, "rb").read()
    if not a.dry_run: store.put(key, data, r2.content_type(key))
    m.setdefault("shared", []).append({"at": now(), "by": a.by, "phase": pid, "key": key, "sha256": r2.sha256(data), "bytes": len(data)})
    m["history"].append({"at": now(), "by": a.by, "event": "share", "phase": pid, "note": os.path.basename(src)})
    save_manifest(store, m, a.dry_run)
    print(f"shared → {key} ({len(data):,} B)")


def cmd_member(a, store):
    m = manifest(store, a.code); mem = m.setdefault("members", {})
    if a.op == "list":
        for n, r in mem.items(): print(f"  {n:16} {r}")
        return
    if mem and mem.get(a.by) != "owner": sys.exit(f"only an owner changes members ({a.by} is {mem.get(a.by, 'not a member')})")
    if a.op == "add":
        if a.role not in CFG["roles"]: sys.exit(f"role must be one of {', '.join(CFG['roles'])}")
        mem[a.name] = a.role
    elif a.op == "remove":
        if mem.get(a.name) == "owner" and sum(r == "owner" for r in mem.values()) == 1: sys.exit("cannot remove the last owner")
        mem.pop(a.name, None)
    m["history"].append({"at": now(), "by": a.by, "event": f"member {a.op}", "note": f"{a.name}={a.role or ''}"})
    save_manifest(store, m, a.dry_run); print(f"members: {', '.join(f'{n}={r}' for n, r in mem.items())}")


def cmd_canvas(a, store):
    data, idx = Canvas(store, a.code).get(a.rev)
    if data is None: sys.exit(f"{a.code}: no canvas revision yet")
    out = a.out or f"{a.code}.r{(a.rev or idx['current']):04d}.canvas.json"
    P.save_json(out, data); print(f"r{a.rev or idx['current']} → {out}  (open it in the editor: Files ▸ Import JSON)")


def cmd_revs(a, store):
    idx = Canvas(store, a.code).index()
    for r in idx["revs"]:
        print(f"r{r['rev']:<3} {r['at'][:19]} {r['phase']:8} {r['by']:10} levels {','.join(r['levels_changed']):10} {json.dumps(r['change'])}  {r.get('note', '')}")
    for c, rm in idx.get("rooms", {}).items(): print(f"room {c}: {rm['key']} (on r{rm['on_rev']}, {rm['phase']}, {rm['by']})")
    if not idx["revs"]: print("(no revisions)")


def cmd_list(a, store):
    print("\n".join(state.listing(get_json(store, "Projects/index.json"))) or "(no projects)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--store", default=""); ap.add_argument("--dry-run", action="store_true")
    sp = ap.add_subparsers(dest="cmd", required=True)
    who = argparse.ArgumentParser(add_help=False); who.add_argument("--by", default=getpass.getuser())
    n = sp.add_parser("new", parents=[who]); n.add_argument("code"); n.add_argument("--title", default="")
    s = sp.add_parser("status"); s.add_argument("code")
    h = sp.add_parser("handover", parents=[who]); h.add_argument("code"); h.add_argument("--phase", choices=IDS); h.add_argument("--note"); h.add_argument("--force")
    h.add_argument("--only", help="comma-separated codes to hand over (e.g. one floor); the rest are recorded as excluded")
    h.add_argument("--why", help="with --only: why the other codes are left out (recorded)")
    sv = sp.add_parser("save", parents=[who]); sv.add_argument("code"); sv.add_argument("--phase", choices=IDS); sv.add_argument("--note"); sv.set_defaults(force=None)
    r = sp.add_parser("resume", parents=[who]); r.add_argument("code"); r.add_argument("--phase", choices=IDS); r.add_argument("--force")
    sh = sp.add_parser("share", parents=[who]); sh.add_argument("code"); sh.add_argument("file"); sh.add_argument("--phase", choices=IDS)
    sp.add_parser("list")
    cvp = sp.add_parser("canvas"); cvp.add_argument("code"); cvp.add_argument("--rev", type=int); cvp.add_argument("--out")
    rv = sp.add_parser("revs"); rv.add_argument("code")
    mb = sp.add_parser("member", parents=[who]); mb.add_argument("code"); mb.add_argument("op", choices=["add", "remove", "list"])
    mb.add_argument("name", nargs="?", default=""); mb.add_argument("role", nargs="?", default="")
    a = ap.parse_args(argv)
    if a.cmd not in ("list",) and not (a.code.replace("_", "").isalnum() and a.code.upper() == a.code):
        sys.exit("CODE must be UPPER_CASE letters, digits and _")
    store = store_of(a)
    {"new": cmd_new, "status": cmd_status, "handover": cmd_handover, "save": cmd_handover, "resume": cmd_resume, "share": cmd_share, "list": cmd_list, "canvas": cmd_canvas, "revs": cmd_revs, "member": cmd_member}[a.cmd](a, store)


if __name__ == "__main__":
    main()
