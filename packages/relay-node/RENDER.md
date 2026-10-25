# Deploy the relay on Render — click-through

About 10 minutes. You need: a Render account (sign up with GitHub), and access to the Vercel project.
The Blueprint is [`render.yaml`](../../render.yaml) at the repo root.

## 0. Get the code onto GitHub (once)

Render builds from GitHub, so the relay commits must be pushed to the repo Render will read
(`bikalbaral13/Floorplan`, remote `origin`):

```bash
git push origin main
```

## 1. Create the service from the Blueprint

1. Go to **dashboard.render.com** ▸ sign in (GitHub is easiest).
2. **New +** ▸ **Blueprint**.
3. **Connect a repository** ▸ allow Render access to `bikalbaral13/Floorplan` ▸ select it.
4. Render reads `render.yaml` and shows one service: **bpluss-relay** (Docker, Singapore, Free).
   Give the Blueprint a name (e.g. `bpluss-relay`) ▸ **Apply**.
5. Wait for the first deploy (3–5 min). The log ends with
   `[relay-node] listening on :10000 (data: /data/rooms.json)` and the status turns **Live**.

## 2. Check it

1. Open the service ▸ copy its URL at the top, e.g. `https://bpluss-relay.onrender.com`.
2. Open `https://bpluss-relay.onrender.com/health` in the browser. Expected:
   `{"ok":true,"service":"bpluss-relay","host":"node",...}`

## 3. Copy the secret

Service ▸ **Environment** ▸ `RELAY_DO_SECRET` ▸ click the eye icon ▸ copy the value (Render generated it).

## 4. Point Vercel at it

1. **vercel.com** ▸ the floorplan project ▸ **Settings** ▸ **Environment Variables**.
2. Add, for **Production** and **Preview**:

   | Key | Value |
   |---|---|
   | `RELAY_DO_URL` | `https://bpluss-relay.onrender.com` (no trailing slash) |
   | `RELAY_DO_SECRET` | the value from step 3 |

3. **Deployments** ▸ the latest production deployment ▸ **⋯** ▸ **Redeploy** (env vars apply to new
   deploys only). If step 0 just pushed, that push already started a deploy — redeploy once it is done, or
   add the variables before pushing.

## 5. Check it end to end

1. Open `https://floorplan-indol.vercel.app/floorplan-editor` ▸ **Connect Claude** ▸ connect as usual.
2. The dialog shows **"Faster: local bridge over the realtime relay"** → the tab got a socket address.
3. Browser devtools ▸ **Network** ▸ **WS**: one connection to `bpluss-relay.onrender.com`, status 101; no
   repeating `/__relay/next` requests.
4. Ask Claude to draw something. Each response's `Server-Timing` header shows `do;dur=…` and `r2;dur=0`.

## Free plan: what to expect

- The service **sleeps after ~15 min without traffic**; the next request wakes it in ~30–60 s. While it
  sleeps, a new Connect Claude may fall back to the old long-poll path (still works, just slower). Whether an
  open editor socket alone keeps it awake is not something I have verified on Render.
- To stay awake: service ▸ **Settings** ▸ **Instance type** ▸ **Starter** ($7/month).
- No disk on Free: a redeploy or wake-up forgets which tabs are paired → tabs reconnect via long-poll until
  the user clicks Connect Claude again. Session data is safe (it is also in R2).

## Turning it off

Delete `RELAY_DO_URL` in Vercel and redeploy → everything goes back to the long-poll relay. The Render service
can then be suspended or deleted.
