import { runExprBody } from "@builderpluss/engine/node";
const body = `
A = arange(4) / 3
B = min(A, 0.5)
C = max(0.2, A)
D = pow(A, 0.5)
E = where(gt(A, 0.5), A, fill(4,1,9))
F = shift(A, -1)
G = sortby(A, 0 - arange(4))
H = arclen(hcat(A, A))
I = resample(hcat(A, A * 0), 3)
K = kron(hcat(1,2), ones(2,1))
L = A * hcat(1,2)
M = sign(A - 0.4)
N = atan2(1, 1)
X = msweep(vcat(hcat(0.1,0), hcat(0,0.1), hcat(-0.1,0)), vcat(hcat(0,0,0), hcat(1,0,0), hcat(2,0,1)), 0)
nX = rows(X)
`;
const v = runExprBody(body, { PI: Math.PI });
for (const k of ["A","B","C","D","E","F","G","H","I","K","L","M","N","nX"]) console.log(k, JSON.stringify(v[k]));
console.log(JSON.stringify(v.X.slice(0,8)));
