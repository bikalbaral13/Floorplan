/** Evaluate a Dynamic Component formula. Shared by the verifier (which checks the emitted formulas
 *  against the bake) and by the emitter (which needs each part's value at the defaults, so the component
 *  is the right shape the instant it lands and not only after the DC engine's first redraw).
 */
import { parse } from "./parse.mjs";

export const M2IN = 39.37007874015748;
const TOL = 1e-6; // metres — far under anything the geometry distinguishes

// ── evaluate one DC formula ───────────────────────────────────────────────────────────────────────
/** DC writes equality as a single `=` and inequality as `<>`; everything else matches the parser's grammar. */
function toParserSyntax(f) {
  return f.replace(/^=/, "").replace(/Parent!/g, "").replace(/<>/g, "!=").replace(/([^<>!=])=([^=])/g, "$1==$2");
}

export const FN = {
  IF: (c, a, b) => (c ? a : b),
  AND: (...a) => (a.every(Boolean) ? 1 : 0),
  OR: (...a) => (a.some(Boolean) ? 1 : 0),
  MIN: Math.min, MAX: Math.max, ABS: Math.abs, ROUND: Math.round,
  FLOOR: Math.floor, CEILING: Math.ceil, SQRT: Math.sqrt,
};

export function evalNode(n, env) {
  switch (n.t) {
    case "num": return n.v;
    case "str": return n.v;
    case "var": {
      if (!(n.name in env)) throw new Error(`DC formula reads unknown attribute ${n.name}`);
      return env[n.name];
    }
    case "un": return n.op === "-" ? -evalNode(n.a, env) : (evalNode(n.a, env) ? 0 : 1);
    case "if": return evalNode(n.c, env) ? evalNode(n.a, env) : evalNode(n.b, env);
    case "call": {
      const f = FN[n.fn.toUpperCase()];
      if (!f) throw new Error(`no such DC function ${n.fn}()`);
      return f(...n.args.map((a) => evalNode(a, env)));
    }
    case "bin": {
      const a = evalNode(n.a, env), b = evalNode(n.b, env);
      switch (n.op) {
        case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b;
        case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0;
        case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
        case "&&": return a && b ? 1 : 0; case "||": return a || b ? 1 : 0;
      }
      throw new Error(`op ${n.op}`);
    }
    default: throw new Error(`node ${n.t}`);
  }
}
export const evalFormula = (f, env) => evalNode(parse(toParserSyntax(f)), env);

