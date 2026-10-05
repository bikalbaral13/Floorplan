# <PROJECT_CODE> — <Project title>

> Agents: read `AGENTS.md` (repository root) first, then this file, then `TASKS.csv`.

## 1. Brief
What is being modelled (floor / rooms), for what purpose, and what "done" means for this project.

## 2. Sources (`inputs/`)
| Folder | Content | Notes |
|---|---|---|
| floorplans/ | | scale, which plan is authoritative |
| layouts/ | | furnishing layout set |
| furnishing/ | | furnishing table (source of item wording) |
| moodboards/ | | for reference only (no materials in this pipeline) |

## 3. Settings (`project.json`)
- `ffl_mm`: finished floor level of this floor above the model origin.
- `collection_root`, `collection_prefix`, `name_prefix`: Blender organisation and object naming.
- Base .blend to open before running tasks: …

## 4. Conventions specific to this project
Plan origin, wall thickness, ceiling heights, anything that differs from AGENTS.md §2.

## 5. Workbook contract (`workbook/*.xlsx`)
| Sheet | Required columns |
|---|---|
| Items | Item_Code, Space, Category, Item (rev 3 wording) or Item, Family, Host (floor/wall/ceiling/room/host), Qty, L_mm, W_mm, H_mm, Faces (N/E/S/W/—), Params_JSON, Fit_Note |
| Placements | Item_Code, Instance, X_mm, Y_mm, Z_mm (number or text = host), Rot_Z_deg |
| Families | Family, Default_H_mm, Default_Params_JSON, Construction recipe |
| Rooms | Space_Code, Space, X0_mm, Y0_mm, X1_mm, Y1_mm |
Then run `python tools/workbook_to_project.py <PROJECT_CODE>`.

## 6. Decisions log
Dated list of design / modelling decisions that affect geometry.

## 7. Open items
Questions that may change geometry; tasks they block.
