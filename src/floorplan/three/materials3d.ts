/** Library materials (`material/1`, R2 `library/Materials/…`) for the live 3D view.
 *
 *  The same binding the Blender renderer uses, so the canvas and the render agree on what a surface is made of:
 *    wired Material node (row.material) → params.finishes row match → params.finishes "*" → params.materialPath.
 *  Paths are relative to `Materials/` ("Fabric/felt.json"), as the object library writes them.
 *
 *  A material/1 file carries a Blender procedural AND a flat `pbr` block; the live view uses `pbr` (base colour,
 *  roughness, metallic, transmission / ior for glazing) — procedural textures are a later step. Definitions are
 *  fetched once per path and shared; THREE materials are cached per (path, fallback colour). */
import * as THREE from "three";
import { useEffect, useState } from "react";
import { DEFAULT_LIBRARY_PATH, cloudLibraryBaseUrl } from "../cloudLibrary";

export interface MaterialDef {
  id?: string;
  procedural?: { type?: string; params?: Record<string, unknown> };
  pbr?: { baseColor?: string; roughness?: number; metallic?: number; transmission?: number; ior?: number; sheen?: number };
  emission?: { kelvin?: number; luminance?: number };
}
/** The attachment params that bind materials. */
export interface MaterialBinding { materialPath?: string; finishes?: string }

/** Row name as `finishes` matches it: the head before any em dash / " - ", lower-cased. */
const head = (s: string) => s.split("—")[0].split(" - ")[0].trim().toLowerCase();

