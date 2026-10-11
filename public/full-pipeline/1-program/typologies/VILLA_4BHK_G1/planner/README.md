# 4BHK Villa Planner

Single-file app (`villa_4bhk_planner.html`) for VILLA_4BHK_G1. Works offline except web fonts and the PDF library (CDN).

- Top band: options A / B, road side, mirror (auto / no / yes), GF + FF built-up and FAR.
- Panels: Layout (option, road, mirror, drawing orientation, vastu table, checks) · Site (plot, setbacks) · Rooms (bands, room sizes, balcony, puja) · Stair (STAIR_DOGLEG parameters, main door) · Export (sheet, PDF / PNG, settings file, title block).
- Sheet: ground and first floor plans side by side at 1:100 to 1:250 (auto), dimensions, legend, north arrow, area statement, room schedule, vastu table, notes; title block on export only.
- **Save / Load settings**: `{typology, typology_version, params, view, summary, title_block}` — same parameter keys as `../typology.json`; P5_SELECT reads it as `work/selection.json`.

The generator logic sits between `/* VILLA CORE START */` and `/* VILLA CORE END */` and is the JavaScript twin of `../generator.py`.
Change both together, then re-export the parity fixture:
`node tests/fixtures/villa_export_parity.js <core.js> tests/fixtures/villa_parity.json` (core.js = the block above saved to a file), and run `python tools/selftest.py`.
