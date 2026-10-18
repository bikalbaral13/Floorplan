---
id: curate-the-brief
name: Curate the drafted brief into typed items, zones, cameras and checks
category: Deck Reader
when: DRAFT has written roombrief.draft.json; before FINALIZE.
---

Read the draft **and the slide images** (`images/`, `pages/`) — the draft is rule-based and misses what only a picture shows.

Write `roombrief.curated.json` (roombrief/1):

- `zones[]` — named areas with their outline in **plan-image pixels**, from the freeforms the designer drew over the plan crop (exact, never guessed).
- `items[]` — one per thing that becomes a canvas object: `category`, `zone`, `object.kind` (`new: true` = no library object yet), typed `params`, `refImages`, `productUrls`, `slides`, `note`.
- `cameras[]`, `checks[]` (review comments that are tests, not geometry), `openQuestions[]`.

Precedence: **final render slides > latest review comment > spec slide.** Fold a review change into the item it changes (cite the slide); anything that is a test goes to `checks`.

READ THE REVIEW RENDERS, not just the plan symbols — on INFRA slide 21's render fixed the wall layout, and the plan's seat symbols along the east wall were the sofa's second leg.

Report progress while you work (one line per zone or per 10 items) — the user is watching the Brief tab.
