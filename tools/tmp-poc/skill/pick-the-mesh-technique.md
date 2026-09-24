---
id: pick-the-mesh-technique
name: Choose the meshing / sculpting technique for every part
category: Parametric Object Creator
when: After study-the-reference, before writing any expression. Brainstorm per part — SoftBox, a custom loft skinned with Solid.Skin, a sweep, a lathe, a cloth drape, a displacement — and write the choice down with its reason. Defaulting every part to a box is the failure this step exists to prevent.
tools: [Read]
requires: [study-the-reference]
---

# Pick the mesh technique

Everything a 3D Render row draws is a **face list** `[x, y, z, faceId]` — consecutive rows with the same id
are one face. The canvas flat-shades each face (`polyhedronGeometry` → `computeVertexNormals` on a
non-indexed list), so **smoothness on the canvas comes only from sample density and even spacing**; Blender
adds smooth-by-angle on top. Every technique below ends in a face list.

## The toolbox (all present in the Math Engine)

| Technique | Call | Use it for | Proven in |
|---|---|---|---|
| Eased / soft box | `Solid.SoftBox(hcat(x0,y0,z0,x1,y1,z1), roundTop, roundBase, roundPlan, stations, points)` | cushions, mattresses, pillows, eased carcasses, plinths, headboard channels | bed.json |
| Custom loft | build rings `[x,y,z,sectionId]` yourself → `Solid.Skin(sections, idBase)` | ANY section carried along ANY path with varying size: tub shells, arms, seat bodies with a rolled edge, tapered/splayed legs, bottles, shades | chair.json |
| Sweep | `msweep(profile N×2, rail M×3, closed)` | constant section along a curve: piping, welts, handrails, cornices, cable, tube frames | chair.json (piping) |
| Lathe | `mlathe(profile, axis, n)` | anything turned: lamp bases, bowls, turned legs, vases, knobs | — |
| Prism | `mprism(ring, z0, z1)` | flat extrusions of a plan shape: table tops with a shaped plan, panels | door/window |
| Curves | `bezier`, `bspline`, `nurbs`, `catenary`, then `resample(M, n)` | smooth rails and profiles; `resample` makes them EVEN in arc length | — |
| Booleans | `msubtract`, `munion`, `mintersect` (BSP) | holes only — a drilled shelf, a cut-out handle. Expensive; never for hollow bodies (use a lathe profile) | — |
| Cloth drape | per-station section + zone masks (top / roll / fall) + gather waves | duvets, throws, table cloths, curtains, turned-back sheets | bed.json STEP 7–8 |
| Displacement | move points along the face normal by a function | quilting, tufting, channels, creases, dents, fluting, wood relief | chair.json (quilt), bed.json (creases) |

## Decision guide

- **Is it hard (timber, metal, stone)?** SoftBox with `roundTop = roundBase = 0` and a small `roundPlan`
  (plan-corner ease only). A non-zero roundTop DOMES the solid — right for a mattress, wrong for a table top.
  Flat top ⇒ 2 stations are enough; spend the budget on `points`. **The converse is a trap:** with
  `roundTop` or `roundBase` > 0, 2 stations put both rings at the poles, they collapse to points and the
  part becomes a zero-volume sliver (sofa.json at Blocky, 2026-09-24). A domed SoftBox needs ≥ 5 stations
  and ≥ 16 points at every detail level.
- **Is it upholstered and box-like (cushion, seat pad, pillow)?** SoftBox with top/base exponents 0.1–0.8
  (bed.json: pillows 0.35–0.80). A plump pillow is soft in SECTION, near-rectangular in plan.
- **Is it upholstered and wraps round (tub back, arms, sofa arm roll, bolster)?** Custom loft along a plan
  curve. This is the chair's shell: ONE part for back and both arms.
- **Constant section along a path?** `msweep` (parallel transport — the section never twists where the rail
  turns or goes vertical).
- **Rotationally symmetric?** `mlathe`.
- **Legs**: tapered + splayed = custom loft of HORIZONTAL rings whose centre moves linearly (a horizontal
  slice of a tilted cone): the foot sits flat on the floor and the top meets the underside flat at any splay,
  with no trimming. Square taper = the same with a 4-point (or SoftBox-eased) ring.
