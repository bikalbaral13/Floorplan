import { runExprBody } from "@builderpluss/engine/node";
import { decodeCanvasJson } from "./decode.mjs";
import { FRAME_BODY, ANALYSES } from "../frame-body.mjs";
const nodes={N1:[0,0],N2:[0,4],N3:[6,4],N4:[6,0]};
const sup={N1:[true,true,true],N4:[true,true,true]};
const payload={units:'m',scoped:false,spaces:[],
 nodes:Object.keys(nodes).map(n=>({id:n,at:[nodes[n][0],-nodes[n][1]],objectId:'frame-joint-with-math',
   params:{fixX:(sup[n]||[0,0,0])[0],fixY:(sup[n]||[0,0,0])[1],fixR:(sup[n]||[0,0,0])[2],Fx:n==='N2'?30:0,Fy:0,Mz:0}})),
 segments:[['C1','N1','N2','col'],['B1','N2','N3','bm'],['C2','N4','N3','col']].map(([id,i,j,s])=>({
   id,type:s,from:[nodes[i][0],-nodes[i][1]],to:[nodes[j][0],-nodes[j][1]],
   lengthM:1,thicknessM:0.3,objectId:s==='col'?'frame-column-with-math':'frame-beam-with-math',
   params:{E:25,b:300,h:s==='col'?300:500,udl:s==='bm'?20:0,releaseStart:false,releaseEnd:false,density:25,selfWeight:false}}))};
const dec=decodeCanvasJson({json:JSON.stringify(payload),typeNames:['frame-beam','frame-column','frame-joint'],
  nodeParams:['fixX','fixY','fixR','Fx','Fy','Mz'],segParams:['E','b','h','udl','releaseStart','releaseEnd','density','selfWeight']});
const scope={PI:Math.PI}; for(const [k,v] of Object.entries(dec)) scope[k]= typeof v==='string'?JSON.parse(v):v;
Object.assign(scope,{run:1,analysis:ANALYSES[0],pdeltaIters:8,loadFactor:1,stiffnessFactor:1,deflectionLimit:250,driftLimit:500});
const extra = process.argv.slice(2);
const probe = FRAME_BODY + "\n" + extra.map((e,i)=>`PB${i} = ${e}`).join("\n");
const r = runExprBody(probe, scope); const o = r?.scope ?? r;
extra.forEach((e,i)=>console.log(String(i).padStart(2), e.padEnd(28), JSON.stringify(o[`PB${i}`]).slice(0,240)));
