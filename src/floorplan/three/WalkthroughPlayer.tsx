/** Walkthrough playback for the 3D view: a person walking the plan's `walkthrough` route at eye height.
 *
 *  - WalkCamera (inside <Canvas>): drives the camera along a smooth curve through the walkthrough path —
 *    centripetal Catmull-Rom through every path point, so it still passes exactly through each door — at the
 *    plan's walking speed, pausing at each stop, and turning the head smoothly toward where it is going.
 *  - WalkthroughBar (HTML overlay): Walkthrough / Exit, Play / Pause, a scrub slider (with the room being
 *    walked through), Forward / Backward, and Export video (records the canvas while the walk plays → .webm).
 *  The two share one mutable state object so the per-frame camera never re-renders React.
 *  Coordinates: plan px → world metres (x / ppm, −y / ppm), Z up — the same mapping as the rest of the scene. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Walkthrough } from "../walkthrough";

export interface WalkState {
  active: boolean;
  playing: boolean;
  /** 0…1 along the route (by distance). */
  t: number;
  /** +1 forward, −1 backward. */
  dir: 1 | -1;
  /** Seconds left of the current stop's pause. */
  hold: number;
  /** Fired once when a play run reaches the end (used by the video export). */
  onEnd: (() => void) | null;
  canvas: HTMLCanvasElement | null;
  /** Label of the room the camera is in / walking toward (for the bar). */
  label: string;
  /** Playback speed multiplier (1 = the plan's walking speed). */
  rate: number;
  /** Route length (m) and where the stops fall (0…1) — published by the camera so the bar can show time. */
  lengthM: number;
  stopU: number[];
  /** True while Export video is recording. */
  recording: boolean;
}
export const newWalkState = (): WalkState => ({ active: false, playing: false, t: 0, dir: 1, hold: 0, onEnd: null, canvas: null, label: "", rate: 1, lengthM: 0, stopU: [], recording: false });

/** The walk as a curve in world metres + where each route stop falls on it (0…1). */
function useWalkCurve(walk: Walkthrough | undefined, ppm: number) {
  return useMemo(() => {
    if (!walk || walk.path.length < 2) return null;
    const pts = walk.path.map((p) => new THREE.Vector3(p.x / ppm, -p.y / ppm, 0));
    // drop consecutive duplicates (a Catmull-Rom through two equal points has a zero tangent)
    const clean = pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.02);
    const curve = new THREE.CatmullRomCurve3(clean, false, "centripetal");
    const length = curve.getLength();
    // a route stop's position on the curve: nearest of 400 arc-length samples
    const samples = Array.from({ length: 401 }, (_, i) => curve.getPointAt(i / 400));
    const stopU = walk.routePathIndex.map((pi) => {
      const p = walk.path[Math.min(pi, walk.path.length - 1)];
      const v = new THREE.Vector3(p.x / ppm, -p.y / ppm, 0);
      let best = 0, bd = Infinity;
      samples.forEach((s, i) => { const d = s.distanceTo(v); if (d < bd) { bd = d; best = i / 400; } });
      return best;
    });
    const labels = walk.route.map((id) => walk.stops.find((s) => s.id === id)?.label ?? "");
    return { curve, length, stopU, labels };
  }, [walk, ppm]);
}

