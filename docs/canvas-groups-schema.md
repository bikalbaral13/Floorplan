# Grouped canvas documents (schemaVersion 3)

Status: **implemented** (2026-10-01, uncommitted): `src/floorplan/planGroups.ts` (read / write),
the editor's Group select scope and the Groups tree in the Layers panel. The Ramanadhapuram flat file is
converted by `tools/masterplan/flat-to-grouped.mts` into
`library/Master Plans/Ramanadhapuram/Ramanadhapuram_MasterPlan_grouped.json` (67 groups, 47 nested);
`tools/masterplan/roundtrip-editor.mts` checks the editor's load → save path on it (26,096 entities, 0
differences).

## Why

A canvas JSON describes one design: `nodes`, `segments` and `spaces`, optionally per level. A master plan is
many designs placed on one site. Today that is written two ways, neither of them good to work with:

- `Ramanadhapuram_MasterPlan_flat.json` merges every design into ONE graph (31 MB, 9 levels). Which villa a
  wall belongs to survives only as an id prefix (`plot-07/L0/…`); a villa cannot be selected, hidden, moved
  or taken back out as a unit, and moving one would rewrite every node.
- `Ramanadhapuram_MasterPlan_site.json` keeps the site and points at each design through a
  `designInstance` on a plot space — the right idea, but tucked into a space and not a document structure.

A **grouped document** is simply a container of ordinary canvas JSONs. Each group holds one canvas (or
points at one) and says where it sits. The 19 plots of the master plan are 19 groups plus a `site` group,
and nothing inside any canvas changes. This is safe for Ramanadhapuram because the designs are already
independent: no segment of any plot uses a node of another plot or of the site.

## Compatibility — existing canvas JSON keeps working

- A document **without `groups`** is a canvas JSON exactly as today: schemaVersion 1 (single level) or 2
  (`levels[]`). It is read and written unchanged. Nothing about the current format is deprecated.
- A document **with `groups`** is a grouped document (schemaVersion 3). Each group's `canvas` *is* a
  schemaVersion 1 or 2 canvas JSON, so every existing design file can be dropped into a group as-is, and
  any group can be saved back out as a standalone design file.
- Detection is by shape, like today (`isStandardPlan` checks for `nodes` + `segments`): `groups` is an
  array ⇒ grouped document. A reader that predates version 3 sees no `nodes`/`segments` at the top and
  should refuse the file rather than show an empty plan — the editor must say "grouped document, needs a
  newer reader" instead of loading nothing.
- Old master-plan files: the site file's `designInstance` on spaces is still read (and migrated into
  groups on save); a flat file is split into groups by its id prefixes (see *Migration*).

## Document

```jsonc
{
  "schemaVersion": 3,
  "kind": "grouped",                       // informative; detection is by `groups`
  "settings": {                            // project-wide; same keys as a canvas JSON
    "pixelsPerMeter": 100, "units": "m", "northbearing": 0,
    "library_path": "https://…/library", "keywords": "Ramanadhapuram master plan"
  },
  "layers":   [ /* one shared layer table — same shape as today */ ],
  "levels":   [                            // the SITE levels every group maps onto
    { "id": "B2", "name": "Basement 2", "elevation": -5.7, "height": 2.85 },
    { "id": "G",  "name": "Ground",     "elevation": 0,    "height": 3.2  },
    { "id": "L+3.2", "name": "Level +3.2", "elevation": 3.2, "height": 3.2 }
  ],
  "activeLevelId": "G",
  "moodboards": [],
  "groups": [ /* Group, below — order is paint order, first = bottom */ ]
}
```

Top-level `nodes` / `segments` / `spaces` are absent (or empty): all geometry lives in groups.

## Group