- **Fabric that hangs or lies on something?** The drape pattern from bed.json: arc-length parameterised
  section, analytic zone normals, gather weighted by how far down the fall a point is, hem level at ONE
  absolute height, crease waves that only ever LIFT (never push cloth into what it lies on).

## Pattern A — the custom loft (the workhorse)

1. **Plan curve.** Build it dense (≈100 pts) from its own maths (e.g. a quarter superellipse
   `u = uB + a − a·cos(φ)^e`, `v = b·sin(φ)^e`, then a straight run), mirror, concatenate, and
   `resample(path, S)` so stations are **evenly spaced in the world**. Get arc length with `arclen`.
2. **Tangent** by central difference with `shift(C,-1)` / `shift(C,1)`, **one-sided at the ends** via
   `where(eq(arange(S),0), …)` — `shift` wraps, and a wrapped tangent at an open end points across the object.
   Normal = perpendicular; fix its sign by construction (walk the path in a known direction) rather than a test.
3. **Per-station quantities** as S×1 columns: height profile, thickness, rake, fades.
4. **Ring template** as Nr×1 columns: masks for each zone of the section (outer face / rolled top / inner
   face / foot) and a parameter per point. SAME point count at every station — topology fixed, sizes vary.
5. **Broadcast**, never loop over points: station columns `kron(col, ones(Nr,1))`, ring columns
   `kron(ones(S,1), col)`. The chair's 7 000-point shell is ~20 vectorised lines and evaluates in ~0.3 s.
6. `sections = hcat(u, v, z, kron(arange(S), ones(Nr,1)))` → `Solid.Skin(sections, idBase)`.
7. **Frame rule** at the end (see `author-the-six-node-flow`).

Half-round tops: a semicircle of radius T/2 across the section gives an upholstered roll. Rake / flare:
shear the section outward in proportion to height, `n += (z − z0)·tan(rake)` — the foot stays put.

## Pattern B — displacement (quilting, tufting, channels, creases)

Move points already in a face along its normal by `depth · puff · window`:

- **Diamond quilt**: in the unrolled (arc length s, height z) plane,
  `puff = sqrt(|sin(π(s + z/k)/p)| · |sin(π(s − z/k)/p)|)` — zero on both stitch-line families, max in the cell
  centre; `sqrt` flattens each pad and pinches the seam like foam under a stitched cover. Measure s from the
  object's CENTRE LINE so the pattern is symmetric at any width. `k` = diamond height/width.
- **Channels**: `puff = sqrt(|sin(π s / p)|)`.
- **Biscuit / tufting**: product of two orthogonal waves `|sin(πs/p)|·|sin(πz/p)|`; add buttons as tiny
  SoftBoxes at the zero crossings if the camera will be close.
- **Window**: smoothstep fades to zero before every edge so a plain welt border frames the field. Without
  it the quilt runs into the seam and the edge ripples.
- **Resolution**: at least ~6–8 samples per pitch in each direction, or the pattern aliases into noise.
  Tie those counts to the `detail` dial and switch the displacement OFF at the lowest detail.
- **Creases on cloth**: two waves at incommensurate frequencies, sheared by the across position, offset to
  stay ≥ 0 (they only lift). Folds at a hem: amplitude weighted by distance down the fall.

## Pattern C — seams and trims

- **Piping**: a small circle (r 3–5 mm, 8–12 pts) swept along the seam line, centred ~0.45 r proud of the
  surface. Put it EXACTLY where two soft parts meet and it hides the seam (and any z-fighting band).
- **Make adjacent soft parts share geometry**: the chair seat's outline IS the shell's outer foot pushed out
  2.5 mm, so the shell stands exactly on the seat at every width. Derive, don't redraw.
- **Shadow gaps / reveals**: a 5–10 mm set-back between hard parts; cheaper and more convincing than a bevel.

## Budget and the detail dial

One `detail` select-prop (`Blocky | Medium | Fine | Smooth`) sets EVERY sample count, so face count is a
decision. Reference points: chair Fine = 11 300 faces (shell 6 800), bed Smooth ≈ 5 000 faces. Keep Fine
under ~15 k faces and evaluation under ~1.5 s. Blocky = low poly, no displacement, no piping.

## Output of this step

A table in the conversation: part → technique → why → sample counts per detail level.