export function WalkCamera({ walk, ppm, state }: { walk?: Walkthrough; ppm: number; state: React.MutableRefObject<WalkState> }) {
  const { camera, controls, gl, invalidate } = useThree();
  const c = useWalkCurve(walk, ppm);
  const yaw = useRef<number | null>(null);
  const saved = useRef<{ pos: THREE.Vector3; fov: number; target?: THREE.Vector3 } | null>(null);
  useEffect(() => { state.current.canvas = gl.domElement; }, [gl, state]);
  useEffect(() => { state.current.lengthM = c?.length ?? 0; state.current.stopU = c?.stopU ?? []; }, [c, state]);
  useFrame((_, dtRaw) => {
    const st = state.current;
    const cam = camera as THREE.PerspectiveCamera;
    const ctl = controls as unknown as { enabled: boolean; target: THREE.Vector3 } | null;
    if (!st.active || !c || !walk) {
      if (saved.current) {
        // leaving the walk: give the user back their orbit view
        cam.position.copy(saved.current.pos); cam.fov = saved.current.fov; cam.updateProjectionMatrix();
        if (ctl) { if (saved.current.target) ctl.target.copy(saved.current.target); ctl.enabled = true; }
        saved.current = null; yaw.current = null;
        invalidate();
      }
      return;
    }
    if (!saved.current) saved.current = { pos: cam.position.clone(), fov: cam.fov, target: ctl?.target?.clone() };
    if (ctl) ctl.enabled = false;
    const dt = Math.min(0.1, dtRaw);
    if (st.playing) {
      if (st.hold > 0) st.hold -= dt * (st.rate || 1);
      else {
        const prev = st.t;
        st.t = Math.max(0, Math.min(1, st.t + (st.dir * dt * walk.speed * (st.rate || 1)) / c.length));
        // crossing a stop → linger there
        const crossed = c.stopU.some((u) => (prev - u) * (st.t - u) < 0 || (st.t === u && prev !== u));
        if (crossed && walk.pauseAtStops > 0) st.hold = walk.pauseAtStops;
        if ((st.dir > 0 && st.t >= 1) || (st.dir < 0 && st.t <= 0)) { st.playing = false; const f = st.onEnd; st.onEnd = null; f?.(); }
      }
    }
    // position + where the eye is heading: ~1.5 m ahead along the walking direction
    const p = c.curve.getPointAt(st.t);
    const ahead = Math.max(0, Math.min(1, st.t + (st.dir * 1.5) / c.length));
    const q = ahead === st.t ? c.curve.getPointAt(Math.max(0, Math.min(1, st.t - st.dir * 0.01))) : c.curve.getPointAt(ahead);
    let want = Math.atan2(q.y - p.y, q.x - p.x);
    if (ahead === st.t) want += Math.PI;
    if (yaw.current == null) yaw.current = want;
    let d = want - yaw.current;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    yaw.current += d * Math.min(1, dt * 2.5); // a head turns, it does not snap
    cam.up.set(0, 0, 1);
    cam.position.set(p.x, p.y, walk.eyeHeight);
    cam.lookAt(p.x + Math.cos(yaw.current), p.y + Math.sin(yaw.current), walk.eyeHeight - 0.08);
    if (cam.fov !== walk.fov) { cam.fov = walk.fov; cam.updateProjectionMatrix(); }
    // the room being walked: the last stop passed
    let li = 0;
    c.stopU.forEach((u, i) => { if (u <= st.t + 1e-6) li = i; });
    st.label = c.labels[li] ?? "";
    invalidate();
  });
  return null;
}

/** Seconds of walk (at the playback rate) between two positions, pauses at the stops in between included. */
export function walkSeconds(st: WalkState, walk: Walkthrough, from: number, to: number): number {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const pauses = st.stopU.filter((u) => u > lo && u <= hi).length * walk.pauseAtStops;
  return ((hi - lo) * st.lengthM / walk.speed + pauses) / (st.rate || 1);
}
const clock = (sec: number) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** Record the canvas while the walk plays from the start (or end, backward) to the other end. */
export function recordWalk(state: React.MutableRefObject<WalkState>, fps = 30): Promise<Blob> {
  const st = state.current;
  const canvas = st.canvas;
  if (!canvas || typeof MediaRecorder === "undefined") return Promise.reject(new Error("video recording is not supported in this browser"));
  const stream = canvas.captureStream(fps);
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  return new Promise((resolve, reject) => {
    rec.onstop = () => { st.recording = false; resolve(new Blob(chunks, { type: mime })); };
    rec.onerror = (e) => reject(e);
    st.active = true; st.t = st.dir > 0 ? 0 : 1; st.hold = 0; st.recording = true;
    st.onEnd = () => setTimeout(() => rec.stop(), 400);
    rec.start(250);
    setTimeout(() => { st.playing = true; }, 300);
  });
}

