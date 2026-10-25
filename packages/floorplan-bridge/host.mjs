// floorplan-bridge sub-commands that use the realtime relay (packages/relay-node or relay-do).
//
//   floorplan-bridge pair <CODE> [--editor https://…]   trade the code Connect Claude shows for a bridge token,
//                                                        saved to ~/.builderpluss/floorplan-bridge.json
//   floorplan-bridge host                               "Claude inside the canvas": wait for prompts typed in
//                                                        the editor's Claude panel, run them through headless
//                                                        Claude Code, stream the output back to the panel
//
// Both connect OUTBOUND to the relay; the browser never reaches this machine.
//
// Host safety: Claude runs with ONLY the floorplan tools allowed (`--allowedTools mcp__floorplan`, strict MCP
// config) in an empty working folder, so a prompt from the canvas cannot read or change files on this machine
// or run commands. It uses the Claude Code login already on this machine; the bridge never sees credentials.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const CFG_DIR = path.join(os.homedir(), ".builderpluss");
const CFG_FILE = path.join(CFG_DIR, "floorplan-bridge.json");
const DEFAULT_EDITOR = "https://floorplan-indol.vercel.app";
const BRIDGE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "floorplan-bridge.mjs");
const log = (s) => process.stderr.write(`[floorplan-bridge] ${s}\n`);

/** The saved pairing, or null when there is none or it expired. */
export function loadSaved() {
  try {
    const c = JSON.parse(fs.readFileSync(CFG_FILE, "utf8"));
    if (!c?.relay || !c?.token) return null;
    if (c.expiresAt && Date.now() > c.expiresAt) return null;
    return c;
  } catch { return null; }
}
/** Relay + token: env first (FP_BRIDGE_RELAY / FP_BRIDGE_TOKEN), else the saved pairing. */
export function relayCredentials() {
  const relay = String(process.env.FP_BRIDGE_RELAY || "").trim().replace(/\/+$/, "");
  const token = String(process.env.FP_BRIDGE_TOKEN || "").trim();
  if (relay && token) return { relay, token, source: "env" };
  const saved = loadSaved();
  return saved ? { relay: saved.relay, token: saved.token, source: "saved", editor: saved.editor } : null;
}

export async function main(sub, args) {
  if (sub === "pair") return pair(args);
  if (sub === "host") return host(args);
}

