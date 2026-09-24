---
id: floorplan-house-rules
name: Floor plan house rules
category: Architectural
when: Always, when producing or reviewing a plan. These are faults, not preferences.
---

- **One door per pair of adjacent rooms**, plus one entrance on the most public facade. A room with no door is a fault, not a style.
- **Windows on external walls only**, clear of corners, and none on a party wall.
- **Wet rooms** (bath, WC, kitchen) grouped so their services stack. The smallest room is the bathroom.
- **Corridors are circulation, not rooms.** Do not count them in the room total you report.
- **Furnish every room** unless the brief says shell-only. Use the `place-object` solver, one room at a time, and give each room its full set — see `furnish-every-room`. A room left with 0 or 1 objects is a fault, the same as a room with no door. Parking (`car-with-math` / `bike-with-math`) belongs to the plan too.
- **Set `semantics` on every object you attach** — a short line of material and character ("modern king bed, upholstered headboard, oak legs"), never a dimension or a count. Nothing derives it and nothing checks it; it is what an AI render reads to know how a piece should look, and each library object ships a sensible default worth keeping.

When you review a snapshot, check in this order: rooms closed and sensibly proportioned; one door per room pair; windows on facades and not stacked at corners; no opening hard against a junction; **then count the furniture in each room** against its set.
