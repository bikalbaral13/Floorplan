# Worker save-back + engine in R2 — plan (proposed, not started)

Goal: the R2 viewer and small form pages can **write** to R2 safely, so the app is needed only for
free-hand drawing and object authoring. Second part: publish the engine itself to R2 as a versioned module.

Status: **E1 done** (2026-10-12) — engine 1.0.0 at `library/Engine/1.0.0/`, `latest.json` → 1.0.0; publish with `node tools/engine/publish.mjs <ver>`, load in Node with `tools/engine/load.mjs`; the viewer loads it (pin: `settings.engineVersion`). Part A (Worker) not started.

---

## Part A — Cloudflare Worker save-back

### Why a Worker
The viewer is static and public. It must never hold the R2 keys (`tools/r2.mjs` signs with keys that can
write and delete the whole bucket). A Worker sits beside the bucket with an R2 **binding** — no keys in any
page — and decides what each caller may write.

```
viewer / form page ──POST (signed-in user)──▶ Worker ──R2 binding──▶ library/…
                   ◀──────── public reads stay on r2.dev (unchanged) ────────
```

### Endpoints (small on purpose)
| Method | Path | Does |
|---|---|---|
| `GET` | `/api/me` | Who is signed in, which roles |
| `PUT` | `/api/design?path=Designs/X.json` | Save a whole design (with `If-Match` etag) |
| `PATCH` | `/api/design?path=…` | Apply a list of small edits (param change, move, rotate) |
| `PUT` | `/api/answers?path=Forms/<form>/<run>.json` | Save a questionnaire's answers |
| `GET` | `/api/history?path=…` | List saved versions of a file |
| `POST` | `/api/restore?path=…&version=…` | Restore an earlier version |

No `DELETE`. No writes outside allowed prefixes.

