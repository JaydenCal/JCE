# Viewer target: "Inglis Street Grading Model" (user-supplied reference)

The final 3D experience must **display like this reference** (a single-file Three.js r147 review tool, 330 parts, about 5 MB, built from the Mudgee site model). The reference file is the user's project data, so it is **not committed**. Analysis notes below.

## What the reference does (to match)
- Top bar: title, subtitle, saved camera views (iso-sw, iso-ne, iso-se, plan, s, w, frontage, dda, west, entry, service).
- Canvas with orbit controls, compass, hover tag (part name), click to pick E, N, RL (AHD) and depth to existing ground, cut/fill colour legend.
- Right dock: **Layers** (19 grouped toggles: design surface, contours, existing ground TIN, context, buildings, drainage, tanks, walls, line marking, bollards, edge strips, boundary, lot boundaries, road, grade arrows, 4 label groups); **Display** (colour surface by cut/fill, buildings see-through, ground see-through for pits and pipes, edge lines, shadows, exaggerate levels x3); **Picked point**; **Design summary** table; **Review notes**.
- Light/dark theme, mobile layout (dock below canvas). Fonts Jost, IBM Plex Sans/Mono; accent #a8842f.
- Procedural textures (Colorbond trimclad, concrete, asphalt, grass); soft shadows; edge lines.

## Data format (`MODEL`)
```
info    { title, subtitle, FFL, origin:[E0,N0,0] }       coordinates are local metres relative to origin (MGA)
layers  [{ c:"surface", n:"Design surface", on:true }]
parts   [{ n:name, c:layerId, col:"#rrggbb", a:alpha, ro:roughness, me:metalness,
           f:<face/kind flag>, cs:<cast shadow>, tex:<texture key>, eml:<emissive>,
           v:[x,y,z, x,y,z, ...] }]                       flat triangle-soup (9 numbers per triangle); some parts are lines
labels  [{ t:text, p:[x,y,z], c:layerId, s:scale }]
views   { "iso-sw": { dir:[x,y,z] }, ... }
summary [[label, value], ...]      notes [string, ...]
```
**Sub-Agent 6 (GlideInside 3D sync) emits this format**, extended with placed-item and walkable-geometry data (see `docs/06-play-mode.md`). The frontend renderer targets it.

## New requirement (user): game-like play mode
Everything placeable in the site and the house, first-person mode, place real store items. Plan in `docs/06-play-mode.md`.
