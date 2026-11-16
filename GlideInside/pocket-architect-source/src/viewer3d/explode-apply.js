// Applies the exploded view to a built model (a THREE.Group from build.js). No DOM, so it runs in node tests.
// A unit is one object that moves as a piece: a wall, a floor, a furniture group, the roof of a level. Offsets go on the topmost
// object under the level group, so rotated furniture groups still move along the world axes.

import { phases, offsetFor, opacityFor, classify, wallOwners } from './explode-logic.js';

function topOf(o, model) {
  let t = o;
  while (t.parent && t.parent !== model && !String(t.parent.name || '').startsWith('level:')) t = t.parent;
  return t;
}

// Gather the units of a model. Every unit that can fade (everything except the selected room) gets its own copy of its materials,
// because the material library shares them between meshes. restoreUnits() puts everything back.
export function collectUnits(model, project, selectedId) {
  const owners = wallOwners(project, selectedId);
  const byObj = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const c = classify(project, o.userData || {}, owners);
    if (!c) return;
    const top = topOf(o, model);
    let u = byObj.get(top);
    if (!u) {
      u = { obj: top, base: top.position.clone(), role: c.role, roomId: c.roomId, levelId: c.levelId, meshes: [], mats: new Map() };
      byObj.set(top, u);
    }
    u.meshes.push(o);
  });
  const units = [...byObj.values()];
  for (const u of units) {
    if (u.role === 'room' && u.roomId === selectedId) continue;
    for (const m of u.meshes) {
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const clones = list.map((mat) => {
        const c = mat.clone();
        c.userData = { ...(mat.userData || {}), shared: false };
        return c;
      });
      u.mats.set(m, {
        orig: m.material,
        clones,
        base: list.map((mat) => ({ o: mat.opacity, t: mat.transparent, w: mat.depthWrite })),
        cast: m.castShadow,
      });
      m.material = Array.isArray(m.material) ? clones : clones[0];
    }
  }
  return units;
}

export function restoreUnits(units) {
  for (const u of units) {
    u.obj.position.copy(u.base);
    for (const [m, rec] of u.mats) {
      if (m.parent) m.material = rec.orig;
      for (const c of rec.clones) c.dispose();
      m.castShadow = rec.cast;
    }
  }
}

// Move and fade the units for master progress p (or a ready made stage).
export function applyUnits(units, targets, selectedId, p) {
  const ph = typeof p === 'number' ? phases(p) : p;
  for (const u of units) {
    const off = offsetFor(targets, u, ph);
    u.obj.position.set(u.base.x + off.x, u.base.y + off.y, u.base.z + off.z);
    if (!u.mats.size) continue;
    const op = opacityFor(u, selectedId, ph);
    for (const [m, rec] of u.mats) {
      rec.clones.forEach((c, i) => {
        const b = rec.base[i];
        c.opacity = b.o * op;
        c.transparent = b.t || op < 0.999;
        c.depthWrite = op < 0.999 ? false : b.w;
      });
      m.castShadow = rec.cast && op > 0.5;
    }
  }
  return ph;
}
