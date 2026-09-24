/** Sweep the PATCHED objects across every select/checkbox value, including the ones just added. */
import { readFileSync, readdirSync } from "node:fs";
import { runExprBody, liftScopeValue } from "@builderpluss/engine/node";
const HOSTS = { node: [[0,0]], segment: [[0,0],[4,0]], space: [[0,0],[3.962,0],[3.962,3.734],[0,3.734]] };
const isM = (v) => Array.isArray(v) && (v.length === 0 || Array.isArray(v[0]));
const spine = (f) => { const by=(t)=>f.nodes.find(n=>n.data?.tool===t); return {props:by("input-props"),math:by("expr"),out:by("output"),r2d:by("render-2d"),r3d:by("render-3d")}; };
function faceProblems(M){ if(!isM(M)||!M.length) return []; const bad=[]; if(M.some(r=>r.length!==4||!r.every(Number.isFinite))) return ["bad row"]; const seen=new Set(); let i=0;
  while(i<M.length){ const f=M[i][3]; let j=i; while(j<M.length&&M[j][3]===f) j++; if(j-i<3) bad.push(`face ${f}: ${j-i} verts`); if(seen.has(f)) bad.push(`face ${f} split`); seen.add(f); i=j; } return bad; }

const NAMES = process.argv.slice(2);
let totalBad = 0;
for (const name of NAMES) {
  const flow = JSON.parse(readFileSync(`out-bedroom/${name}.json`, "utf8"));
  const N = spine(flow);
  const props = N.props.data.params.props;
  const body = N.math.data.params.expr;
  const nameOf = new Map();
  for (const e of flow.edges) if (e.source === N.math.id && e.target === N.out.id) nameOf.set(e.targetHandle.slice(6), e.sourceHandle.slice(4));
  const rows3 = N.r3d.data.params.prims.map(r => { const e = flow.edges.find(x => x.target === N.r3d.id && x.targetHandle === `valin-${r.id}`); return { ...r, src: e && nameOf.get(e.sourceHandle.slice(4)) }; }).filter(r => r.src);

  const sels = props.filter(p => p.type === "select");
  const chks = props.filter(p => p.type === "checkbox");
  let combos = [{}];
  for (const s of sels) { const nx = []; for (const c of combos) for (const v of s.options) nx.push({ ...c, [s.id]: v }); combos = nx; }
  if (combos.length > 400) combos = combos.filter((_, i) => i % Math.ceil(combos.length / 400) === 0);
  const list = [{ label: "defaults", over: {} }, ...combos.map(c => ({ label: Object.values(c).join("/"), over: c })),
                ...chks.map(c => ({ label: `${c.id}=${!c.value}`, over: { [c.id]: !c.value } }))];

  const problems = [];
  const everSeen = new Set();
  for (const c of list) {
    const scope = { PI: Math.PI };
    for (const p of props) scope[p.id] = liftScopeValue(p.value);
    scope.P = HOSTS[flow.object?.hostKind] ?? HOSTS.node; // AFTER the props — prop #0 is `P`
    for (const [k, v] of Object.entries(c.over)) scope[k] = liftScopeValue(v);
    let out; try { const r = runExprBody(body, scope); out = r?.scope ?? r; }
    catch (e) { problems.push(`${c.label}: threw ${e.message}`); continue; }
    for (const row of rows3) {
      const v = out[row.src];
      if (v === undefined) { problems.push(`${c.label}: ${row.src} undefined`); continue; }
      if (!isM(v)) { problems.push(`${c.label}: ${row.src} not a matrix`); continue; }
      if (v.length) everSeen.add(row.src);
      if (row.kind === "tube" || row.kind === "ring") { if (v.some(r => r.length < 6 || !r.every(Number.isFinite))) problems.push(`${c.label}: ${row.src} bad ${row.kind} row`); continue; }
      if (row.kind === "loft") continue;
      faceProblems(v).forEach(b => problems.push(`${c.label}: ${row.src} ${b}`));
      if (v.length) { const xs=v.map(r=>r[0]), ys=v.map(r=>r[1]), zs=v.map(r=>r[2]);
        const d=[Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys), Math.max(...zs)-Math.min(...zs)];
        if (d.some(x => x > 80)) problems.push(`${c.label}: ${row.src} bbox ${d.map(x=>x.toFixed(1)).join("x")} runaway`); }
    }
    for (const [sid] of nameOf) { const v = out[nameOf.get(sid)]; if (typeof v === "number" && !Number.isFinite(v)) problems.push(`${c.label}: metric ${nameOf.get(sid)} = ${v}`); }
  }
  for (const r of rows3) if (!everSeen.has(r.src)) problems.push(`3D row "${r.src}" empty in all ${list.length} cases`);
  if (problems.length) { totalBad++; console.log(`FAIL ${name}  (${list.length} cases)`); [...new Set(problems)].slice(0,8).forEach(p=>console.log("      - "+p)); }
  else console.log(`ok   ${name.padEnd(14)} ${String(list.length).padStart(4)} cases clean`);
}
console.log(`\n${NAMES.length} swept, ${totalBad} with problems`);
