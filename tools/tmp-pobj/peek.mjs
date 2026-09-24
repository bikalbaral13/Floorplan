import fs from "node:fs";
const SKIP = /^(_e1|_np|_isSeg|_isSpace|_edges|_edgeLen|_longest|_spaceDir|_segDir|_dir|_dirLen|_axisB|_rot|_crot|_srot|_bx|_by|_axisU|_axisV|_ux|_uy|_vx|_vy|_Qu|_Qv|_hu0|_hu1|_hv0|_hv1|_hcu|_hcv|_hostL|_hostW|_availL|_notOff|_exact|_sRaw|_sFit|_anchorL|_anchorR|_anchorT|_anchorB|_ax|_ay|_hau|_hav|_nq|_r4|_a[1-4]|_b[1-4]|_qz[01]|_gq|_fq|_q[0-5]|_FL|_PL|_U|_V|_W|_nw|_PU|_PV|_WP|_nwp)\s*=/;
const SKIPC = /^# (Host frame|Fit to host|Anchor|Quad prism|Local)/;
for (const n of process.argv.slice(2)) {
  const j = JSON.parse(fs.readFileSync(`live/${n}.json`, "utf8"));
  const e = j.nodes.find((x) => x.id === "math").data.params.expr.split("\n");
  console.log(`================== ${n}  (${e.length} lines)`);
  e.forEach((l, i) => { if (!SKIP.test(l.trim()) && !SKIPC.test(l.trim())) console.log(String(i).padStart(3) + ": " + l); });
}
