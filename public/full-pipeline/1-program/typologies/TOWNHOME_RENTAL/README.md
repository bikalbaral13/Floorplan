# TOWNHOME_RENTAL

Four ground-floor rental units on a narrow road-facing plot, with a central open court holding a dog-legged staircase so floors can be added later. Entrances face north (road) or east (lane) only.

## Options
| | Layout | Facing |
|---|---|---|
| A | 2 + 2, side lane into the court | all north |
| B | 2 + 2, passage between front units | all north |
| C | 4 stacked | all east |
| D | 1 + 3 stacked | U1 north, U2–U4 east |
| E | front pair, rear pair stacked | front north, rear east |
| F | front pair stacked, rear pair | front east, rear north (court) |
| G | twin columns, central passage | all east |
| H | front pair, rear twins on a passage | front north, rear east |
| I | front stacked, rear twins on a passage | all east |
| J | mixed front, rear pair | U1 north, U2 east, U3–U4 north |

## Parameters
Plot width and side lengths; setbacks (sides 0 or 3–6 ft, one side may be 0); front and rear setbacks; court depth (0 removes court and stair); front-row share; passage width; stair floor height, max riser, tread, flight width, position, first-flight direction, turn; door position per unit; drawing orientation. Ranges in `typology.json`.

## Frame and outputs
Feet; x east from the west plot edge, y south from the road edge; planning depth = shorter side. `to_plan_trace` writes unit shells (inset `wall_mm/2`) and entrance doors in design_pipeline's trace format plus a `program` block with court and stair.

## Planner
`planner/town_home_rental_planner.html` — the Town Home Rental Planner. Open in a browser; export a drawing sheet (PDF / PNG, title block on export only) or **Save settings** for P5.
