/** Draw a baked object's meshes as an isometric SVG/PNG, so a 3D result can be looked at without
 *  the app. Run: node tools/scribbleplan/iso.mjs <baked.json> [out.png] [--az 35] [--el 30]
 *
 *  Reads `resolved.meshes` (tools/bake) — each mesh a list of faces, each face a polygon of [x,y,z] —
 *  projects them with a fixed orthographic camera (azimuth/elevation), sorts faces back to front by
 *  depth, and fills them with the mesh colour shaded by the face normal. Painter's algorithm; good
 *  enough to tell a waist slab from a block and a handrail from a fence.
 */
import fs from "node:fs";
import sharp from "sharp";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const src = process.argv[2];
const out = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : src.replace(/\.json$/, ".png");
const AZ = (arg("az", 35) * Math.PI) / 180, EL = (arg("el", 30) * Math.PI) / 180;
const j = JSON.parse(fs.readFileSync(src, "utf8"));
// --alpha Name=0.3 draws that mesh translucent (the bake carries no prim opacity; the app does).
const ai = process.argv.indexOf("--alpha");
const alpha = ai >= 0 ? Object.fromEntries(process.argv[ai + 1].split(",").map((kv) => { const [k, v] = kv.split("="); return [k, Number(v)]; })) : {};
const meshes = j.resolved?.meshes ?? j.meshes ?? [];

// camera: rotate about z by AZ, then tilt by EL; screen x = right, screen y = up (flip for SVG)
const view = ([x, y, z]) => {
  const xr = x * Math.cos(AZ) - y * Math.sin(AZ), yr = x * Math.sin(AZ) + y * Math.cos(AZ);
  const sy = yr * Math.sin(EL) + z * Math.cos(EL);
  const depth = yr * Math.cos(EL) - z * Math.sin(EL);
  return [xr, sy, depth];
};
const light = [0.4, -0.5, 0.75];
const faces = [];
for (const m of meshes) {
  for (const poly of m.faces ?? []) {
    if (poly.length < 3) continue;
    const pts = poly.map(view);
    // normal in world for shading
    const [a, b, c] = poly;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = n.map((k) => k / l);
    const shade = 0.55 + 0.45 * Math.abs(n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
    const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
    faces.push({ pts, depth, color: m.color ?? "#999", shade, alpha: alpha[m.name] ?? 1 });
  }
}
faces.sort((a, b) => b.depth - a.depth);
const xs = faces.flatMap((f) => f.pts.map((p) => p[0])), ys = faces.flatMap((f) => f.pts.map((p) => p[1]));
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const S = 900 / Math.max(maxX - minX, maxY - minY), PAD = 40;
const W = (maxX - minX) * S + 2 * PAD, H = (maxY - minY) * S + 2 * PAD;
const px = ([x, y]) => `${((x - minX) * S + PAD).toFixed(1)},${((maxY - y) * S + PAD).toFixed(1)}`;
const hex = (c, k) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c); if (!m) return c; return "#" + m.slice(1).map((h) => Math.round(Math.min(255, parseInt(h, 16) * k)).toString(16).padStart(2, "0")).join(""); };
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}"><rect width="100%" height="100%" fill="#f8fafc"/>
${faces.map((f) => `<polygon points="${f.pts.map(px).join(" ")}" fill="${hex(f.color, f.shade)}" fill-opacity="${f.alpha}" stroke="#0f172a" stroke-width="0.4" stroke-opacity="0.35"/>`).join("\n")}
</svg>`;
await sharp(Buffer.from(svg)).png().toFile(out);
console.log(`${out}  ${faces.length} faces · ${meshes.map((m) => m.name).join(", ")}`);
