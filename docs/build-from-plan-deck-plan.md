# Build-from-Plan-Deck pipeline — plan (discussion only, nothing built)

Input: `PROJECT - View Inputs - Part 1.pptx` (INFRA competition 2024, 80+ slides).
Goal: user picks a room → pipeline produces **canvas JSON + 2D drawings + realistic .blend + low-quality preview stills from several angles**.

---

## 1. What the deck actually contains

Read of the slides (python-pptx text + image count):

| Slide pattern | Example | What it gives us |
|---|---|---|
| Cover / key plan | s1: key plan image with labels RECEPTION, COLLAB 01–04, OPEN OFFICE, CAFETERIA | Room list + rough position of each room on a key plan **(image only, no CAD geometry)** |
| Room divider | s2 "RECEPTION", s33 "COLLAB 01", s52 "COLLAB 02", s76 "COLLAB 03" | Section boundaries → room segmentation |
| Element spec slides | "Collab 1 Ceiling / Wall / Flooring / Furniture" | Per-element: reference image(s), product URL (Haworth, Arktura, Luxxbox, Shaw…), text spec ("baffle 100×25, c/c 150", "false ceiling to 2700 lvl", "herringbone", "concentric brick") |
| Dimension slides | s16 "3300 / 800 / 750 / 300 MM", s34 "DIA 4000 / DIA 1500" | Sizes of specific items (reception desk, stretch-ceiling circle) |
| Colour/finish callouts | "TABLE-TOP / WOODEN LEG / CHAIR-CUSHION" swatches | Material assignments per object part |
| Review-comment slides | s17–29, s41–45, s62–69 ("change rug", "duct oval", "light too low", "human eye perspective") | Revision notes on earlier renders — **these are corrections / acceptance criteria, not base spec** |
| Final render slides | s30–32, s46–51, s70–75 (picture only) | The approved look per room → **visual target + camera angles** |

Key consequence: the deck is a **design-intent + finish schedule + review log**, not a floor plan. There are no wall coordinates. Geometry must come from somewhere else (see §4, step 2).

---

## 2. Do we need a new pipeline?

**Yes, but a thin one.** ~70 % of the work is already done by existing pipelines/skills. What is missing is
(a) an **intake** that turns a PPT into structured data, and
(b) a **contract** between the Plan phase and the Build phase.

Recommended: `public/build-from-deck-pipeline/` registered under **Build** in `src/floorplan/phases.ts`, following the same three-places contract (repo folder, R2 `library/Pipelines`, editor toolbar) as the tracer and walkthrough pipelines. It *orchestrates* existing tools; it does not re-implement rendering, tracing or DXF.

The most important design decision: define **`roombrief/1`** (one JSON per room) as the hand-off format. Then:

```
            Plan phase (future)                        Build phase (this plan)
floorplan image + refs ──► [Plan-Deck pipeline] ──► deck.pptx + roombrief/1 ──► [Build-from-Deck] ──► canvas JSON, 2D, .blend, stills
existing deck.pptx ─────────────────────────────► [deck intake] ─► roombrief/1 ─┘
```

Build only ever reads `roombrief/1`. The PPT is just one source of it. When the future Plan-phase pipeline exists, it writes `roombrief/1` directly *and* renders the PPT from it — so the Build pipeline needs no change and the round trip is lossless.

---

## 3. What already exists vs what must be added

