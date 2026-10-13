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

/** Image maps a material may ship (Library-relative paths or URLs; .png / .jpg / .webp / .ktx2). `sizeM` is
 *  how many metres one tile of the image covers — UVs are in metres, so repeat = 1 / sizeM. */
export interface MaterialMaps {
  albedo?: string; normal?: string; roughness?: string; metallic?: string; ao?: string;
  sizeM?: number;
  /** "gl" (default, three.js / Blender) or "dx" (green channel flipped). */
  normalConvention?: "gl" | "dx";
}
export interface MaterialDef {
  id?: string;
  procedural?: { type?: string; params?: Record<string, unknown> };
  pbr?: { baseColor?: string; roughness?: number; metallic?: number; transmission?: number; ior?: number; sheen?: number; maps?: MaterialMaps };
  /** The Blender-side surface detail; the Realistic view reads normal strength, coat and roughness variation. */
  surface?: {
    normal?: { strength?: number; scale?: number };
    coat?: { weight?: number; roughness?: number; ior?: number };
    roughnessVariation?: { amount?: number; scale?: number };
  };
  /** Same image maps as pbr.maps, accepted at the top level too. */
  maps?: MaterialMaps;
  emission?: { kelvin?: number; luminance?: number };
}

/** How the 3D view shows surfaces: "basic" (Detailed mode) = flat colour, no maps, no environment response;
 *  "realistic" = physical material with albedo / normal / roughness maps. */
export type SurfaceLook = "basic" | "realistic";

/** Redraw hooks of the mounted 3D canvases: a texture that finishes loading after the frame was drawn must
 *  ask for a new one, because the canvas only renders on demand. */
const redraws = new Set<() => void>();
export function registerRedraw(fn: () => void): () => void { redraws.add(fn); return () => { redraws.delete(fn); }; }
const redrawAll = () => redraws.forEach((f) => f());
export { rowMaterialPath, type MaterialBinding } from "./materialBinding";
import type { MaterialBinding } from "./materialBinding";

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

/* ── Realistic maps ─────────────────────────────────────────────────────────────────────────────────────
 * No material in the Library ships image maps yet, so a Realistic surface derives its normal and roughness
 * maps from the same procedural canvas the albedo comes from: the canvas's luminance is read as a height
 * field (dark grout, plank joints and veins sit lower), its slope becomes a tangent-space normal map, and
 * `surface.roughnessVariation` modulates roughness by the same field. Image maps, when a material lists them,
 * replace the derived ones. All of it is built on first use in Realistic mode only. */
const derivedCache = new Map<string, { normal: THREE.Texture; rough: THREE.Texture } | null>();
function derivedMaps(path: string, def: MaterialDef, albedo: { tex: THREE.Texture; periodM: number }): { normal: THREE.Texture; rough: THREE.Texture } | null {
  if (derivedCache.has(path)) return derivedCache.get(path)!;
  const src = (albedo.tex as THREE.CanvasTexture).image as HTMLCanvasElement | undefined;
  if (!src?.getContext) { derivedCache.set(path, null); return null; }
  const W = src.width, H = src.height;
  const px = src.getContext("2d")!.getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  const at = (x: number, y: number) => h[((y + H) % H) * W + ((x + W) % W)];
  const strength = (def.surface?.normal?.strength ?? 0.4) * 6;
  const rv = def.surface?.roughnessVariation?.amount ?? 0.1;
  const baseR = def.pbr?.roughness ?? 0.6;
  const mk = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const nc = mk(), rc = mk();
  const nImg = nc.getContext("2d")!.createImageData(W, H), rImg = rc.getContext("2d")!.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // Sobel slope, wrapping at the edges so the tile stays seamless
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (y * W + x) * 4;
    nImg.data[k] = (nx * 0.5 + 0.5) * 255; nImg.data[k + 1] = (ny * 0.5 + 0.5) * 255; nImg.data[k + 2] = (nz * 0.5 + 0.5) * 255; nImg.data[k + 3] = 255;
    // lower (darker) parts read rougher: grout and joints are matt, the faces carry the sheen
    const r = Math.min(1, Math.max(0.02, baseR + (0.5 - at(x, y)) * rv * 2));
    rImg.data[k] = rImg.data[k + 1] = rImg.data[k + 2] = r * 255; rImg.data[k + 3] = 255;
  }
  nc.getContext("2d")!.putImageData(nImg, 0, 0);
  rc.getContext("2d")!.putImageData(rImg, 0, 0);
  const wrap = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.copy(albedo.tex.repeat);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const out = { normal: wrap(nc), rough: wrap(rc) };
  derivedCache.set(path, out);
  return out;
}

