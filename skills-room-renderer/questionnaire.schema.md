---
id: questionnaire-schema
name: What a question and a binding are
category: Room Renderer
when: Before writing or editing any `rooms/*.questions.json`, and whenever a binding stops resolving.
---

A questions file is **not a list of questions**. It is a list of **writes into the object library**, wearing questions as a user interface. Every answer that changes geometry names the object and the parameter it changes, in the object's own words.

The reason is narrow and worth stating: a form that collects prose produces a brief someone must re-type into a model. A form that collects **parameter values** produces something that can be applied. The first loses the link at the first handover; the second keeps it.

## The file

```json
{
  "id": "bedroom",
  "name": "Master bedroom",
  "version": 1,
  "display": "ft-in",
  "objects": ["bed-with-math", "wardrobe-with-math"],
  "plan": { "viewBox": "0 0 260 250", "svg": "<rect …/>", "zones": ["bed", "wardrobe"] },
  "sections": [ { "id": "bed", "title": "Bed wall", "zone": "bed", "lead": "…", "questions": [ … ] } ],
  "conflicts": [ … ]
}
```

`display` sets the units the **form shows**. It never changes what is stored: **every length in this file and in the plan it produces is in METRES**, because that is what the objects take. `ft-in` means the form draws a feet box and an inches box and converts on the way in. Convert once, here, and nowhere else.

`objects` is the list every binding must be drawn from. It exists so a dead binding is a listed object's missing parameter rather than a typo nobody notices.

## A question

```json
{
  "id": "wardrobe_shutter",
  "kind": "param",
  "ask": "Shutter type",
  "note": "sliding needs 2'0\" of depth",
  "input": "choice",
  "default": "Sliding",
  "options": [
    { "label": "Hinged",  "hint": "swing doors, more panels",      "value": "Hinged" },
    { "label": "Sliding", "hint": "2–3 wide panels, no swing space", "value": "Sliding" }
  ],
  "writes": [ { "object": "wardrobe-with-math", "param": "doorStyle", "value": "$" } ]
}
```

`"$"` is the answer. Nothing else is substituted — a write is a literal or `"$"`.

### The four kinds

| `kind` | What it does | Must have `writes` |
|---|---|---|
| `param` | Changes geometry. | Yes |
| `context` | Character, material, intent — things the model cannot express. Lands in an object's `material` or `semantics` text parameter, or in the plan preamble. | Optional |
| `plan` | A fact about the drawing, not about an object: which door is the entry, which wall the bed is on. | No |
| `derived` | Never asked. Computed from the others and shown read-only. | No |

Keeping `context` separate is what stops "client dislikes brass" being modelled as a parameter it is not. Every object in the library carries a `material` and a `semantics` text parameter, wired to nothing, for exactly this.

### Inputs

| `input` | Answer stored as | Form shows |
|---|---|---|
| `choice` | the chosen `value` | cards, one selectable |
| `multi` | array of `value`s | cards, many selectable |
| `length` | **metres**, number | two boxes (ft, in) when `display` is `ft-in`, else one metre box |
| `number` | number | one box, with `min` / `max` / `step` |
| `bool` | true / false | one toggle card |
| `text` | string | a text area |

### Showing a question only when it matters

```json
"showWhen": { "any": [ { "q": "beams", "is": "bed_wall" }, { "q": "beams", "is": "middle" } ] }
```

Same predicate shape as **Conflicts** below. A hidden question is not asked, not counted in the
progress, and **does not write** — so beam depth cannot quietly set a parameter on a beam that is
not there.

### Writing a number that was chosen as a word

A `choice` stores the option's `value`, which is a string. When the parameter is numeric, say so:

```json
"writes": [ { "object": "downlight-with-math", "param": "kelvin", "value": "$", "as": "number" } ]
```

Without `as`, `"3000"` reaches a numeric parameter as text. Use it only where the option values are
numbers wearing labels; a genuine word like `"Sliding"` must never carry it.

### One answer, several writes

An option may carry its own `writes`, which **replace** the question's. This is the case the schema exists for:

```json
{ "label": "Daybed with padded back", "value": "daybed",
  "writes": [
    { "object": "window-seat-with-math", "param": "lidStyle",    "value": "Fixed" },
    { "object": "window-seat-with-math", "param": "backCushion", "value": true }
  ] }
```

"Daybed" is not a value of any parameter. It is two values of two parameters, and writing it as one would mean inventing an option the object does not have. When a form offers a word the library has no word for, that is the moment to find out — not while modelling.

## Conflicts

Answers that are each fine and wrong together. These are computed, never asked.