| Need | Already have | Gap to add |
|---|---|---|
| Read PPT | `pptx` skill (python-pptx), Moodboard Creator does PDF→pages | **deck-intake**: slide → room section, element classification, image extraction, URL/dim/text capture |
| Room geometry | Floorplan Tracer pipeline (image→plan.json, selftest 18/18); tools/kabita DWG→JSON | Crop the key-plan region per room; accept a DWG/PDF floor plan if the user has one (strongly preferred) |
| Finishes → materials | Materials library (material/1, Blender procedural + PBR + plan2d + dxf); Material Creator (photo→material) | Map "herringbone wood", "marble", "concrete texture paint", "moss wall", "brick concentric" to library materials, or create missing ones from the reference images |
| Furniture | R2 library/Objects (six-node parametric), Parametric Object Creator (image→object), Python objects | **product-matcher**: product URL/reference image → nearest library object + params (L-sofa, lounge chair, bar stool, Madrid coffee table…); create missing via Object Creator |
| Ceiling systems | — (mostly flat ceilings today) | New parametric objects: **baffle ceiling** (size, c/c, colour, end profile), **circular stretch ceiling**, **exposed ceiling + services (oval ducts, trays)**, **false-ceiling bands / cove** |
| Wall systems | wall object, Material node | New wall-finish objects: **fluted panel**, **acoustic puffed panel (random thickness/colour)**, **layered acrylic/acoustic feature wall**, **moss wall**, **glass partition with stile door (frames @600)** |
| Lighting | lamp/1, lighting objects, render-look | Add the specific pendants (birdcage, ring light, acoustic designer light) as lamp objects |
| Furnish/tile/light the room | Floorplan Improver (11 skills, improve.mjs, moodboard picks) | Drive it from `roombrief` instead of the scope questionnaire (placement rules from deck text, e.g. "no centre table", "planter behind sofa") |
| Canvas JSON | Improver output is canvas JSON | none — just save per room `Designs/<project>/<room>.json` |
| 2D drawings | tools/dxfplan (plan JSON→DXF: hatch, blocks, 3-tier dims, elevations, A1 layout) | Add **RCP (reflected ceiling plan)** sheet and **finish schedule table** from roombrief; per-wall elevations already exist |
| Realistic .blend | Floorplan Renderer (improved JSON→render-ready .blend, plan-view cut), render quality pipeline, JSON→Blender render-ready | Camera rig from the deck's final renders |
| Low-quality multi-angle stills | Renderer already does stills | **camera-set step**: 4 corners at 1.6 m eye height + top + 1–3 "deck views", Eevee/Cycles low samples (e.g. 960×540, 32 spp, denoise) |
| Review comments | — | **review-checklist**: parse comment slides into rules (e.g. "ducts oval", "logo dark blue + backlit", "pendant higher") applied as overrides + a pass/fail QA list |

---

## 4. Pipeline steps

**Step 0 — Intake (deck-intake)**
- `python-pptx` extracts per slide: text frames, tables, hyperlinks, pictures (save to `work/<project>/slides/sNN_k.png`), plus a full slide raster (LibreOffice → PNG) for vision reading.
- Segment into rooms using divider slides (single-title slide whose text matches a key-plan label).
- Classify each slide: `spec | dims | review | final_render | cover`. Rules first (keywords Ceiling/Wall/Flooring/Furniture, "MM", imperative verbs like Change/Add/Increase → review; picture-only after reviews → final render), then a vision pass for the ambiguous ones.
- Output `deck.json` (raw, traceable: every fact keeps its slide number).

**Step 1 — Room selection (user)**
- Show a room picker (form, like the tracer scope form): list of rooms with thumbnail from its final render and slide range. The **user** answers — agent must not self-answer.
- Also ask in the same form: output set (canvas / 2D / blend / previews), render quality, whether to apply review comments (default yes), and whether a real floor plan (DWG/PDF) is available.

**Step 2 — Geometry**
- Best: user-provided DWG/PDF → tools/kabita or the Tracer pipeline → crop the selected room polygon.
- Fallback: trace the key plan from slide 1 with the Tracer, scaled by a known dimension (e.g. reception desk 3300 mm, stretch ceiling Ø4000) — flagged as *approximate*.
- Last resort: estimate the room box from the final-render images (vision, known heights 2600/2700 as scale) — flagged *indicative*.
- Heights from deck text: false ceiling 2700, partition 2600, fluted panel 1500/2700 levels.

