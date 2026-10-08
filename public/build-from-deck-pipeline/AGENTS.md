# AGENTS.md — Build from Plan Deck

Turns a **plan-phase deck (.pptx)** into Build-phase outputs for **one room the user picks**:
canvas JSON, 2D drawings, a realistic .blend and low-quality preview stills.
Pilot: INFRA (Competition) 2024 → RECEPTION (`projects/INFRA_RECEPTION`).

## Contract: `roombrief/1`
Everything downstream reads only `projects/<CODE>/roombrief.json`. A future Plan-phase pipeline
(floor plan + references → deck) writes the same file, so Build does not care where it came from.

- `zones[]`  — named areas with their outline in **plan-image pixels**, taken from the freeforms the
  designer drew over the plan crop on the spec slides (exact, not guessed).
- `items[]`  — one per thing that becomes a canvas object: `category`, `zone`, `object.kind`
  (`new: true` = no library object yet), typed `params`, `refImages`, `productUrls`, `slides`, `note`.
- `cameras[]`, `checks[]` (review comments that are tests, not geometry), `openQuestions[]`.

Precedence: final render slides > latest review comment > spec slide. Fold review changes into the
item they change (cite the slide); anything that is a test goes to `checks`.

## Canvas representation (S5)
Attachment `params` are flat (number | string | boolean). Every attachment the pipeline places carries
its spec values as real params **plus** the provenance group:
`specId`, `refImages` (comma-separated R2 `Images/Decks/<CODE>/…` URLs), `productUrl`, `deckSlides`, `specNote`.
New objects declare these params in their definition so the editor shows them.

## Deck reading facts (verified on the INFRA deck)
- One file can hold several projects (INFRA 1–139, MARIAN 140–199, CGI ODC 200–210): cover slide opens a project.
- The floor plan is the picture repeated (cropped) on many slides of a project; the crop gives the room window,
  and shapes drawn over it map back to plan pixels (`plan_overlays`, `points_px`).
- Swatches are solid-filled shapes (`fill`); red fills are callout arrows; filled freeforms on the plan are zone highlights.
- Classification is rule-based (`kind`: cover/divider/spec/dims/review/view/final_render/label); check the draft before curating.

## Rules
- The user picks the room and answers questions; do not self-answer.
- Heavy files (images, deck.json, .blend) live in `work_dir`, never in `public/`.
- `brief.py finalize` must pass (every room slide covered) before S3.

## S3 geometry (done for INFRA_RECEPTION)
- You write `projects/<CODE>/trace.px.json`: wall centrelines, openings, columns and furniture hints in **plan
  pixels**, measured with pixel profiles on the deck's plan image (not eyeballed from a thumbnail).
- Scale comes from a dimension the deck states (Reception: desk 3300 mm → 53.8 mm/px); cross-check it
  (desk depth 800 → 780 measured, door leaf ≈ 900 → 940 measured).
- `tools/geometry.py` cuts walls at openings, checks every wall lies on the designer's zone outline (≤ 3 px),
  snaps zones to shared edges on wall centrelines and exports through the Floorplan Tracer's canvas exporter.
- Door `swing` L/R is relative to a→b in WORLD axes; the connector's `design.render` preview draws double-door
  arcs unreliably — verify swings in the live editor.
- Wall segments get `specIds` (a wall can carry several finishes); doors and zone spaces get the full spec +
  provenance params now; finish objects get theirs in S5.
- `tools/publish.mjs` uploads images to `library/Images/Decks/<CODE>/` and the canvas to `library/Designs/Decks/<CODE>.json`.

## S4 resolve (done for INFRA_RECEPTION)
- `tools/catalog.mjs` snapshots every R2 object (host kind + input-props params with options) and material.
- You write `projects/<CODE>/resolve.json`: per item `status` (match | adapt | new-object | new-material |
  render-only), `object`, `host` (space / wall run / node_px / rect_px), `params` with the object's REAL ids.
  Material paths are relative to `Materials/` (`Fabric/felt.json`), as the library writes them.
- `tools/resolve_check.py` fails on unknown params, select values outside options, missing materials
  (materialPath and every `finishes` entry) and unknown hosts — negative-tested.
- New objects: `objects/objects-deck.mjs` (specs on the tools/tmp-pobj six-node spine) → `build-objects.mjs`
  (wiring + evaluation at defaults and every select/checkbox case) → `objects/out/`. Every new object carries
  `materialPath`, `finishes` and the provenance text props, unwired. Preview with `objects/dump.mjs`.
- Deck colours: `tools/material_variant.py` recolours a library material to a swatch (keeps recipe + surface,
  records `variantOf`). Herringbone has no Blender node: `layout` block + procedural fallback + AR-HBONE.
- Known gaps carried to S5/S7: door has no glass-stile leaf (glass flush leaf stands in); lotus pendant is a
  brass dome; library sofa is straight (L = two pieces); logo letters are blocks (Blender sets the text);
  baffle/services fields fill a rectangle host, not the zone outline.

