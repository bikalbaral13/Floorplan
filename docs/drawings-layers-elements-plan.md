# Drawings · Layers · Elements in the left navigator — plan (for decision)

Reference: `INFRA_RECEPTION_architect_standalone.html`, **Drawings** tab. **Steps 1–3 built 2026-10-12** (layers moved left, all elements, codes later): components/NavPlanSections.tsx + selectElement / elementCard in FloorPlanEditor.tsx.

## What the reference does

| Area | Behaviour |
|---|---|
| **Drawings** (left, top) | List of sheets with thumbnail + "N elements · plan/rcp/elevation" (Plan, RCP, Elevation A–E). Click = show that sheet. |
| **Colour by** | Toggle **Type / Status**; one checkbox row per category with swatch + count (Flooring 2, Ceiling 2, Walls 4 …) = show/hide + legend. |
| **Elements** | Flat list: swatch · code (FL-01) · name · status dot. Rows not on the current sheet are faded; clicking one jumps to a sheet that shows it. |
| **Selection** | Both ways: list row ⇄ drawing. Selected = handles on the canvas, everything else faded. |
| **Right panel, nothing selected** | Space summary: "18 elements on 7 drawings", approval and review counts. |
| **Right panel, element selected** | A spec card: code · rev · type chip · status badge · close; Name; Code + Type; References (images, upload/library/generate); Specification (material, finish, source link); Dimensions & levels ("from plan" rows); Notes for the modeler; Options for the client; Client decision; Review history; **Drawn on** (sheet list with View); Delete. |

Not needed in the editor (you said): the Select/Zone/Line/Pin/Fit toolbar — the drawing toolbar has these.

## What already exists in the editor

| Need | Exists | Where |
|---|---|---|
| Selection state | Yes, but **split by kind**: `useSelection()` (walls/segments/spaces/openings), `selectedNodeKey` (nodes/objects), plus images, grids, groups… | FPE:2271, 6597 |
| 2D ⇄ 3D selection | **Yes, both ways** | FloorPlan3DCanvas props; FPE:31850–31875 |
| Clickable entity list | Partly: the Properties panel's Nodes / Edges / Areas outliner (node + edge rows select) | FPE:41203–41250 |
| Layers: visibility, lock, active, disciplines, groups, levels | Yes — in the **"View, levels and layers" popover** (top-right) | FPE:29063 |
| Levels (storeys) | Yes — `switchLevel`, 3D "all levels" | levels.ts, FPE:3779 |
| Elevation / layout views | Yes — `viewMode` "views" (ElevationPanels / AlignedElevations), "layout" (LayoutSheet) | FPE:3687 |
| Properties per type | Yes — segment / room / node property components + Parametric Object block + Metrics tab | components/*Properties |
| Left navigator with foldable sections | Yes — NavigatorBar (Library, Project, 4 pipeline sections, Selection); each section folds itself | NavigatorBar.tsx |

## What is missing

1. **One select-by-id** for every element kind (today callers pick a setter per kind) — needed so a list row can select anything.
2. **A list of drawings/sheets** (plan per level, elevations, layout) as a navigator section.
3. **Layers by colour** in the navigator (today only in the popover).
4. **An Elements list** of everything placed (objects, openings, walls, spaces) with code, name, swatch — only nodes/edges exist today, in the right panel.
5. **"Faded on this sheet / jump to a sheet that shows it."**
6. **The spec-card style properties** (a header with code/type/status, sections, "Drawn on"). Today's panel is a parameter form.
7. Codes (FL-01 …) and status (approved, changed …) — **data the plan JSON does not have yet**.

## Plan — four steps, each usable on its own

### Step 1 — Unified selection (foundation, small)
- `selectElement(ref)` in the editor: `ref = { kind: "segment"|"space"|"node"|"object"|"opening", id }` → calls the right setter, switches level if needed, and frames it in 2D.
- `currentElement` derived the other way (from whatever is selected), so lists can highlight their row.
- 3D already follows the same state — nothing new there.

### Step 2 — Navigator sections (medium)
Added under the Library tree as foldable sections, same look as the pipeline sections:
- **Drawings** — one row per level plan, plus Elevations and Layout when they exist; click = switch level + `viewMode`. Thumbnails later (a cached small 2D render).
- **Layers** — by colour: swatch · name · count · eye · lock · "active" dot; grouped by discipline as the popover does. **Moves out of the popover** (the popover keeps View / Render / 2D style / Levels), or stays in both — your choice.
- **Elements** — every object/opening/space/wall on the current level: swatch (its layer colour) · code · name; filter box; type filter (like "Colour by Type"). Click = `selectElement`; the selected element's row highlights when picked on the canvas or in 3D. Elements on other levels shown faded; click jumps to that level.

### Step 3 — Properties card (medium)
Restyle the right panel for a selected element as a card: header (code · type chip · layer swatch · close), Name, Code + Type, then the existing parameter form as "Specification", Dimensions/metrics, **Drawn on** (levels/views that show it, each with View), Delete. Nothing selected → a plan summary (elements per type, levels, layers) like the reference.

### Step 4 — Codes and status (needs a decision; data change)
- Element **codes** (FL-01, DR-02 …): auto from type prefix + number, stored on the attachment (`params.code`) so they survive export.
- **Status / approvals / references / notes / client options**: the reference's review workflow. That is a project-review feature, not a viewer one — suggest leaving it out of this round.

## Decisions for you
1. Layers: **move** them from the popover to the navigator, or show in **both**?
2. Elements list scope: **objects + openings only** (like the reference), or also walls and spaces?
3. Codes (Step 4): auto-generate and store `params.code` — yes / later?
4. Status / approvals / review history — leave out for now?
5. Order: Step 1 → 2 → 3 (recommended), or stop after 2?

## Size
Step 1 small · Step 2 medium (three sections) · Step 3 medium (panel restyle; logic exists) · Step 4 small for codes, large for the review workflow.

## Update 2026-10-12 — Layers and Elements merged

One section, **Layers & Elements**, with **Group by Layer / Type** and one search box:
- **Layer**: the existing layer controls (groups, schema blocks, disciplines, eye / lock / colour / active,
  display toggles, New layer, Move sel → active), and each layer row folds out the elements drawn on it.
  A search hides layers with no match and opens those with matches; the selected element's layer opens
  by itself. Node objects take the layer of the segment that carries them.
- **Type**: the kind chips (All / Objects / Openings / Walls / Spaces) and the flat list.
Selection is the same as before (list ⇄ 2D ⇄ 3D ⇄ Properties card).
