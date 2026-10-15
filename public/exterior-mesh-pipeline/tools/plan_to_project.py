"""Master plan → project items, prototypes, instances and TASKS.csv.  System Python 3.10+ with shapely.

    python tools/plan_to_project.py RMD_EXT            (reads projects/RMD_EXT/project.json → source)

Writes
    geometry/<design>.json          extracted exterior per design (+ _M mirrored when a plot mirrors it)
    items/<CODE>/item.json          one per site element, building prototype (LOD2 / LOD1), plant / light prototype
    instances.json                  buildings, trees, shrubs, lights (prototype + world transform)
    TASKS.csv                       selftest → family_verify → site items → prototypes → instances → qc → export → report
Designs are fetched from the project folder in R2 (Projects/<CODE>/inputs/designs/) into cache/ (not shipped, see .gitignore).
Re-running keeps the status of task rows whose target still exists (new rows are todo).
"""
import json, os, sys, glob
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import paths, tasks
from adapters import canvas_masterplan as A

def main(code):
    pdir = paths.project_dir(code); proj = json.load(open(os.path.join(pdir, "project.json"), encoding="utf-8"))
    src = proj["source"]; J = lambda rel: json.load(open(os.path.join(pdir, rel), encoding="utf-8"))
    site, mp = J(src["site"]), J(src["masterplan"])
    envelopes = {os.path.splitext(os.path.basename(f))[0]: json.load(open(f, encoding="utf-8")) for f in glob.glob(os.path.join(pdir, src["envelopes"], "*.json"))}
    os.makedirs(os.path.join(pdir, "geometry"), exist_ok=True)
    cache = os.path.join(paths.work_dir(code), "cache")
    mirrored = {s["design"] for s in mp.get("summary", []) if s.get("mirror")}
    stats = {}
    for dname, info in mp["designs"].items():
        print(f"design {dname}: {info['path']}", flush=True)
        d = A.fetch_design(info["path"], cache, proj["library_url"])
        geo = A.extract_building(d, proj["site"]["plinth_h"])
        json.dump(geo, open(os.path.join(pdir, "geometry", f"{dname}.json"), "w", encoding="utf-8"), separators=(",", ":"))
        if dname in mirrored:
            json.dump(A.mirror_building(geo), open(os.path.join(pdir, "geometry", f"{dname}_M.json"), "w", encoding="utf-8"), separators=(",", ":"))
        stats[dname] = geo["stats"]
    items, inst, summary = A.build_items(site, mp, envelopes, None, proj["site"])
    # prototypes: buildings per LOD, plants and lights per LOD
    protos = []
    for b in {(x["proto"], x["design"], x["proto"].endswith("_M")) for x in inst["buildings"]}:
        proto, dname, mir = b
        for lod in (2, 1):
            protos.append(dict(code=f"{proto}-LOD{lod}".replace("_", "-"), family="BUILDING", group="prototypes", params={"lod": lod},
                               geometry={"$ref": f"geometry/{dname}{'_M' if mir else ''}.json"}, proto=f"{proto}_LOD{lod}"))
    plant = proj["site"]["plants"]
    for sp in proj["site"]["tree_species"]:
        for lod in (2, 1):
            protos.append(dict(code=f"{sp}-LOD{lod}", family="TREE", group="prototypes", params=dict(plant[sp], species=sp, lod=lod), geometry=None, proto=f"{sp}_LOD{lod}"))
    for fam, key in (("SHRUB", "SHRUB"), ("STREET_LIGHT", "STREET_LIGHT")):
        for lod in (2, 1):
            protos.append(dict(code=f"{key.replace('_', '-')}-LOD{lod}", family=fam, group="prototypes", params=dict(plant.get(key, {}), lod=lod), geometry=None, proto=f"{key}_LOD{lod}"))
    for group in inst.values():
        for x in group: x["proto"] = f"{x['proto']}_LOD2"           # instances show the detailed prototype; LOD1 ships as Unreal LOD1
    import shutil
    keep = {it["code"] for it in items + protos}
    for d in glob.glob(os.path.join(pdir, "items", "*")):          # items the plan no longer produces
        if os.path.basename(d) not in keep: shutil.rmtree(d)
    for it in items + protos:
        d = os.path.join(pdir, "items", it["code"]); os.makedirs(d, exist_ok=True)
        it.setdefault("status", "todo")
        json.dump(it, open(os.path.join(d, "item.json"), "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
        brief = f"# {it['code']} — {it['family']}\n\nGroup: {it['group']}" + (f" · prototype `{it['proto']}`" if it.get("proto") else "") + \
                f"\n\nParams: `{json.dumps(it['params'])}`\n\nBuild with the family recipe (families/{it['family']}/family.json). Acceptance: closed parts manifold, UV0 real-world, UV1 lightmap packed, under the triangle budget.\n"
        open(os.path.join(d, "prompt.md"), "w", encoding="utf-8").write(brief)
    json.dump(inst, open(os.path.join(pdir, "instances.json"), "w", encoding="utf-8"), indent=0)
    # task sheet
    old = {r["task_id"]: r for r in (tasks.load(pdir) if os.path.exists(tasks.path(pdir)) else [])}
    rows = [dict(task_id="P0-SELFTEST", phase="0", type="selftest", target="core")]
    fams = sorted({it["family"] for it in items + protos})
    rows += [dict(task_id=f"P1-FAM-{f}", phase="1", type="family_verify", target=f, family=f, depends_on="P0-SELFTEST") for f in fams]
    for it in items:
        rows.append(dict(task_id=f"P2-ITEM-{it['code']}", phase="2", type="item_build", target=it["code"], family=it["family"], group=it["group"], depends_on=f"P1-FAM-{it['family']}"))
    for it in protos:
        rows.append(dict(task_id=f"P3-PROTO-{it['code']}", phase="3", type="proto_build", target=it["code"], family=it["family"], group="prototypes", depends_on=f"P1-FAM-{it['family']}"))
    for g in ("buildings", "trees", "shrubs", "lights"):
        need = {x["proto"] for x in inst[g]}
        dep = ";".join(r["task_id"] for r in rows if r["type"] == "proto_build" and next(p["proto"] for p in protos if p["code"] == r["target"]) in need)
        rows.append(dict(task_id=f"P4-INST-{g.upper()}", phase="4", type="instance_place", target=g, group=g, depends_on=dep))
    rows.append(dict(task_id="P5-QC-SITE", phase="5", type="qc_site", target="site", depends_on=";".join(r["task_id"] for r in rows if r["phase"] in ("2", "3", "4"))))
    rows.append(dict(task_id="P6-EXPORT-UNREAL", phase="6", type="export", target="unreal_fbx", depends_on="P5-QC-SITE"))
    rows.append(dict(task_id="P7-REPORT", phase="7", type="report", target="REPORT.md", depends_on="P6-EXPORT-UNREAL"))
    for r in rows:
        r.setdefault("status", "todo")
        if r["task_id"] in old:
            for k in ("status", "agent", "started", "finished", "output", "report", "notes"): r[k] = old[r["task_id"]].get(k, r.get(k, ""))
    tasks.save(pdir, rows)
    summary["designs"] = stats; summary["items"] = len(items); summary["prototypes"] = len(protos); summary["tasks"] = len(rows)
    json.dump(summary, open(os.path.join(pdir, "plan_summary.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(summary, indent=1))

if __name__ == "__main__":
    main(sys.argv[1])
