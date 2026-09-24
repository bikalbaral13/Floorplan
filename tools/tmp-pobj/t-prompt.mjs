// Mirrors the prompt-builder branch in evaluateFlow.ts exactly.
const run = (params, vin) => {
  const dp = Math.max(0, Math.min(6, Math.round(Number(params.decimals ?? 2))));
  const bind = new Map();
  for (let i = 1; i <= 8; i++) {
    const name = String(params[`n${i}`] ?? "").trim();
    const v = vin[`v${i}`];
    if (!name || v == null) continue;
    const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);
    bind.set(name, n != null ? String(Number(n.toFixed(dp))) : String(v));
  }
  return String(params.template ?? "").replace(/\{([A-Za-z_][\w.-]*)\}/g, (whole, key) => bind.get(key) ?? whole);
};
const P = { template: "A {roomType} of {area} m2, {dimX} x {dimY} m. Door {doorWidth} m. Missing: {nope}. Literal {} and {9bad}.",
  n1: "area", n2: "dimX", n3: "dimY", n4: "roomType", n5: "doorWidth", decimals: 2 };
console.log("1 all wired :", run(P, { v1: 17.899999999999999, v2: 4.76, v3: 3.76, v4: "Bedroom", v5: "0.9" }));
console.log("2 one unwired:", run(P, { v1: 17.9, v2: 4.76, v3: 3.76, v4: "Bedroom" }));
console.log("3 decimals=0 :", run({ ...P, decimals: 0 }, { v1: 17.9, v2: 4.76, v3: 3.76, v4: "Bedroom", v5: 0.9 }));
console.log("4 empty tmpl :", JSON.stringify(run({ ...P, template: "" }, { v1: 1 })));
console.log("5 unnamed slot:", run({ template: "{area}", n1: "" }, { v1: 5 }));