export function WalkthroughBar({ walk, state, onGenerate, fileName = "walkthrough" }: {
  walk?: Walkthrough; state: React.MutableRefObject<WalkState>; onGenerate?: () => void; fileName?: string;
}) {
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  // the camera loop mutates `state`; mirror it into the bar ~10× a second
  useEffect(() => { const id = window.setInterval(() => setTick((n) => n + 1), 100); return () => window.clearInterval(id); }, []);
  const st = state.current;
  const btn = "rounded-full px-3 py-1 text-xs font-medium shadow-sm border transition";
  if (!walk) {
    return onGenerate ? (
      <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-2 py-1 shadow">
        <button type="button" className={`${btn} border-slate-900 bg-slate-900 text-white`} onClick={onGenerate} title="Build the space traversal graph and route from the doors, openings and open edges of this plan">
          Generate walkthrough
        </button>
      </div>
    ) : null;
  }
  const exportVideo = async () => {
    setBusy("Recording…");
    try {
      const blob = await recordWalk(state);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileName}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      alert(`Video export failed: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-10 flex w-[min(720px,92%)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg">
      <button type="button" className={`${btn} ${st.active ? "border-slate-300 bg-white text-slate-700" : "border-slate-900 bg-slate-900 text-white"}`}
        onClick={() => { st.active = !st.active; st.playing = false; if (st.active && (st.t >= 1 || st.t <= 0)) st.t = st.dir > 0 ? 0 : 1; }}
        title={st.active ? "Leave the walkthrough and return to the orbit view" : "Stand in the plan at eye height"}>
        {st.active ? "Exit" : "Walkthrough"}
      </button>
      <button type="button" disabled={!!busy} className={`${btn} border-slate-300 bg-white text-slate-800`}
        onClick={() => { st.active = true; if ((st.dir > 0 && st.t >= 1) || (st.dir < 0 && st.t <= 0)) st.t = st.dir > 0 ? 0 : 1; st.playing = !st.playing; }}>
        {st.playing ? "Pause" : "Play"}
      </button>
      <input type="range" min={0} max={1000} value={Math.round(st.t * 1000)} disabled={!!busy}
        onChange={(e) => { st.active = true; st.t = Number(e.target.value) / 1000; st.hold = 0; }}
        className="h-1 flex-1 cursor-pointer accent-slate-900" aria-label="Walkthrough position" />
      <span className="w-40 truncate text-right text-xs tabular-nums text-slate-500" title={st.label}>
        {(() => {
          const total = walkSeconds(st, walk, 0, 1);
          const done = st.dir > 0 ? walkSeconds(st, walk, 0, st.t) : walkSeconds(st, walk, st.t, 1);
          if (st.recording) return `Recording ${Math.round((done / Math.max(1e-6, total)) * 100)}% · ${clock(total - done)} left`;
          if (!st.active) return `${walk.stops.length} rooms · ${clock(total)}`;
          return `${st.label} · ${clock(done)} / ${clock(total)}`;
        })()}
      </span>
      <button type="button" disabled={!!busy} className={`${btn} border-slate-300 bg-white text-slate-700`}
        onClick={() => { st.dir = st.dir > 0 ? -1 : 1; }} title="Walk the route forward or backward">
        {st.dir > 0 ? "Forward" : "Backward"}
      </button>
      <button type="button" disabled={!!busy} className={`${btn} border-emerald-700 bg-emerald-700 text-white`} onClick={exportVideo} title="Play the whole walk and save it as a video">
        {busy ? `${Math.round((st.dir > 0 ? st.t : 1 - st.t) * 100)}%` : "Export video"}
      </button>
    </div>
  );
}