### Rules the Worker enforces
1. **Auth:** Cloudflare Access (email login, the team's domain) in front of `/api/*`. The Worker reads the
   verified email from the Access JWT. No passwords stored by us.
2. **Roles:** a small `library/Config/roles.json` — who may write `Designs/`, `Master Plans/`, `Forms/`.
   (Fits the Full Pipeline roles already in R2.)
3. **Allowed prefixes only:** `Designs/`, `Master Plans/`, `Forms/`. Never `Objects/`, `Skills/`,
   `Viewer/`, `Engine/` (those stay publish-from-repo).
4. **No lost updates:** every save sends the etag it loaded; a mismatch → `409` with the current version,
   and the page asks the user to reload or merge.
5. **Every save is versioned:** before overwriting, the Worker copies the old file to
   `library/_versions/<path>/<timestamp>.json` (the bucket has no versioning of its own — a delete or bad
   save is otherwise unrecoverable, as the lost `design-schema-2.md` showed).
6. **Validation:** JSON must parse and pass a shape check (schemaVersion, levels/groups) and stay under a size
   cap; a `PATCH` may only touch `params`, node `x/y`, group `transform`.
7. **Audit:** each save appends `{who, when, path, bytes, summary}` to `library/_audit/YYYY-MM.jsonl`.
8. **Baked sidecar:** saving a design marks `<name>.view.json` stale (header/flag); the viewer then shows
   boxes for changed objects until `bake.mjs` runs again (or Phase-3 live eval fills them in).

### Viewer changes
- **Save** button appears only when `/api/me` says the user can write that path.
- Param-panel edits become a pending change list → `PATCH` (preview stays instant).
- Later: move/rotate an object or a group with handles → same `PATCH`.
- "Unsaved changes" indicator; conflict dialog on `409`.

### Form pages
- Each questionnaire becomes a standalone HTML in `library/Forms/<name>/index.html`, rendered from its
  existing schema; answers `PUT` to `Forms/<name>/<run>.json`.
- The agent reads the answers file — the user answers, the agent never self-answers (existing rule).

### Phases
| # | Deliverable | Done when |
|---|---|---|
| W1 | Worker + R2 binding + Access; `GET /api/me`, `PUT /api/design` with etag + versions + audit | A design saved from curl as a signed-in user; old copy in `_versions/` |
| W2 | Viewer Save for param edits (`PATCH`) | Chair width edited in viewer is in R2 after reload |
| W3 | One form page (Tracer scope form) saving answers | Agent reads the answers file and runs the plan |
| W4 | Move/rotate objects and groups in the viewer | A plot moved on the master plan, saved, reloaded |
| W5 | History + restore UI | A bad save undone from the viewer |

### Decisions needed
1. Auth: **Cloudflare Access** (recommended) vs a simple shared token per person.
2. Who gets write: everyone on the team, or per-role from `roles.json`.
3. Worker URL: same domain as the bucket (custom domain, clean, no CORS) vs `*.workers.dev`.
4. How long to keep `_versions/` (all, or last N per file).

### Risks
| Risk | Mitigation |
|---|---|
| A page bug overwrites a design | etag check + automatic version copy + restore |
| Leaked access | Access login, prefix allowlist, no DELETE, audit log |
| Big designs (30 MB) | `PATCH` for small edits; full `PUT` only from tools |
| Bake out of date after a save | stale flag; re-bake on demand |

---

## Part B — the engine in R2

**Already half true:** `library/Viewer/v1/objects.js` *is* the engine (the app's evaluator bundled for the
browser). Making it a first-class, versioned module:

```
library/Engine/
  1.0.0/engine.js        ← ES module: evaluate(), bake helpers
  1.0.0/engine.js.sha256
  1.0.0/manifest.json    ← version, git commit, build date, exports
  latest.json            ← { "version": "1.0.0" }
```

### Who would use it
- **Viewer:** loads `Engine/<version>/engine.js` instead of its own copy.
- **Node pipelines** (`bake.mjs`, Floorplan Renderer, Improver): import the same file → no repo checkout
  needed to bake; any machine with Node can run a pipeline.
- **App:** can keep its built-in copy, or load the same module, so all three agree by construction.
- **Agents in the cloud:** fetch the engine instead of cloning the repo.

### Rules
1. **Git stays the source.** R2 is distribution only; publish from a tagged commit via one script
   (`tools/engine/publish.mjs`), never edit in R2.
2. **Immutable versions.** `1.0.0/` never changes; fixes go to `1.0.1/`. Old designs keep rendering.
3. **Pin per design (optional).** `settings.engineVersion` in a design; viewer/bakes use it, else `latest`.
   A `.view.json` records the engine version it was baked with.
4. **Integrity.** Loaders check the sha256 before running (code from a bucket is executable).
5. **Python twin stays separate.** `pyobject` (spine2py) remains for Blender; parity tests run against the
   published engine version.

### Benefits / costs
- + One evaluator for viewer, pipelines, app, agents; no drift.
- + Pipelines run without the repo; bakes are reproducible (engine version recorded).
- − A publish step to remember after engine changes (scripted, and the viewer already has one).
- − Breaking engine changes must bump the version, or old bakes and new live evals disagree.

### Phases
| # | Deliverable |
|---|---|
| E1 | `tools/engine/publish.mjs` → `Engine/<ver>/` + manifest + sha; viewer loads it |
| E2 | `bake.mjs` (and Renderer's `bake_plan.mjs`) import the published engine; record version in output |
| E3 | `settings.engineVersion` pinning + viewer honours it |
| E4 | (optional) app loads the same module |

---

## Suggested order
E1 first (small, it mostly renames what exists) → W1–W2 (save-back for the viewer) → W3 (forms) → rest.

---

## Part C — MCP on the Worker, viewer-first (built 2026-10-12, not yet deployed)

The agent no longer needs the editor app: the Worker serves an MCP endpoint (`POST /mcp`, Streamable HTTP,
stateless) and the viewer is the canvas. `tools/worker/src/mcp.js`, `sessions.js`.

| Tool | Does |
|---|---|
| `viewer_open {src?, view?}` | new session → viewer link (`?session=<id>&api=<worker>`) |
| `viewer_show {session, src?, view?, level?, select?, camera?}` | change what the open viewer shows |
| `viewer_snapshot {session, pane?}` | PNG of the viewer (the page captures itself and uploads) |
| `viewer_events {session, since?}` | user selections + form answers |
| `form_ask {session, title, fields}` | a form in the viewer; answers arrive as events — never self-answered |
| `library_list`, `library_read`, `skills_list` | read the library (read returns the etag) |
| `design_save {path, json, etag?, session?}` | save via the same rules as `PUT /api/file` |

Sessions live in `library/Sessions/<id>/` (`state.json` by the agent, `events.json` + `snapshot.png` by the
viewer, which polls once a second). Tested locally (`wrangler dev` + `tools/worker/dev/viewer-proxy.mjs` on
:2510): `node tools/worker/test.mjs` (19) and `node tools/worker/test-mcp.mjs` (14) pass; show → snapshot
≈ 2.5 s; form and selection events round-trip.

Connect Claude Code after deploy:
`claude mcp add --transport http builderpluss-library https://builderpluss-library.<sub>.workers.dev/mcp`

Not yet: heavy jobs (bake, Blender render) behind job tickets; repointing the R2 skills from "open the
editor" to `viewer_open`; roles instead of open write.
