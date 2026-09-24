/** Push a built plan into the LIVE editor tab. Run: node tools/scribbleplan/push.mjs [model.json]
 *
 *  The MCP bridge exposes the same command queue over `POST /enqueue` as it does over stdio, so a
 *  model on disk can be applied without the file passing through the agent's context. Any bridge
 *  tool can be driven this way — `node push.mjs --tool list_spaces` reads the result back.
 */
import fs from "node:fs";
import { toModel } from "./toModel.mjs";

const PORT = Number(process.env.FP_BRIDGE_PORT || 41414);

export async function call(tool, args = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/enqueue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "bridge command failed");
  return json.result;
}

if (process.argv[1]?.endsWith("push.mjs")) {
  const argv = process.argv.slice(2);
  const toolIdx = argv.indexOf("--tool");
  if (toolIdx >= 0) {
    const out = await call(argv[toolIdx + 1], argv[toolIdx + 2] ? JSON.parse(argv[toolIdx + 2]) : {});
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1).slice(0, 8000));
  } else {
    const src = argv[0] ?? "tools/scribbleplan/scribble-house.json";
    const raw = JSON.parse(fs.readFileSync(src, "utf8"));
    const model = raw.walls ? raw : toModel(raw);
    await call("import_objects", {});
    const out = await call("apply_model", { model });
    console.log(`applied ${src} → ${typeof out === "string" ? out : JSON.stringify(out)}`);
  }
}
