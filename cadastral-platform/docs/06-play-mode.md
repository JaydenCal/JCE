# Play mode: first-person walk-through and placeable store items

User requirement (2026-10-12): the site and the house are navigable "like a video game" with a **first-person mode**, and the user can **place actual items from stores** in them, with the result displayed in the style of the reference model (`05-viewer-reference.md`).

## Modes
| Mode | Behaviour |
|---|---|
| Review (orbit) | As the reference model: layers, views, pick readout, cut/fill, see-through |
| First person | Pointer-lock, WASD + mouse look, eye height 1.6 m (adjustable), gravity and ground-following from the terrain TIN, floor-level following inside the house, collision with walls and fences, optional sprint; touch joysticks on mobile |
| Place | Pick an item from the catalogue, ghost preview, snap to ground/floor/wall, rotate in 15 degree steps, scale locked to real dimensions, move/duplicate/delete, undo/redo; items persist per project |

## Store items
Real retailer products will be added by **product URL or catalogue search**: title, brand, price, dimensions, image, and a 3D model when one exists (glTF/GLB). Where no model is available the item is placed as a **dimensioned proxy** (box or simple shape textured with the product image), which is honest about what it is. Items keep their source URL, retailer and price so a shopping list can be exported.
Open issues to settle before launch: retailer terms of use and licensing for 3D assets and images, trademark use, price accuracy (price is "as at" the capture time), and whether to use official retailer or aggregator APIs where they exist. A Terms addendum is required (renders are illustrative; third-party assets and trademarks belong to their owners).

## Compliance interplay
Placed items are checked against the same rules: slab/envelope, setbacks, DBYD buffers (no items on a service buffer without a warning), driveway and swept path, and the walkable-surface map. Visual output is illustrative only.

## Data
Design schema (`db/002_design.sql`): catalogue items, placed items (transform in the lot MGA frame, level, room), layouts, levels, rooms, walls, openings, materials. SA6 emits walkable geometry (floor planes, wall colliders, stair/ramp links) with the scene bundle.
