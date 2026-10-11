# S7 — publish the apps and seed the brief

Inputs: `work/apps/publish.json`, `work/apps/dbseed/batches.json`. Use the Artifact and ArtifactData tools.

## First publish (no `apps.json` yet)
1. **Artifact publish** with exactly what publish.json says: `file_path` = publish.file_path, `root` = publish.root,
   `files` = publish.files, `capabilities` = publish.capabilities (it carries the db access rules — do not drop or edit
   them), `icon`, `description`. Note the returned URL and version id.
2. **ArtifactData batch** once per entry in `batches.first_publish` (each ≤ 50 writes; file paths are absolute).
   Count the documents written.
3. Write `apps.json` in the project folder:
   `{"url": "<artifact url>", "version_id": "...", "site_sha256": publish.site_sha256, "run_id": publish.run_id,
     "mode": "first", "seeded": true, "seed_documents": <count>, "published_at": "<iso time>"}`
4. Read back once: `ArtifactData list` of `elements` with `as_level: "interact"` must return documents (Contributors can
   read), and one `set` into `elements` with `as_level: "interact"` must be REFUSED — that proves the rules are live.
   Do not leave a probe document behind.

## Republish (apps.json exists, the site was rebuilt)
1. Artifact publish with `url` = apps.json url (keeps the link and the data). Pass `capabilities` again only if
   publish.json's differ from the stored ones.
2. ArtifactData `update` brief/meta from `batches.republish.update_meta` (pipeline-owned fields only — rounds, issue,
   dismissed and everything the architect did stay).
3. For `batches.republish.add_missing_elements`: `get` each id first and `set` only the ones that do not exist. **Never
   overwrite an existing element** — it holds the architect's work and its issued snapshot.
4. Update apps.json (`site_sha256`, `run_id`, `mode: "republish"`, `published_at`).

Then save the project so the link survives this chat: `python tools/project_state.py pack <CODE>` and follow the
SAVE.md it writes (library `Projects/<CODE>/space-brief/state.json` + `Projects/index.json`).

Then tell the user: share the brief with the client and the modeler as **Contributor**, with other architects as
**Editor**, and add each person in *Issue & team* so their role counts. Never share it by public link: assets make it
organisation-internal anyway, and a public link would demote outside Editors.

Run `python tools/run_task.py <CODE> --task S7_PUBLISH_APPS`.
