"""S2 brief draft: deck.json + room -> roombrief.draft.json

Collects everything the deck says about one room, item by item, with provenance:
zone polygon on the plan (from the outlines drawn on the slide), reference images,
product links, raw text, dimensions and levels. Structured params are filled in by
the S2 agent step (see stages/S2_BRIEF/prompt.md) into roombrief.json.

    python tools/brief.py <deck_dir> "<project title prefix>" "<room>" <draft.json>
    python tools/brief.py finalize <draft.json> <roombrief.curated.json> <roombrief.json>
"""
import json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from intake import norm  # noqa: E402


def main(deck_dir, project, room, out):
    deck_dir = Path(deck_dir)
    d = json.loads((deck_dir / "deck.json").read_text(encoding="utf-8"))
    proj = next(p for p in d["projects"] if p["title"].lower().startswith(project.lower()))
    rm = next(r for r in proj["rooms"] if r["id"] == norm(room))
    by = {s["slide"]: s for s in d["slides"]}
    plan = proj.get("plan")

    items, reviews, views, dims = [], [], [], []
    for n in rm["slides"]:
        s = by[n]
        pics = [p for p in s["pictures"] if not p.get("is_plan")]
        plan_pic = next((p for p in s["pictures"] if p.get("is_plan")), None)
        texts = [t["text"] for t in s["texts"]]
        swatches = [{"fill": x["fill"], "box": x["box"]} for x in s["shapes"] + s["texts"]
                    if x.get("fill") and not x["fill"].startswith("#FF0000")  # red = callout arrows
                    and "points" not in x]  # filled freeforms over the plan are zone highlights
        base = {"slide": n, "swatches": swatches, "texts": texts, "urls": s["urls"], "dims_mm": s["dims_mm"], "levels_mm": s["levels_mm"]}
        if s["kind"] in ("spec", "label"):
            zones = [{"kind": o["kind"], "points_px": o["points_px"]} for o in s.get("plan_overlays", []) if o.get("points_px")]
            items.append({**base, "category": s.get("category"), "refs": [p["file"] for p in pics],
                          "zones_px": zones, "plan_view_px": plan_pic and plan_pic["plan_rect_px"]})
        elif s["kind"] == "dims":
            dims.append({**base, "refs": [p["file"] for p in pics]})
        elif s["kind"] == "review":
            reviews.append({**base, "category": s.get("category"), "renders": [p["file"] for p in pics]})
        elif s["kind"] in ("view", "final_render"):
            views.append({"slide": n, "kind": s["kind"], "images": [p["file"] for p in pics]})

    rects = [i["plan_view_px"] for i in items if i.get("plan_view_px")]
    draft = {
        "schema": "roombrief.draft/1",
        "project": proj["title"], "room": rm["name"], "room_id": rm["id"],
        "source": {"deck": d["source"], "divider_slide": rm.get("divider_slide"), "slides": rm["slides"]},
        "plan": plan and {"file": plan["file"], "px": plan["px"], "room_view_px": rects[0] if rects else None},
        "items": items, "dimension_sheets": dims, "reviews": reviews, "views": views,
    }
    Path(out).write_text(json.dumps(draft, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{rm['name']}: {len(items)} spec items, {len(dims)} dim sheets, {len(reviews)} reviews, {len(views)} views -> {out}")


if __name__ == "__main__" and sys.argv[1:2] != ["finalize"]:
    main(*sys.argv[1:5])


def finalize(draft_path, curated_path, out):
    """Merge the agent-curated brief with the draft's provenance and check coverage.

    Every item gets refImages / productUrls / deckSlides from its slides; every zone gets its plan
    polygon. Fails if a spec/review/dims slide of the room is referenced by no item, check or camera."""
    draft = json.loads(Path(draft_path).read_text(encoding="utf-8"))
    cur = json.loads(Path(curated_path).read_text(encoding="utf-8"))
    src = {x["slide"]: x for x in draft["items"] + draft["dimension_sheets"] + draft["reviews"]}
    for z in cur["zones"]:
        s = src[z["from_slide"]]
        z["points_px"] = next(o["points_px"] for o in s["zones_px"] if len(o["points_px"]) >= 3)
    for it in cur["items"]:
        refs, urls = [], []
        for n in it["slides"]:
            s = src.get(n)
            if s is None:
                raise SystemExit(f"{it['id']}: slide {n} is not a spec/review/dims slide of this room")
            refs += s.get("refs", []) + s.get("renders", [])
            urls += s["urls"]
        it["refImages"] = list(dict.fromkeys(refs))
        it["productUrls"] = list(dict.fromkeys(([it["productUrl"]] if it.get("productUrl") else []) + urls))
    used = {n for it in cur["items"] for n in it["slides"]} | {c["slide"] for c in cur.get("checks", [])} \
        | {c["match_slide"] for c in cur.get("cameras", [])} | {z["from_slide"] for z in cur["zones"]}
    missing = sorted(set(src) - used)
    if missing:
        raise SystemExit(f"slides not covered by the brief: {missing}")
    cur["source"] = draft["source"]
    cur["plan"] = draft["plan"]
    cur["views"] = draft["views"]
    Path(out).write_text(json.dumps(cur, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"roombrief OK: {len(cur['items'])} items, {len(cur['zones'])} zones, all {len(src)} slides covered -> {out}")


if __name__ == "__main__" and len(sys.argv) > 1 and sys.argv[1] == "finalize":
    finalize(*sys.argv[2:5])