/** The material path a row should wear, or "" for none (keep the row's own colour). */
export function rowMaterialPath(bind: MaterialBinding | undefined, rowName?: string, wired?: string): string {
  if (wired) return wired.replace(/^Materials\//, "");
  if (!bind) return "";
  const pairs = String(bind.finishes ?? "").split(";").map((x) => x.trim()).filter(Boolean)
    .map((x) => { const i = x.indexOf("="); return i < 0 ? null : [head(x.slice(0, i)), x.slice(i + 1).trim()] as const; })
    .filter((x): x is readonly [string, string] => !!x);
  if (rowName) {
    const h = head(rowName);
    const hit = pairs.find(([r]) => r === h) ?? pairs.find(([r]) => r !== "*" && (h.includes(r) || r.includes(h)));
    if (hit) return hit[1].replace(/^Materials\//, "");
  }
  const star = pairs.find(([r]) => r === "*");
  if (star) return star[1].replace(/^Materials\//, "");
  return String(bind.materialPath ?? "").replace(/^Materials\//, "");
}

const defs = new Map<string, MaterialDef | null>();
const pending = new Map<string, Promise<MaterialDef | null>>();
let base: Promise<string> | null = null;

function loadDef(path: string): Promise<MaterialDef | null> {
  if (defs.has(path)) return Promise.resolve(defs.get(path)!);
  let p = pending.get(path);
  if (!p) {
    base ??= cloudLibraryBaseUrl().catch(() => "").then((b) => (b || DEFAULT_LIBRARY_PATH).replace(/\/+$/, ""));
    p = base
      .then((b) => fetch(`${b}/Materials/${path.split("/").map(encodeURIComponent).join("/")}`))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((d: MaterialDef | null) => { defs.set(path, d); pending.delete(path); return d; });
    pending.set(path, p);
  }
  return p;
}

/** Load every listed material definition; re-renders when they arrive. Returns path → def (null = failed). */
export function useMaterialDefs(paths: string[]): Map<string, MaterialDef | null> {
  const key = [...new Set(paths.filter(Boolean))].sort().join("|");
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const want = key ? key.split("|") : [];
    const missing = want.filter((p) => !defs.has(p));
    if (missing.length) Promise.all(missing.map(loadDef)).then(() => { if (live) setTick((t) => t + 1); });
    return () => { live = false; };
  }, [key]);
  return defs;
}

/** Box-projected UVs in WORLD METRES (scene units): horizontal faces use (x, z), walls their own plane.
 *  Because every surface is mapped in the same metric frame, a pattern continues across adjacent wall pieces and
 *  floor plates — no seams where two segments meet, and coplanar overlaps at wall corners shade identically. */
export function addBoxUV(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geom.getAttribute("position");
  if (!pos) return geom;
  if (!geom.getAttribute("normal")) geom.computeVertexNormals();
  const nrm = geom.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geom;
}

/** A small deterministic PRNG so a material's texture is the same on every load. */
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const hexOf = (v: unknown, fb: string) => (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v) ? (v.startsWith("#") ? v : `#${v}`) : fb);
const lerpHex = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/** Value noise on a W×W canvas — smooth blotches between two colours, tileable (wraps). */
function noiseFill(ctx: CanvasRenderingContext2D, W: number, a: string, b: string, cells: number, seed: number, amp = 1) {
  const r = rng(seed), g: number[] = [];
  for (let i = 0; i < cells * cells; i++) g.push(r());
  const at = (i: number, j: number) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
  const img = ctx.createImageData(W, W);
  const ca = new THREE.Color(a), cb = new THREE.Color(b);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const fx = (x / W) * cells, fy = (y / W) * cells, i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const v = (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
    const t = 0.5 + (v - 0.5) * amp;
    const k = (y * W + x) * 4;
    img.data[k] = (ca.r + (cb.r - ca.r) * t) * 255; img.data[k + 1] = (ca.g + (cb.g - ca.g) * t) * 255; img.data[k + 2] = (ca.b + (cb.b - ca.b) * t) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

const texCache = new Map<string, { tex: THREE.Texture; periodM: number } | null>();
/** The material's Blender procedural, drawn once to a canvas the live view can map: what one tile of it covers
 *  in metres comes back with it (`periodM`), so UVs in metres become `repeat = 1 / periodM`. */
export function proceduralTexture(path: string, def: MaterialDef | null | undefined): { tex: THREE.Texture; periodM: number } | null {
  if (!def?.procedural || typeof document === "undefined") return null;
  if (texCache.has(path)) return texCache.get(path)!;
  const p = def.procedural.params ?? {};
  const type = String(def.procedural.type ?? "");
  const base = def.pbr?.baseColor ?? "#cccccc";
  const A = hexOf(p.colorA ?? p.color1, base), B = hexOf(p.colorB ?? p.color2, lerpHex(base, "#000000", 0.12));
  const W = 512, cv = document.createElement("canvas");
  cv.width = cv.height = W;
  const ctx = cv.getContext("2d")!;
  let periodM = 1;
  const seed = [...path].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  if (type === "checker") {
    // floor / wall tile: 2×2 tiles per texture, each a slightly different shade, with a grout joint
    const tile = Number(p.tileSize) || 0.3;
    periodM = tile * 2;
    noiseFill(ctx, W, A, lerpHex(A, B, 0.6), 16, seed, 0.6);
    ctx.globalAlpha = 0.18;
    [[0, 0], [1, 1]].forEach(([i, j]) => { ctx.fillStyle = B; ctx.fillRect(i * W / 2, j * W / 2, W / 2, W / 2); });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = lerpHex(B, "#000000", 0.25);
    ctx.lineWidth = Math.max(2, W * 0.006);
    for (let k = 0; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(0, k * W / 2); ctx.lineTo(W, k * W / 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k * W / 2, 0); ctx.lineTo(k * W / 2, W); ctx.stroke(); }
  } else if (type === "wave") {
    // timber floor: planks of `plankWidth` (default 180 mm) along the texture's U, grain bands inside each,
    // each plank a slightly different tone, with staggered butt joints — what reads as a real board floor.
    const pw = Number(p.plankWidth) || 0.18;
    const rowsN = 4;
    periodM = pw * rowsN;
    const r = rng(seed);
    const rowH = W / rowsN;
    for (let j = 0; j < rowsN; j++) {
      const tone = (r() - 0.5) * 0.35;
      for (let y = 0; y < rowH; y++) {
        const yy = j * rowH + y;
        const t = 0.5 + 0.5 * Math.sin((yy / W) * Math.PI * 2 * 7 + Math.sin(yy * 0.07 + j) * 1.3);
        ctx.fillStyle = lerpHex(A, B, Math.min(1, Math.max(0, t * 0.7 + 0.15 + tone)));
        ctx.fillRect(0, yy, W, 1);
      }
      ctx.strokeStyle = lerpHex(B, "#000000", 0.28);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, j * rowH); ctx.lineTo(W, j * rowH); ctx.stroke();
      const x = (((j * 0.37 + r() * 0.2) % 1) * W);
      ctx.beginPath(); ctx.moveTo(x, j * rowH); ctx.lineTo(x, (j + 1) * rowH); ctx.stroke();
    }
  } else if (type === "brick") {
    periodM = 0.6;
    ctx.fillStyle = lerpHex(B, "#ffffff", 0.4); ctx.fillRect(0, 0, W, W);
    const rows = 8, h = W / rows, w = W / 2, r = rng(seed);
    for (let j = 0; j < rows; j++) for (let i = -1; i < 3; i++) {
      ctx.fillStyle = lerpHex(A, B, r() * 0.6);
      ctx.fillRect(i * w + (j % 2) * w / 2 + 2, j * h + 2, w - 4, h - 4);
    }
  } else {
    // noise / voronoi / magic: plaster & paint (fine, low contrast) or stone (broad blotches + veins)
    const scale = Number(p.scale) || 10;
    const stone = scale < 8;
    periodM = stone ? 2.0 : 0.8;
    // Paint / plaster: broad, very low-contrast cloud (real emulsion shows almost no grain). Fine high-contrast
    // noise aliases into a speckle on wall tops and distant walls. Stone keeps its broad blotches.
    noiseFill(ctx, W, A, B, stone ? 6 : 6, seed, stone ? 1 : 0.35);
    if (stone && (Number(p.distortion) || 0) > 1) {
      const r = rng(seed + 1);
      ctx.strokeStyle = lerpHex(B, "#6b6560", 0.35);
      ctx.globalAlpha = 0.35;
      for (let v = 0; v < 6; v++) {
        ctx.lineWidth = 1 + r() * 2;
        ctx.beginPath();
        let x = r() * W, y = 0;
        ctx.moveTo(x, y);
        while (y < W) { x += (r() - 0.5) * 60; y += 20 + r() * 30; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(1 / periodM, 1 / periodM);
  const out = { tex, periodM };
  texCache.set(path, out);
  return out;
}

const cache = new Map<string, THREE.Material>();
/** A shared THREE material for a library path (falls back to the row colour while loading / on failure). */
export function libraryMaterial(path: string, fallbackColor: string, def: MaterialDef | null | undefined, opts?: { emissive?: string; emissiveIntensity?: number }): THREE.Material {
  const sel = opts?.emissiveIntensity ? `|sel:${opts.emissive}:${opts.emissiveIntensity}` : "";
  const key = `${def ? path : `flat:${fallbackColor}`}${sel}`;
  let m = cache.get(key);
  if (m) return m;
  const pbr = def?.pbr;
  const transmission = pbr?.transmission ?? 0;
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(pbr?.baseColor ?? fallbackColor),
    roughness: pbr?.roughness ?? 0.6,
    metalness: pbr?.metallic ?? 0,
    side: THREE.DoubleSide,
  });
  if (transmission > 0) {
    // Architectural glazing: physical transmission reads as glass with an environment map; keep it cheap.
    mat.transmission = transmission;
    mat.ior = pbr?.ior ?? 1.5;
    mat.thickness = 0.01;
    mat.roughness = Math.min(mat.roughness, 0.05);
  }
  if (pbr?.sheen) { mat.sheen = pbr.sheen; mat.sheenRoughness = 0.8; }
  // The procedural, drawn to a texture: the colour then comes from the map (white base so it is not tinted twice).
  const pt = transmission > 0 ? null : proceduralTexture(path, def);
  if (pt) { mat.map = pt.tex; mat.color = new THREE.Color("#ffffff"); }
  if (def?.emission?.luminance) { mat.emissive = new THREE.Color("#fff3e0"); mat.emissiveIntensity = Math.min(4, def.emission.luminance / 300); }
  if (opts?.emissiveIntensity) { mat.emissive = new THREE.Color(opts.emissive ?? "#2563eb"); mat.emissiveIntensity = opts.emissiveIntensity; }
  cache.set(key, mat);
  m = mat;
  return m;
}
