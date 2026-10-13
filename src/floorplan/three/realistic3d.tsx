/** The two 3D looks of the editor's Render mode, and what each one switches on.
 *
 *  Detailed  ("basic")     — plain shading for modelling: Lambert surfaces in their base colour, a hemisphere fill
 *                            and one sun WITHOUT shadows. No HDRI, no textures, no post effects; the canvas renders
 *                            only when something changes.
 *  Realistic ("realistic") — the same geometry, fully lit: physical materials with albedo / normal / roughness maps
 *                            (materials3d.ts), the HDRI as image light and reflections, sun shadows, the lamps the
 *                            lighting fixtures reference (lamp/1), N8AO ambient occlusion and SMAA. While the camera
 *                            moves the AO is dropped and the pixel ratio lowered, then restored when it stops; the
 *                            sun's shadow map is redrawn only when the scene changes, never per frame.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { DEFAULT_LIBRARY_PATH, cloudLibraryBaseUrl } from "../cloudLibrary";
import { registerRedraw, setKtx2Loader, type SurfaceLook } from "./materials3d";

export const LookContext = createContext<SurfaceLook>("basic");
export const useLook = () => useContext(LookContext);

/** True while the user is orbiting / panning / zooming (and ~300 ms after). */
export const MovingContext = createContext(false);
export const useMoving = () => useContext(MovingContext);

/** Lets a texture that loads after the last frame ask the on-demand canvas for a new one. */
export function RedrawBridge() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => registerRedraw(() => invalidate()), [invalidate]);
  return null;
}

/** KTX2 (Basis) texture support for image maps that ship as .ktx2 — set up once per renderer. */
let ktx2Ready = false;
export function Ktx2Setup() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (ktx2Ready) return;
    ktx2Ready = true;
    const l = new KTX2Loader().setTranscoderPath(`https://cdn.jsdelivr.net/npm/three@0.${THREE.REVISION}.0/examples/jsm/libs/basis/`).detectSupport(gl);
    setKtx2Loader(l as unknown as Parameters<typeof setKtx2Loader>[0]);
  }, [gl]);
  return null;
}

/** Shadows are static unless the scene changes: stop the per-frame shadow pass and redraw it only when the
 *  canvas re-renders (content, selection or view settings changed) — orbiting re-uses the last shadow map. */
export function StaticShadows({ enabled }: { enabled: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.shadowMap.autoUpdate = !enabled;
    gl.shadowMap.needsUpdate = true;
  });
  return null;
}

/** Track camera motion through the OrbitControls start / end events; lowers the pixel ratio while moving. */
export function useCameraMotion(active: boolean): boolean {
  const controls = useThree((s) => s.controls) as unknown as THREE.EventDispatcher<{ start: object; end: object }> | null;
  const setDpr = useThree((s) => s.setDpr);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!active || !controls) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const start = () => { if (t) clearTimeout(t); setMoving(true); };
    const end = () => { if (t) clearTimeout(t); t = setTimeout(() => setMoving(false), 300); };
    controls.addEventListener("start", start);
    controls.addEventListener("end", end);
    return () => { controls.removeEventListener("start", start); controls.removeEventListener("end", end); if (t) clearTimeout(t); };
  }, [active, controls]);
  useEffect(() => {
    const full = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    setDpr(active && moving ? Math.min(1, full) : full);
  }, [active, moving, setDpr]);
  return active && moving;
}

/* ── Lamps ────────────────────────────────────────────────────────────────────────────────────────────── */

