// Placeholder until the server stage: re-sampling a web mercator aerial into a north up MGA image (used only when the imagery
// service cannot draw directly in MGA). See server/lib/site.js.
export async function warpToMga() {
  throw new Error('The imagery service did not return an MGA image');
}
