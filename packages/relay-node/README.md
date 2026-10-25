# @builderpluss/relay-node — realtime relay without Cloudflare

The same relay room as `packages/relay-do` (it imports `relay-do/src/room.js`), hosted by a plain Node
server. Same routes and protocol, so **nothing else changes**: Vercel points `RELAY_DO_URL` at this server
instead of a workers.dev URL.

Needs a host that keeps **one** process running and allows WebSockets. Vercel functions cannot. R2 keys are
not needed here: the relay holds nothing in R2.

## Run locally

```bash
cd packages/relay-node
npm install
RELAY_DO_SECRET=dev-secret npm start          # http://127.0.0.1:8787/health → "host":"node"
npm test                                      # the 12 room checks, against this server
```

Editor against it: launch config `dev-2502-relay`.

## Environment

| Variable | Default | |
|---|---|---|
| `RELAY_DO_SECRET` | — (required) | shared with Vercel's `RELAY_DO_SECRET` |
| `PORT` | `8787` | most hosts set this for you |
| `ALLOWED_ORIGINS` | `https://floorplan-indol.vercel.app` | extra editor origins; localhost and `floorplan-*.vercel.app` always allowed |
| `RELAY_DATA_DIR` | `./data` | rooms are saved here (`rooms.json`) so a restart resumes them; `""` = memory only |

Run **one instance only**: rooms live in the process memory.

## Deploy (pick one host)

Any of these works; each needs its own sign-in. The Docker image builds from the `packages/` folder:

```bash
docker build -f packages/relay-node/Dockerfile -t bpluss-relay packages
```

- **Render** — one-click Blueprint (`render.yaml`), steps in [RENDER.md](RENDER.md). Or by hand: New ▸ Web Service ▸ this GitHub repo ▸ Runtime *Docker*, Dockerfile path
  `packages/relay-node/Dockerfile`, Docker build context `packages`. Add `RELAY_DO_SECRET`. Free instances
  sleep after ~15 min idle (the first call after that waits ~30 s); a paid instance stays up. Add a disk at
  `/data` to keep rooms across deploys (optional — sessions survive without it, see below).
- **Railway** — New project ▸ GitHub repo ▸ set *Root directory* `packages`, *Dockerfile path*
  `relay-node/Dockerfile`; add `RELAY_DO_SECRET`; a volume at `/data` (optional).
- **Fly.io** — `fly launch --dockerfile packages/relay-node/Dockerfile` from `packages/`, `fly secrets set
  RELAY_DO_SECRET=…`, `min_machines_running = 1`.
- **Your own server / VPS** — `docker run -d --restart unless-stopped -p 8787:8787 -e RELAY_DO_SECRET=… -v
  bpluss-relay-data:/data bpluss-relay` behind HTTPS (Caddy / nginx). The editor is served over https, so the
  relay must be `https://` / `wss://` too.

Then in Vercel ▸ Settings ▸ Environment Variables (Production + Preview) set `RELAY_DO_URL` to the host's
https URL (no trailing slash) and `RELAY_DO_SECRET` to the same secret, and redeploy.

## What a restart or redeploy costs

Open sockets drop and reconnect by themselves within seconds. Rooms come back from `RELAY_DATA_DIR`; without a
persistent disk they are empty, and then: session.json is re-seeded from R2 on the next call; a tab must click
Connect Claude again (its token hashes were in the room) — or keeps working on the long-poll fallback;
calls that were in flight fail and the agent retries them.
