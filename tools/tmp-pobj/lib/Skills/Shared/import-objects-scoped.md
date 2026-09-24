---
id: import-objects-scoped
name: Import library objects, scoped
category: Shared
when: Before anything hosts or places a parametric object — once per session, and again only if an id you need is missing.
tools: [list_objects, import_objects]
---

Objects are referenced BY ID. A segment or node that names a missing id draws a bare placeholder symbol instead of the real thing — which looks like a geometry bug and is not one.

1. `list_objects` first. If the id you need is already loaded, do nothing.
2. If it is missing, `import_objects` with a SCOPE:
   - by category — `{ "categories": ["Architectural"] }`
   - by id — `{ "categories": ["Site"], "ids": ["site"] }`
3. **Never call `import_objects` with both scopes omitted** — that loads the entire library into the session for no reason.

Import once, early, before the step that needs it. Do not re-import between steps.