```jsonc
{
  "id": "plot-07",                         // unique in the document; stable across saves
  "name": "Plot 7 · Villa 2",
  "design": "villa-2",                     // optional tag: groups showing the same design share it
  "parent": null,                          // optional: id of the enclosing group (nesting, see below)

  "transform": {                           // where the canvas's (0,0) sits on the site
    "position": [53.174, 27.018],          // site METRES
    "rotation": 0,                         // degrees, clockwise on screen (canvas y points down)
    "mirror": false                        // flip the canvas's x before rotating
  },
  "levelMap": { "L0": "G", "L1": "L+3.2", "L2": "L+6.4" },   // canvas level id → site level id

  "visible": true,
  "locked": false,
  "layerOverrides": { "lighting": { "visible": false } },  // optional, per group

  // exactly ONE of the two:
  "canvas": { /* a complete canvas JSON, schemaVersion 1 or 2 */ },
  "source": {                              // …or a reference to one in the library
    "path": "Designs/Ramanadhapuram_Villa2_improved.json",
    "sha256": "3c63d9c1…"                  // the content placed; lets the editor flag a changed design
  },

  "meta": {                                // optional, written by tools, never required
    "areaM2": 212.4, "rooms": 19, "fit": { "method": "column match", "rmsM": 0.026 }
  }
}
```

### Rules

1. **`canvas` or `source`.** An inline `canvas` is self-contained and editable in place. A `source` group
   is drawn from the library file; to edit it, the editor either opens the design file or converts the
   group to an inline copy (it asks which). Several groups may share one `source` — that is instancing:
   Villa 5 on five plots is five small groups and one design file.
2. **Transform.** For a canvas point `p` (canvas pixels, canvas `pixelsPerMeter` = `c`) and site
   `pixelsPerMeter` = `s`:
   `site_px = position·s + R(rotation) · M(mirror) · p · (s / c)`, where `M` negates x when `mirror` is
   true and `R` rotates clockwise on screen. Mirror first, then rotation, then scale, then position — the
   order `src/floorplan/designInstances.ts` already uses.
3. **Levels.** The canvas keeps its own level ids. `levelMap` puts each one on a site level; a canvas
   level with no entry is not shown on the site. A single-level canvas (schemaVersion 1) is one level and
   maps with the key `""`; with no `levelMap` at all it goes on the site's ground level (elevation 0).
4. **Layers.** The document's `layers` table is the one in force. A canvas's own `layers` are kept in the
   file (so the canvas stays a valid standalone design) but ignored inside the document; an entity whose
   layer id is not in the document table is drawn on layer `"0"`, as today.
5. **Ids** only need to be unique inside their own canvas — no more `plot-07/L0/` prefixes. Anything that
   refers across groups (a selection, a comment, a BOQ line) uses the pair `groupId` + entity id.
6. **Visibility and lock.** An entity is drawn when its layer is visible (after the group's
   `layerOverrides`), its group is visible, and every ancestor group is visible. Locked works the same
   way: locked if the group or any ancestor is locked.
7. **Nesting.** `parent` makes a tree — e.g. `plot-19` → `plot-19/F0-1`. A child group's transform is
   relative to its parent's canvas; its `levelMap` still names SITE levels. Any depth is read and written;
   for Ramanadhapuram the unit groups (flats, Villament homes) hold their rooms only — a wall between two
   flats belongs to neither, so walls stay with the plot.
8. **Paint order** is `groups` order, then layer order inside a group.

## Group selection mode (editor)

The selection-scope filter (`selectFilter`: All / Node / Segment / Space) gains **Group**.

| Gesture | Effect |
|---|---|
| Click on or inside a group | Selects the whole group (outermost unlocked one) — one outline with move / rotate handles, not its thousands of entities |
| Hover | Highlights the group under the cursor (outline), like the other scopes' hover ring |
| Shift-click / box-drag | Adds groups to the selection |
| Double-click a group | **Enters** it: that canvas becomes the editable one, normal Node / Segment / Space tools apply, everything else is dimmed and read-only |
| Esc / click outside | Leaves the group |

Hit-testing is against each group's outline (its levels' wall union, or the bounding box as a fallback)
under its transform — a few dozen point-in-polygon tests, not a search through every wall.

**Actions on selected groups**

