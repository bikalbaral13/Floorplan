"""S4 check: resolve.json against the library catalog, the new objects/materials and the brief.

    python tools/resolve_check.py <project_dir> <catalog.json>

Fails on: an item with no binding; an object path that is neither in the library nor built here;
a param id the object does not have; a select value outside its options; a material path (materialPath
or any finishes entry) that does not exist; a host naming an unknown zone / wall / opening.
"""
import json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
HELPER = {"panesEveryM"}  # resolved by S5 into real params (panes)


def main(project_dir, catalog_path):
    P = Path(project_dir)
    brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
    res = json.loads((P / "resolve.json").read_text(encoding="utf-8"))
    trace = json.loads((P / "trace.px.json").read_text(encoding="utf-8"))
    cat = json.loads(Path(catalog_path).read_text(encoding="utf-8"))

    objects = {o["path"]: {p["id"]: p for p in o["params"]} for o in cat["objects"]}
    for path in res["new"]["objects"]:
        f = HERE / "objects/out" / Path(path).name
        if not f.exists():
            raise SystemExit(f"new object {path} not built ({f.name})")
        d = json.loads(f.read_text(encoding="utf-8"))
        props = next(n for n in d["nodes"] if n["data"]["tool"] == "input-props")["data"]["params"]["props"]
        objects[path] = {p["id"]: p for p in props if p["id"] != "P"}
    materials = {m["path"].removeprefix("Materials/") for m in cat["materials"]}
    for m in res["new"]["materials"]:
        if not (HERE / "materials" / Path(m).name).exists():
            raise SystemExit(f"new material {m} has no file in materials/")
        materials.add(m)

    zones = {z["id"] for z in brief["zones"]}
    walls = {w["id"] for w in trace["walls"]}
    openings = {o["id"] for o in trace["openings"]}
    problems, by_item = [], {b["item"]: b for b in res["bindings"]}
    for it in brief["items"]:
        if it["id"] not in by_item:
            problems.append(f"{it['id']}: no binding")
    for b in res["bindings"]:
        tag = b["item"]
        if b["status"] in ("render-only", "omitted"):
            continue
        params = objects.get(b["object"])
        if params is None:
            problems.append(f"{tag}: object {b['object']} not in library or built here")
            continue
        sets = [b.get("params", {}), b.get("params_full_height", {})] + b.get("per_instance", [])
        if "doors" in b:
            dp = objects.get(b["doors"]["object"])
            for k, v in b["doors"]["params"].items():
                if k not in dp:
                    problems.append(f"{tag}: door has no param {k}")
            sets.append({k: v for k, v in b["doors"]["params"].items() if k in ("materialPath", "finishes")})
            problems += [f"{tag}: unknown opening {o}" for o in b["doors"]["openings"] if o not in openings]
        for ps in sets:
            for k, v in ps.items():
                if k in HELPER:
                    continue
                if k not in params:
                    problems.append(f"{tag}: {b['object'].split('/')[-1]} has no param '{k}'")
                    continue
                opts = params[k].get("options")
                if opts and v not in opts:
                    problems.append(f"{tag}: {k}={v!r} not in {opts}")
                if k == "materialPath" and v not in materials:
                    problems.append(f"{tag}: material {v} does not exist")
                if k == "finishes":
                    for path in re.findall(r"=\s*([^;]+?\.json)", v):
                        if path.strip() not in materials:
                            problems.append(f"{tag}: finishes material {path.strip()} does not exist")
        h = b["host"]
        if "space" in h and h["space"] not in zones:
            problems.append(f"{tag}: unknown zone {h['space']}")
        for w in [h.get("wall")] + [r["wall"] for r in h.get("runs", [])]:
            if w and w not in walls:
                problems.append(f"{tag}: unknown wall {w}")

    counts = {}
    for b in res["bindings"]:
        counts[b["status"]] = counts.get(b["status"], 0) + 1
    print("bindings:", ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    if problems:
        print("\n".join("FAIL " + p for p in problems))
        raise SystemExit(1)
    print(f"resolve OK: {len(res['bindings'])} bindings, every param/material/host checked")


if __name__ == "__main__":
    main(*sys.argv[1:3])
