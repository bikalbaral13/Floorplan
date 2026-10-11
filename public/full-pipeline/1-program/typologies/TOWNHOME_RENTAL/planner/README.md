# Town Home Rental Planner

Single-file app (`town_home_rental_planner.html`). Works offline except the web fonts and the PDF library (loaded from CDNs on first open).

- Top band: options A–J, north up / down, built-up and coverage.
- Panels: Layout · Setbacks (site + setbacks + court) · Stair and doors · Export (sheet size, PDF / PNG, settings file, title block).
- **Save settings / Load settings**: JSON with `typology`, `typology_version`, `params` (same keys as ../typology.json), a summary and the title block. P5_SELECT reads this file as `work/selection.json`.

Keep `compute()` here and `../generator.py` identical in behaviour; see ../../README.md.
