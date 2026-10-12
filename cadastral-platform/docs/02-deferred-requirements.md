# Deferred requirements (recorded in Phase 1, not yet actioned)

Both items below were requested by the user during Phase 1. Neither is built until the core platform (Phases 2 to 4) works.

## D1. Visual style emulating planningai.com.au (action in Phase 4)
- Replicate layout, spacing, typography feel and colour mood.
- Use our own name, logo, copy and assets. Do not copy their branding or text.
- Nothing has been fetched or built from that site yet.

## D2. Architectural design and visualisation module (secondary, after core works)
The user wants a project to start in one of two ways:

1. **Design from scratch:** draw a layout (walls, rooms, openings), choose roof type and pitch, and see it rendered.
2. **Import:** load an architect's **PDF** (already planned, Sub-Agent 7) or a **DXF** layout (new input format).

In either case a **3D model is generated and rendered** from the layout. The user can then **place furniture and decorate** (materials, finishes, fixtures).

### Impact on the design (to settle when this is scheduled)
| Area | Needed |
|---|---|
| New sub-agent | **SA8 Layout and Model Builder**: DXF import (ezdxf), wall/room recognition, extrusion to 3D, roof generation (gable, hip, skillion, flat; pitch, eaves), openings. Deterministic, no LLM except optional DXF layer classification |
| SA7 | PDF path stays as is; its footprint/wall output feeds SA8 so imports from PDF and DXF share one model |
| SA6 | Renders the generated building and furniture on the terrain, with the existing underground cutaway |
| Schema (new `design` schema) | `design.layouts`, `walls`, `openings`, `rooms`, `roofs`, `levels`, `materials`, `furniture_catalogue`, `placed_items`, with transforms in the lot MGA frame so the model sits on the cadastre and respects the envelope |
| Frontend | 2D layout editor, 3D orbit view, catalogue drag-and-drop, material picker |
| Legal | Terms addendum: renders are illustrative, not construction documents; third-party furniture/model asset licences; no compliance certification of designed layouts (BCA/NCC is out of scope) |
| Compliance links | Designed footprint is tested against the same setback envelope, site cover and BYDA buffers as an uploaded plan |

Phase 1 does not need to change: `plans.plan_overlays` already stores a footprint in MGA, and a designed layout can write the same kind of footprint, so downstream agents treat both sources identically.
