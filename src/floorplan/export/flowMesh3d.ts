/**
 * flowMesh3d.ts
 *
 * 3D export for FLOW geometry — the "Export 3D" node's engine. It takes the same resolved primitive
 * descriptors the 3D viewport renders (`PrimMass3D`, produced in FloorPlanEditor from the 3D Render rows
 * and the 3D primitive chain), rebuilds them as a plain THREE.Group, and hands that to one of the
 * exporters that ship with three (OBJ / STL / GLB / PLY) — so no new dependency is involved.
 *
 * The geometry builders below intentionally MIRROR FloorPlan3DCanvas's `buildPrimitiveMesh` rather than
 * importing it: the canvas module is a React/R3F component tree, and an exporter that pulls it in would
 * drag the whole viewport into the flow overlay's bundle. Keep the two in step when a new shape lands.
 *
 * FRAME: descriptors are in the viewport's Y-up scene metres (x across, y UP, z = plan Y / south). "Z-up"
 * export rotates the group +90° about X so Z becomes up and +Y becomes north — the same handedness the
 * DXF export writes, which is what CAD and Blender expect.
 */

import * as THREE from "three";

/** A resolved 3D primitive to export — structurally FloorPlanEditor's `PrimMass3D` (kept local so the
 *  exporter doesn't import the editor). */
export interface ExportMass3D {
  id: string;
  shape: string;
  length: number;
  breadth: number;
  height: number;
  radius: number;
  color: string;
  radiusTop?: number;
  topLength?: number;
  topBreadth?: number;
  tubeRadius?: number;
  arcDeg?: number;
  faces?: number[][][];
  transform?: { tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; mx: number; my: number; mz: number };
  display?: { color: string; opacity: number; wireframe: boolean; showEdges: boolean };
}

export type Mesh3DFormat = "glb" | "obj" | "stl" | "ply";

/** Per-format file extension, MIME type, and whether colour survives the round trip. */
export const MESH3D_FORMATS: Record<Mesh3DFormat, { ext: string; mime: string; label: string; colour: boolean }> = {
  glb: { ext: "glb", mime: "model/gltf-binary", label: "glTF (.glb)", colour: true },
  obj: { ext: "obj", mime: "text/plain", label: "Wavefront (.obj)", colour: false },
  stl: { ext: "stl", mime: "model/stl", label: "STL (.stl)", colour: false },
  ply: { ext: "ply", mime: "application/octet-stream", label: "PLY (.ply)", colour: true },
};

/** Metres → export unit. */
export const MESH3D_UNIT_SCALE: Record<string, number> = { m: 1, cm: 100, mm: 1000, ft: 3.280839895 };

export interface Mesh3DOptions {
  /** Unit key into {@link MESH3D_UNIT_SCALE}. */
  units: string;
  /** "z-up" (CAD / Blender) or "y-up" (the viewport / glTF convention). */
  axis: "z-up" | "y-up";
}

export const DEFAULT_MESH3D_OPTIONS: Mesh3DOptions = { units: "m", axis: "z-up" };

/** A rectangular frustum (tapered box) — twin of the viewport's `taperedBoxGeometry`. */
function taperedBoxGeometry(L: number, B: number, TL: number, TB: number, H: number): THREE.BufferGeometry {
  const hb = { x: L / 2, z: B / 2 }, ht = { x: TL / 2, z: TB / 2 }, y0 = -H / 2, y1 = H / 2;
  const b = [[hb.x, y0, hb.z], [-hb.x, y0, hb.z], [-hb.x, y0, -hb.z], [hb.x, y0, -hb.z]];
  const t = [[ht.x, y1, ht.z], [-ht.x, y1, ht.z], [-ht.x, y1, -ht.z], [ht.x, y1, -ht.z]];
  const tris: number[][] = [];
  const quad = (a: number[], bb: number[], c: number[], dd: number[]) => { tris.push(a, bb, c, a, c, dd); };
  quad(b[0], b[1], b[2], b[3]);
  quad(t[3], t[2], t[1], t[0]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(b[j], b[i], t[i], t[j]); }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  geom.computeVertexNormals();
  return geom;
}

/** A solid given as its own faces (each an ordered ring, scene metres) — twin of the viewport's
 *  `polyhedronGeometry`. Every ring is fan-triangulated into a non-indexed triangle list. */
function polyhedronGeometry(faces: number[][][]): THREE.BufferGeometry {
  const tris: number[] = [];
  for (const ring of faces) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const a = ring[0];
    for (let i = 1; i + 1 < ring.length; i++) {
      const b = ring[i], c = ring[i + 1];
      tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris), 3));
  geom.computeVertexNormals();
  return geom;
}

