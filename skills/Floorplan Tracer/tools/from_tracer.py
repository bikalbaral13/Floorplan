"""S3 from the Floorplan Tracer: the tracer's plan (walls, openings, columns, spaces measured by ITS stages — wallbands,
calibrated image frame, checks, the user's S8 approval) -> this pipeline's trace.px.json, in the deck plan's pixels.
geometry.py then runs unchanged. Plan tracing is never eyeballed here: it is the Floorplan Tracer's job.

    python tools/from_tracer.py <tracer project dir> <roombrief.json> <out trace.px.json> [--scale-ref "what" --scale-mm N]

Frames: tracer plan.json is metres (X east, Y north) on an IMAGE frame — layout.json frame {px_per_m, origin_px} in the
image the tracer saw, which is the deck plan cropped at project.json crop_px. So
    full_px = crop_px[0:2] + (origin_px[0] + x * px_per_m, origin_px[1] - y * px_per_m)
Collinear tracer pieces (walls, doors, windows, openings along one centreline) become ONE Build wall, the openings
cut it. Spaces become the brief's zones (one zone ↔ the largest tracer space when there is a single zone; otherwise by
name). --scale-ref/--scale-mm only label the scale (the tracer's px/m is the scale); the check is recorded.
"""
import argparse, json, math, os, sys
from pathlib import Path