/* ── pair ───────────────────────────────────────────────────────────────────────────────────────────── */
async function pair(args) {
  const code = (args.find((a) => !a.startsWith("--")) ?? "").trim();
  const i = args.indexOf("--editor");
  const editor = (i >= 0 ? args[i + 1] : process.env.FP_BRIDGE_EDITOR || DEFAULT_EDITOR).replace(/\/+$/, "");
  if (!code) { log("usage: floorplan-bridge pair <CODE> [--editor https://…]   (the code Connect Claude shows)"); process.exitCode = 2; return; }
  let r, j;
  try {
    r = await fetch(`${editor}/__relay/bridge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    j = await r.json().catch(() => ({}));
  } catch (e) { log(`could not reach ${editor}: ${e.message}`); process.exitCode = 1; return; }
  if (!r.ok || !j.ok) { log(`pairing failed: ${j.error || `HTTP ${r.status}`}`); process.exitCode = 1; return; }
  fs.mkdirSync(CFG_DIR, { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify({ relay: j.relay, token: j.token, sessionId: j.sessionId, expiresAt: j.expiresAt, editor, pairedAt: Date.now() }, null, 2), { mode: 0o600 });
  log(`paired with the editor (session ${j.sessionId}, valid until ${new Date(j.expiresAt).toLocaleString()}).`);
  log(`saved to ${CFG_FILE}`);
  log(`next:  floorplan-bridge host     — Claude answers prompts typed in the editor's Claude panel`);
  log(`  or:  claude mcp add floorplan -- npx -y @builderpluss/floorplan-bridge     — Claude Code drives the canvas`);
}

/* ── host: Claude inside the canvas ─────────────────────────────────────────────────────────────────── */
/** How to start Claude Code without a shell (a .cmd shim would mangle the JSON arguments). */
function claudeCommand() {
  if (process.env.CLAUDE_CLI) {
    const p = process.env.CLAUDE_CLI;
    return /\.(c?m?js)$/i.test(p) ? [process.execPath, [p]] : [p, []];
  }
  const candidates = [];
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"));
  candidates.push(path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude"));
  for (const c of candidates) if (fs.existsSync(c)) return c.endsWith(".js") ? [process.execPath, [c]] : [c, []];
  return ["claude", []];
}

const SYSTEM_PROMPT = [
  "You are Claude inside the BuilderPluss floorplan editor. The user is typing to you from the editor's Claude panel and watching the canvas.",
  "Act on the canvas ONLY through the floorplan MCP tools (grouped tools with an `op`; call a group with op \"describe_ops\" to see its arguments).",
  "Coordinates are metres. Load objects (import_objects) before placing doors, windows or furniture.",
  "Keep replies short: say what you did on the canvas, and ask before large or destructive changes such as clearing the canvas.",
].join(" ");

async function host() {
  const cred = relayCredentials();
  if (!cred) { log("not paired — run: floorplan-bridge pair <CODE>   (the code Connect Claude shows in the editor)"); process.exitCode = 2; return; }
  if (typeof WebSocket === "undefined") { log("needs Node 22+ (global WebSocket)"); process.exitCode = 2; return; }
  const m = /^fpa_([A-Za-z0-9]{10,40})_/.exec(cred.token);
  if (!m) { log("the saved token is not a bridge token — pair again"); process.exitCode = 2; return; }
  const url = `${cred.relay}/v1/agent/${m[1]}?t=${encodeURIComponent(cred.token)}`;
  const agentId = `host-${crypto.randomUUID()}`;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "bpluss-claude-"));
  const mcpConfig = path.join(workDir, "mcp.json");
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { floorplan: { command: process.execPath, args: [BRIDGE_SCRIPT],
    env: { FP_BRIDGE_RELAY: cred.relay, FP_BRIDGE_TOKEN: cred.token, FP_BRIDGE_NO_HTTP: "1" } } } }));
  const [claudeBin, claudePre] = claudeCommand();
  log(`Claude Code: ${[claudeBin, ...claudePre].join(" ")}`);

  let ws = null, failures = 0;
  const send = (msg) => { try { ws?.send(JSON.stringify(msg)); return true; } catch { return false; } };
  const emit = (conv, event) => send({ type: "chat_event", conv, event });

  /** conv id → { proc, buf, busy } — one long-lived Claude process per conversation. */
  const convs = new Map();
  const endConv = (conv, why) => {
    const c = convs.get(conv);
    if (!c) return;
    convs.delete(conv);
    try { c.proc.kill(); } catch { /* gone */ }
    if (why) emit(conv, { type: "ended", reason: why });
  };
  const startConv = (conv) => {
    // Locked down: no built-in tools at all (`--tools ""`: no Bash, Read, Edit, web…), only the floorplan MCP
    // server, and anything not allowed is refused without asking (dontAsk) — a canvas prompt can only draw.
    const args = [...claudePre, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--include-partial-messages", "--mcp-config", mcpConfig, "--strict-mcp-config", "--tools", "",
      "--allowedTools", "mcp__floorplan", "--permission-mode", "dontAsk", "--append-system-prompt", SYSTEM_PROMPT];
    // Wait for the floorplan server before the first turn and list its tools up front (no deferred tool search):
    // otherwise Claude starts while the server is still connecting and goes looking for tools that are not there.
    const env = { ...process.env, ENABLE_TOOL_SEARCH: "false", MCP_CONNECTION_NONBLOCKING: "false", MCP_TIMEOUT: process.env.MCP_TIMEOUT || "30000" };
    const proc = spawn(claudeBin, args, { cwd: workDir, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const c = { proc, buf: "", busy: false, err: "" };
    convs.set(conv, c);
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      c.buf += chunk;
      let nl;
      while ((nl = c.buf.indexOf("\n")) >= 0) {
        const line = c.buf.slice(0, nl).trim(); c.buf = c.buf.slice(nl + 1);
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        for (const out of translate(ev)) { if (out.type === "done") c.busy = false; emit(conv, out); }
      }
    });
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (d) => { c.err = (c.err + d).slice(-2000); });
    proc.on("exit", (code) => {
      if (convs.get(conv) !== c) return;      // ended on purpose
      convs.delete(conv);
      emit(conv, { type: "error", message: `Claude stopped (exit ${code}). ${c.err.trim().split("\n").slice(-3).join(" ")}`.trim() });
    });
    proc.on("error", (e) => { convs.delete(conv); emit(conv, { type: "error", message: `could not start Claude Code (${e.message}) — is it installed and signed in? Set CLAUDE_CLI to its path if it is elsewhere.` }); });
    return c;
  };

  const onChat = (msg) => {
    const conv = typeof msg.conv === "string" && msg.conv ? msg.conv.slice(0, 64) : "default";
    if (msg.op === "stop") { endConv(conv, "stopped"); return; }
    if (msg.op === "reset") { endConv(conv, "reset"); return; }
    if (msg.op !== "prompt" || typeof msg.text !== "string" || !msg.text.trim()) return;
    const c = convs.get(conv) ?? startConv(conv);
    if (c.busy) { emit(conv, { type: "error", message: "Claude is still working on the last message — wait, or press Stop." }); return; }
    c.busy = true;
    emit(conv, { type: "user", text: msg.text });
    c.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: msg.text.slice(0, 20_000) }] } }) + "\n");
  };

  const connect = () => {
    let opened = false, beat = null;
    ws = new WebSocket(url);
    ws.onopen = () => {
      opened = true; failures = 0;
      send({ type: "hello", agent: agentId, chatHost: true });
      beat = setInterval(() => send({ type: "ping" }), 15_000);
      log("hosting Claude for the editor — type in the editor's Claude panel. Ctrl+C to stop.");
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === "chat") onChat(msg);
    };
    ws.onclose = (ev) => {
      if (beat) clearInterval(beat);
      if (ev.code === 4001) { log("the editor session ended — pair again with a new code"); process.exit(1); }
      if (!opened) failures++;
      if (failures === 3) log("cannot reach the relay (pairing expired, or offline) — still retrying");
      setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(failures, 5)));
    };
    ws.onerror = () => { /* onclose follows */ };
  };
  connect();
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const k of [...convs.keys()]) endConv(k); process.exit(0); });
  await new Promise(() => {});   // run until stopped
}

