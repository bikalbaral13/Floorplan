# objects

Parametric building elements that do not belong to any one typology or project: staircases, doors, later ramps, lifts, parking bays, toilets.

| File | Purpose |
|---|---|
| `object.json` | id, version, `parameters` (type, default, min/max or options, unit), `rule_keys` (rules.json keys its QC reads), `functions` |
| `object.py` | pure functions, e.g. `compute`, `place`, `lines`, `qc`, `schedule` |
| `versions/<x.y.z>/` | frozen older versions still pinned by typologies |
| `CHANGELOG.md` | semver history |

How they are used
- A typology pins each object it uses (`typology.json → objects`) and maps its own parameter names onto the object's (`"floor_height_ft": "floor_height_ft"`, `"position_pct": "door{n}_pct"`).
- Typology parameters can inherit an object's schema with `"from_object": "stair.max_riser_in"` — ranges and defaults are then defined once, here.
- Firm-wide preferences for objects live in `standards/<SET>.json`, not in typologies or projects.
- Changing an object's behaviour is a version bump; typologies adopt it by changing their pin (and bumping their own version).
