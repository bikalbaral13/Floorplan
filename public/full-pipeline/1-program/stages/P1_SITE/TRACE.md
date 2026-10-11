# work/site_trace.json

Written by the agent from a sketch, survey or photo in `inputs/`. Never put it in `inputs/`.

```json
{
 "source": "inputs/IMG-20261006-WA0000.jpg",
 "units": "ft",
 "front_ft": 36, "rear_ft": 36, "west_ft": 106, "east_ft": 105.5,
 "stated_area_sqft": 3807,
 "road_side": "N",
 "assumptions": ["north arrow on the sketch points to the road; road taken as north"]
}
```
- `front` is the road side and `rear` the opposite side. `west` and `east` are compass sides: with the road on the north, west is on the left of a north-up drawing.
- Lengths may be numbers (feet) or strings like `"105'-6\""`, `"3200mm"`.
- Every reading that is not printed on the source goes in `assumptions`; P1 copies them to REPORT.md as dated decisions.
