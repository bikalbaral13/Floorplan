---
id: read-an-image-deck
name: Mark what is on a moodboard / plan image (panels.json)
category: Deck Reader
when: S1 INTAKE was given an IMAGE (deck.json kind "image", needs_panels) — before PANELS. A slide deck skips this.
---

A deck puts one idea on each slide; a moodboard image packs a plan, a dozen product photos and the swatches into one
picture. Pixels cannot say which photo is the sofa and which is the floor sample — you can. Look at
`pages/page-01.png` (zoom in on crops; never guess a box from the thumbnail) and write `panels.json` next to
`deck.json`:

```json
{"schema": "deck-panels/1", "project": "Bachelor Pad", "room": "Bachelor Pad",
 "plan": {"box": [0, 0, 782, 745], "printed": ["18'11\"", "17'5\""], "note": "living room, ceiling fans x2, L kitchen counter"},
 "items": [
   {"id": "sofa-leather", "box": [922, 342, 1408, 528], "category": "furniture", "kind": "object", "label": "Cognac leather 3-seat sofa, tapered legs"},
   {"id": "floor-chevron-oak", "box": [1335, 515, 1564, 752], "category": "flooring", "kind": "swatch", "label": "Chevron oak floor"}],
 "views": []}
```

- **Boxes in the source image's pixels**, tight around the product (a little margin is fine; no neighbour inside —
  the crop becomes the reference the Object Maker / Material Maker work from).
- One item per THING that becomes a canvas object or a finish: furniture, lighting, rugs, art, shelving, plants,
  and every **swatch** (paint chip, floor / tile / fabric sample) as `kind: "swatch"` — its mean colour is recorded.
- `category`: furniture · lighting · flooring · wall · ceiling · rug · decor · storage · plant.
- `plan.printed`: every dimension printed on the plan, verbatim — S2 calibrates the scale from them.
- A rendered view of the room (not a product photo) goes in `views`.

Report progress while you mark (one line per few items). Then queue PANELS: it crops every box into `images/`,
rewrites `deck.json` with one slide per panel, and lists the questions the user answers in the Brief tab.