```json
{
  "id": "sliding_needs_depth",
  "severity": "blocker",
  "when": { "all": [ { "q": "wardrobe_shutter", "is": "Sliding" },
                     { "q": "wardrobe_depth", "lt": 0.61 } ] },
  "says": "Sliding shutters need 2'0\" of carcass depth; this wardrobe is shallower.",
  "resolution": "Take the wardrobe to 2'0\", or use hinged shutters.",
  "resolve": [ { "object": "wardrobe-with-math", "param": "depth", "value": 0.61 } ]
}
```

`when` is `all` or `any` of predicates. A predicate is `{ "q": "<question id>" }` plus exactly one of:

`is` · `isNot` · `lt` · `gt` · `lte` · `gte` · `includes` (for `multi`)

The compared value is a literal, or `{ "q": "<other question id>" }` to compare two answers, with an optional `margin` added to it:

```json
{ "q": "headboard_width", "gt": { "q": "clear_span", "margin": -0.6 } }
```

There is no expression language and there is no `eval`. If a check cannot be written with these predicates, it is a `derived` question with a formula the form knows, or it does not belong here.

`severity` is `blocker` or `warning`. A blocker means do not model yet. `resolve` is optional — when present the form offers it as a one-click answer, which is how "fan or chandelier" stops being a paragraph in a plan and becomes `ceiling-fan-with-math.ringLight = true`.

## What comes out

```json
{
  "room": "bedroom",
  "answeredAt": "2026-09-16T00:00:00Z",
  "questionnaire": { "id": "bedroom", "version": 1 },
  "answers":  { "wardrobe_shutter": "Sliding", "slab_height": 3.353 },
  "params":   { "wardrobe-with-math": { "doorStyle": "Sliding", "depth": 0.61 } },
  "context":  { "wardrobe_finish": "light oak veneer, matte" },
  "plan":     { "entry_door": "Door B (S wall)" },
  "open":     ["pendant_style"],
  "conflicts":[ { "id": "sliding_needs_depth", "severity": "blocker", "resolved": true } ]
}
```

`params` is the part that matters: object id → parameter → value, in metres, ready to apply. `open` is every unanswered question, listed rather than defaulted, so a gap is visible instead of guessed.

## Answers that arrive already known

A room that was traced already has its own length. Retyping it would make the questionnaire a second source of truth for a rectangle the plan has already measured — so the form accepts a prefill map and the questionnaire says nothing about it:

```json
{
  "room_length": { "value": 3.962, "source": "measured" },
  "clear_span":  { "value": 3.352, "source": "derived" },
  "sill_height": { "value": 0.914, "source": "convention" }
}
```

Open the form with `?prefill=<url>`, or pick the file next to the questions file. A bare value with no `source` is treated as a default.

| `source` | Means | The form |
|---|---|---|
| `measured` | read off the drawing | badges it **from the plan** and locks it |
| `derived` | computed from measured things | badges it **worked out from the plan** and locks it |
| `convention` | the producer's assumption wearing a number | badges it **assumed — check this** and leaves it editable |
| `default` | the questionnaire's own | nothing |

**`convention` is the one that matters.** A tracer assigns a toilet window a 1.5 m sill because that is what toilet windows are, not because it measured one. Arriving unlabelled, that number is indistinguishable from a measurement and gets modelled as one. Arriving as `convention`, it is flagged, editable, and — because the conflict rules run over prefilled answers exactly as over typed ones — it gets checked: an assumed sill that does not suit the seat below it trips `seat_not_level_with_sill` before anybody models anything.

The plan JSON carries `sources` and an `assumed` list, so what was known and what was guessed survives the handover.

A questions file never mentions prefill. It works identically with none, which is how a room that was never traced still gets briefed.

## Rules that keep this from rotting

1. **Every `param` write names a real object and a real parameter.** The form checks this against the live library when it can reach it, and says so in a banner when a binding is dead. A dead binding writes nothing and is silent otherwise — this is the failure mode to fear.
2. **Every `choice` value written to a `select` parameter is one of that parameter's own options, spelled identically.** `"Sliding"` is not `"sliding"`.
3. **Lengths are metres.** A questions file with `10` in a length field is claiming ten metres.
4. **Two questions never write the same object parameter.** Whichever ran last would win, silently.
5. **`objects` lists every object any binding touches.** Nothing binds outside it.
6. **A question with no `writes` is `context`, `plan` or `derived` — never `param`.**

## What this does not do

It does not place anything. `params` says what an object should be, not where it goes or how many there are — two matching bedside tables are one parameter set placed twice, and that is the placement step's business, not this file's.

It does not know about rooms it has not been written for. A questions file is per room type, by hand, and that is the only file in this skill anyone edits.
