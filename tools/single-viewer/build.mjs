/**
 * Assemble the standalone viewer.
 *
 * Output is ONE .html that opens from `file://`. Everything is a classic `<script>` and every asset is
 * inlined, because a module script, a worker or a fetch would all be blocked there — see the notes in
 * README.md. The engine is compiled from the app's own TypeScript, so this file can never drift from
 * what the canvas editor evaluates.
 *
 *   node tools/single-viewer/build.mjs [plan.json] [--out FILE] [--keep-prose]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const planPath = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--out")
  ?? "C:/Users/bikal/Downloads/floorplan_with_bedroom.json";
const outPath = opt("--out", path.join(HERE, "dist/bedroom-viewer.html"));

const say = (...m) => console.log(" ", ...m);
const kb = (n) => (n / 1024).toFixed(0) + " KB";

// ── 1. the engine ─────────────────────────────────────────────────────────────────────────────────
// IIFE, not ESM: `<script type="module">` is blocked from file:// by CORS.
say("compiling the parametric engine…");
const enginePath = path.join(HERE, "cache/engine.js");
execFileSync(process.execPath, [
  path.join(REPO, "node_modules/esbuild/bin/esbuild"),
  path.join(HERE, "src/engine-entry.ts"),
  "--bundle", "--format=iife", "--global-name=PlanEngine", "--minify", "--target=es2019",
  "--outfile=" + enginePath, "--log-level=warning"
], { cwd: REPO, stdio: "inherit" });
const engine = fs.readFileSync(enginePath, "utf8");
say("engine", kb(engine.length));

// ── 2. three.js ───────────────────────────────────────────────────────────────────────────────────
// Lifted from the headboard configurator, which carries r147 already minified. Kept as a cached copy so
// a rebuild does not depend on that file still being in Downloads.
const threePath = path.join(HERE, "cache/three.min.js");
if (!fs.existsSync(threePath)) {
  const src = "C:/Users/bikal/Downloads/headboard_configurator_standalone.html";
  if (!fs.existsSync(src)) throw new Error("No cached three.js and no headboard_configurator_standalone.html to lift it from.");
  const html = fs.readFileSync(src, "utf8");
  const start = html.indexOf('!function(t,e){"object"==typeof exports');
  const end = html.indexOf("</script>", start);
  if (start < 0 || end < 0) throw new Error("Could not find the three.js bundle in the headboard file.");
  fs.writeFileSync(threePath, "/* three.js r147 — MIT, Copyright 2010-2022 Three.js Authors */\n" + html.slice(start, end).trim());
  say("cached three.js from the headboard file");
}
const three = fs.readFileSync(threePath, "utf8");
say("three.js", kb(three.length));

// ── 2b. the typeface ──────────────────────────────────────────────────────────────────────────────
// A `<link>` to Google Fonts would be the finished file's only live network call, which is exactly what
// a file meant to be shared must not have. Jost is a VARIABLE font — Google serves one woff2 for 400,
// 500 and 600, differing only by unicode-range — so the latin subset embeds once and covers all three
// weights by interpolation rather than by synthesis.
const fontPath = path.join(HERE, "cache/fonts/jost-latin.woff2");
let fontCss = "";
if (fs.existsSync(fontPath)) {
  const b64 = fs.readFileSync(fontPath).toString("base64");
  fontCss = `@font-face{font-family:'Jost';font-style:normal;font-weight:100 900;font-display:swap;`
    + `src:url(data:font/woff2;base64,${b64}) format('woff2');`
    + `unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,`
    + `U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;}`;
  say("typeface", kb(fontCss.length), "inlined");
} else {
  say("NO cached typeface — the file will fall back to Segoe UI. See README to re-fetch.");
}

