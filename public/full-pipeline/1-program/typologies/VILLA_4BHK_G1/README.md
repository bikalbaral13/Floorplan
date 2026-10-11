# VILLA_4BHK_G1

Premium 4BHK independent villa, ground + first floor, for 30' x 40' class plots (applicability: frontage 26–40', depth 36–50'). Modern Indian program, vastu-aware, any road side.

## Program
| Floor | Rooms |
|---|---|
| GF | car porch, living (puja niche in the corner nearest NE), dining hub, staircase, common toilet, kitchen, bedroom 4 (guest / parents) + attached toilet |
| FF (A) | bedroom 2 + toilet, bedroom 3 + toilet, family lounge, master bedroom + dress + toilet, front balcony |
| FF (B) | bedroom 2 + toilet, double-height living (OTS) over the living room, gallery, bedroom 3 + toilet, master + dress + toilet, balcony |

4 bedrooms, 5 toilets. Defaults (5' front, 3' rear, 3' / 2' sides) give a 25' x 32' footprint: GF 800 + FF 800 (A) or 638 (B) sq ft, FAR 1.20 / 1.06, coverage 66.7%.

## How the plan is built
Drawing frame: road at the top. Three bands into the plot: **front** (porch + living), **middle** (staircase | dining hub | common toilet), **rear** (bedroom 4 | kitchen). The dining is the hub: the rear split is clamped so bedroom 4 and the kitchen both keep a door into it, and the stair's first step starts from it. Upstairs the lounge (A) or gallery (B) gives every bedroom a door. Every room's access is checked by walking the door / opening graph.

## Parameters
Plot frontage / depth and road side (from site.json), setbacks (left / right as drawn), porch width, band depths, toilet / kitchen / master widths, attached toilet size, balcony projection, puja niche, mirror (no / yes / auto = best vastu score), and the STAIR_DOGLEG and DOOR_HINGED parameters (floor height 10'-6", riser, tread, flight, first-flight direction, turn; main door width 3'-6" and position). Ranges in `typology.json`.

## Rules (P3 placeholders)
NBC 2016 room minimums (first habitable 9.5 m², others 7.5 m², width 2.4 m; kitchen 5 m² / 1.8 m; bath + WC 2.8 m² / 1.2 m), parking bay 2.5 x 5 m (may use the open front setback), stair riser / tread / flight, FAR and coverage limits with exclusions (porch, void, balcony), height, balcony projection. Confirm all with the local authority.

## Vastu
Zones from each room's centre relative to the footprint centre, by compass: kitchen SE (NW acceptable), master SW, puja NE, living N / E / NE, stair S / W / SW, toilets NW / W, entrance N / E / NE. `mirror: auto` picks the better of the two mirrored layouts; the guest toilet takes the better rear corner. North- and east-facing plots score +16 to +18; south- and west-facing plots score low with this arrangement (kitchen falls NE) and QC says so. A variant with a front kitchen would serve them.

## Stages
Shared P1–P5, shared `P5b_STAIR_SCHEDULE`, own `+P5c_AREA_VASTU` (floor-wise area statement, FAR, VASTU.md), P6, P7. Hand-off carries `level` per room: `tools/handoff_to_design.py <CODE> --level GF` (and FF) for design_pipeline.

## Planner
`planner/villa_4bhk_planner.html` — 4BHK Villa Planner: options, road side, mirror, every parameter as sliders, live vastu and checks, A3 sheet with both floors, PDF / PNG export (title block on export), settings file for P5.

## Tests
`tests/fixtures/villa_golden.json` (options A / B x roads N / E / S / W), `tests/fixtures/villa_parity.json` (48 planner cases, hashed against the planner's embedded core) and a full road-east project in `tools/selftest.py`.
