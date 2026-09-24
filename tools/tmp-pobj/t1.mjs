import { runExprBody } from "@builderpluss/engine/node";
const body = `
_n = rows(B)
_r4 = ones(4,1)
X0 = col(B,0)
Y0 = col(B,1)
Z0 = col(B,2)
X1 = col(B,3)
Y1 = col(B,4)
Z1 = col(B,5)
_gi = kron(arange(_n), _r4) * 6
_bot = hcat(reshape(hcat(X0,Y0,Z0,X1,Y0,Z0,X1,Y1,Z0,X0,Y1,Z0), 4*_n, 3), _gi + 0)
_top = hcat(reshape(hcat(X0,Y0,Z1,X1,Y0,Z1,X1,Y1,Z1,X0,Y1,Z1), 4*_n, 3), _gi + 1)
Solid = vcat(_bot,_top)
nrows = rows(Solid)
`;
const B = [[0,0,0, 1,2,3],[10,10,0, 11,12,1]];
const out = runExprBody(body, { B });
console.log(Object.keys(out));
console.log("nrows", out.nrows);
console.log(JSON.stringify(out.Solid));
