// Engine side of the parity check: every spine object resolved by the app's own resolveSpineObject.
// node node_modules/jiti/bin/jiti.js packages/pyobject/parity/engine_dump.ts <src dir> <out dir>   (MAX_CASES=24)
// One JSON per object in <out dir>, keyed by its path relative to <src dir> ("/" → "__").
import fs from "node:fs";
import path from "node:path";
import { resolveSpineObject, parseSpineObject, spineParams } from "../../../src/floorplan/flow/eval/spineObject";

const [src, out] = process.argv.slice(2);
export const HOSTS: Record<string, { x: number; y: number }[]> = {
  node: [{ x: 0, y: 0 }],
  segment: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
  space: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }],
};
const MAX = Number(process.env.MAX_CASES || 24);
fs.mkdirSync(out, { recursive: true });
let count = 0;
const walk = (d: string) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { walk(p); continue; }
    if (!f.endsWith(".json")) continue;
    const text = fs.readFileSync(p, "utf8");
    const sp = parseSpineObject(text);
    if (!sp) continue;
    const host = HOSTS[sp.object.hostKind] ?? HOSTS.node;
    const cases: Record<string, unknown>[] = [{}];
    for (const prm of spineParams(sp)) {
      if (prm.kind === "number" && typeof prm.min === "number" && typeof prm.max === "number") cases.push({ [prm.key]: prm.min }, { [prm.key]: prm.max });
      else if (prm.kind === "select") for (const o of prm.options ?? []) if (o.value !== prm.default) cases.push({ [prm.key]: o.value });
      else if (prm.kind === "checkbox") cases.push({ [prm.key]: !prm.default });
    }
    const rel = path.relative(src, p).split(path.sep).join("/");
    const result = cases.slice(0, MAX).map((ov) => {
      const t0 = Date.now();
      try {
        const r = resolveSpineObject(text, { x: 0, y: 0 }, 1, Object.keys(ov).length ? ov : undefined, host);
        return r ? {
          overrides: ov, ms: Date.now() - t0,
          fill: r.geometry.fill.map((ring) => ring.map((q) => [q.x, q.y])),
          meshes: r.meshes.map((m) => ({ name: m.name, faces: m.faces })),
          stats: r.outputs.declared.map((d) => [d.name, d.value]),
          host: host.map((q) => [q.x, q.y]),
        } : { overrides: ov, null: true };
      } catch (e) { return { overrides: ov, error: String(e) }; }
    });
    fs.writeFileSync(path.join(out, rel.split("/").join("__")), JSON.stringify(result)); count++;
  }
};
walk(src);
console.log(`engine: ${count} objects → ${out}`);