/** Claude Code stream-json → the small events the panel renders. */
function translate(ev) {
  const out = [];
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  if (ev.type === "system" && ev.subtype === "init") {
    const n = (ev.tools ?? []).filter((t) => t.startsWith("mcp__floorplan")).length;
    out.push({ type: "ready", model: ev.model ?? null, tools: n });
    if (!n) out.push({ type: "error", message: `the floorplan tools did not load (MCP: ${JSON.stringify(ev.mcp_servers ?? [])}) — Claude cannot draw this turn` });
  }
  else if (ev.type === "stream_event" && ev.event?.type === "content_block_delta" && ev.event.delta?.type === "text_delta") out.push({ type: "text_delta", text: ev.event.delta.text });
  else if (ev.type === "assistant") {
    for (const b of ev.message?.content ?? []) {
      if (b.type === "tool_use") out.push({ type: "tool_use", id: b.id, name: String(b.name).replace(/^mcp__floorplan__/, ""), input: clip(JSON.stringify(b.input ?? {}), 300) });
      if (b.type === "text") out.push({ type: "text", text: b.text });
    }
  } else if (ev.type === "user") {
    for (const b of ev.message?.content ?? []) {
      if (b.type !== "tool_result") continue;
      const text = Array.isArray(b.content) ? b.content.map((x) => x.text ?? "").join(" ") : String(b.content ?? "");
      out.push({ type: "tool_result", id: b.tool_use_id, ok: !b.is_error, text: clip(text, 300) });
    }
  } else if (ev.type === "result") {
    const text = typeof ev.result === "string" ? ev.result : "";
    // Account problems come back as a "successful" one-line result; show them as the error they are.
    const accountProblem = /credit balance is too low|invalid api key|please run \/login|not logged in/i.test(text);
    out.push({ type: "done", ok: ev.subtype === "success" && !ev.is_error && !accountProblem,
      text: accountProblem ? `Claude Code on the bridge computer: "${text}" — check that machine's Claude login / credit.` : text,
      durationMs: ev.duration_ms ?? null, costUsd: ev.total_cost_usd ?? null });
  }
  return out;
}
