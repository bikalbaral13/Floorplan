import { runExprBody } from "@builderpluss/engine/node";
const out = runExprBody(`
_rg = 0.03
_rn = 0.011
_ns = 14
_ratio = min(0.98, _rn / _rg)
_th0 = atan2(_ratio, sqrt(max(0.0001, 1 - _ratio * _ratio)))
c0 = cos(_th0)
_k = arange(_ns) + 1
_thk = _th0 + (PI - _th0) * _k / _ns
thk = _thk
ck = cos(_thk)
sk = sin(_thk)
th0 = _th0
ratio = _ratio
pival = PI
`, {});
console.log("ratio", out.ratio, "th0", out.th0, "c0", out.c0, "PI", out.pival);
console.log("thk", JSON.stringify(out.thk));
console.log("ck", JSON.stringify(out.ck));
