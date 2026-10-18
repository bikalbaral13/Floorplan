"""Image decks: a single moodboard / plan image -> the same deck.json a .pptx gives, from Claude's panels.json.

    python tools/panels.py <deck_dir> [<panels.json>]      (default <deck_dir>/panels.json)

A slide deck has one slide per idea; a moodboard image packs everything into one picture. intake.py turns the
image into one 'board' page; Claude marks what is on it (panels.json, deck-panels/1 — see the skill's
read-an-image-deck.md); this script crops every marked box into images/ and writes deck.json with ONE SLIDE PER
PANEL, so questions.py, brief.py draft / finalize and the rest of the pipeline run unchanged:

    {"schema": "deck-panels/1", "project": "Bachelor Pad", "room": "Bachelor Pad",
     "plan":  {"box": [x0, y0, x1, y1], "printed": ["18'11\\"", "17'5\\""], "note": "…"},
     "items": [{"id": "sofa-leather", "box": [x0, y0, x1, y1], "category": "furniture", "label": "Cognac leather sofa",
                "kind": "object" | "swatch", "note": "…", "urls": []}],
     "views": [{"id": "render-1", "box": [...]}]}

Boxes are in the source image's pixels. A 'swatch' (paint chip, floor sample) also records its mean colour as a
swatch fill, the way a drawn colour chip on a slide does.
"""
import json, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from intake import norm  # noqa: E402
from progress import report  # noqa: E402


def mean_hex(im):
    small = im.convert("RGB").resize((1, 1), Image.BOX)
    r, g, b = small.getpixel((0, 0))
    return f"#{r:02X}{g:02X}{b:02X}"


def main(deck_dir, panels_path=None):
    deck_dir = Path(deck_dir)
    deck = json.loads((deck_dir / "deck.json").read_text(encoding="utf-8"))
    P = json.loads(Path(panels_path or deck_dir / "panels.json").read_text(encoding="utf-8"))
    if P.get("schema") != "deck-panels/1":
        sys.exit("panels.json must be deck-panels/1")
    src = Image.open(deck_dir / deck["board"]["file"]).convert("RGB")
    W, H = src.size
    img_dir = deck_dir / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    def crop(pid, box):
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
            sys.exit(f"{pid}: box {box} is outside the {W}x{H} image")
        im = src.crop((x0, y0, x1, y1))
        rel = f"images/{norm(pid) or pid}.png"
        im.save(deck_dir / rel)
        return rel, im

    slides, n = [], 0
    total = 1 + len(P.get("items", [])) + len(P.get("views", []))
    # slide 1: the plan, with its printed sizes (dims) — finalize wants it covered by a check or a zone
    pl = P["plan"]
    rel, im = crop("plan", pl["box"])
    n += 1
    plan = {"md5": "", "file": rel, "px": list(im.size), "slides": total, "source_box": pl["box"]}
    slides.append({"slide": n, "kind": "dims", "category": "plan", "panel": "plan",
                   "texts": [{"text": t, "box": [0, 0, 0, 0]} for t in pl.get("printed", [])] + ([{"text": pl["note"], "box": [0, 0, 0, 0]}] if pl.get("note") else []),
                   "pictures": [{"md5": "", "file": rel, "px": list(im.size), "box": [0, 0, 1, 1], "crop": [0, 0, 0, 0], "is_plan": True,
                                 "plan_rect_px": [0, 0, im.size[0], im.size[1]]}],
                   "shapes": [], "tables": [], "urls": [], "dims_mm": [], "levels_mm": []})
    report(10, "Plan panel cropped")
    for i, it in enumerate(P.get("items", []), 1):
        rel, im = crop(it["id"], it["box"])
        n += 1
        shapes = [{"kind": "SWATCH", "fill": mean_hex(im), "box": [0, 0, 1, 1]}] if it.get("kind") == "swatch" else []
        slides.append({"slide": n, "kind": "spec", "category": it.get("category"), "panel": it["id"],
                       "texts": [{"text": it.get("label", it["id"]), "box": [0, 0, 0, 0]}] + ([{"text": it["note"], "box": [0, 0, 0, 0]}] if it.get("note") else []),
                       "pictures": [{"md5": "", "file": rel, "px": list(im.size), "box": [0, 0, 1, 1], "crop": [0, 0, 0, 0], "source_box": it["box"]}],
                       "shapes": shapes, "tables": [], "urls": it.get("urls", []), "dims_mm": it.get("dims_mm", []), "levels_mm": []})
        report(10 + 80 * i / max(1, len(P.get("items", []))), f"Cropped {it['id']} ({i} of {len(P['items'])})")
    for v in P.get("views", []):
        rel, im = crop(v["id"], v["box"])
        n += 1
        slides.append({"slide": n, "kind": "view", "panel": v["id"], "texts": [], "shapes": [], "tables": [], "urls": [], "dims_mm": [], "levels_mm": [],
                       "pictures": [{"md5": "", "file": rel, "px": list(im.size), "box": [0, 0, 1, 1], "crop": [0, 0, 0, 0]}]})
    title, room = P.get("project") or deck["source"], P.get("room") or P.get("project") or "room"
    deck.update({"slide_count": n, "slides": slides, "panels": P,
                 "projects": [{"title": title, "cover_slide": 1, "room_list": [room], "from_panels": True, "plan": plan,
                               "rooms": [{"name": room, "id": norm(room) or "room", "slides": [s["slide"] for s in slides]}]}]})
    (deck_dir / "deck.json").write_text(json.dumps(deck, indent=1, ensure_ascii=False), encoding="utf-8")
    report(100, f"{n} panels -> deck.json")
    print(f"{title} / {room}: plan {plan['px']} + {len(P.get('items', []))} items + {len(P.get('views', []))} views -> {deck_dir / 'deck.json'}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
