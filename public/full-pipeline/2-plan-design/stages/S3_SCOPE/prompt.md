# S3 — confirm scope, levels and team (GATE)

**The user decides; you write down what they said.** Never fill scope.json from scope.draft.json on your own.

1. Show the user `scope.draft.json` as a short form — the spaces with their areas (all pre-ticked), the three levels with
   where each came from (`plan` = measured from the drawing, `convention` = firm default from library/Standards), the
   client name, and the questions listed under `questions`. Put the form where they can answer it, then **stop**.
2. From their reply write `scope.json`:

```json
{
  "spaces": ["<space id>", "..."],            // ids from scope.draft.json → spaces[].id
  "label": "Reception · Waiting lobby",        // the space name used on every page and slide
  "client": "Marian",
  "levels": {"ceiling_mm": 2700, "soffit_mm": 3600, "partition_mm": 2600,
             "src": {"ceiling_mm": "user", "soffit_mm": "plan", "partition_mm": "plan"}},
  "seed_issue": false,                         // true = the plan-derived schedule goes to the client as I1 now
  "team": [{"role": "client", "who": "name or email"}, {"role": "modeler", "who": "..."}],
  "approved_words": "<the user's reply, verbatim>",
  "approved_on": "2026-10-09"
}
```

   A level the user confirms becomes `src: user`; one they leave alone keeps its draft source.
3. Run `python tools/run_task.py <CODE> --task S3_SCOPE --approved "<their words, date>"`.

`team` is a reminder only: roles take effect when the architect adds each person in the app (Issue & team), because the
app can only trust a user id the platform gives it, never a typed name or email.
