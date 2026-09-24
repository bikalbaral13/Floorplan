import { runExprBody } from "@builderpluss/engine/node";
import { scopeOf } from "./validate.mjs";
import { pendant } from "./pendant-spec.mjs";
const run = (over={}) => runExprBody(pendant.expr, scopeOf(pendant, [[0,0]], over));
const show = (tag, over={}) => {
  const r = run(over);
  const g = (k)=>r[k];
  const dims = (M)=>{ if(!Array.isArray(M)||!M.length) return "empty";
    const lo=[1e9,1e9,1e9], hi=[-1e9,-1e9,-1e9];
    for(const row of M) for(let i=0;i<3;i++){ lo[i]=Math.min(lo[i],row[i]); hi[i]=Math.max(hi[i],row[i]); }
    return `x ${lo[0].toFixed(3)}..${hi[0].toFixed(3)}  y ${lo[1].toFixed(3)}..${hi[1].toFixed(3)}  z ${lo[2].toFixed(3)}..${hi[2].toFixed(3)}  rows ${M.length}`; };
  console.log(`\n-- ${tag}`);
  console.log(`   Shade3D    ${dims(g("Shade3D"))}`);
  console.log(`   Canopy3D   ${Array.isArray(g("Canopy3D"))&&g("Canopy3D").length?JSON.stringify(g("Canopy3D")[0].map(v=>+v.toFixed(3))):"empty"}`);
  console.log(`   Cord3D     ${Array.isArray(g("Cord3D"))&&g("Cord3D").length?JSON.stringify(g("Cord3D")[0].map(v=>+v.toFixed(3))):"empty"}`);
  console.log(`   Diffuser3D ${Array.isArray(g("Diffuser3D"))&&g("Diffuser3D").length?JSON.stringify(g("Diffuser3D")[0].map(v=>+v.toFixed(3))):"empty"}`);
  for (const k of ["shadeDiameter","shadeHeight","bottomElevation","topElevation","dropFromCeiling","cordLength","colourTemperature","lampOutput","scale"])
    console.log(`   ${k.padEnd(18)} ${typeof g(k)==="number"?g(k).toFixed(4):JSON.stringify(g(k))}`);
  // face contract: every face group a contiguous run of >=3
  const M=g("Shade3D"); let bad=0,faces=0,i=0;
  if(Array.isArray(M)&&M.length){ while(i<M.length){ const f=M[i][3]; let j=i; while(j<M.length&&M[j][3]===f) j++; if(j-i<3) bad++; faces++; i=j; } }
  console.log(`   faces ${faces}  degenerate ${bad}`);
};
show("defaults (plan values: 2in dia, 12in long, bottom 3'10\", canopy 9'9\")",
     { diameter:0.0508, bodyLength:0.3048, bottomHeight:1.1684, mountHeight:2.9718 });
show("Cone", { shade:"Cone" });
show("Dome", { shade:"Dome" });
show("no cord (shade reaches the canopy)", { bodyLength:1.5, bottomHeight:1.45, mountHeight:2.9718 });
show("no diffuser", { openBottom:false });
