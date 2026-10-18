"""S1 questions: deck.json -> questions.json (questions/1), what the USER must answer before S2 can start.
    python tools/questions.py <deck_dir> <questions.json>

Only what the deck cannot settle by itself: which project (a deck can hold several), which room, the ceiling
height when the room's slides state none, and a dimension to scale the plan by (S3). Every question carries
what the deck offered (options, a default, the slides it came from) so the user answers from evidence.
The pipeline app renders the form; the answers come back in its store (answers/main) — never from the agent.
"""
import json, sys
from collections import Counter
from pathlib import Path


def main(deck_dir, out):
    d = json.loads((Path(deck_dir) / "deck.json").read_text(encoding="utf-8"))
    by_slide = {s["slide"]: s for s in d["slides"]}
    rooms = [(p, r) for p in d["projects"] for r in p["rooms"]]
    qs = []
    if len(d["projects"]) > 1:
        qs.append({"key": "project", "label": "Which project in the deck?", "type": "select",
                   "options": [p["title"] for p in d["projects"]], "default": d["projects"][0]["title"],
                   "why": f"the deck holds {len(d['projects'])} projects (cover slides " + ", ".join(str(p["cover_slide"]) for p in d["projects"]) + ")"})
    opts = [f"{p['title']} › {r['name']}" for p, r in rooms]
    qs.append({"key": "room", "label": "Which room should Build model?", "type": "select", "options": opts, "default": opts[0] if opts else "",
               "why": "Build models one room at a time; " + ("each option is a room the deck has slides for" if not any(p.get("fallback") for p, _ in rooms)
                       else "the deck has no cover/divider slides, so it is one room — give it a name below"),
               "room_ids": {f"{p['title']} › {r['name']}": {"project": p["title"], "room": r["id"], "slides": r["slides"]} for p, r in rooms}})
    if any(p.get("fallback") for p, _ in rooms):
        qs.append({"key": "room_name", "label": "Name of the room (e.g. Reception)", "type": "text", "default": ""})
    levels = Counter(l for _, r in rooms for s in r["slides"] for l in by_slide[s].get("levels_mm", []))
    ceil = max(levels) if levels else None
    qs.append({"key": "ceiling_mm", "label": "Ceiling height (mm)", "type": "number", "default": ceil or 2700,
               "why": (f"the deck states levels {sorted(levels)} mm" if levels else "the deck states no ceiling level") + " — confirm or correct"})
    dims = Counter(x for _, r in rooms for s in r["slides"] for x in by_slide[s].get("dims_mm", []))
    qs.append({"key": "scale_ref", "label": "One dimension you know on the plan (what + mm, e.g. 'reception desk 3300')", "type": "text",
               "default": "", "why": "S3 scales the plan image from it" + (f"; the deck mentions {', '.join(k for k, _ in dims.most_common(6))} mm" if dims else "")})
    qs.append({"key": "notes", "label": "Anything Build should know (changes since the deck, items to skip)", "type": "text", "default": ""})
    doc = {"schema": "questions/1", "stage": "S1_INTAKE", "deck": d.get("source"), "slides": d.get("slide_count"),
           "projects": [{"title": p["title"], "rooms": [r["name"] for r in p["rooms"]], "plan": bool(p.get("plan"))} for p in d["projects"]],
           "questions": qs}
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(qs)} questions -> {out} ({len(rooms)} room(s) in {len(d['projects'])} project(s))")


if __name__ == "__main__":
    main(*sys.argv[1:3])
