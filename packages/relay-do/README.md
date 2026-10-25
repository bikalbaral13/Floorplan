# @builderpluss/relay-do — realtime relay

A Cloudflare Worker with one Durable Object per relay session. It moves calls from the Vercel relay
(`server/relayCore.mjs`) or the local `floorplan-bridge` to the editor tab over WebSockets, and results back,
instead of the R2 `calls/` + `results/` queue. Plan: `docs/connector-realtime-plan.md`.

Session records, tokens, tickets, designs and the step gate stay in R2 / Vercel. When `RELAY_DO_*` is not set,
or the tab cannot open a socket, everything falls back to the long-poll relay unchanged.

## Local

```bash
cd packages/relay-do
npm install
echo RELAY_DO_SECRET=dev-secret > .dev.vars
npm run dev                       # http://127.0.0.1:8787
npm test                          # 11 checks: auth, round trip, agent socket, resume, TAB_CHANGED, end
```

Editor against it: launch config `dev-2502-relay` (sets `RELAY_DO_URL=http://127.0.0.1:8787`,
`RELAY_DO_SECRET=dev-secret`).

## Deploy (once)

```bash
cd packages/relay-do
npx wrangler login
npx wrangler secret put RELAY_DO_SECRET      # a long random string
npx wrangler deploy                          # prints https://bpluss-relay.<account>.workers.dev
```

Then in the Vercel project settings (Production + Preview), and redeploy:

| Variable | Value |
|---|---|
| `RELAY_DO_URL` | `https://bpluss-relay.<account>.workers.dev` |
| `RELAY_DO_SECRET` | the same secret |

Extra editor origins go in `ALLOWED_ORIGINS` in `wrangler.toml` (localhost and `floorplan-*.vercel.app` are
always allowed).

## Routes

| Route | Who | What |
|---|---|---|
| `GET /v1/tab/<sid>?t=fpt_…` (WebSocket) | editor tab | receives `cmd`, sends `hello` / `ping` / `result` |
| `GET /v1/agent/<sid>?t=fpa_…` (WebSocket) | local floorplan-bridge (`FP_BRIDGE_RELAY`, `FP_BRIDGE_TOKEN`) | sends `call`, receives `result` / `tab` |
| `POST /v1/room/<sid>/register \| call \| await \| end`, `GET …/state` | Vercel relay (`x-relay-secret`) | token hashes, one call held until its result, ticket wait, room state |
