/** The 3D export formats, units and the mass description — plain data, no three.js, so the editor and dialogs can
 *  list formats without loading the exporter (flowMesh3d.ts re-exports all of this). */
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
