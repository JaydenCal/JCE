// Walls over the lot boundary or inside the setback glow red in 3D (the 2D plan draws the same walls red). The overlay is a
// thin shell around each breaching exterior wall: unlit, slightly translucent, no shadow, disposed with the model.

import * as THREE from 'three';
import { lotChecks } from '../site/lot-checks.js';
import * as G from '../model/geometry.js';

export function addBreachOverlay(model, project) {
  const c = lotChecks(project);
  if (!c.breachWallIds.size) return null;
  const group = new THREE.Group();
  group.name = 'breach-walls';
  const mat = new THREE.MeshBasicMaterial({ color: 0xd8321f, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData = { shared: false };
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  for (const level of levels) {
    for (const w of level.walls || []) {
      if (!c.breachWallIds.has(w.id)) continue;
      let ring;
      try { ring = G.wallPolygon(w); } catch { continue; }
      const pts = ring.map((p) => new THREE.Vector2(p.x / 1000, p.y / 1000));
      const H = (w.height ?? level.height) / 1000;
      const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: H + 0.04, bevelEnabled: false });
      // Shape is in XY, extruded along +Z: lay it down so plan y is world Z and the extrusion rises along world Y.
      geo.rotateX(Math.PI / 2);
      geo.scale(1, -1, 1);
      geo.translate(0, 0, 0);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = level.elevation / 1000 - 0.02;
      m.renderOrder = 6;
      m.castShadow = false;
      m.receiveShadow = false;
      m.name = `breach-${w.id}`;
      group.add(m);
    }
  }
  if (!group.children.length) return null;
  model.add(group);
  return group;
}