/** Image texture loading (png / jpg / webp, and KTX2 once a renderer has registered the transcoder). */
let ktx2: { load: (url: string, onLoad: (t: THREE.Texture) => void, onProgress?: unknown, onError?: (e: unknown) => void) => void } | null = null;
export function setKtx2Loader(loader: typeof ktx2) { ktx2 = loader; }
const imageTex = new Map<string, Promise<THREE.Texture | null>>();
async function loadImageTexture(ref: string, color: boolean, sizeM: number): Promise<THREE.Texture | null> {
  const key = `${ref}|${color}|${sizeM}`;
  let p = imageTex.get(key);
  if (!p) {
    base ??= cloudLibraryBaseUrl().catch(() => "").then((b) => (b || DEFAULT_LIBRARY_PATH).replace(/\/+$/, ""));
    p = base.then((b) => new Promise<THREE.Texture | null>((resolve) => {
      const url = /^https?:/i.test(ref) ? ref : `${b}/${ref.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
      const done = (t: THREE.Texture) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(1 / sizeM, 1 / sizeM);
        t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.needsUpdate = true;
        resolve(t);
      };
      if (/\.ktx2$/i.test(url)) {
        if (!ktx2) { resolve(null); return; }
        ktx2.load(url, done, undefined, () => resolve(null));
      } else new THREE.TextureLoader().load(url, done, undefined, () => resolve(null));
    }));
    imageTex.set(key, p);
  }
  return p;
}
/** Hang a material's image maps on it as they arrive (the derived maps show until then). */
function applyImageMaps(mat: THREE.MeshPhysicalMaterial, maps: MaterialMaps) {
  const size = maps.sizeM && maps.sizeM > 0 ? maps.sizeM : 1;
  const set = (ref: string | undefined, color: boolean, apply: (t: THREE.Texture) => void) => {
    if (!ref) return;
    void loadImageTexture(ref, color, size).then((t) => { if (t) { apply(t); mat.needsUpdate = true; redrawAll(); } });
  };
  set(maps.albedo, true, (t) => { mat.map = t; mat.color.set("#ffffff"); });
  set(maps.normal, false, (t) => { mat.normalMap = t; if (maps.normalConvention === "dx") mat.normalScale.y = -Math.abs(mat.normalScale.y); });
  set(maps.roughness, false, (t) => { mat.roughnessMap = t; mat.roughness = 1; });
  set(maps.metallic, false, (t) => { mat.metalnessMap = t; mat.metalness = 1; });
  set(maps.ao, false, (t) => { mat.aoMap = t; });
}

const cache = new Map<string, THREE.Material>();
/** Basic look (Detailed mode): a Lambert surface in the material's base colour — no maps, no reflections, no
 *  environment response, so it costs a fraction of a physical material per pixel. Glazing stays see-through. */
function basicMaterial(color: string, def: MaterialDef | null | undefined, opts?: { emissive?: string; emissiveIntensity?: number }): THREE.Material {
  const pbr = def?.pbr;
  const glass = (pbr?.transmission ?? 0) > 0;
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(pbr?.baseColor ?? color), side: THREE.DoubleSide });
  if (glass) { mat.transparent = true; mat.opacity = 0.3; mat.depthWrite = false; }
  if (opts?.emissiveIntensity) { mat.emissive = new THREE.Color(opts.emissive ?? "#2563eb"); mat.emissiveIntensity = opts.emissiveIntensity; }
  return mat;
}

/** A shared THREE material for a library path (falls back to the row colour while loading / on failure). */
export function libraryMaterial(path: string, fallbackColor: string, def: MaterialDef | null | undefined, opts?: { emissive?: string; emissiveIntensity?: number; look?: SurfaceLook }): THREE.Material {
  const look: SurfaceLook = opts?.look ?? "realistic";
  const sel = opts?.emissiveIntensity ? `|sel:${opts.emissive}:${opts.emissiveIntensity}` : "";
  const key = `${look}|${def ? path : `flat:${fallbackColor}`}${sel}`;
  let m = cache.get(key);
  if (m) return m;
  if (look === "basic") { m = basicMaterial(fallbackColor, def, opts); cache.set(key, m); return m; }
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
  // Realistic surface detail: a normal map and a roughness map from the same procedural, and the coat.
  if (pt && def) {
    const dm = derivedMaps(path, def, pt);
    if (dm) { mat.normalMap = dm.normal; mat.normalScale.set(1, 1); mat.roughnessMap = dm.rough; mat.roughness = 1; }
  }
  const coat = def?.surface?.coat;
  if (coat?.weight) { mat.clearcoat = coat.weight; mat.clearcoatRoughness = coat.roughness ?? 0.1; }
  const maps = def?.pbr?.maps ?? def?.maps;
  if (maps && transmission === 0) applyImageMaps(mat, maps);
  if (def?.emission?.luminance) { mat.emissive = new THREE.Color("#fff3e0"); mat.emissiveIntensity = Math.min(4, def.emission.luminance / 300); }
  if (opts?.emissiveIntensity) { mat.emissive = new THREE.Color(opts.emissive ?? "#2563eb"); mat.emissiveIntensity = opts.emissiveIntensity; }
  cache.set(key, mat);
  m = mat;
  return m;
}
