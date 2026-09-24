import { readFileSync } from "node:fs";
import { parse, freeVars } from "./parse.mjs";
const flow = JSON.parse(readFileSync(process.argv[2], "utf8"));
const body = flow.nodes.find((n) => n.id === "math").data.params.expr;
const props = flow.nodes.find((n) => n.id === "props").data.params.props;
const { parseExprStmts, runExprBody, liftScopeValue } = await import("@builderpluss/engine/node");
const stmts = parseExprStmts(body).filter((s) => s.kind === "def");
const scope = { PI: Math.PI };
for (const p of props) scope[p.id] = liftScopeValue(p.value);
scope.P = [[0, 0]]; scope.rotation = 0; scope.anchorDir = "Center"; scope.fitMode = "Off"; scope.margin = 0; scope.flipSide = false;
const numeric = runExprBody(body, scope);
const PLACE = ["rotation", "anchorDir", "fitMode", "margin", "flipSide"];
const constNames = new Set(["P", "PI", ...PLACE]);
for (const s of stmts) { const fv = [...freeVars(parse(s.expr))]; if (fv.every((v) => constNames.has(v))) constNames.add(s.name); }
console.log("CONST names:", [...constNames].filter(n=>!["P","PI",...PLACE].includes(n)).join(" "));
console.log("\nconst names whose numeric value is NOT a plain scalar (these lift to opaque):");
for (const n of constNames) {
  if (["P","PI",...PLACE].includes(n)) continue;
  const v = numeric[n];
  const scalar = typeof v === "number" || typeof v === "boolean" || typeof v === "string"
    || (Array.isArray(v) && v.length === 1 && Array.isArray(v[0]) && v[0].length === 1);
  if (!scalar) console.log(`  ${n} =`, JSON.stringify(v));
}
console.log("\nNON-const names (symbolic):", stmts.map(s=>s.name).filter(n=>!constNames.has(n)).join(" "));
