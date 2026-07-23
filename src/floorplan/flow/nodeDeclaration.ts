/** Node-declaration loader (prototype) — builds a live {@link FlowToolDef} from a DATA declaration file
 *  (see ./declarations/*.node.json), the way a `.pobj.json` builds a parametric object. The declaration is
 *  the single source of truth for a node's INTERFACE — its param schema (kind / min / max / step / options /
 *  unit), conditional visibility (`showWhen`), handle set, and usage `instructions`. The node's BEHAVIOUR
 *  (the algorithm) stays in code, dispatched by `tool` id in evaluateFlow — that's the one part a data file
 *  can't own, i.e. the "render engine".
 *
 *  Conditional logic (`showWhen`, `handles.outputCount`) is expressed as EXPRESSION STRINGS over the node's
 *  params + `vars`, evaluated by the same safe engine the parametric objects use (see ./eval/expr) — so a
 *  data file reproduces the exact `showIf`/`outputCount` FUNCTIONS the hand-written FLOW_TOOLS entry had. */
import type { FlowToolDef, ParamField, FlowToolType } from "./flowTypes";
import { evalNum, evalRaw, evalTruthy, type Scope } from "./eval/expr";

/** One parameter's full declaration — mirrors {@link ParamField} but with `default` (baked into
 *  `defaultParams`) and `showWhen` (a predicate STRING compiled into `showIf`). */
export interface NodeParamDecl {
  key: string;
  label: string;
  kind: ParamField["kind"];
  default?: unknown;
  options?: { value: string; label: string }[];
  optionsFromParam?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  /** `textarea` only — visible row count (default 3). */
  rows?: number;
  secret?: boolean;
  output?: boolean;
  role?: string;
  /** Show this field only when this expression (over params + vars) is truthy. Omitted → always shown. */
  showWhen?: string;
}

/** A complete node declaration file. `tool` keys the code kernel; everything else is interface data. */
export interface NodeDeclaration {
  kind?: string;
  version?: number;
  tool: string;
  meta: { label: string; category?: string; color: string };
  description?: string;
  instructions?: string;
  /** This node outputs real Space polygon(s) → eligible for Flow "Live" materialisation (see FlowToolDef). */
  materialisesSpace?: boolean;
  /** This node outputs real SEGMENT geometry (open strokes) → Live materialises it as walls (see FlowToolDef). */
  materialisesSegments?: boolean;
  handles?: {
    input?: boolean;
    output?: boolean;
    /** Expression over params + vars → number of geometry output handles. Omitted → (output ? 1 : 0). */
    outputCount?: string;
    outputLabels?: string[];
    valueInputs?: { key: string; label: string }[];
    valueOutputs?: { key: string; label: string; unit?: string; alignField?: string }[];
    geomInputs?: { key: string; label: string }[];
    exposesParams?: boolean;
    acceptsParams?: boolean;
  };
  /** Named intermediate expressions (e.g. `isRect`), evaluated in order into the scope BEFORE `showWhen` /
   *  `outputCount` — exactly like a `.pobj` `vars` block. Keeps per-field predicates short + readable. */
  vars?: Record<string, string>;
  parameters: NodeParamDecl[];
  /** Extra default-param entries NOT represented as a visible `parameters` field (e.g. a File Upload's
   *  `path` / `fileName`, or a node's baked non-field state). Merged into `defaultParams` after the
   *  per-parameter defaults (so it can also override them). */
  defaults?: Record<string, unknown>;
}

/** Flatten the node's live params into an expression scope, then evaluate `vars` on top (in order). */
const buildScope = (params: Record<string, unknown>, vars?: Record<string, string>): Scope => {
  const sc: Scope = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") sc[k] = v;
    else if (v != null) sc[k] = String(v);
  }
  if (vars) for (const [k, expr] of Object.entries(vars)) sc[k] = evalRaw(expr, sc);
  return sc;
};

/** Build a live {@link FlowToolDef} from a declaration. The runtime shape is identical to a hand-written
 *  FLOW_TOOLS entry, so nothing downstream (rendering, compile, eval, the agent catalog) needs to change. */
export function buildToolDefFromDeclaration(decl: NodeDeclaration): FlowToolDef {
  const vars = decl.vars;
  const fields: ParamField[] = decl.parameters.map((p) => {
    const field: ParamField = { key: p.key, label: p.label, kind: p.kind };
    if (p.options) field.options = p.options;
    if (p.optionsFromParam) field.optionsFromParam = p.optionsFromParam;
    if (p.min != null) field.min = p.min;
    if (p.max != null) field.max = p.max;
    if (p.step != null) field.step = p.step;
    if (p.unit != null) field.unit = p.unit;
    if (p.placeholder != null) field.placeholder = p.placeholder;
    if (p.rows != null) field.rows = p.rows;
    if (p.secret) field.secret = true;
    if (p.output) field.output = true;
    if (p.role != null) field.role = p.role;
    if (p.showWhen) {
      const expr = p.showWhen;
      field.showIf = (params) => evalTruthy(expr, buildScope(params, vars));
    }
    return field;
  });

  const defaultParams: Record<string, unknown> = {};
  for (const p of decl.parameters) if (p.default !== undefined) defaultParams[p.key] = p.default;
  if (decl.defaults) Object.assign(defaultParams, decl.defaults);

  const h = decl.handles ?? {};
  const def: FlowToolDef = {
    type: decl.tool as FlowToolType,
    label: decl.meta.label,
    color: decl.meta.color,
    hasInput: Boolean(h.input),
    hasOutput: Boolean(h.output),
    defaultParams,
    fields,
    hint: decl.description ?? "",
  };
  if (decl.instructions) def.instructions = decl.instructions;
  if (decl.materialisesSpace) def.materialisesSpace = true;
  if (decl.materialisesSegments) def.materialisesSegments = true;
  if (h.outputCount) {
    const expr = h.outputCount;
    def.outputCount = (params) => Math.max(0, Math.round(evalNum(expr, buildScope(params, vars))));
  }
  if (h.outputLabels) def.outputLabels = h.outputLabels;
  if (h.valueOutputs) def.valueOutputs = h.valueOutputs;
  if (h.valueInputs) def.valueInputs = h.valueInputs;
  if (h.geomInputs) def.geomInputs = h.geomInputs;
  if (h.exposesParams) def.exposesParams = true;
  if (h.acceptsParams) def.acceptsParams = true;
  return def;
}