def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("tracer"); ap.add_argument("brief"); ap.add_argument("out")
    ap.add_argument("--scale-ref", default=""); ap.add_argument("--scale-mm", type=float, default=0)
    a = ap.parse_args()
    T = Path(a.tracer)
    plan = json.loads((T / "plan.json").read_text(encoding="utf-8"))
    layout = json.loads((T / "layout.json").read_text(encoding="utf-8"))
    pj = json.loads((T / "project.json").read_text(encoding="utf-8"))
    brief = json.loads(Path(a.brief).read_text(encoding="utf-8"))
    fr = layout.get("frame") or {}
    if fr.get("type") != "image" or not fr.get("px_per_m"):
        sys.exit("the tracer plan is not on an image frame (a sketch?) — Build S3 needs a measured drawing trace")
    ppm = float(fr["px_per_m"]); ox, oy = fr["origin_px"]; cx, cy = (pj.get("crop_px") or [0, 0])[:2]
    P = lambda m: [round(cx + ox + m[0] * ppm, 2), round(cy + oy - m[1] * ppm, 2)]
    L = plan["levels"][0]

    # group collinear pieces (walls + openings) into lines
    # only real walls: a tracer "line" (a drawn edge, a shower screen) is not a wall in Build
    pieces = [dict(p, _k="wall") for p in L["walls"] if p.get("kind", "wall") == "wall"] + [dict(p, _k="opening") for p in L["openings"]]
    def key(p):
        (ax, ay), (bx, by) = p["a"], p["b"]
        ang = math.atan2(by - ay, bx - ax) % math.pi
        nx, ny = -math.sin(ang), math.cos(ang)
        return round(ang, 3), round(ax * nx + ay * ny, 3)
    lines = {}
    for p in pieces:
        lines.setdefault(key(p), []).append(p)
    walls, openings, n = [], [], 0
    for (ang, _), ps in sorted(lines.items(), key=lambda kv: kv[0]):
        ux, uy = math.cos(ang), math.sin(ang)
        proj = lambda q: q[0] * ux + q[1] * uy
        ps.sort(key=lambda p: min(proj(p["a"]), proj(p["b"])))
        # split the line where pieces do not touch (two separate walls on one centreline)
        runs, cur = [], [ps[0]]
        for p in ps[1:]:
            end = max(max(proj(q["a"]), proj(q["b"])) for q in cur)
            if min(proj(p["a"]), proj(p["b"])) - end > 0.05:
                runs.append(cur)
                cur = [p]
            else:
                cur.append(p)
        runs.append(cur)
        for run in runs:
            if not any(p["_k"] == "wall" for p in run):
                continue
            n += 1
            lo = min(run, key=lambda p: min(proj(p["a"]), proj(p["b"])))
            hi = max(run, key=lambda p: max(proj(p["a"]), proj(p["b"])))
            a_m = lo["a"] if proj(lo["a"]) <= proj(lo["b"]) else lo["b"]
            b_m = hi["b"] if proj(hi["b"]) >= proj(hi["a"]) else hi["a"]
            ws = [p for p in run if p["_k"] == "wall"]
            t = max(p["t"] for p in ws)
            label = next((p["label"] for p in ws if p.get("label")), "")
            wid = f"W{n}"
            walls.append({"id": wid, "a": P(a_m), "b": P(b_m), "t_mm": round(t * 1000), "h_mm": round(max(p.get("h", L["height"]) for p in ws) * 1000),
                          "label": label or f"tracer line {wid}", "tracer": [p["id"] for p in run]})
            for o in (p for p in run if p["_k"] == "opening"):
                kind = {"door": "door", "window": "window"}.get(o["kind"], "opening")
                openings.append({"id": o["id"], "wall": wid, "from_px": P(o["a"]), "to_px": P(o["b"]), "kind": kind,
                                 "leaves": o.get("leaves") or 1, "hinge": o.get("hinge") or "a", "swing": o.get("swing") or "L",
                                 "head_mm": round((o.get("head") or 2.1) * 1000), "label": o.get("label") or kind})
    columns = [{"id": c["id"], "c_px": P(c["c"]), "size_mm": [round(s * 1000) for s in c["size"]], "label": c.get("label", "column")}
               for c in L.get("columns", [])]

    # spaces -> the brief's zones
    spaces = [s for s in L.get("spaces", []) if s.get("ring")]
    area = lambda r: abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2
    zones = []
    if len(brief["zones"]) == 1 and spaces:
        s = max(spaces, key=lambda s: area(s["ring"]))
        zones.append({"id": brief["zones"][0]["id"], "ring_px": [P(p) for p in s["ring"]], "why": f"tracer space {s['id']} {s.get('name', '')}".strip()})
    else:
        for z in brief["zones"]:
            s = next((s for s in spaces if (s.get("name") or "").lower() in z["label"].lower() or z["label"].lower() in (s.get("name") or "").lower()), None)
            if s: zones.append({"id": z["id"], "ring_px": [P(p) for p in s["ring"]], "why": f"tracer space {s['id']} {s.get('name', '')}".strip()})

    ref_mm = a.scale_mm or 1000
    trace = {
        "schema": "deck-trace/1",
        "note": f"From the Floorplan Tracer (project {pj.get('code')}, frame {ppm} px/m, crop {pj.get('crop_px')}); "
                f"walls are the tracer's centrelines mapped to the deck plan's pixels. Do not edit coordinates here — re-trace.",
        "scale": {"method": f"Floorplan Tracer image frame {ppm} px/m ({plan.get('scale', {}).get('method', 'tracer')})"
                            + (f"; user's reference: {a.scale_ref} = {a.scale_mm:.0f} mm" if a.scale_ref else ""),
                  "ref_px": [P([0, 0]), P([ref_mm / 1000, 0])], "ref_mm": ref_mm, "checks": []},
        "origin_px": P([0, 0]),
        "level": {"id": L["id"], "name": L.get("name") or brief["room"], "height_m": L.get("height") or 3.0, "height_src": "Floorplan Tracer"},
        "walls": walls, "openings": openings, "columns": columns, "zones": zones,
        "furniture_hints": [],
        "tracer": {"project": pj.get("code"), "px_per_m": ppm, "crop_px": pj.get("crop_px"), "spaces": [s["id"] for s in spaces]},
    }
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(trace, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"trace.px.json from tracer {pj.get('code')}: {len(walls)} walls, {len(openings)} openings, {len(columns)} columns, "
          f"{len(zones)} zone outline(s) · {ppm} px/m · crop {pj.get('crop_px')} -> {a.out}")


if __name__ == "__main__":
    main()