// ── 3. the library ────────────────────────────────────────────────────────────────────────────────
const objects = {};
let prose = 0;
for (const f of fs.readdirSync(path.join(HERE, "cache/objects"))) {
  if (!f.endsWith(".json")) continue;
  const d = JSON.parse(fs.readFileSync(path.join(HERE, "cache/objects", f), "utf8"));
  if (!flag("--keep-prose")) {
    // The rationale essays are 2 KB each and nothing in the viewer reads them.
    prose += (d.description || "").length;
    delete d.description;
  }
  objects[d.id] = d;
}
say(Object.keys(objects).length, "objects", prose ? `(${kb(prose)} of prose dropped)` : "");

const materials = {};
const walkMats = (dir, prefix) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walkMats(path.join(dir, e.name), prefix + e.name + "/");
    else if (e.name.endsWith(".json")) materials[prefix + e.name] = JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8"));
  }
};
walkMats(path.join(HERE, "cache/materials"), "Materials/");
say(Object.keys(materials).length, "materials");

// ── 4. the plan ───────────────────────────────────────────────────────────────────────────────────
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
// The underlay points at R2. Nothing in a 3D view draws it, and leaving the URL in would be the file's
// only live network dependency.
delete plan.imageUnderlay;
const count = ["segments", "nodes", "spaces"].reduce(
  (n, k) => n + (plan[k] || []).reduce((m, h) => m + (h.attachments?.length ?? 0), 0), 0);
say(path.basename(planPath), "—", count, "attachments");

const moodboard = JSON.parse(fs.readFileSync(path.join(HERE, "src/moodboard.json"), "utf8"));

// Every object the plan asks for must be present, or the viewer silently draws less than the plan says.
const missing = new Set();
for (const k of ["segments", "nodes", "spaces"])
  for (const h of plan[k] || []) for (const a of h.attachments || []) if (!objects[a.objectId]) missing.add(a.objectId);
if (missing.size) throw new Error("Missing object definitions: " + [...missing].join(", "));

// ── 5. assemble ───────────────────────────────────────────────────────────────────────────────────
const data = JSON.stringify({ plan, objects, materials, moodboard });
const css = fs.readFileSync(path.join(HERE, "src/app.css"), "utf8");
const app = fs.readFileSync(path.join(HERE, "src/app.js"), "utf8");

// A closing tag inside a string literal would end the script element early.
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");

const html = fs.readFileSync(path.join(HERE, "src/index.html"), "utf8")
  .replace("/*__FONT__*/", () => fontCss)
  .replace("/*__CSS__*/", () => css)
  .replace("/*__THREE__*/", () => three)
  .replace("/*__ENGINE__*/", () => engine)
  .replace("/*__DATA__*/", () => safe(data))
  .replace("/*__APP__*/", () => app);

// ── 6. prove it is self-contained ─────────────────────────────────────────────────────────────────
// The point of this file is that it can be sent to someone. One `src=` or one `url(https:…)` and it
// quietly stops working on a machine that is offline, behind a proxy, or simply not this one — so the
// build refuses rather than shipping it.
const offences = [];
for (const m of html.matchAll(/<(link|script|img|iframe|source|video|audio|embed|object)\b[^>]*>/gi)) {
  const tag = m[0];
  if (/\b(src|href|data)\s*=\s*["']?(?!#|data:)[^"'>\s]/i.test(tag)) offences.push(tag.slice(0, 160));
}
for (const m of html.matchAll(/url\(\s*["']?(?!data:)(https?:|\/\/)[^)]*\)/gi)) offences.push(m[0].slice(0, 160));
for (const m of html.matchAll(/@import[^;]*;/gi)) offences.push(m[0].slice(0, 160));
if (offences.length) {
  console.error("\n  NOT self-contained — these would load from outside:");
  for (const o of offences) console.error("   ", o);
  process.exit(1);
}
say("self-contained: no external src, href, url() or @import");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);

console.log("\n  " + outPath);
console.log("  " + kb(html.length) + "  ("
  + ["three " + kb(three.length), "engine " + kb(engine.length), "library " + kb(data.length), "app " + kb(app.length + css.length)].join(" · ") + ")");
