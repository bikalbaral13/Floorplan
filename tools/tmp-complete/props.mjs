import { cfg } from "./r2cfg.mjs"; import { getObjectText } from "../r2.mjs";
for (const k of process.argv.slice(2)) {
  const { text } = await getObjectText(cfg, `library/Objects/${k}.json`, 5e7); const o = JSON.parse(text);
  const p = o.nodes.find((n) => n.data?.tool === "input-props")?.data.params.props || [];
  console.log(k, "::", p.map((q) => `${q.id}=${JSON.stringify(q.value)}${q.options ? "{" + q.options.join("/") + "}" : ""}`).join(" "));
}
