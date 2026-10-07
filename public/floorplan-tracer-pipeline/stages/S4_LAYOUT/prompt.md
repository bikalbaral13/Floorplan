# S4 — Author the layout (and, for sketches, the dimension chains)

You write `layout.json` (spec in `core/layout.py`). Everything downstream — junctions, splits, spaces, clear sizes, checks, exports — is derived from it. **Author from constants, never hand-typed derived coordinates**: drawings use the calibrated image frame and ONE centreline constant per wall line; sketches use the grid from `dims.json`. A correction then changes one number and the plan stays consistent.

## Dimensions (sketch branch — `dims.json`, closed by S3)
- Outer is not centre-to-centre: `c-c = outer − wall_out` (a 9" outer wall sits ON the perimeter grid). S3 asserts the chain closes; if it does not, re-read the sketch — never nudge a bay.
- Known bays as given; unknown bays get `px` (their sketch-pixel length) and S3 fits them to the remainder, rounded to the set-out step, residual in the largest bay.
- Defaults when the sketch is silent (they are tagged `convention`): outer 9", inner 4", columns 12", floor-to-floor 3.0 m, wall height 2.7 m.
- Off-grid partitions go in `dims.json → extra` as expressions (`"P1": "B+0.0508+3.0988+0.0508"` = a bedroom set out by its clear width).

```json
{"x": {"outer": "36'", "wall_out": "9in", "lines": ["A", "B", "C", "D"], "bays": [{"value": "10'"}, {"value": null, "px": 236}, {"value": null, "px": 262}], "round": "3in"},
 "y": {"outer": "25'", "wall_out": "9in", "lines": ["Y1", "Y2", "Y3"], "bays": [{"value": "13'3\""}, {"value": "11'"}]},
 "extra": {"x": {"P1": "B+0.0508+3.0988+0.0508"}}}
```

## The plan graph (both branches)
- **Lines, not segments**: one `["H"|"V", c, t, runs]` per wall line; runs are typed pieces along it in order: `w` wall, `d` door, `win` window, `g` glazed sliding door, `o` vacant opening, `gate` channel gate, `r` parapet (`h`), `k` kerb, `l` a drawn line that is not a wall (shower screen).
- **At a 90° bend or a T both walls end ON the shared centreline** — no stub past the junction (the builder snaps the first / last run end to the nearest perpendicular line within `snap`).
- **Openings are pre-cut gaps**, never symbols over a solid wall. A door / window / opening is not a wall and connects only through wall: collinear between wall pieces it needs nothing, but **an opening whose end would land on a perpendicular wall's centreline needs a short wall stub of its own thickness between the junction and the jamb** (S6 fails it otherwise). A balcony's open side = a vacant opening between two short wall returns.
- **Doors**: `hinge` = which end of the run (`s` / `e`), `swing` = toward increasing perpendicular frame coordinate (`+`) or decreasing (`−`) — for a horizontal wall in an IMAGE frame `+` is DOWN the sheet. Read both from the arc at ≥ 4× zoom. Sketches: **doors go to one side** — a jamb (30–600 mm) off the corner, hinged on the corner side, never centred.
- **Windows**: `sill`, `head`, `panes`; toilet ventilators short and high (a sill you did not read is a `convention`, and the report says so).
- Thickness per piece from measurement (`opts.t` when a piece differs from its line). Collinear pieces of different thickness share ONE centreline.
- **Columns are objects** on the wall line at their block's true centre, never a thicker wall.

## Spaces
- One per room, ring on the wall CENTRELINES (rectangle `[x0, y0, x1, y1]` on the line constants, or an explicit ring for an L). Every printed room carries `printed` — S6 compares it with the clear (face-to-face) size: drawings solved from printed spans must be exact; 2–5 % off with everything else exact means the print was taken to a different face — report it, do not bend the wall.
- Every edge of a printed room needs a band under it (give an alcove mouth a real thin kerb band, never nothing).
- Toilets, balconies, ducts / shafts / niches get their `type` (toilet · balcony · area).

## Sketch arrangement rules (S6 checks them)
- **Hierarchy is a constraint**: hall and kitchen each larger than every bedroom — decide the arrangement BEFORE fixing dimensions: split bands unevenly, pair rooms across the bands (kitchen next to the smaller bedroom, hall next to the larger), set bedrooms by clear width.
- **Wet rooms need an outside wall** (ventilator); put a toilet partition on the line of a partition in the other band where one is close.
- **Circulation**: from the entrance every room without passing through a bedroom.

## Stairs
Arithmetic, not taste: `risers = round(f2f / 0.170)`, split a dog-leg EVENLY, `run = steps × tread + landing`, `width = 2 × flight + well`; size it to FILL its bay (≥ 85 %), entered at the toe through a gate centred on the FIRST flight. `{bay, risers, tread, flight_w, mid, landing, config, toe, first_flight}`.

## Fixtures — only what is DRAWN on the source
`[kind, cx, cy, across, along, back, {…}]`: `back` = the side of the room its back is against (N/E/S/W; image N = up), across = extent along that wall, along = extent away from it. Every symbol in `reading.symbols` is placed or listed in `not_placed` with a reason. Furnishing empty rooms is Design-phase work — do not do it here.