## S5 compose (done for INFRA_RECEPTION)
- `tools/compose.py` turns the S3 shell + `resolve.json` into `<CODE>.room.canvas.json`; every attachment gets the
  object's params + `spec_*` + provenance. Verified: the live editor's model keeps all of them (unknown params survive).
- Measured conventions (canvas axes, y DOWN): FRAME u = (cos r, sin r), v = perp(u) = (−u_y, u_x), flipSide negates v.
  Sofa/chair backs are +v; TV screens and fluted/upholstered panels build toward −v; the reception desk visitor side is −v.
- Wall finishes are hosted on FACE LINES (non-wall `finish` segments on the room-side face, ordered so the room is
  on −v) — a panel on the wall centreline would sit inside a 150 mm wall. Cove light gets an extra 90 mm offset.
- Wall runs take per-run `params` (resolve.json `host.runs[].params`).
- Verify headless: `tools/bakeplan` (every attachment must come back with meshes) + `tools/preview_baked.py`;
  the live tab is too slow to screenshot with the baffle field loaded (~84k faces).
- READ THE REVIEW RENDERS, not just the plan symbols: slide 21's render fixed the wall layout (moss + TVs + fluted on
  the diagonal wall), and the plan's seat symbols along the east wall were the sofa's second leg, not a shelf.

## S6 drawings (done for INFRA_RECEPTION)
- `tools/drawings.py` draws everything from the BAKED meshes (tools/bakeplan output), so drawings and model agree.
  tools/dxfplan is for whole buildings (exterior elevations, GL/parapet, house notes) — not used here.
- Plan cut at +1.20: walls/columns unioned + ANSI31; floor zones hatched with each material's own `dxf` block,
  minus furniture footprints; ceiling objects only as dashed envelopes. RCP: ceiling objects + level notes.
- Interior elevations: faces within −0.35…+2.0 m of the room face, projected to (s, z), hidden lines removed
  NEAREST FIRST = largest distance into the room first (sorting by smallest depth draws the wall body first and
  hides every finish — the bug this hit). "Inside" = a point inside the zone union, never the plan origin.
- Fonts have no em/en dash, middle dot or ² — `clean()` text; dimension text is written explicitly in whole mm.
- Material `dxf.scale` sets plank/tile size on the sheet (oak-herringbone 0.26 → 600 mm planks).

## S7 render (done for INFRA_RECEPTION)
- `tools/render_room.sh <CODE>`: compose → Floorplan Renderer `bake_plan.mjs` → `enrich_plan.mjs` → `render_plan.py
  --no-render --lm-per-w 80` → `tools/deck_pass.py` (Blender) → `<CODE>.blend` + stills. Scripts come from R2
  `library/Skills/Floorplan Renderer/` into `pipeline-work/build-from-deck/renderer/`.
- Cameras are canvas `camera.json` node objects composed from `resolve.json.cameras` (deck views + corners);
  rotation = view direction in canvas axes (renderer: bearing = rotation + 90). deck_pass renames them CAM-x by position.
- The renderer reads ONLY attachment params: compose copies each object's default `materialPath`/`finishes`, and
  appends `*=<materialPath>` so a brief's material outranks the renderer's generic rules. `enrich_plan.mjs` did not
  implement `*` — fixed in R2 (2026-10-08). Lamp output must be explicit (lumens / lumensPerMetre) for the same reason.
- deck_pass.py: exposed soffit over the room at level height; logo blocks → extruded text (faces the room-side
  normal, not the block run, or it reads mirrored); halo emissive; TV screens show a deck image; Cycles CPU + OIDN + AgX.
- Not done in S7: people/desktops (FN-05, no assets), real herringbone planks (material `layout` block unread),
  the sloped moss edge, glass-stile door leaves.

## S8 QA (done for INFRA_RECEPTION)
- `tools/qa.py` turns every deck review comment into a test on the BAKED geometry / canvas params (pendant cords vs
  duct footprints, glass top vs moss top, ductShape, logo colour + backlit, legs, rug, sofa/table, eye height…),
  checks coverage (every brief item on the canvas or render-only), and puts each deck camera still beside the deck
  render with palettes, a palette distance and a COLOUR-CAST check.
- Colour cast = distance in (a*, b*) of the 40–90th luminance percentile (walls/ceiling/floor). The brightest 30 %
  (lamps, windows) is near-white in any render and hides a cast; a palette distance does not see a uniform tint.
- Found and fixed by QA: 3 pendants hanging through the ducts (s25) → moved into the gap between ducts; 3000 K
  lamps read peach against the deck's neutral renders → 4000 K (cast 5.4 → 3.6); logo halo 12 → 3.
- Open by design: people/desktops (no assets), services detail (no sprinklers/diffusers).
- Registered in the editor: NavigatorBar `PipelineTreeSection base="/build-from-deck-pipeline"`, phases.ts Build,
  tools/gen-pipeline-manifest.mjs (re-run it after changing the folder), R2 library/Pipelines/index.json.
