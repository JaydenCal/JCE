// One entry point for every paid export. Used by the server (after an entitlement check) and by the
// local dev unlock path in the browser. Each exporter is imported on demand, so a missing 3D builder
// only affects the 3D formats. Pure of DOM access, Node compatible.

import { slugify } from './shared.js';

export const EXPORT_TYPES = {
  pdf: { mime: 'application/pdf', label: 'PDF plans' },
  dxf: { mime: 'application/dxf', label: 'DXF' },
  glb: { mime: 'model/gltf-binary', label: '3D model (GLB)' },
  obj: { mime: 'application/zip', label: '3D model (OBJ)' },
};

export const exportFilename = (type, project) => {
  const slug = slugify(project?.name);
  return { pdf: `${slug}-plans.pdf`, dxf: `${slug}.dxf`, glb: `${slug}.glb`, obj: `${slug}-obj.zip` }[type];
};

/**
 * Build one export. options: { jsPDF, loadJsPDF, image, config, catalogue, layerMap, scale }.
 * Returns { bytes: Uint8Array, mime, filename }.
 */
export async function buildExport(type, project, options = {}) {
  if (!EXPORT_TYPES[type]) throw new Error(`Unknown export type ${type}`);
  const { catalogue = null, config = {} } = options;
  let bytes;
  if (type === 'dxf') {
    const { toDXF } = await import('./dxf.js');
    bytes = new TextEncoder().encode(toDXF(project, { layerMap: options.layerMap, catalogue, notes: config.disclaimer ? [config.disclaimer] : [] }));
  } else if (type === 'pdf') {
    const { toPDF } = await import('./pdf.js');
    const jsPDF = options.jsPDF || (await options.loadJsPDF?.());
    bytes = toPDF(project, { jsPDF, image: options.image || null, config, catalogue, scale: options.scale || null });
  } else if (type === 'glb') {
    const { toGLB } = await import('./model3d.js');
    bytes = new Uint8Array(await toGLB(project, { catalogue }));
  } else {
    const { toOBJBundle } = await import('./model3d.js');
    const { zipStore } = await import('./zip.js');
    const { obj, mtl } = toOBJBundle(project, { catalogue });
    const slug = slugify(project?.name);
    bytes = zipStore([
      { name: `${slug}.obj`, data: obj.replace('mtllib model.mtl', `mtllib ${slug}.mtl`) },
      { name: `${slug}.mtl`, data: mtl },
    ]);
  }
  return { bytes, mime: EXPORT_TYPES[type].mime, filename: exportFilename(type, project) };
}
