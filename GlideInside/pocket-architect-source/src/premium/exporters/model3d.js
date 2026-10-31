// 3D model export: GLB (glTF 2.0 binary, metres, Y up) and OBJ with MTL.
// Uses the same model builder as the 3D view (src/viewer3d/build.js, no DOM access). Node compatible.
// Import this module lazily: it pulls in three.js and the exporters.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { buildModel } from '../../viewer3d/build.js';

// Base64 without Buffer, so this also runs on edge runtimes.
function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// GLTFExporter reads blobs with FileReader. Node and edge runtimes have none, so give it a minimal one.
function ensureFileReader() {
  if (typeof globalThis.FileReader !== 'undefined') return;
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
    }

    finish(promise, convert) {
      promise.then(
        (buf) => {
          this.result = convert(buf);
          this.onloadend?.({ target: this });
        },
        (e) => this.onerror?.(e),
      );
    }

    readAsArrayBuffer(blob) {
      this.finish(blob.arrayBuffer(), (buf) => buf);
    }

    readAsDataURL(blob) {
      this.finish(blob.arrayBuffer(), (buf) => `data:${blob.type || 'application/octet-stream'};base64,${toBase64(buf)}`);
    }
  };
}

function modelFor(project, catalogue) {
  const group = buildModel(project, { THREE, catalogue, showRoof: true, statusView: 'proposed', levelFilter: 'all' });
  if (!group) throw new Error('The 3D model builder returned nothing');
  group.name = String(project.name || 'Design');
  // The 3D view draws a large lawn disc around the house. A model file holds the building only, so a person who opens
  // it in Blender sees the real size and can add their own ground.
  const lawn = group.getObjectByName('ground');
  if (lawn) {
    lawn.removeFromParent();
    lawn.geometry?.dispose?.();
  }
  group.updateMatrixWorld(true);
  // Texture images need a canvas, which a server does not have. Colours are kept, textures dropped there.
  if (typeof document === 'undefined') {
    group.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        if (m?.map) m.map = null;
        if (m?.normalMap) m.normalMap = null;
        if (m?.roughnessMap) m.roughnessMap = null;
        if (m?.bumpMap) m.bumpMap = null;
      }
    });
  }
  return group;
}

/** GLB as an ArrayBuffer (starts with the ASCII bytes "glTF"). */
export async function toGLB(project, { catalogue = null } = {}) {
  ensureFileReader();
  const group = modelFor(project, catalogue);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(group, { binary: true, onlyVisible: true, trs: false });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLB export did not produce binary output');
  return result;
}

const hex = (m) => (m?.color ? m.color.getHexString() : 'cccccc');

function nameMaterials(group) {
  const used = new Map();
  group.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material) || !o.material) return;
    const m = o.material;
    if (!m.name) m.name = `mat_${hex(m)}${m.transparent && m.opacity < 1 ? `_a${Math.round(m.opacity * 100)}` : ''}`;
    if (!used.has(m.name)) used.set(m.name, m);
  });
  return used;
}

function mtlFor(materials) {
  const out = ['# Plan Studio materials'];
  for (const [name, m] of materials) {
    const c = hex(m);
    const r = (parseInt(c.slice(0, 2), 16) / 255).toFixed(4);
    const g = (parseInt(c.slice(2, 4), 16) / 255).toFixed(4);
    const b = (parseInt(c.slice(4, 6), 16) / 255).toFixed(4);
    out.push('', `newmtl ${name}`, `Kd ${r} ${g} ${b}`, 'Ka 0.0000 0.0000 0.0000', 'Ks 0.0500 0.0500 0.0500', 'illum 2');
    if (m.transparent && m.opacity < 1) out.push(`d ${m.opacity.toFixed(3)}`);
  }
  return `${out.join('\n')}\n`;
}

/** OBJ text (geometry and usemtl names). Materials are written by toOBJBundle. */
export function toOBJ(project, { catalogue = null } = {}) {
  const group = modelFor(project, catalogue);
  nameMaterials(group);
  return new OBJExporter().parse(group);
}

/** { obj, mtl } ready to zip: the OBJ refers to model.mtl. */
export function toOBJBundle(project, { catalogue = null } = {}) {
  const group = modelFor(project, catalogue);
  const materials = nameMaterials(group);
  const obj = `# Plan Studio, units metres, Y up\nmtllib model.mtl\n${new OBJExporter().parse(group)}`;
  return { obj, mtl: mtlFor(materials) };
}
