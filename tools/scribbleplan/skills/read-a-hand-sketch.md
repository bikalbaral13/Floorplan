---
id: read-a-hand-sketch
name: Read a hand sketch — what the marks mean and what to ask
category: Scribble to Floorplan
when: First step on any scribble. Before a single coordinate exists.
tools: [Read]
---

A scribble is a photograph of someone thinking. It is usually rotated, always out of scale, and carries three kinds of information that must be separated before anything is drawn.

**GIVEN — believe these.** Room names. Printed dimension strings ("36ft outer", "25ft Outer", "10ft c-c"). Wall thickness notes ("9 inch outer wall", "4 inch Inner wall"). Adjacency: which room touches which. These are the brief.

**DRAWN — read these, do not measure them.** Small squares at wall junctions are COLUMNS, and the pattern of them is the structural grid — count the lines, not the squares (four across and three down is a 3 × 2 bay grid, twelve intersections). Quarter-circle arcs are DOORS, and the arc tells you the hinge side and which way it swings. A box drawn inside a room with an arrow through it is a STAIR and the arrow is the up direction. A run of short parallel ticks is usually a window.

**INFERRED — you are deciding these, so say so.** Bay dimensions the sketch never printed. Every window, when the sketch drew none. Door widths. Floor-to-floor height. Which way a room's furniture faces.

## Getting the orientation right

Rotate the image until the text reads upright, then work out which printed dimension runs along which direction by following the dimension line, not by where the label sits — a label is written wherever there was room. Cross-check against the column grid: the direction with more grid lines is usually the longer one.

## Measuring what is not printed

Relative pixel spacing between grid lines is a decent proportion estimate and a terrible dimension. Use it ONLY to split a known total: if three bays span 36'-0" outer and one is printed as 10'-0" c-c, the pixel ratio of the other two tells you they are roughly 12' and 13'-3", and `resolve-dimensions-and-grid` makes them close exactly. Never take an unprinted dimension straight off the pixels.

## Present the reading before you build

Draw the layout back as a text block diagram — bays across the top, rooms in their cells, dimensions on the edges — and list what you inferred. Ask ONE round of questions covering: is the room arrangement right; are the inferred bays acceptable; where do the rooms you had to relocate actually go. Then build.

The question worth asking every time: **what happens at the ambiguous cell.** In nearly every domestic scribble there is one region where two rooms are drawn stacked in a space that cannot hold both at a sensible size. Work out the areas both ways, present the numbers ("splitting this band evenly leaves the bedroom at 82 sq ft"), propose the resolution, and let the user choose. Do not silently pick one.

## What the sketch will get wrong

A hand sketch is drawn room by room and almost never checked for CIRCULATION. Before accepting your own reading, walk the plan: from the entrance, can you reach every room without passing through a bedroom? If not, the sketch has a fault and you must fix it — see the passage rule in `resolve-dimensions-and-grid`. Report the fix; do not present it as what the user drew.