/** lamp/1 (R2 library/Objects/Photometry/<Category>/<id>.json) — only what the live view reads. */
interface LampDef {
  category?: string;
  emission?: { sourceType?: string; lumens?: number; lumensPerMetre?: number; kelvin?: number; illuminanceLux?: number };
  distribution?: { beamAngle?: number; beamBlend?: number };
}
const lampDefs = new Map<string, Promise<LampDef | null>>();
let libBase: Promise<string> | null = null;
/** A fixture's `lamp` prop → its lamp/1. Accepts "Objects/Photometry/…", the older "Photometry/…", or a URL. */
function loadLamp(ref: string): Promise<LampDef | null> {
  let p = lampDefs.get(ref);
  if (!p) {
    libBase ??= cloudLibraryBaseUrl().catch(() => "").then((b) => (b || DEFAULT_LIBRARY_PATH).replace(/\/+$/, ""));
    let rel = ref.replace(/^\/+/, "").replace(/^library\//, "");
    if (/^Photometry\//.test(rel)) rel = `Objects/${rel}`;
    if (!/\.json$/i.test(rel)) rel += ".json";
    p = libBase
      .then((b) => fetch(/^https?:/i.test(ref) ? ref : `${b}/${rel.split("/").map(encodeURIComponent).join("/")}`))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    lampDefs.set(ref, p);
  }
  return p;
}

/** Correlated colour temperature → linear RGB (Tanner Helland's fit, good to ~1% over 1000–12000 K). */
export function kelvinToColor(k: number): THREE.Color {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

/** The scene's sun and HDRI are not in physical units (a 1.35 "lux" sun), so a lamp's real candela is scaled
 *  down by this to sit in the same range: an 806 lm bulb lights the floor below it, it does not white it out. */
export const LAMP_SCALE = 0.04;
/** Only the lamps nearest the camera cast real light — each one costs every lit pixel. The rest still glow
 *  through their emissive material. */
export const MAX_LAMPS = 8;

/** One fixture to light: where its light sits (local, Y-up, metres — the frame the meshes are drawn in), how
 *  wide the fixture is (for linear sources), and the lamp reference. */
export interface LampPlacement { key: string; ref: string; pos: [number, number, number]; spanM: number }

interface BuiltLamp { key: string; pos: THREE.Vector3; kind: "point" | "spot"; color: THREE.Color; intensity: number; angle: number; penumbra: number }

export function LampLights({ lamps }: { lamps: LampPlacement[] }) {
  const [defs, setDefs] = useState<Map<string, LampDef | null>>(new Map());
  const refs = useMemo(() => [...new Set(lamps.map((l) => l.ref))].sort(), [lamps]);
  useEffect(() => {
    let live = true;
    Promise.all(refs.map(async (r) => [r, await loadLamp(r)] as const)).then((pairs) => { if (live) setDefs(new Map(pairs)); });
    return () => { live = false; };
  }, [refs]);
  const built = useMemo((): BuiltLamp[] => lamps.flatMap((l) => {
    const d = defs.get(l.ref);
    const e = d?.emission;
    // Daylight "lamps" (sun, sky) are the scene's job, not a fixture's.
    if (!d || !e || d.category === "Daylight" || e.illuminanceLux) return [];
    const lumens = e.lumens || (e.lumensPerMetre ? e.lumensPerMetre * Math.max(0.3, l.spanM) : 0);
    if (!(lumens > 0)) return [];
    const beam = d.distribution?.beamAngle ?? 120;
    const spot = e.sourceType === "Spot" || beam <= 170;
    const half = THREE.MathUtils.degToRad(Math.min(170, beam) / 2);
    // luminous intensity (cd) of an even cone / sphere: lm / solid angle
    const cd = lumens / (spot ? 2 * Math.PI * (1 - Math.cos(half)) : 4 * Math.PI);
    return [{ key: l.key, pos: new THREE.Vector3(...l.pos), kind: spot ? "spot" : "point", color: kelvinToColor(e.kelvin ?? 3000),
      intensity: cd * LAMP_SCALE, angle: half, penumbra: Math.min(1, Math.max(0.15, d.distribution?.beamBlend ?? 0.5)) }];
  }), [lamps, defs]);

  // Nearest MAX_LAMPS to the camera, re-picked at most twice a second (the group is rotated Z-up, so compare in world).
  const group = useRef<THREE.Group>(null);
  const [active, setActive] = useState<string[]>([]);
  const last = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, clock }) => {
    if (clock.elapsedTime - last.current < 0.5 && active.length) return;
    last.current = clock.elapsedTime;
    const g = group.current;
    if (!g) return;
    const pick = built
      .map((b) => ({ k: b.key, d: g.localToWorld(tmp.copy(b.pos)).distanceToSquared(camera.position) }))
      .sort((a, b) => a.d - b.d).slice(0, MAX_LAMPS).map((x) => x.k).sort();
    if (pick.join("|") !== active.join("|")) setActive(pick);
  });
  const on = new Set(active);
  return (
    <group ref={group}>
      {built.filter((b) => on.has(b.key)).map((b) => b.kind === "spot"
        ? <SpotLamp key={b.key} b={b} />
        : <pointLight key={b.key} position={b.pos} color={b.color} intensity={b.intensity} distance={0} decay={2} />)}
    </group>
  );
}

/** A downward spot (fixtures hang from or sit in the ceiling); its target rides along 1 m below. */
function SpotLamp({ b }: { b: BuiltLamp }) {
  const light = useMemo(() => new THREE.SpotLight(), []);
  useEffect(() => {
    light.position.copy(b.pos);
    light.target.position.set(b.pos.x, b.pos.y - 1, b.pos.z);
    light.color.copy(b.color);
    light.intensity = b.intensity;
    light.angle = b.angle;
    light.penumbra = b.penumbra;
    light.distance = 0;
    light.decay = 2;
  }, [light, b]);
  return (
    <>
      <primitive object={light} />
      <primitive object={light.target} />
    </>
  );
}