**Step 3 — Build `roombrief/1`** (the contract)
```json
{
  "schema": "roombrief/1", "project": "INFRA-2024", "room": "COLLAB 01",
  "source": {"deck": "PROJECT - View Inputs - Part 1.pptx", "slides": [33, 51]},
  "geometry": {"polygon": [...], "ceilingHeight": 2700, "confidence": "approximate"},
  "finishes": {
    "floor":   [{"zone":"collab","material":"brick","pattern":"concentric","ref":"s37"}],
    "ceiling": [{"type":"baffle","size":[100,25],"cc":150,"colour":"...","ref":"s34"},
                {"type":"stretch_circle","dia":1500,"ref":"s34"}],
    "walls":   [{"wall":"feature","type":"layered","layers":6,"acrylic":[1,2],"rest":"acoustic","ref":"s36"}]
  },
  "furniture": [{"kind":"lounge_chair","product":"bt.design lamy ellipse","url":"...","parts":{"cushion":"...","leg":"wood"},"qty":4,"ref":"s40"}],
  "lighting":  [{"kind":"pendant","product":"luxxbox birdcage","ref":"s35"}],
  "rules":     [{"text":"Remove side table","ref":"s38"}, {"text":"Ducts oval","ref":"s28"}],
  "cameras":   [{"from":"final_render","slide":50}],
  "openQuestions": []
}
```
Anything not determinable goes to `openQuestions`, shown in the form — never silently guessed.

**Step 4 — Resolve to library**
- Materials: match each finish to `library/Materials`; misses → Material Creator from the reference image (user names before save, as today).
- Objects: product-matcher (URL domain + product name + image embedding) → library object + params; misses → Parametric Object Creator queue. Colour callouts → per-part material bindings.
- New system objects (baffle, stretch ceiling, fluted, puffed, glass partition, ducts) are built once and reused by every room/project.

**Step 5 — Compose canvas JSON**
- Feed geometry + resolved objects to Floorplan Improver in "brief mode" (placements from rules, not questionnaire). Apply review rules as overrides. Validate with `validate.mjs`.
- Save `Designs/INFRA-2024/<room>.json` to R2; show once with `design.load` (file-first rule).

**Step 6 — 2D**
- dxfplan: floor plan with furniture + floor-pattern hatch, **RCP** (baffles, stretch ceiling, lights, ducts), 4 interior elevations with finishes tagged, finish/furniture schedule table, A1 layout → DXF + PDF.

**Step 7 — 3D**
- Floorplan Renderer → render-ready `.blend` (Cycles, materials, lamps, render-look).
- Camera set: deck-view cameras (matched to final render slides via vision pose estimate), 4 eye-level corners (1.6 m — per the s29 "human eye perspective" note), 1 top/axo.
- Previews: low resolution/samples PNGs; optional GLB.

**Step 8 — QA**
- Side-by-side: each preview vs the deck's final render; review-rule checklist pass/fail (e.g. "logo dark blue", "pendant not clashing duct"); report.md + TASKS.csv like the tracer projects.

Outputs per room: `roombrief.json`, `<room>.json` (canvas), `<room>.dxf/.pdf`, `<room>.blend`, `previews/*.png`, `report.md`.

---

## 5. Realistic difficulties

1. **No plan geometry in the deck** — biggest risk. Ask for the DWG; otherwise dimensions are approximate.
2. **Branded products** (Haworth, Naughtone, Arktura) won't exist in the library — first project will spend most time in Object Creator; later projects reuse.
3. **Review slides refer to earlier render iterations** — some comments are already resolved in the final renders; treat final render as truth and comments as checks.
4. Custom systems (puffed panels, concentric brick, stretch ceilings, oval ducts) need new parametric objects — one-time cost.
5. Vision-based camera matching is approximate; good enough for previews.

---

## 6. Build order (suggested)

1. `roombrief/1` schema in R2 `library/Schemas` + fixture from COLLAB 01.
2. deck-intake script (`tools/deck/intake.py`) + room picker form.
3. Geometry adapters (DWG → room crop; key-plan fallback).
4. Resolver (materials + product-matcher) with miss queue.
5. New system objects: baffle ceiling, glass partition, fluted panel, stretch ceiling, ducts, puffed panel.
6. Improver "brief mode" + dxfplan RCP/schedule.
7. Renderer camera set + low-quality preview preset.
8. QA compare + pipeline packaging (phases.ts Build, R2 Pipelines, selftest).

