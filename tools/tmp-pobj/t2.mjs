import { runExprBody } from "@builderpluss/engine/node";
// Q: n x 11 = [u1,v1,u2,v2,u3,v3,u4,v4,z0,z1,g]  -> general quad prism
const KERNEL = `
_nq = rows(Q)
_r4 = ones(4,1)
_a1 = col(Q,0)
_b1 = col(Q,1)
_a2 = col(Q,2)
_b2 = col(Q,3)
_a3 = col(Q,4)
_b3 = col(Q,5)
_a4 = col(Q,6)
_b4 = col(Q,7)
_z0 = col(Q,8)
_z1 = col(Q,9)
_gq = kron(col(Q,10), _r4)
_fq = kron(arange(_nq), _r4) * 6
_q0 = hcat(reshape(hcat(_a1,_b1,_z0,_a2,_b2,_z0,_a3,_b3,_z0,_a4,_b4,_z0), 4*_nq, 3), _fq + 0, _gq)
_q1 = hcat(reshape(hcat(_a1,_b1,_z1,_a2,_b2,_z1,_a3,_b3,_z1,_a4,_b4,_z1), 4*_nq, 3), _fq + 1, _gq)
_q2 = hcat(reshape(hcat(_a1,_b1,_z0,_a2,_b2,_z0,_a2,_b2,_z1,_a1,_b1,_z1), 4*_nq, 3), _fq + 2, _gq)
_q3 = hcat(reshape(hcat(_a2,_b2,_z0,_a3,_b3,_z0,_a3,_b3,_z1,_a2,_b2,_z1), 4*_nq, 3), _fq + 3, _gq)
_q4 = hcat(reshape(hcat(_a3,_b3,_z0,_a4,_b4,_z0,_a4,_b4,_z1,_a3,_b3,_z1), 4*_nq, 3), _fq + 4, _gq)
_q5 = hcat(reshape(hcat(_a4,_b4,_z0,_a1,_b1,_z0,_a1,_b1,_z1,_a4,_b4,_z1), 4*_nq, 3), _fq + 5, _gq)
_FL = vcat(_q0,_q1,_q2,_q3,_q4,_q5)
_PL = hcat(reshape(hcat(_a1,_b1,_a2,_b2,_a3,_b3,_a4,_b4), 4*_nq, 2), kron(arange(_nq), _r4), _gq)
nf = rows(_FL)
np = rows(_PL)
FL = _FL
PL = _PL
`;
// one unit box + one rotated blade
const Q = [
  [0,0, 1,0, 1,2, 0,2, 0,3, 1],
  [0,0, 1,1, 0,2, -1,1, 5,6, 2],
];
const out = runExprBody(KERNEL, { Q });
console.log("faces rows", out.nf, "plan rows", out.np);
console.log("FL head:", JSON.stringify(out.FL.slice(0,8)));
console.log("PL:", JSON.stringify(out.PL));
// group ids present
console.log("groups:", [...new Set(out.FL.map(r=>r[4]))]);
console.log("faceIdx:", [...new Set(out.FL.map(r=>r[3]))].sort((a,b)=>a-b));
