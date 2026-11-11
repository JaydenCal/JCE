# Room snapping (3D viewer)

Engine for the room tabs under the 3D view: snap the camera to a room, fly between rooms, a double click cutaway and a room bar while walking.
Code: `src/viewer3d/rooms.js` (viewer glue) and `src/viewer3d/room-logic.js` (pure geometry and wording, no three, no DOM). Tests: `tests/rooms.test.mjs`.

## Calling it from the lot card

The app's viewer is `window.__ps.getViewer()` (null until the 3D view has loaded; `await window.__ps.getViewer.ensure()` loads it).

```js
const v = await window.__ps.getViewer.ensure();
const tabs = v.roomTabs();            // [{ id, label, roomIds, caption, levelId }], 'aerial' always last
await v.snapToRoom('living');         // eased flight to that tab's eye viewpoint (about 1.2 s)
await v.snapToRoom('aerial');         // back to the site view (leaves walk mode if walking)
await v.snapToRoom(roomId);           // any room id works too
v.snapToRoom('kitchen', { duration: 0 });   // jump, no glide
v.flyTo({ position: {x,y,z}, target: {x,y,z}, fov? }, { duration: 1.2, ease });
```

`snapToRoom` resolves to `{ completed, pose }` (or `null` for an unknown tab). `completed` is false when the person took over mid flight.

### Tabs

`roomTabs(levelId?, { groupBedrooms })` (also `listRoomTabs(project, levelId?, opts)` exported from `rooms.js`):

| id | label | rooms |
| --- | --- | --- |
| `living` | Living | type living, family, rumpus, media, or a name with lounge, living, family, rumpus, media, theatre |
| `kitchen` | Kitchen | type kitchen or a name with kitchen |
| `dining` | Dining | type dining or a name with dining, meals |
| `master` | Master | name with master, main bed, primary or bed 1; else the first bedroom |
| `bed2`, `bed3` ... | Bed 2 ... | the other bedrooms, by number in the name |
| `alfresco` | Alfresco | alfresco, patio, deck, verandah, outdoor |
| `garage` | Garage | garage (not carport) |
| `aerial` | Aerial | no rooms; the existing aerial pose |

Only tabs whose rooms exist are returned. An open plan room ("Kitchen, dining and family") serves the living, kitchen and dining tabs, each with its own viewpoint
(the kitchen and dining tabs look at that furniture group from about 5 m off). `groupBedrooms: true` returns one `bedrooms` tab instead of master and bed2...

`caption` is `"Living area · A view across the living room to the alfresco."`: the area, then a sentence built from the room and its largest opening or adjacent
living space. It never contains a dash.

### Viewpoints

`roomViewpoint(project, roomId, { group? })` returns `{ position, target, levelId, roomId, fov }` in metres (world space): eye at 1.6 m above the level's floor, inside
the room at least 0.4 m from wall faces and room edges and off the furniture footprints (the margin is only relaxed in rooms too small to allow it), in the corner
that looks across the room to its largest opening or adjacent living space. `tabViewpoint(project, tab)` does the same for a tab.

## Camera behaviour

- `flyTo` eases position and look target (orbit mode) or the walker's position and look direction (walk mode, via `walk.placeAt`; the walking level switches at the end). The field of view eases between 70 degrees inside a room and 38 degrees outside.
- A pointer press, wheel, touch or movement key cancels the flight where it is. A new flight replaces the old one. Reduced motion jumps straight there.
- Cutaway: double click a room floor, wall, window or roof in the orbit view. The camera flies to about 52 degrees over that room, centred, and the roof and upper levels are hidden (`ui.showRoof`, `ui.levelFilter`). They come back on Escape, any other view change or snap, walk mode, zooming or orbiting well away, or when the person changes those toggles themselves.
- Walk mode: a slim row of room buttons along the bottom (the same chip styling as the view buttons); keys 1 to 9 do the same. Only the rooms that exist are shown.

## Wiring

`createViewer3D` (viewer.js) calls `enableRoomCutaway` and `createRoomBar` itself, so none of this needs the lot card. Extra viewer API: `snapToRoom`, `roomTabs`, `flyTo`,
`addDoubleClickHandler(fn)` (return true to consume a double click), `aerialPose()`, `leaveWalk()`, `invalidate()`, `stopAnim()`, `store`, `rootEl`, `canvas`.

Review screenshots (1440 x 900, review build with the mock flags set in a scratch copy only): `docs/rooms-review/`.
