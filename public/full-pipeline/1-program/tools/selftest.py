"""python tools/selftest.py — run after any change to core/, stages/, objects/, standards/ or a typology.

 1 planner <-> typology parameter contract       6 flow A: typology matched at P2, planner selection from 0.1.0 (migration)
 2 parity: 0.2.0 and frozen 0.1.0 vs planner      7 flow B: pinned 0.1.0, upgrade diff + approved upgrade to 0.2.0
 3 objects (stair, door)                          8 flow C: project variant (extends) adding option K
 4 layered parameters: provenance, rules, locks   9 flow D: parcels with different typology versions, merged hand-off
 5 inputs/ guard                                 10 tools: catalog, fit, new_typology scaffold
11 shared: pipeline_kit copy, library standards, pipeline.json, save/restore, plan → canvas bridge
Temporary projects / typologies are removed afterwards; REGISTRY files are restored.
"""
import json, re, shutil, subprocess, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core import paths, tasks, objects, params as prm, typology as typ

ROOT = paths.ROOT; FX = ROOT / "tests" / "fixtures"; py = sys.executable
ok = True; TMP = ["ZZ_A", "ZZ_B", "ZZ_C", "ZZ_D", "ZZ_E"]
LAST = [""]
def check(c, msg):
    global ok
    print(("PASS " if c else "FAIL ") + msg); ok &= bool(c)
    if not c and LAST[0]: print("   last task output:\n   " + LAST[0].strip().replace("\n", "\n   ")[-1500:])