| Action | Writes |
|---|---|
| Move / rotate / mirror | `transform` only — the canvas is untouched, so it is instant even for the 19 MB apartment |
| Hide / lock | `visible` / `locked` |
| Duplicate | A new group: same `source`, or a copy of `canvas`; new `id`, offset `position` |
| Replace design | `source` (or `canvas`) swapped, `transform` kept |
| Open design | Opens `source.path` (or the inline canvas) as its own document |
| Make unique | Converts a `source` group to an inline `canvas` copy |
| Delete | Removes the group |

**Layers panel:** a foldable Groups tree above the layer list. Each group row has an eye (hide the
group and everything in it, on every level), a lock, and its name (click to select it). Unfolded, it lists
its child groups and then the layers its own entities sit on, with counts; each of those has an eye that
writes `layerOverrides[layer].visible = false` on the group — e.g. lighting hidden in Plot 1 only.

**Editing inside a group** is the existing editor: entities are merged into the levels in site
coordinates on load, tagged `groupId`, ids prefixed `<groupId>::`; saving splits them back. Moving a group
moves the active level through undo history and the other levels follow its new position, so undo / redo
keeps every level of the group together.

**Properties panel** for a selected group: name, design, position, rotation, mirror, level map, visible /
locked, layer overrides, and the `meta` figures.

**Defaults.** The `site` group is locked on open, so clicking a road does not select the whole site.
Groups do not snap to each other while drawing inside one; moving a group may snap its outline to plot
boundaries (optional).

## Example: Ramanadhapuram

```jsonc
"groups": [
  { "id": "site", "name": "Site", "locked": true,
    "canvas": { /* B2, B1, G: parking, ramps, cores, roads, plot boundaries */ } },
  { "id": "plot-01", "name": "Plot 1 · Villa 1", "design": "villa-1",
    "transform": { "position": [14.475, 13.735], "rotation": 0, "mirror": false },
    "levelMap": { "L0": "G", "L1": "L+3.2", "L2": "L+6.4" },
    "source": { "path": "Designs/Ramanadhapuram_Villa1_improved.json", "sha256": "c4cc7e1f…" } },
  /* plot-02 … plot-18 likewise */
  { "id": "plot-19", "name": "Plot 19 · Apartment", "design": "apartment",
    "transform": { "position": [110.752, 61.125], "rotation": 0, "mirror": false },
    "levelMap": { "L0": "G", "L1": "L+3.2", "L2": "L+6.4", "L3": "L+9.6", "L4": "L+12.8", "L5": "L+16.0", "L6": "L+19.2" },
    "source": { "path": "Designs/Ramanadhapuram_Apartment_improved.json", "sha256": "44b6cf96…" } }
]
```

With `source` groups the whole master plan is a few hundred kilobytes (the site canvas plus 19 small
group records) instead of 31 MB; an "expanded" export writes the same groups with inline `canvas` copies
for tools that cannot fetch from the library (Blender, DXF, BOQ).

## Migration

| From | To |
|---|---|
| A canvas JSON (v1 / v2) | Unchanged. Optionally wrapped as a one-group document when placed on a site. |
| `_site.json` (`designInstance` on spaces) | `site` group = the site canvas minus the instance fields; one group per distinct instance (`design`, `transform`, `levelMap`, `source.path`). Plot and footprint spaces carrying the same instance collapse to one group. |
| `_flat.json` (id-prefixed merge) | One group per id prefix (`site`, `plot-01` … `plot-19`); strip the prefix from every id; move each entity to the canvas level named in its id (`plot-19/L0/…` → canvas level `L0`), undoing the transform applied when it was flattened; take `transform` / `levelMap` / `source` from `master_plan.json`. |

`master_plan.json` (the index with checksums) becomes redundant: everything it records is in the groups.

## Decided, and left for later

- **In version 3:** groups, `canvas` or `source`, transform, `levelMap`, visible / locked, `layerOverrides`,
  one level of nesting, Group selection mode with enter / leave.
- **Later:** deeper nesting (flats inside the apartment, homes inside the Villament — rooms can be assigned
  from their labels, walls only by geometry); per-level group visibility; snapping between groups.
