/** Render `layout.json` over the source map as a PNG, for looking at.
 *  Run: node tools/cityplan/drawSite.mjs [--layout layout.json] [--out layout.png] [--scale 2]
 *
 *  Metres → image pixels (÷ mpp) → drawn on top of the scan: roads dark, plots pale with their
 *  numbers, park green, residual hatched red. If it does not look like a subdivision here it will not
 *  look like one in the editor either; this is the picture to iterate the algorithm against.
 */
import fs from "node:fs";
import sharp from "sharp";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const L = JSON.parse(fs.readFileSync(arg("layout", "tools/cityplan/layout.json"), "utf8"));
const OUT = arg("out", "tools/cityplan/layout.png");
const S = Number(arg("scale", 2));
const px = ([x, y]) => `${((x / L.mpp) * S).toFixed(1)},${((y / L.mpp) * S).toFixed(1)}`;
const ring = (r) => r.map(px).join(" ");
const mp = (g, cls, extra = "") => g.map((P) => `<path class="${cls}" d="${P.map((r) => "M" + r.map(px).join("L") + "Z").join(" ")}" fill-rule="evenodd" ${extra}/>`).join("");

const body = [];
body.push(`<polygon points="${ring(L.parcel)}" class="parcel"/>`);
for (const r of L.roads) body.push(mp(r.poly, `road ${r.cls}`));
if (L.park) body.push(mp(L.park.poly, "park"));
for (const p of L.plots) {
  body.push(mp(p.poly, p.irregular ? "plot irregular" : "plot"));
  const c = p.poly[0][0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < c.length - 1; i++) { const q = c[i], w = c[i + 1]; const k = q[0] * w[1] - w[0] * q[1]; a += k; cx += (q[0] + w[0]) * k; cy += (q[1] + w[1]) * k; }
  a /= 2; const cen = a ? [cx / (6 * a), cy / (6 * a)] : c[0];
  const [x, y] = px(cen).split(",");
  body.push(`<text x="${x}" y="${y}" class="num">${p.number}</text>`);
}
for (const P of L.residual ?? []) body.push(mp([P], "residual"));
body.push(`<circle cx="${px(L.entry).split(",")[0]}" cy="${px(L.entry).split(",")[1]}" r="${4 * S}" class="entry"/>`);

const W = L.width * S, H = L.height * S;
const img = fs.readFileSync(L.image).toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>
 .parcel{fill:none;stroke:#1d4ed8;stroke-width:${1.2 * S}}
 .road{fill:#334155;fill-opacity:.85;stroke:none} .road.main{fill:#0f172a} .road.branch{fill:#1e293b}
 .plot{fill:#fef3c7;fill-opacity:.75;stroke:#92400e;stroke-width:${0.5 * S}} .plot.irregular{fill:#fde68a}
 .park{fill:#86efac;fill-opacity:.8;stroke:#166534;stroke-width:${0.6 * S}}
 .residual{fill:#fca5a5;fill-opacity:.7;stroke:#b91c1c;stroke-width:${0.5 * S}}
 .num{font:${5.2 * S}px system-ui,sans-serif;text-anchor:middle;dominant-baseline:middle;fill:#1c1917}
 .entry{fill:#dc2626}
</style>
<image href="data:image/png;base64,${img}" width="${W}" height="${H}" opacity="0.55"/>
${body.join("\n")}
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(OUT);
console.log(`${OUT}  ${W}×${H}  ${L.plots.length} plots · ${L.roads.length} roads · ${(L.residual ?? []).length} residual pieces`);
