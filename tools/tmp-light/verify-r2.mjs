/** Round-trip: read every lighting object and lamp back OUT of the bucket and re-check it there.
 *  What was built locally is not what matters — what the app and the transpiler will fetch is. */
import { getObjectText, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { validateFlow, propsOf } from "./validate-flow.mjs";

const OBJS = ["light", "led-strip", "downlight", "pendant", "chandelier", "light-bulb", "floor-lamp",
              "outdoor-light", "mirror", "false-ceiling", "light-panel", "cove-light", "linear-profile",
              "daylight-portal", "track", "track-head", "wall-washer", "lighting-layout", "render-look"];

const lamps = await listObjectsDetailed(cfg, "library/Photometry/");
const lampKeys = new Set(lamps.map((l) => l.key.replace("library/", "")));
console.log(`Photometry: ${lamps.length} lamp files in the bucket`);

let bad = 0;
for (const n of OBJS) {
  const r = await getObjectText(cfg, `library/Objects/Architectural/${n}.json`);
  let flow;
  try { flow = JSON.parse(r.text); } catch (e) { bad++; console.log(`FAIL ${n}  unparseable`); continue; }
  const { problems, metrics } = validateFlow(flow);
  const lampPath = propsOf(flow).find((p) => p.id === "lamp")?.value ?? "";
  const lampOk = !lampPath || lampKeys.has(lampPath);
  const probs = problems.filter((p) => !/_ax|_ay/.test(p)); // chandelier's pre-existing name reuse
  if (probs.length || !lampOk) {
    bad++;
    console.log(`FAIL ${n}${lampOk ? "" : `  lamp not in the bucket: ${lampPath}`}`);
    probs.slice(0, 5).forEach((p) => console.log("      - " + p));
    continue;
  }
  const lm = metrics["Dimmed output (lm)"];
  console.log(`ok   ${n.padEnd(17)} ${String(flow.object.hostKind).padEnd(8)} ${String(propsOf(flow).length).padStart(2)}p  ` +
              `${lm === undefined ? "—".padStart(8) : lm.toFixed(0).padStart(6) + " lm"}  ${lampPath}`);
}
console.log(`\n${OBJS.length - bad} verified in R2, ${bad} with problems`);
process.exit(bad ? 1 : 0);
