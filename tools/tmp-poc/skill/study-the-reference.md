---
id: study-the-reference
name: Read a reference image (or a brief) into parts, proportions and materials
category: Parametric Object Creator
when: First step of every object. The user has attached a photo, or has only named the thing ("a pendant lamp", "a three-seat sofa"). Produces the written breakdown the mesh and material steps are chosen from.
tools: [Read]
requires: []
---

# Study the reference

Write the breakdown down before any maths. It is short, and it is what you compare the render against later.

## With an image

1. **Name the object precisely.** Not "chair": *upholstered dining armchair, tub back wrapping into
   arms, diamond-quilted inner back, piped seams, splayed tapered oak legs*. That sentence becomes the
   `semantics` prop and the object's title.
2. **List the parts** as a real maker would build them — each becomes (at least) one 3D Render row, because
   a row is also a material binding. Chair: shell (back + arms, ONE part), seat, piping, legs.
3. **Estimate proportions from the picture, then snap to real furniture standards.** Photos lie about
   size; standards do not. Useful anchors:

   | Object | Key dimensions (m) |
   |---|---|
   | Dining chair / armchair | seat 0.45–0.49 high, 0.42–0.50 deep; overall 0.50–0.62 wide; back top 0.80–0.95; arms 0.62–0.68 |
   | Lounge armchair | seat 0.38–0.43; overall 0.75–0.90 wide, 0.80–0.90 deep; back 0.75–0.90 |
   | Sofa (3-seat) | 2.0–2.3 × 0.85–0.95; seat 0.42–0.45; arm 0.60–0.65; back 0.80–0.85 |
   | Dining table | top 0.74–0.76; 0.75–0.90 per person length; 0.85–1.00 wide |
   | Bed | mattress top 0.50–0.62; headboard 1.0–1.3 |
   | Coffee table | 0.38–0.45 high |
   | Pendant | hang so the shade bottom is 0.70–0.80 above a table |

   Use a known size in the photo to scale the rest (a seat height, a door, a floor board).
4. **Name the silhouette-defining curves.** Where does the back meet the arm? Is the plan of the back a
   circle, a superellipse, straight with rounded corners? Does the top edge fall smoothly or step? Do legs
   splay, taper, turn? These become explicit functions in the body (see chair's height profile along the
   shell: flat across the back → smoothstep through the corners → gentle fall along the arm → quarter-round
   drop onto the seat).
5. **Name the surface detail**: quilting (diamond / channel / biscuit), tufting with buttons, piping,
   top-stitching, creases, gathers, fluting, grain direction, a chamfer. Each is a technique in
   `pick-the-mesh-technique`.
6. **Name the materials per part**, in the library's vocabulary: "cream PU faux leather", "light oak,
   grain along the leg", "brushed brass". Note colour (hex from the picture, then corrected for lighting —
   photos of cream read as grey-beige in shadow), roughness, sheen, whether it is a coated fabric or a
   natural material. Then run `make-the-materials`.
7. **Say what you will NOT model** and why (a label, a hidden bracket, a stitch pattern finer than the
   camera resolves). It goes in the description's "WHAT THIS CANNOT DO".

## Without an image

Do exactly the same list from architectural knowledge, and **state your design choices out loud** in the
breakdown — style, proportions, materials — because the user has no picture to compare against. Prefer the
most typical, best-proportioned contemporary version of the object; take dimensions from the table above or
from the relevant standard. Offer two or three named variants as select-props (e.g. `armStyle: Tub arms |
Low arms | Armless`) rather than guessing one.

## Output of this step

A short block in the conversation (and later the object's `description`):

```
Object:   upholstered dining armchair — tub back into arms, diamond quilt, piping, splayed oak legs
Parts:    Shell (back+arms, one loft) · Seat · Piping (2 welts) · Legs (4)
Size:     W 0.56 · D 0.58 · seat 0.48 · arms 0.65 · back 0.84
Curves:   back plan = superellipse (exp ≈ 0.6); top edge flat → smoothstep → arm fall → tip roll
Detail:   diamond quilt on inner back (pitch ~75 mm), piping on seat edge + shell top
Materials: Shell/Seat/Piping = cream faux leather (NEW: Finishes/leather-cream) · Legs = Finishes/light-oak
Not modelled: stitch holes, floor glides
```
