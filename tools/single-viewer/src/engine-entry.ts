/**
 * The parametric engine, as one browser global.
 *
 * Everything a viewer needs to turn an attachment into solids, and nothing else: the spine resolver
 * plus the three graph-wide helpers the wall band needs. Bundled as a CLASSIC script (IIFE) rather
 * than a module because the deliverable opens from `file://`, where `<script type="module">` is
 * blocked by CORS.
 */
export {
  parseSpineObject,
  isSpineObjectText,
  spineParams,
  spineHostParam,
  resolveSpineObject,
} from "../../../src/floorplan/flow/eval/spineObject";

export {
  computeMiteredWallPolygons,
  computeConvexHull,
  polygonCentroid,
} from "@builderpluss/engine";
