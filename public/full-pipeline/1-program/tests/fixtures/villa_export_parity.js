// usage: node villa_export_parity.js <core.js> <out.json>
const fs=require('fs'),crypto=require('crypto'),path=require('path');const V=require(path.resolve(process.argv[2]));
const base={option:'A',road_side:'N',mirror:'auto',plot_width_ft:30,plot_depth_ft:40,setback_front_ft:5,setback_rear_ft:3,setback_left_ft:3,setback_right_ft:2,porch_width_ft:11,front_band_ft:15,
 middle_band_ft:8,toilet_width_ft:4.5,kitchen_width_ft:10,attached_toilet_ft:5.5,master_width_ft:15,balcony_depth_ft:3,puja_ft:4,floor_height_ft:10.5,max_riser_in:7,tread_in:10,flight_width_ft:3.5,
 stair_first_flight:'W',stair_turn:'L',main_door_width_ft:3.5,main_door_pct:25};
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;const pick=a=>a[Math.floor(rnd()*a.length)];const between=(lo,hi,st)=>Math.round((lo+rnd()*(hi-lo))/st)*st;
const cases=[];
for(const opt of['A','B'])for(const road of['N','E','S','W'])for(const mir of['auto','no','yes'])cases.push(Object.assign({},base,{option:opt,road_side:road,mirror:mir}));
for(let i=0;i<24;i++)cases.push(Object.assign({},base,{option:pick(['A','B']),road_side:pick(['N','E','S','W']),mirror:pick(['auto','no','yes']),plot_width_ft:between(28,40,0.5),plot_depth_ft:between(38,55,0.5),
 setback_front_ft:between(4,8,0.5),setback_rear_ft:between(2,5,0.5),setback_left_ft:between(2,5,0.5),setback_right_ft:between(0,4,0.5),porch_width_ft:between(9.5,13,0.5),front_band_ft:between(14,18,0.5),
 middle_band_ft:between(7,10,0.5),toilet_width_ft:between(4,6,0.25),kitchen_width_ft:between(7,12,0.5),attached_toilet_ft:between(5,6.5,0.25),master_width_ft:between(12,18,0.5),balcony_depth_ft:between(0,4,0.5),
 puja_ft:pick([0,3,4,5]),floor_height_ft:between(9.5,11.5,0.25),max_riser_in:between(6,7.5,0.25),tread_in:between(9.5,11.5,0.5),flight_width_ft:between(3,4,0.25),stair_first_flight:pick(['W','E']),
 stair_turn:pick(['L','R']),main_door_width_ft:between(3,4,0.25),main_door_pct:between(0,100,5)}));
const out=cases.map(p=>{const r=V.villaGenerate(p);return{params:p,result:{mirror:r.mirror,vastu_score:r.vastu_score,total:r.total,far:r.far,
 rooms:Object.fromEntries(['GF','FF'].flatMap(lv=>r.rooms[lv].map(rm=>[lv+'-'+rm.code,rm.poly]))),doors:r.doors.map(d=>d.missing?{from:d.from,to:d.to,missing:true}:{from:d.from,to:d.to,kind:d.kind,a:d.a,b:d.b}),
 main_door:r.main_door,stair:{x:r.stair.x,y:r.stair.y,w:r.stair.w,h:r.stair.h,entryOK:r.stair.entryOK},warn:r.warn,warn2:r.warn2,qc_fails:V.villaQC(r).filter(x=>x.level==='fail').map(x=>x.check+':'+x.ref)}}});
const sha=crypto.createHash('sha256').update(fs.readFileSync(process.argv[2],'utf8').replace(/\r\n/g,'\n').replace(/\s+$/,'')).digest('hex');
fs.writeFileSync(process.argv[3],JSON.stringify({core_sha256:sha,cases:out}));console.log(out.length,'cases',sha.slice(0,12));