def run(*a):
    return subprocess.run([py, *map(str, a)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
def task(code, tid, appr="selftest"):
    r = run("tools/run_task.py", code, "--task", tid, "--approved", appr)
    st = tasks.get(tasks.load(paths.project_dir(code)), tid)["status"]; LAST[0] = f"{code} {tid} -> {st}\n" + r.stdout + r.stderr
    if st not in ("done",) and "--quiet" not in sys.argv and False: print(r.stdout, r.stderr)
    return st, r.stdout + r.stderr
def confirm(pdir, name, **kw):
    d = json.loads((pdir / name).read_text(encoding="utf-8")); d.update(status="confirmed", confirmed_on="2026-10-06", **kw); paths.save_json(pdir / name, d)
def same(r, j):
    s = (len(r["units"]) == len(j["units"]) and all(abs(a[k] - b[k]) < 1e-6 for a, b in zip(r["units"], j["units"]) for k in "xywh")
         and all(a["d"] == b["d"] for a, b in zip(r["units"], j["units"])) and len(r["zones"]) == len(j["zones"])
         and all(abs(a[k] - b[k]) < 1e-6 and a["k"] == b["k"] for a, b in zip(r["zones"], j["zones"]) for k in "xywh")
         and (r["stair"] is None) == (j["stair"] is None) and abs(r["total"] - j["total"]) < 1e-6 and r["warn"] == j["warn"] and r["warn2"] == j["warn2"])
    if s and r["stair"]: s = all(abs(r["stair"][k] - j["stair"][k]) < 1e-6 for k in "xywh") and r["stair"]["entryOK"] == j["stair"]["entryOK"]
    return s

regs = {p: p.read_text(encoding="utf-8") for p in [ROOT / "typologies" / "REGISTRY.json", ROOT / "objects" / "REGISTRY.json"]}
try:
    T2 = typ.load("TOWNHOME_RENTAL"); T1 = typ.load("TOWNHOME_RENTAL", "0.1.0")
    # 1 contract: every typology with a planner
    import hashlib
    for tid in typ.registry():
        TT = typ.load(tid)
        if not TT.schema.get("planner"): continue
        html = (TT.dirs[0] / TT.schema["planner"]).read_text(encoding="utf-8")
        pm = re.search(r"const (?:PMAP|NUM)=\{(.*?)\};", html, re.S).group(1)
        keys = set(re.findall(r"(\w+):'\w+'", pm)) | set(re.findall(r"(\w+):'\w+'", re.search(r"const SMAP=\{(.*?)\};", html, re.S).group(1)))
        if "drawing_north" in TT.schema["parameters"]: keys |= {"drawing_north"}
        check(keys == set(TT.schema["parameters"]) - set(TT.schema.get("planner_fixed", [])), f"planner keys match {TT.ref} parameters ({len(keys)})")
        check(re.search(r"TYPO_VERSION=(?:'" + re.escape(TT.version) + r"'|VILLA_VERSION)", html) is not None and (f"VILLA_VERSION='{TT.version}'" in html or "VILLA_VERSION" not in html), f"{tid} planner version matches {TT.version}")
    # 2 parity
    for T, fx, mig in [(T2, "townhome_parity.json", False), (T1, "townhome_parity_0.1.0.json", False), (T2, "townhome_parity_0.1.0.json", True)]:
        bad = 0
        for c in json.loads((FX / fx).read_text(encoding="utf-8")):
            p = dict(c["params"])
            if mig: p, _ = T.call("migrate", p, "0.1.0")
            p, errs, _ = typ.resolve(T.schema, p); bad += 0 if (not errs and same(T.call("generate", p), c["result"])) else 1
        check(bad == 0, f"parity {T.ref} vs {fx}{' (migrated)' if mig else ''}: {bad} mismatches")
    TV = typ.load("VILLA_4BHK_G1"); vfx = json.loads((FX / "villa_parity.json").read_text(encoding="utf-8"))
    vhtml = (TV.dirs[0] / TV.schema["planner"]).read_text(encoding="utf-8")
    vcore = re.search(r"/\* VILLA CORE START \*/\n(.*?)\n/\* VILLA CORE END \*/", vhtml, re.S).group(1)
    check(hashlib.sha256(vcore.encode()).hexdigest() == vfx["core_sha256"], "villa planner core unchanged since the parity export (else re-export the fixture)")
    def close(a, b):
        if isinstance(a, (list, tuple)): return isinstance(b, (list, tuple)) and len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
        if isinstance(a, dict): return isinstance(b, dict) and set(a) == set(b) and all(close(a[k], b[k]) for k in a)
        if isinstance(a, float) or isinstance(b, float): return abs(a - b) < 1e-6
        return a == b
    rules_v = {k: v for k, v in TV.schema["rule_defaults"].items() if not k.startswith("_")}; bad = 0
    for c in vfx["cases"]:
        p, errs, _ = typ.resolve(TV.schema, c["params"]); r = TV.call("generate", p); j = c["result"]
        got = {"mirror": r["mirror"], "vastu_score": r["vastu_score"], "total": r["total"], "far": r["far"],
               "rooms": {f"{lv}-{rm['code']}": [list(q) for q in rm["poly"]] for lv in ("GF", "FF") for rm in r["rooms"][lv]},
               "doors": [{"from": x["from"], "to": x["to"], "missing": True} if x.get("missing") else {"from": x["from"], "to": x["to"], "kind": x["kind"], "a": list(x["a"]), "b": list(x["b"])} for x in r["doors"]],
               "main_door": r["main_door"], "stair": {k: r["stair"][k] for k in ("x", "y", "w", "h", "entryOK")}, "warn": r["warn"], "warn2": r["warn2"],
               "qc_fails": [x["check"] + ":" + x["ref"] for x in TV.call("qc", r, rules_v, TV.schema["brief_defaults"]) if x["level"] == "fail"]}
        bad += 0 if (not errs and all(close(got[k], j[k]) for k in j) and list(got["rooms"]) == list(j["rooms"])) else 1
    check(bad == 0, f"parity {TV.ref} vs villa planner ({len(vfx['cases'])} cases: polygons, doors, warnings, QC fails): {bad} mismatches")
    # 3 objects
    so = objects.load_module("STAIR_DOGLEG"); c = so.compute({"floor_height_ft": 10, "max_riser_in": 7, "tread_in": 10, "flight_width_ft": 3.5, "gap_ft": 1 / 3, "direction": "W", "turn": "R"})
    check(c["risers"] == 18 and abs(c["SL"] - (8 * 10 / 12 + 3.5)) < 1e-9 and c["wX"] == c["SL"], "STAIR_DOGLEG sizing (18 risers, 10'-2\" long)")
    dd = objects.load_module("DOOR_HINGED").place({"width_ft": 3, "position_pct": 0, "margin_ft": 0.5}, (10, 5), (25, 5))
    check(dd["a"] == [10.5, 5] and dd["b"] == [13.5, 5], "DOOR_HINGED placement")
    # 4 layers
    site = {"width_ft": 36, "west_ft": 106, "east_ft": 105.5}
    L = [("object", "o", prm.object_layer(T2)), ("typology", "t", prm.typology_layer(T2)), ("standards", "s", prm.standards_layer(T2, {"DOOR_HINGED": {"width_ft": 3.5}})),
         ("site", "site", prm.site_layer(T2, site)), ("project", "params.json", {"court_ft": {"value": 14, "lock": True}, "setback_front_ft": 6})]
    r = prm.resolve(T2, L, {"stair_max_riser_in": 6.5, "front_setback_min_ft": 8})
    pv = r["provenance"]
    check(pv["door_width_ft"]["layer"] == "standards" and r["params"]["door_width_ft"] == 3.5, "standards layer sets object parameters (door width)")
    check(pv["max_riser_in"]["layer"] == "rules" and r["params"]["max_riser_in"] == 6.5, "rules clamp a default (max riser 7 -> 6.5)")
    check(pv["setback_front_ft"]["layer"] == "project" and r["params"]["setback_front_ft"] == 6 and "court_ft" in r["locks"], "project value kept above rules (QC judges it); lock recorded")
    check(pv["floor_height_ft"]["layer"] == "object" and pv["court_ft"]["layer"] == "project", "provenance: object / project layers")
    r2 = prm.resolve(T2, L + [("option", "o.json", {"court_ft": 10})], {})
    check(any("locked" in e for e in r2["errors"]), "locked parameter refuses a later change")
    r3 = prm.resolve(T2, L + [("option", "o.json", {"court_ft": {"value": 10, "unlock": "user asked"}})], {})
    check(not r3["errors"] and r3["params"]["court_ft"] == 10, "unlock with a reason changes a locked parameter")
    # 5 guard
    try: paths.save_text(ROOT / "projects" / "_TEMPLATE" / "inputs" / "x.txt", "no"); check(False, "inputs guard")
    except PermissionError: check(True, "inputs/ write guard")

    def start(code, *args, trace="site_trace.json"):
        pdir = paths.project_dir(code)
        if pdir.exists(): shutil.rmtree(pdir)
        r = run("tools/new_project.py", code, "--title", "self-test", *args); check(r.returncode == 0, f"{code} new_project {' '.join(args)}" + ("" if r.returncode == 0 else r.stderr[-300:]))
        shutil.copy(FX / trace, pdir / "work" / "site_trace.json"); check(task(code, "P1-SITE")[0] == "done", f"{code} P1"); return pdir
    def brief_rules(code, pdir, scope="", dec="existing", ref="TOWNHOME_RENTAL@0.2.0", options=None, pre=""):
        sd = pdir if not scope else pdir / "parcels" / scope
        check(task(code, pre + "P2-BRIEF")[0] == "blocked", f"{code}{'/' + scope if scope else ''} P2 draft")
        b = json.loads((sd / "brief.json").read_text(encoding="utf-8")); kw = {"typology_match": {"decision": dec, "typology": ref, "reason": "self-test"}}
        if options: kw["options"] = options
        confirm(sd, "brief.json", **kw)
        return sd
    def rules_ok(code, sd, pre=""):
        check(task(code, pre + "P3-RULES")[0] == "blocked", f"{code} {pre}P3 draft"); confirm(sd, "rules.json", source="self-test placeholder")
        check(task(code, pre + "P3-RULES")[0] == "done", f"{code} {pre}P3 confirmed")

    # 6 flow A
    pdir = start("ZZ_A")
    sd = brief_rules("ZZ_A", pdir)
    st, out = task("ZZ_A", "P2-BRIEF"); check(st == "blocked" and "set_typology" in out, "A: P2 asks for the pin after the match decision")
    check(json.loads((pdir / "brief.json").read_text(encoding="utf-8"))["candidates"][0]["fits"], "A: P2 draft lists TOWNHOME_RENTAL as a fitting candidate")
    r = run("tools/set_typology.py", "ZZ_A", "TOWNHOME_RENTAL@0.2.0"); check("P5b-STAIR_SCHEDULE" in r.stdout, "A: set_typology adds the typology plan incl. its own stage")
    st, out = task("ZZ_A", "P2-BRIEF"); check(st == "blocked" and "filled from" in out, "A: P2 fills the typology's brief defaults and asks to re-confirm")
    confirm(pdir, "brief.json"); check(task("ZZ_A", "P2-BRIEF")[0] == "done", "A: P2 done"); rules_ok("ZZ_A", pdir)
    paths.save_json(pdir / "params.json", {"court_ft": {"value": 12, "lock": True, "note": "user: keep 12 ft court"}})
    check(task("ZZ_A", "P4-OPTIONS")[0] == "done", "A: P4")
    o = json.loads((pdir / "options" / "C" / "option.json").read_text(encoding="utf-8")); check(o["provenance"]["court_ft"]["layer"] == "project" and "court_ft" in o["locks"], "A: option.json carries provenance and locks")
    shutil.copy(FX / "selection_planner_A_0.1.0.json", pdir / "work" / "selection.json")
    check(task("ZZ_A", "P5-SELECT", "user: go ahead")[0] == "blocked", "A: P5 needs the option named in the approval")
    st, out = task("ZZ_A", "P5-SELECT", "user: take option A"); check(st == "done", "A: P5 from a 0.1.0 planner file")
    check("migrated 0.1.0 -> 0.2.0" in (pdir / "REPORT.md").read_text(encoding="utf-8"), "A: migration logged in REPORT.md")
    check(task("ZZ_A", "P5b-STAIR_SCHEDULE")[0] == "done" and (pdir / "output" / "stair_schedule.csv").exists(), "A: typology-owned stage P5b ran")
    check(task("ZZ_A", "P6-HANDOFF")[0] == "done" and task("ZZ_A", "P7-QC")[0] == "done", "A: P6 + P7")
    sel = json.loads((pdir / "selected.json").read_text(encoding="utf-8")); man = {m["layer"]: m for m in sel["layers"]}
    check({"object", "typology", "standards", "site", "rules", "brief", "project", "selection"} <= set(man) and all(f["sha256"] for m in sel["layers"] for f in m["files"]),
          "trace: selected.json manifest lists every layer with file hashes")
    check(man["project"]["supplied"] == ["court_ft"] and man["project"]["survived"] == [] and "court_ft" in man["selection"]["survived"],
          "trace: params.json recorded as read even though the selection overrode all its values")
    r = run("tools/trace_params.py", "ZZ_A", "--key", "court_ft"); check("layer selection" in r.stdout and "option:C" in r.stdout and "layer project" in r.stdout, "trace_params --key: selection and per-option sources")
    r = run("tools/trace_params.py", "--file", "projects/ZZ_A/params.json"); check("ZZ_A" in r.stdout and "use(s) of" in r.stdout and "selected" in r.stdout, "trace_params --file finds the selection and options that read params.json")
    r = run("tools/trace_params.py", "--file", "standards/DEFAULT.json"); check("ZZ_A" in r.stdout, "trace_params --file across projects (standards set)")
    pj = pdir / "params.json"; orig = pj.read_text(encoding="utf-8")
    paths.save_json(pj, {"court_ft": {"value": 13, "lock": True}})
    st, out = task("ZZ_A", "P7-QC"); check(st == "failed" and "params.json changed since P5" in out, "trace: P7 fails when params.json changed after P5")
    check("STALE" in run("tools/catalog.py").stdout, "catalog usage index flags the stale file")
    pj.write_text(orig, encoding="utf-8"); check(task("ZZ_A", "P7-QC")[0] == "done", "trace: P7 passes again once the file is restored")
    # 7 flow B
    pdir = start("ZZ_B", "--typology", "TOWNHOME_RENTAL@0.1.0")
    sd = brief_rules("ZZ_B", pdir, ref="TOWNHOME_RENTAL@0.1.0"); check(task("ZZ_B", "P2-BRIEF")[0] == "done", "B: P2 on 0.1.0"); rules_ok("ZZ_B", pdir)
    check(task("ZZ_B", "P4-OPTIONS")[0] == "done", "B: P4 on 0.1.0")
    shutil.copy(FX / "selection_planner_A_0.1.0.json", pdir / "work" / "selection.json")
    check(task("ZZ_B", "P5-SELECT", "user: option A")[0] == "done", "B: P5 on 0.1.0")
    check("P5b-STAIR_SCHEDULE" not in {r["task_id"] for r in tasks.load(pdir)}, "B: 0.1.0 plan has no P5b")
    r = run("tools/upgrade_typology.py", "ZZ_B"); check("0.1.0 -> TOWNHOME_RENTAL@0.2.0" in r.stdout and (pdir / "work" / "upgrade_0.1.0_to_0.2.0.md").exists(), "B: upgrade diff report")
    r = run("tools/upgrade_typology.py", "ZZ_B", "--approved", "user: upgrade ok")
    rows = tasks.load(pdir); check(json.loads((pdir / "project.json").read_text(encoding="utf-8"))["typology_version"] == "0.2.0" and tasks.get(rows, "P5-SELECT")["status"] == "todo"
                                   and "P5b-STAIR_SCHEDULE" in {x["task_id"] for x in rows}, "B: approved upgrade re-pins, resets tasks, adds P5b")
    st, out = task("ZZ_B", "P3-RULES"); check(st == "blocked" and "door_min_width_ft" in out, "B: P3 asks for the rule the new version needs")
    confirm(pdir, "rules.json")
    for t in ["P3-RULES", "P4-OPTIONS"]: check(task("ZZ_B", t)[0] == "done", f"B: {t} re-run on 0.2.0")
    check(task("ZZ_B", "P5-SELECT", "user: option A")[0] == "done" and task("ZZ_B", "P5b-STAIR_SCHEDULE")[0] == "done"
          and task("ZZ_B", "P6-HANDOFF")[0] == "done" and task("ZZ_B", "P7-QC")[0] == "done", "B: P5..P7 on 0.2.0 after upgrade")
    # 8 flow C
    pdir = start("ZZ_C", "--typology", "TOWNHOME_RENTAL@0.2.0")
    r = run("tools/new_variant.py", "ZZ_C", "--extends", "TOWNHOME_RENTAL@0.2.0", "--id", "TOWNHOME_RENTAL_K"); check(r.returncode == 0, "C: new_variant scaffold + pin")
    for f in ("typology.json", "generator.py"): shutil.copy(FX / "variant_K" / f, pdir / "typology" / f)
    sd = brief_rules("ZZ_C", pdir, dec="variant", ref="TOWNHOME_RENTAL@0.2.0", options=["A", "K"]); check(task("ZZ_C", "P2-BRIEF")[0] == "done", "C: P2 variant match")
    rules_ok("ZZ_C", pdir); check(task("ZZ_C", "P4-OPTIONS")[0] == "done", "C: P4 with option K")
    k = json.loads((pdir / "options" / "K" / "option.json").read_text(encoding="utf-8"))
    check(k["lineage"] == ["TOWNHOME_RENTAL_K@0.1.0", "TOWNHOME_RENTAL@0.2.0"] and abs(k["result"]["units"][2]["w"] / (k["result"]["units"][2]["w"] + k["result"]["units"][3]["w"]) - 0.6) < 1e-9, "C: variant lineage and option K geometry")
    paths.save_json(pdir / "work" / "selection.json", {"option": "K", "params": {"rear_split_pct": 55}})
    check(task("ZZ_C", "P5-SELECT", "user: option K at 55%")[0] == "done" and task("ZZ_C", "P5b-STAIR_SCHEDULE")[0] == "done"
          and task("ZZ_C", "P6-HANDOFF")[0] == "done" and task("ZZ_C", "P7-QC")[0] == "done", "C: P5..P7 with the variant (inherited P5b stage)")
    r = run("tools/promote_variant.py", "ZZ_C", "--id", "ZZ_TOWNHOME_K"); check(r.returncode == 0 and typ.load("ZZ_TOWNHOME_K").lineage[-1] == "TOWNHOME_RENTAL@0.2.0", "C: promote variant to a registered typology")
    shutil.rmtree(paths.typology_dir("ZZ_TOWNHOME_K"))
    # 9 flow D
    pdir = start("ZZ_D", "--parcels", trace="site_trace_212.json")
    paths.save_json(pdir / "work" / "parcels.json", {"split": "depth", "parcels": [{"code": "PA", "depth_ft": 106, "typology": "TOWNHOME_RENTAL@0.2.0"}, {"code": "PB", "typology": "TOWNHOME_RENTAL@0.1.0"}]})
    st, out = task("ZZ_D", "P1b-PARCELS"); ids = {r["task_id"] for r in tasks.load(pdir)}
    check(st == "done" and {"PA:P5b-STAIR_SCHEDULE", "PB:P5-SELECT", "P6-HANDOFF"} <= ids and "PB:P5b-STAIR_SCHEDULE" not in ids, "D: P1b pins parcels (0.2.0 + 0.1.0) and adds their stage plans")
    for P, ver in (("PA", "0.2.0"), ("PB", "0.1.0")):
        sd = brief_rules("ZZ_D", pdir, scope=P, ref=f"TOWNHOME_RENTAL@{ver}", pre=f"{P}:"); check(task("ZZ_D", f"{P}:P2-BRIEF")[0] == "done", f"D: {P} P2")
        rules_ok("ZZ_D", sd, pre=f"{P}:"); check(task("ZZ_D", f"{P}:P4-OPTIONS")[0] == "done", f"D: {P} P4")
        paths.save_json(sd / "work" / "selection.json", {"option": "C" if P == "PA" else "A"})
        check(task("ZZ_D", f"{P}:P5-SELECT", f"user: option {'C' if P == 'PA' else 'A'}")[0] == "done", f"D: {P} P5")
    check(task("ZZ_D", "PA:P5b-STAIR_SCHEDULE")[0] == "done", "D: PA P5b")
    check(task("ZZ_D", "P6-HANDOFF")[0] == "done", "D: P6 merges parcels")
    tr = json.loads((pdir / "output" / "plan_trace.json").read_text(encoding="utf-8")); ys = {r["code"]: min(p[1] for p in r["polygon"]) for r in tr["rooms"]}
    check(len(tr["rooms"]) == 8 and ys["PA-U1"] > ys["PB-U4"] and len(tr["program"]) == 2, "D: 8 rooms, PA (road side) north of PB")
    check(task("ZZ_D", "P7-QC")[0] == "done", "D: P7 across parcels")
    # 9b villa typology: golden geometry + full project on an east-facing 30 x 40 plot
    TV = typ.load("VILLA_4BHK_G1"); bad = 0
    for c in json.loads((FX / "villa_golden.json").read_text(encoding="utf-8")):
        r = TV.call("generate", c["params"]); e = c["expect"]
        got = {f"{lv}-{rm['code']}": round(rm["area_sqft"], 3) for lv in r["rooms"] for rm in r["rooms"][lv]}
        bad += 0 if (got == e["rooms"] and r["mirror"] == e["mirror"] and r["vastu_score"] == e["vastu_score"] and abs(r["total"] - e["total"]) < 1e-3
                     and len([d for d in r["doors"] if not d.get("missing")]) == e["doors"]) else 1
    check(bad == 0, f"villa golden geometry (8 cases: options A/B x roads N/E/S/W): {bad} mismatches")
    rules_v = {k: v for k, v in TV.schema["rule_defaults"].items() if not k.startswith("_")}
    fails = [(c["params"]["option"], c["params"]["road_side"], x["msg"]) for c in json.loads((FX / "villa_golden.json").read_text(encoding="utf-8"))
             for x in TV.call("qc", TV.call("generate", c["params"]), rules_v, TV.schema["brief_defaults"]) if x["level"] == "fail"]
    check(not fails, f"villa: no failing QC with default rules on any road side {fails[:3]}")
    pdir = start("ZZ_E", "--typology", "VILLA_4BHK_G1@0.1.0", "--standards", "AADITHYAA", trace="site_trace_villa_east.json")
    site = json.loads((pdir / "site.json").read_text(encoding="utf-8")); check(site["left_ft"] == 40 and site["north_ft"] == 40 and site["road_side"] == "E", "E: P1 reads a road-east plot (north/south sides -> left/right)")
    r = run("tools/fit.py", "ZZ_E"); check("VILLA_4BHK_G1@0.1.0 | tested | yes" in r.stdout and "TOWNHOME_RENTAL@0.2.0 | tested | no" in r.stdout, "E: fit picks the villa, rejects town homes for 30 x 40")
    ids = [x["task_id"] for x in tasks.load(pdir)]
    check(ids == ["P1-SITE", "P2-BRIEF", "P3-RULES", "P4-OPTIONS", "P5-SELECT", "P5b-STAIR_SCHEDULE", "P5c-AREA_VASTU", "P6-HANDOFF", "P7-QC"], "E: villa stage plan (shared P5b + own P5c)")
    sd = brief_rules("ZZ_E", pdir, ref="VILLA_4BHK_G1@0.1.0"); st_, out_ = task("ZZ_E", "P2-BRIEF")
    if st_ == "blocked": confirm(pdir, "brief.json"); st_ = task("ZZ_E", "P2-BRIEF")[0]
    check(st_ == "done", "E: P2"); rules_ok("ZZ_E", pdir)
    check(task("ZZ_E", "P4-OPTIONS")[0] == "done", "E: P4 villa options")
    o = json.loads((pdir / "options" / "B" / "option.json").read_text(encoding="utf-8"))
    check(o["provenance"]["main_door_width_ft"]["layer"] == "standards" and o["params"]["main_door_width_ft"] == 3 and o["params"]["road_side"] == "E" and o["provenance"]["road_side"]["layer"] == "site",
          "E: AADITHYAA standard sets the main door; road side comes from site.json")
    paths.save_json(pdir / "work" / "selection.json", {"option": "B"})
    check(task("ZZ_E", "P5-SELECT", "user: option B")[0] == "done", "E: P5 option B")
    check(task("ZZ_E", "P5b-STAIR_SCHEDULE")[0] == "done" and task("ZZ_E", "P5c-AREA_VASTU")[0] == "done" and (pdir / "output" / "VASTU.md").exists(), "E: shared P5b + villa P5c")
    st_, out_ = task("ZZ_E", "P6-HANDOFF"); check(st_ == "done", "E: P6 hand-off")
    tr = json.loads((pdir / "output" / "plan_trace.json").read_text(encoding="utf-8"))
    check({r_["level"] for r_ in tr["rooms"]} == {"GF", "FF"} and any(r_["code"] == "FF-MBR" for r_ in tr["rooms"]) and "GF-OTS" not in [r_["code"] for r_ in tr["rooms"]], "E: trace has GF + FF rooms, void excluded")
    check(task("ZZ_E", "P7-QC")[0] == "done", "E: P7")

    # 11 shared with the other pipelines
    import hashlib
    sys.path.insert(0, str(ROOT / "_vendor"))
    from pipeline_kit import state as SS, interop as IO
    kit = json.loads((ROOT / "_vendor" / "KIT.json").read_text(encoding="utf-8"))
    have = {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in (ROOT / "_vendor" / "pipeline_kit").iterdir() if f.suffix == ".py" or f.name == "VERSION"}
    check(have == kit["files"], f"vendored pipeline_kit {kit['version']} matches KIT.json (no hand edits)")
    src = json.loads((ROOT / "standards" / "SOURCE.json").read_text(encoding="utf-8"))
    check(all(hashlib.sha256((ROOT / "standards" / f).read_bytes()).hexdigest() == m["sha256"] for f, m in src["files"].items()), "standards/ are byte-identical copies of the library masters")
    pjson = json.loads((ROOT / "pipeline.json").read_text(encoding="utf-8"))
    try:
        import jsonschema; errs = list(jsonschema.Draft202012Validator(json.loads((ROOT / "schemas" / "library" / "pipeline.v1.schema.json").read_text(encoding="utf-8"))).iter_errors(pjson))
    except ImportError: errs = []
    check(not errs and pjson["version"] == (ROOT / "VERSION").read_text(encoding="utf-8").strip() and pjson["kit"] == kit["version"], "pipeline.json validates (pipeline/1) and matches VERSION and the kit")
    try:
        import jsonschema; terr = list(jsonschema.Draft202012Validator(json.loads((ROOT / "schemas" / "library" / "plan_trace.v1.schema.json").read_text(encoding="utf-8"))).iter_errors(tr))
    except ImportError: terr = []
    check(not terr, "E: output/plan_trace.json validates against library/Schemas/plan_trace.v1" + (f" — {terr[0].message}" if terr else ""))
    for lv in ("GF", "FF"):
        cv, notes = IO.plan_trace_to_canvas(tr, lv, wall_mm=230)
        nd = sum(1 for d in tr["doors"] if d.get("level") == lv)
        check(sum(1 for s_ in cv["segments"] if s_["layer"] == "door") == nd and len(cv["spaces"]) == sum(1 for r_ in tr["rooms"] if r_["level"] == lv),
              f"E: {lv} plan_trace → canvas.v1 for the design brief: every room a space, all {nd} doors in their walls")
    r = run("tools/project_state.py", "pack", "ZZ_E"); stp = paths.project_dir("ZZ_E") / "work" / "state" / "state.json"
    st = json.loads(stp.read_text(encoding="utf-8")) if stp.exists() else {}
    LAST[0] = r.stdout + r.stderr
    check(r.returncode == 0 and "output/plan_trace.json" in st.get("files", {}) and "TASKS.csv" in st.get("files", {}) and all(f["via"] == "re-attach" for f in st.get("fetch", [])),
          f"E: project packs for the library: outputs travel, {len(st.get('fetch', []))} inputs listed to re-attach")
    keep = paths.project_dir("ZZ_E").parent / "_ZZ_E_saved"; shutil.rmtree(keep, ignore_errors=True); shutil.move(str(paths.project_dir("ZZ_E")), str(keep))
    r = run("tools/project_state.py", "unpack", str(keep / "work" / "state" / "state.json"))
    check(r.returncode == 0 and (paths.project_dir("ZZ_E") / "output" / "plan_trace.json").read_text(encoding="utf-8") == (keep / "output" / "plan_trace.json").read_text(encoding="utf-8")
          and tasks.get(tasks.load(paths.project_dir("ZZ_E")), "P7-QC")["status"] == "done", "E: restore rebuilds the project folder with its task sheet and outputs")
    shutil.rmtree(keep, ignore_errors=True)

    # 10 tools
    check(run("tools/catalog.py").returncode == 0, "catalog"); check(run("tools/fit.py", "ZZ_A").returncode == 0 and (paths.project_dir("ZZ_A") / "work" / "FIT.md").exists(), "fit report")
    r = run("tools/new_typology.py", "ZZ_NEWTYPE", "--title", "scaffold test"); check(r.returncode == 0 and typ.registry()["ZZ_NEWTYPE"]["status"] == "spec", "new_typology scaffold (status spec)")
    shutil.rmtree(paths.typology_dir("ZZ_NEWTYPE"), ignore_errors=True)
finally:
    for c in ([] if "--keep" in sys.argv else TMP): shutil.rmtree(paths.project_dir(c), ignore_errors=True)
    for p, t in regs.items(): p.write_text(t, encoding="utf-8")
print("\nALL PASS" if ok else "\nSOME CHECKS FAILED"); sys.exit(0 if ok else 1)
