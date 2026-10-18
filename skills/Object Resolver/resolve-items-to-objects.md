---
id: resolve-items-to-objects
name: Write resolve.json — item → object, real param ids, host, materials
category: Object Resolver
when: CATALOG has written catalog.json; before CHECK.
---

Per brief item one binding:

```json
{ "item": "FN-01", "status": "match | adapt | new-object | new-material | render-only",
  "object": "Objects/Furniture/sofa.json",
  "host": { "space": "Z1" } | { "runs": [{ "wall": "W3", "params": {} }] } | { "node_px": [x, y] } | { "rect_px": [x0, y0, x1, y1] },
  "params": { "<the object's REAL param id>": "value", "materialPath": "Fabric/felt.json" } }
```

- Param ids come from `catalog.json` — never invent one; select values must be one of the param's `options`.
- Material paths are relative to `Materials/` (`Fabric/felt.json`), as the library writes them.
- Wall finishes are hosted on FACE LINES (the room-side face), not the wall centreline.
- `resolve.json.cameras` carries the deck views for S5.

Report progress (one line per 5 items). Never mark an item approved — the user does that in the Objects review.