Milestone 1 = COLLAB 01 end-to-end with user DWG. Milestone 2 = all rooms of this deck.

---

## 7. Future Plan-phase pipeline (image + references → this deck)

Same contract, reversed:
1. Floor plan image → Tracer → plan.json, room list.
2. Reference images per room → Moodboard Creator / vision → finishes, furniture, lighting choices → `roombrief/1` (with product links where found).
3. Quick concept renders via the Build pipeline's preview step.
4. **deck-writer**: roombrief + images → PPTX in this exact layout (cover with key plan, divider, Floor/Ceiling/Wall/Furniture slides, render slides).
5. Client review comments come back as slides → intake parses them into `rules` → Build.

So: build `roombrief/1` and deck-intake now, design them so deck-writer is just the inverse. Both pipelines share the schema, the resolver and the object library.

---

## 8. Update — tracing from the PPTX only

**Finding:** the deck *does* contain a floor plan. One image (804×994 px, a CAD screenshot of the whole office floor: cafeteria, reception, collabs, cabins, workstations, training room, toilets, stairs, lifts) is embedded on ~60 slides (3–16, 26, 34–40, 53–61, 77–81, 85–116, 131–133). Each slide shows it **cropped to the room**, and the crop values are stored in the PPTX (`crop_left/top/right/bottom`), e.g. COLLAB 01 = 0.471 / 0.151 / 0.212 / 0.641.

So geometry flow becomes:
1. Pull the master plan image once (it is identical on every slide, md5 259b38).
2. Trace the whole floor once with the Tracer pipeline → floor plan.json (walls, columns, doors, glazing, labelled rooms).
3. Per room: the union of the crop windows on that room's slides = a room bounding box in plan pixels → select the traced room polygon(s) inside it. No vision guessing needed for which room is which.
4. Callout shapes on the slide (freeforms/lines/circles drawn over the crop, e.g. 4 circles on s34 = Ø4000 / Ø1500 stretch-ceiling rings) can be mapped back through the crop transform to plan coordinates → exact placement for ceiling/floor features.

**Limits of tracing from this image:**
- Low resolution (≈ 1 px ≈ 50–60 mm if the floor is ~45 m wide) → wall thickness and door widths are approximate; snap to standards (230 brick / 115 partition / 900 doors).
- **No dimension strings** on the plan → scale must come from a known size: column grid, 900 mm doors, lift cores, workstation modules (1200/1500), or the deck dims (reception desk 3300, Ø4000 circle).
- Furniture in the image is drawn as CAD blocks → use them as *placement hints* (position/rotation/count), then replace with library objects.
- Heights only from deck text (2600 partition, 2700 false ceiling); slab height unknown.

**Questions to settle (I'll use the defaults below unless told otherwise):**

| # | Question | Default |
|---|---|---|
| 1 | Scale reference | Column grid + standard door 900 mm, cross-checked with reception desk 3300 mm |
| 2 | Slab-to-slab / true ceiling height (exposed ceiling areas) | 3600 mm |
| 3 | Trace the whole floor or only the chosen room | Whole floor once, cache it; rooms are cut from it |
| 4 | Room extent for open zones (collabs sit inside open office with no walls) | Crop-window bbox ∩ ceiling-feature outline (baffle/stretch ceiling) defines the zone; neighbours shown as context, not rendered at full quality |
| 5 | Final render vs review comments when they disagree | Final render slides win; comments become QA checks |
| 6 | Branded products (Haworth, Naughtone, Arktura…) | Closest library object + correct colours; exact replicas only on request |
| 7 | Which room first | COLLAB 01 (richest spec: stretch ceiling, baffles, layered wall, concentric brick, 3 furniture sets) |
| 8 | Preview set | 4 eye-level corners (1.6 m) + top + deck-matched views, 960×540, ~32 spp |
| 9 | 2D output | DXF + PDF: plan, RCP, 4 elevations, finish schedule |
| 10 | Context outside the room in the .blend | Shell walls/columns of neighbours only (for window light & reflections) |

Only #2 (true ceiling height) and #4 (how to bound open collab zones) genuinely change geometry; everything else is a reasonable default.
