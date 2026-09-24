import { runExprBody } from "@builderpluss/engine/node";
const body = `
_rb = 0.013
_rg = 0.03
_rn = 0.011
_hb = 0.028
_hn = 0.014
_hg = 0.058
_ns = 14
_ratio = min(0.98, _rn / _rg)
_th0 = atan2(_ratio, sqrt(max(0.0001, 1 - _ratio * _ratio)))
_k = arange(_ns) + 1
_thk = _th0 + (PI - _th0) * _k / _ns
_rk = _rg * sin(_thk)
_tk = _hb + _hn + _hg * (cos(_th0) - cos(_thk)) / (cos(_th0) + 1)
_prof = vcat(hcat(0,0), hcat(0,_rb), hcat(_hb,_rb), hcat(_hb + _hn, _rn), hcat(_tk, _rk))
_seg = hcat(0, 0, 2.4, 0, 0, 3.4)
Glass = mlathe(_seg, _prof, 20)
nprof = rows(_prof)
nf = rows(Glass)
prof = _prof
`;
const out = runExprBody(body, {});
console.log("profile rows", out.nprof);
console.log("profile", JSON.stringify(out.prof));
console.log("mesh rows", out.nf, "cols", out.Glass?.[0]?.length);
const M = out.Glass;
if (M && M.length) {
  const z = M.map(r=>r[2]);
  const r = M.map(r=>Math.hypot(r[0],r[1]));
  console.log("z range", Math.min(...z).toFixed(4), Math.max(...z).toFixed(4));
  console.log("max radius", Math.max(...r).toFixed(4));
  console.log("faces", new Set(M.map(r=>r[3])).size);
}
