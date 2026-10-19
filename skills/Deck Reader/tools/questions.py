"""S1 questions: deck.json -> questions.json (questions/1), what the USER must answer before S2 can start.
    python tools/questions.py <deck_dir> <questions.json>

Only what the deck cannot settle by itself: which floorplan (a deck or an image can hold several) and which room on
it. (Ceiling height, a scale dimension and free notes are no longer asked — S2 calibrates from the printed sizes.) Every question carries
what the deck offered (options, a default, the slides it came from) so the user answers from evidence.
The pipeline app renders the form; the answers come back in its store (answers/main) — never from the agent.
"""
import json, sys
from pathlib import Path


def main(deck_dir, out):
    d = json.loads((Path(deck_dir) / "deck.json").read_text(encoding="utf-8"))
    by_slide = {s["slide"]: s for s in d["slides"]}
    rooms = [(p, r) for p in d["projects"] for r in p["rooms"]]
    qs = []
    if len(d["projects"]) > 1:
        qs.append({"key": "project", "label": "Which floorplan should Build use?", "type": "select",
                   "options": [p["title"] for p in d["projects"]], "default": d["projects"][0]["title"],
                   "why": f"the deck holds {len(d['projects'])} projects (cover slides " + ", ".join(str(p["cover_slide"]) for p in d["projects"]) + ")"})
    opts = [f"{p['title']} › {r['name']}" for p, r in rooms]
    qs.append({"key": "room", "label": "Which room on that floorplan?", "type": "select", "options": opts, "default": opts[0] if opts else "",
               "why": "Build models one room at a time; " + ("each option is a room the deck has slides for" if not any(p.get("fallback") for p, _ in rooms)
                       else "the deck has no cover/divider slides, so it is one room — give it a name below"),
               "room_ids": {f"{p['title']} › {r['name']}": {"project": p["title"], "room": r["id"], "slides": r["slides"], **({"board": p["board"]} if p.get("board") else {})} for p, r in rooms}})
    if any(p.get("fallback") for p, _ in rooms):
        qs.append({"key": "room_name", "label": "Name of the room (e.g. Reception)", "type": "text", "default": ""})
    doc = {"schema": "questions/1", "stage": "S1_INTAKE", "deck": d.get("source"), "slides": d.get("slide_count"),
           "projects": [{"title": p["title"], "rooms": [r["name"] for r in p["rooms"]], "plan": bool(p.get("plan"))} for p in d["projects"]],
           "questions": qs}
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(qs)} questions -> {out} ({len(rooms)} room(s) in {len(d['projects'])} project(s))")


if __name__ == "__main__":
    main(*sys.argv[1:3])