/** Geometry + floor-resting lift for one descriptor — the same shape table the viewport builds from. */
function geometryFor(d: ExportMass3D): { geom: THREE.BufferGeometry; y: number } {
  if (d.shape === "cuboid") return { geom: new THREE.BoxGeometry(d.length, d.height, d.breadth), y: d.height / 2 };
  if (d.shape === "sphere") return { geom: new THREE.SphereGeometry(d.radius, 32, 24), y: d.radius };
  if (d.shape === "cone") return { geom: new THREE.ConeGeometry(d.radius, d.height, 40), y: d.height / 2 };
  if (d.shape === "cylinder") return { geom: new THREE.CylinderGeometry(d.radius, d.radius, d.height, 40), y: d.height / 2 };
  if (d.shape === "frustum") return { geom: new THREE.CylinderGeometry(Math.max(0, d.radiusTop ?? 0), d.radius, d.height, 40), y: d.height / 2 };
  if (d.shape === "tapered-box") return { geom: taperedBoxGeometry(d.length, d.breadth, Math.max(0, d.topLength ?? 0), Math.max(0, d.topBreadth ?? 0), d.height), y: d.height / 2 };
  if (d.shape === "torus") {
    const tube = Math.max(0.001, d.tubeRadius ?? 0.3);
    const geom = new THREE.TorusGeometry(d.radius, tube, 16, 48, (Math.max(5, Math.min(360, d.arcDeg ?? 360)) * Math.PI) / 180);
    geom.rotateX(Math.PI / 2);
    return { geom, y: tube };
  }
  if (d.shape === "capsule") { const mid = Math.max(0, d.length); return { geom: new THREE.CapsuleGeometry(d.radius, mid, 8, 16), y: mid / 2 + d.radius }; }
  // A polyhedron's vertices are absolute, so it needs no lift onto the floor.
  if (d.shape === "polyhedron") return { geom: polyhedronGeometry(d.faces ?? []), y: 0 };
  return { geom: new THREE.BoxGeometry(d.length, d.length, d.length), y: d.length / 2 };
}

/** Paint every vertex with the row colour, so formats that carry vertex colours (PLY) keep it. */
const applyVertexColour = (geom: THREE.BufferGeometry, hex: string): void => {
  const pos = geom.getAttribute("position");
  if (!pos) return;
  const c = new THREE.Color(hex);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geom.setAttribute("color", new THREE.BufferAttribute(arr, 3));
};

/** Descriptors → a THREE.Group ready for any exporter (unit-scaled, axis-converted, world matrices
 *  updated). Materials are NAMED after the row colour so OBJ's `usemtl` and glTF's material list stay
 *  readable. */
export function massesToGroup(masses: ExportMass3D[], opts: Mesh3DOptions): { group: THREE.Group; triangles: number } {
  const inner = new THREE.Group();
  let triangles = 0;
  for (const d of masses) {
    const { geom, y } = geometryFor(d);
    const pos = geom.getAttribute("position");
    if (!pos || pos.count < 3) continue;
    triangles += pos.count / 3;
    const colour = d.display?.color ?? d.color ?? "#94a3b8";
    applyVertexColour(geom, colour);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour), side: THREE.DoubleSide });
    mat.name = `mat_${colour.replace(/[^0-9a-z]/gi, "")}`;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = d.id.replace(/[^0-9a-z_-]/gi, "_");
    const tf = d.transform;
    mesh.position.set(tf?.tx ?? 0, y + (tf?.ty ?? 0), tf?.tz ?? 0);
    mesh.rotation.set(tf?.rx ?? 0, tf?.ry ?? 0, tf?.rz ?? 0);
    mesh.scale.set(tf?.mx ?? 1, tf?.my ?? 1, tf?.mz ?? 1);
    inner.add(mesh);
  }
  return { group: wrapForExport(inner, opts), triangles };
}

/**
 * Wrap any object in the export frame: unit scale plus whatever rotation takes it from the frame it
 * is authored in to the requested one. Applied on an OUTER group so the contents keep their own
 * transforms.
 *
 * `sourceUp` matters and is easy to get wrong. Flow masses are built in three's default Y-up, so
 * asking for z-up rotates them. The interactive 3D scene is ALREADY z-up (the floor is the XY plane
 * and height rises along +Z), so asking for z-up must rotate it by nothing and asking for y-up must
 * rotate it back. Sharing this function is what stops a flow node and the 3D view from disagreeing
 * about what "mm, z-up" means.
 */
export function wrapForExport(
  inner: THREE.Object3D,
  opts: Mesh3DOptions,
  sourceUp: "y-up" | "z-up" = "y-up",
): THREE.Group {
  const group = new THREE.Group();
  group.scale.setScalar(MESH3D_UNIT_SCALE[opts.units] ?? 1);
  if (sourceUp === "y-up" && opts.axis === "z-up") group.rotation.x = Math.PI / 2;
  else if (sourceUp === "z-up" && opts.axis === "y-up") group.rotation.x = -Math.PI / 2;
  group.add(inner);
  group.updateMatrixWorld(true);
  return group;
}

/** Serialise a prepared group (already unit-scaled and axis-converted) to a Blob. The exporters are
 *  imported lazily so three's exporter bundle only loads when someone actually exports. */
export async function exportGroupToBlob(group: THREE.Object3D, format: Mesh3DFormat): Promise<Blob> {
  const meta = MESH3D_FORMATS[format];
  let part: BlobPart;
  if (format === "glb") {
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    part = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
  } else if (format === "obj") {
    const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
    part = new OBJExporter().parse(group);
  } else if (format === "stl") {
    const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
    part = new STLExporter().parse(group, { binary: true }) as unknown as DataView;
  } else {
    const { PLYExporter } = await import("three/examples/jsm/exporters/PLYExporter.js");
    part = new PLYExporter().parse(group, () => undefined, { binary: true }) as ArrayBuffer;
  }
  return new Blob([part], { type: meta.mime });
}

/** Serialise the masses of one flow node to a downloadable Blob in the chosen format. */
export async function exportMassesToBlob(
  masses: ExportMass3D[],
  format: Mesh3DFormat,
  opts: Mesh3DOptions,
): Promise<{ blob: Blob; meshes: number; triangles: number }> {
  const { group, triangles } = massesToGroup(masses, opts);
  const meshes = group.children[0]?.children.length ?? 0;
  return { blob: await exportGroupToBlob(group, format), meshes, triangles };
}
