# Aerial edge and Open full editor button

Branch claude/aerial-edge (release-6 merged in, then the earlier agent's snapshot 6cda462 is already in history).

## Changes
- Aerial edge (src/viewer3d/terrain.js): when the wide aerial tile is loaded, the sharp inner tile now shows the photograph in full across the whole tile (the old fade to a lawn and paddock tone beyond about 150 m is only used when there is no wide tile). That fade made a visible darker or lighter disc around the lot. The inner tile still melts into the wide tile at its rim, and the wide tile still fades into a world grain textured ground ring and then the sky haze, so there is no hard boundary and no flat olive ring. Shader cache key bumped.
- The embed already requests the wide tile through the same lookup as the full editor (fetchSite, and ensureFlowAerial for the commercial viewer). Verified in the harness: both tiles present for the sample lot and a 27 ha rural lot (wide tile surrounds the inner tile).
- Open full editor (src/lotcard/lot-card.js, lot-card-css.js, src/commercial/lotcard.js, src/site/upload/css.js): a 44 px high gold (site accent #e9b66f, dark ink) pill button at the top right of the embed, on residential and commercial cards. It is a real button (Tab reaches it, Enter and Space open the editor, white focus ring), same action as before. The menu item stays. Hidden in 2D and split views; compact layout has its own position. The Upload boundary pill moved down 6 px.
- Faster scroll zoom (58cc4b8) kept untouched.

## Tests
Related files (lotcard, commercial-lotcard, embed-viewer, view3d-site): 53 pass, 0 fail. Full suite result in the final message.

## Screenshots (/home/claude/shots/aerial-edge/)
sample-embed-{landing,low,lowside,high,edge}.png, sample-editor-{landing,low,lowside,high,edge}.png, rural-embed-{landing,low,lowside,high,edge}.png, rural-editor-landing.png.
Harness: /home/claude/aerial-edge-tools/shots.cjs (synthetic aerial world, stubbed /api/site). The first pose shot after landing (the "low" shots) can still show the landing frame because the camera had not rendered yet; "lowside" and "edge" show the low oblique horizon.
Notes: the synthetic source imagery is coarse (0.75 m per world pixel), so blockiness in the foreground comes from the test picture, not the shader. The renderer's sharpening is unchanged.

## Left
- Rural 3D editor screenshots at the oblique and top poses were not captured (headless software GL stalled under machine load); the editor uses the same terrain code as the embed.
- Real imagery was not used (no network); look once on a real lot after deploy.
