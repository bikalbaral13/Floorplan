/** Write the two benchmark structures as standard canvas plans, with the frame objects attached.
 *
 *  THE CANVAS PLANE IS THE FRAME'S PLANE, so structural Y (up) becomes canvas y (down) by a flip plus
 *  a padding offset. Only DIFFERENCES in Y matter to the analysis, so translating the frame to sit in
 *  positive canvas coordinates changes nothing about the answer — it just puts the drawing on the page.
 *
 *  Unlike a pipe network, a member's DRAWN length IS its structural length: a frame elevation is a
 *  scale drawing, not a schematic, so there is no length override anywhere here.
 */
import { writeFileSync, mkdirSync } from "node:fs";

const PPM = 40;   // canvas pixels per metre
const PAD = 1.5;  // metres of margin

const OBJ = {
  beam: { id: "frame-beam-with-math", path: "Objects/Structural/frame-beam.json" },
  column: { id: "frame-column-with-math", path: "Objects/Structural/frame-column.json" },
  joint: { id: "frame-joint-with-math", path: "Objects/Structural/frame-joint.json" },
};
const r4 = (v) => +Number(v).toFixed(4);

/** @param spec {nodes, members, supports, loads, sections, E, title} */
function plan(spec) {
  const ids = Object.keys(spec.nodes);
  const maxY = Math.max(...ids.map((n) => spec.nodes[n][1]));
  const minX = Math.min(...ids.map((n) => spec.nodes[n][0]));
  const px = (n) => {
    const [x, y] = spec.nodes[n];
    return { x: r4(((x - minX) + PAD) * PPM), y: r4(((maxY - y) + PAD) * PPM) };
  };
  const pos = Object.fromEntries(ids.map((n) => [n, px(n)]));

  const segments = Object.entries(spec.members).map(([nm, [i, j, kind]]) => {
    const [b, h] = spec.sections[kind];
    const A = pos[i], B = pos[j];
    return {
      id: `mem_${nm}`, fromNodeId: i, toNodeId: j, layer: "frame",
      thickness: Math.max(2, r4(h * PPM)),
      color: kind === "column" ? "#0f766e" : "#b45309",
      segmentType: kind, label: nm,
      attachments: [{
        id: `att_${nm}`, objectId: OBJ[kind].id, objectPath: OBJ[kind].path, t: 0.5,
        params: {
          E: r4(spec.E), b: r4(b * 1000), h: r4(h * 1000),
          fy: kind === "column" ? 12 : 12, density: 25, selfWeight: false,
          udl: r4(spec.udl?.[nm] ?? 0),
          releaseStart: !!(spec.releases?.[nm]?.[0]), releaseEnd: !!(spec.releases?.[nm]?.[1]),
          spanMode: "Fill segment", ownLength: 4,
          N1: 0, V1: 0, M1: 0, N2: 0, V2: 0, M2: 0,
          showBmd: true, bmdScale: r4(spec.bmdScale ?? 0.01),
        },
      }],
    };
  });

  const planNodes = ids.map((n) => {
    const sup = spec.supports[n] ?? [false, false, false];
    const ld = spec.loads[n] ?? [0, 0, 0];
    return {
      id: n, x: pos[n].x, y: pos[n].y, layer: "frame",
      label: n, showLabel: true, type: "point",
      attachments: [{
        id: `att_${n}`, objectId: OBJ.joint.id, objectPath: OBJ.joint.path, t: 0,
        params: {
          fixX: !!sup[0], fixY: !!sup[1], fixR: !!sup[2],
          Fx: r4(ld[0]), Fy: r4(ld[1]), Mz: r4(ld[2]),
          markerSize: 0.35, dispScale: spec.dispScale ?? 200,
          ux: 0, uy: 0, rotZ: 0, Rx: 0, Ry: 0, Rz: 0,
        },
      }],
    };
  });

  return {
    schemaVersion: 1,
    settings: {
      library_path: "/Library/", units: "m", northbearing: 0, pixelsPerMeter: PPM,
      keywords: `structural, plane frame, ${spec.title}`,
      frame: {
        note: "The canvas plane IS the frame's plane: canvas x is structural X, structural Y is UP (minus canvas y). Member length is the drawn length — a frame elevation is a scale drawing, not a schematic.",
        generator: "tools/struct/make-plan.mjs",
      },
    },
    nodes: planNodes,
    segments,
    spaces: [],
    layers: [
      { id: "0", name: "0", color: "#94a3b8", visible: true, locked: false, order: 0 },
      { id: "frame", name: "Frame", color: "#0f766e", visible: true, locked: false, order: 1 },
    ],
    imageUnderlay: null,
    customSegmentTypes: {
      beam: { id: "beam", displayName: "Beam", fill: "#b45309", params: [] },
      column: { id: "column", displayName: "Column", fill: "#0f766e", params: [] },
    },
  };
}

const PORTAL = {
  title: "portal frame",
  E: 25,
  nodes: { N1: [0, 0], N2: [0, 4], N3: [6, 4], N4: [6, 0] },
  sections: { column: [0.30, 0.30], beam: [0.30, 0.50] },
  members: { C1: ["N1", "N2", "column"], B1: ["N2", "N3", "beam"], C2: ["N4", "N3", "column"] },
  supports: { N1: [true, true, true], N4: [true, true, true] },
  loads: { N2: [30, 0, 0] },
  udl: { B1: 20 },
  bmdScale: 0.02,
  dispScale: 200,
};

const TRUSS = {
  title: "simple truss",
  E: 200,
  nodes: { T1: [0, 0], T2: [4, 0], T3: [2, 3] },
  sections: { beam: [0.05, 0.05], column: [0.05, 0.05] },
  members: { M1: ["T1", "T3", "beam"], M2: ["T3", "T2", "beam"], M3: ["T1", "T2", "beam"] },
  supports: { T1: [true, true, false], T2: [false, true, false] },
  loads: { T3: [0, -50, 0] },
  udl: {},
  bmdScale: 0.02,
  dispScale: 2000,
};

mkdirSync("tools/struct/out-plan", { recursive: true });
for (const [name, spec] of [["frame_portal", PORTAL], ["frame_truss", TRUSS]]) {
  const p = plan(spec);
  writeFileSync(`tools/struct/out-plan/${name}.json`, JSON.stringify(p, null, 1) + "\n", "utf8");
  console.log(`ok   ${name}.json  ${p.nodes.length} joints, ${p.segments.length} members`);
}
