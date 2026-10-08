Vendored copy of the Hydropower "Complete House Design" engine (D:/MY_CODING_HOBBY/Hydropower src/house,
structural, geotech, pm, feasibility). Pure TypeScript, no React. Copy changes back from Hydropower rather
than editing here; the only local change is that house/inputs.ts no longer bundles kabita.json.
Entry: house/compute.ts computeHouse(cj) → house/report.ts buildHouseReport → feasibility/renderHtml.
Adapter from the canvas plan format: ../adapter.ts.
- structural/design.ts: slab deflection MF clamped to 2 when the IS 456 fit's denominator ≤ 0.5 (negative MF for tiny panels) — port back to Hydropower.
