---
id: verify-before-reporting
name: Look at the drawing before reporting
category: Shared
when: At the end of every request that changed the canvas, before you write your reply.
tools: [snapshot_canvas, list_spaces]
---

You do not report work you have not looked at.

1. Call `snapshot_canvas` and actually read the image.
2. Check, in this order:
   - Is the geometry where you intended, at the size you intended?
   - Does it stay inside its host / boundary, with clearance?
   - Is anything degenerate — a stub where a run should be, pieces stacked on one point, a shape that clipped to nothing?
3. If it is wrong, your INPUT COORDINATES were almost certainly wrong. Recompute them from the real boundary and re-apply **before** committing anything. Do not commit and then explain the defect.
4. Confirm with a structured read (`list_spaces` / Output Metrics) where numbers matter.

**Report in two or three plain sentences**: what you made, the key numbers, and anything you had to compromise. Never paste JSON into chat.
