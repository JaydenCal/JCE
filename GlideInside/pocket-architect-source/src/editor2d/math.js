// Pure helpers for the 2D editor: view transforms, snapping, hit tests, opening placement.
// No DOM access, so everything here is covered by tests/editor2d.test.mjs.

import * as G from '../model/geometry.js';

export const MIN_SCALE = 0.012; // px per mm
export const MAX_SCALE = 1.6;
export const DEFAULT_SCALE = 0.08;

// View: { scale, ox, oy }. screen = world * scale + offset, in CSS pixels.
export const worldToScreen = (v, p) => ({ x: p.x * v.scale + v.ox, y: p.y * v.scale + v.oy });
export const screenToWorld = (v, s) => ({ x: (s.x - v.ox) / v.scale, y: (s.y - v.oy) / v.scale });

export function zoomAt(v, s, factor, min = MIN_SCALE, max = MAX_SCALE) {
  const scale = G.clamp(v.scale * factor, min, max);
  const k = scale / v.scale;
  return { scale, ox: s.x - (s.x - v.ox) * k, oy: s.y - (s.y - v.oy) * k };
}

export const panBy = (v, dx, dy) => ({ scale: v.scale, ox: v.ox + dx, oy: v.oy + dy });

export function fitView(bounds, size, { padding = 64, minScale = MIN_SCALE, maxScale = 0.25 } = {}) {
  const b = bounds && (bounds.w > 0 || bounds.h > 0) ? bounds : { cx: 6000, cy: 4500, w: 12000, h: 9000 };
  const w = Math.max(b.w, 1500);
  const h = Math.max(b.h, 1500);
  const sx = Math.max(10, size.w - padding * 2) / w;
  const sy = Math.max(10, size.h - padding * 2) / h;
  const scale = G.clamp(Math.min(sx, sy), minScale, maxScale);
  return { scale, ox: size.w / 2 - b.cx * scale, oy: size.h / 2 - b.cy * scale };
}

// Grid spacing to draw so lines never get closer than about 7 px.
export function gridSpec(scale, gridMm = 100) {
  let minor = gridMm > 0 ? gridMm : 100;
  let major = minor * 10;
  while (minor * scale < 7 && minor < 1e7) {
    minor *= 10;
    major *= 10;
  }
  return { minor, major };
}

export function niceLength(maxMm) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(maxMm, 1)));
  for (const m of [5, 2, 1]) if (m * pow <= maxMm) return m * pow;
  return pow;
}
export function scaleBar(scale, targetPx = 120) {
  const mm = niceLength(targetPx / scale);
  return { mm, px: mm * scale };
}

// Extension status ------------------------------------------------------------
export const statusOf = (e) => e?.status || 'new';
// proposed = existing + new, existing = existing + demolish, both = everything
export function statusVisible(status, statusView = 'proposed') {
  const s = status || 'new';
  if (statusView === 'both') return true;
  if (statusView === 'existing') return s !== 'new';
  return s !== 'demolish';
}
// In the Existing view, work to be demolished is still standing, so it draws as existing.
export function drawStatus(status, statusView = 'proposed') {
  const s = status || 'new';
  return statusView === 'existing' && s === 'demolish' ? 'existing' : s;
}
export function hasExtensionContent(project) {
  const any = (e) => e.status === 'existing' || e.status === 'demolish';
  return project.levels.some((l) => l.walls.some(any) || l.rooms.some(any) || l.openings.some(any)) || (project.site?.tanks || []).some(any);
}

// Levels --------------------------------------------------------------------------
export const levelsByElevation = (project) => [...project.levels].sort((a, b) => a.elevation - b.elevation);
export const groundLevel = (project) => levelsByElevation(project)[0];
export function levelBelow(project, level) {
  const sorted = levelsByElevation(project);
  const i = sorted.findIndex((l) => l.id === level.id);
  return i > 0 ? sorted[i - 1] : null;
}

// Snapping --------------------------------------------------------------------------
// o: { level, scale, snapMm, snapOn, alt, endpoints, extraPoints, radiusPx, visible(wall) }
export function snapPoint(p, o) {
  const free = { x: Math.round(p.x), y: Math.round(p.y), kind: 'free' };
  if (o.alt || !o.snapOn) return free;
  if (o.endpoints !== false) {
    const r = (o.radiusPx ?? 10) / (o.scale || 1);
    let best = null;
    let bd = r;
    const consider = (q) => {
      const d = G.dist(p, q);
      if (d <= bd) {
        bd = d;
        best = q;
      }
    };
    if (o.level) {
      for (const w of o.level.walls) {
        if (o.visible && !o.visible(w)) continue;
        consider(w.a);
        consider(w.b);
      }
    }
    for (const q of o.extraPoints || []) consider(q);
    if (best) return { x: best.x, y: best.y, kind: 'endpoint' };
  }
  if (o.snapMm > 0) return { x: G.snap(p.x, o.snapMm), y: G.snap(p.y, o.snapMm), kind: 'grid' };
  return free;
}

// Lock direction to stepDeg increments from `from`; length rounds to snapMm.
export function constrainPoint(from, to, { stepDeg = 15, snapMm = 0 } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-6) return { x: Math.round(to.x), y: Math.round(to.y) };
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = snapMm > 0 ? Math.max(snapMm, Math.round(L / snapMm) * snapMm) : L;
  return { x: Math.round(from.x + Math.cos(a) * len), y: Math.round(from.y + Math.sin(a) * len) };
}

export function dragRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// Rotated rectangles (furniture, stairs) ----------------------------------------------------
export function toLocal(p, cx, cy, rotDeg) {
  const r = (-rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
export function toWorld(q, cx, cy, rotDeg) {
  const r = (rotDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: cx + q.x * c - q.y * s, y: cy + q.x * s + q.y * c };
}
export function rectCorners(cx, cy, w, d, rotDeg) {
  return [
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 },
  ].map((q) => toWorld(q, cx, cy, rotDeg));
}
export function pointInRotatedRect(p, cx, cy, w, d, rotDeg, pad = 0) {
  const q = toLocal(p, cx, cy, rotDeg);
  return Math.abs(q.x) <= w / 2 + pad && Math.abs(q.y) <= d / 2 + pad;
}
export const furnitureSize = (f, def) => ({ w: f.w ?? def?.w ?? 600, d: f.d ?? def?.d ?? 600 });

// Openings ----------------------------------------------------------------------------------
export function openingFrame(wall, o) {
  const d = G.wallDir(wall);
  const n = G.wallNormal(wall);
  const at = (u, v = 0) => ({ x: wall.a.x + d.x * u + n.x * v, y: wall.a.y + d.y * u + n.y * v });
  return { d, n, at, u0: o.offset - o.width / 2, u1: o.offset + o.width / 2, centre: at(o.offset) };
}

// Hinge point, leaf tips and arc of a hinged door, in plan coordinates.
export function doorGeometry(wall, o) {
  const f = openingFrame(wall, o);
  const hingeAtA = o.hinge !== 'b';
  const hinge = f.at(hingeAtA ? f.u0 : f.u1);
  const closedDir = hingeAtA ? f.d : { x: -f.d.x, y: -f.d.y };
  const side = o.side === -1 ? -1 : 1;
  const openDir = { x: f.n.x * side, y: f.n.y * side };
  return {
    hinge,
    closedDir,
    openDir,
    closedTip: { x: hinge.x + closedDir.x * o.width, y: hinge.y + closedDir.y * o.width },
    openTip: { x: hinge.x + openDir.x * o.width, y: hinge.y + openDir.y * o.width },
    radius: o.width,
    a0: Math.atan2(closedDir.y, closedDir.x),
    a1: Math.atan2(openDir.y, openDir.x),
    anticlockwise: G.cross(closedDir, openDir) < 0,
  };
}

// Where an opening of `spec.width` would sit if dropped at p. null when no wall is near.
// o: { snapMm, snapOn, alt, ignoreId, visible(wall), reachMm }
export function placeOpening(level, p, spec, o = {}) {
  let best = null;
  for (const w of level.walls) {
    if (o.visible && !o.visible(w)) continue;
    const r = G.projectToSegment(p, w.a, w.b);
    const reach = Math.max(o.reachMm ?? 0, (w.thickness || 100) / 2 + 100);
    if (r.d <= reach && (!best || r.d < best.r.d)) best = { wall: w, r };
  }
  if (!best) return null;
  const wall = best.wall;
  const L = G.wallLength(wall);
  const margin = 100;
  let offset = best.r.along;
  if (o.snapOn && !o.alt && o.snapMm > 0) offset = G.snap(offset, o.snapMm);
  let valid = true;
  let reason = '';
  const lo = margin + spec.width / 2;
  const hi = L - margin - spec.width / 2;
  if (hi < lo) {
    valid = false;
    reason = 'Does not fit in this wall';
    offset = L / 2;
  } else {
    offset = G.clamp(offset, lo, hi);
    const a = offset - spec.width / 2;
    const b = offset + spec.width / 2;
    const clash = level.openings.find((q) => q.wallId === wall.id && q.id !== o.ignoreId && G.openingSpan(q).start < b && G.openingSpan(q).end > a);
    if (clash) {
      valid = false;
      reason = 'Overlaps another opening';
    }
  }
  return { wall, offset, valid, reason, point: G.pointOnWall(wall, offset), distance: best.r.d };
}

// Offset of an opening dragged to point p, grabbed `grab` mm from its centre.
export function slideOffset(wall, p, grab = 0, { snapMm = 0, snapOn = false, alt = false } = {}) {
  let offset = G.projectToSegment(p, wall.a, wall.b).tRaw * G.wallLength(wall) - grab;
  if (snapOn && !alt && snapMm > 0) offset = G.snap(offset, snapMm);
  return offset;
}

// Hit testing ----------------------------------------------------------------------------------
export const HIT_ORDER = ['opening', 'furniture', 'tank', 'stair', 'wall', 'room'];

// o: { scale, tolPx, kinds, visible(status), furnSize(f) -> {w, d}, tanks (default true) }
export function hitTest(project, level, p, o = {}) {
  const tol = (o.tolPx ?? 6) / (o.scale || 1);
  const kinds = o.kinds || HIT_ORDER;
  const visible = o.visible || (() => true);
  const furnSize = o.furnSize || ((f) => furnitureSize(f, null));
  const wallsById = new Map(level.walls.map((w) => [w.id, w]));
  for (const kind of HIT_ORDER) {
    if (!kinds.includes(kind)) continue;
    if (kind === 'opening') {
      for (let i = level.openings.length - 1; i >= 0; i--) {
        const op = level.openings[i];
        const w = wallsById.get(op.wallId);
        if (!w || !visible(op.status) || !visible(w.status)) continue;
        const f = openingFrame(w, op);
        const u = G.dot(G.sub(p, w.a), f.d);
        const v = G.dot(G.sub(p, w.a), f.n);
        if (Math.abs(u - op.offset) <= op.width / 2 + tol * 0.5 && Math.abs(v) <= (w.thickness || 100) / 2 + tol) return { kind, id: op.id, item: op };
      }
    } else if (kind === 'furniture') {
      for (let i = level.furniture.length - 1; i >= 0; i--) {
        const f = level.furniture[i];
        const s = furnSize(f);
        if (pointInRotatedRect(p, f.x, f.y, s.w, s.d, f.rotation || 0, tol * 0.5)) return { kind, id: f.id, item: f };
      }
    } else if (kind === 'tank') {
      if (o.tanks === false) continue;
      const tanks = project.site?.tanks || [];
      for (let i = tanks.length - 1; i >= 0; i--) {
        const t = tanks[i];
        if (visible(t.status) && G.dist(p, t) <= t.diameter / 2 + tol * 0.5) return { kind, id: t.id, item: t };
      }
    } else if (kind === 'stair') {
      for (let i = level.stairs.length - 1; i >= 0; i--) {
        const s = level.stairs[i];
        if (pointInRotatedRect(p, s.x, s.y, s.width, s.length, s.rotation || 0, tol * 0.5)) return { kind, id: s.id, item: s };
      }
    } else if (kind === 'wall') {
      let best = null;
      for (const w of level.walls) {
        if (!visible(w.status)) continue;
        const d = G.projectToSegment(p, w.a, w.b).d;
        const reach = Math.max((w.thickness || 100) / 2, tol);
        if (d <= reach && (!best || d < best.d)) best = { d, w };
      }
      if (best) return { kind, id: best.w.id, item: best.w };
    } else if (kind === 'room') {
      let best = null;
      for (const r of level.rooms) {
        if (!visible(r.status) || !G.pointInPolygon(p, r.polygon)) continue;
        const a = G.polygonArea(r.polygon);
        if (!best || a < best.a) best = { a, r };
      }
      if (best) return { kind, id: best.r.id, item: best.r };
    }
  }
  return null;
}

// Underlay calibration: scale the image so p1 to p2 measures trueMm, keeping p1 fixed.
// Underlay x, y is the world position of the image centre; rotation is clockwise about it.
export function calibrateUnderlay(u, p1, p2, trueMm) {
  const measured = G.dist(p1, p2);
  if (!(measured > 0) || !(trueMm > 0)) throw new Error('Pick two different points and enter a distance above zero');
  const k = trueMm / measured;
  return { ...u, mmPerPx: u.mmPerPx * k, x: Math.round(p1.x + (u.x - p1.x) * k), y: Math.round(p1.y + (u.y - p1.y) * k) };
}

export function underlayCorners(u, imgW, imgH) {
  const w = imgW * u.mmPerPx;
  const h = imgH * u.mmPerPx;
  return rectCorners(u.x, u.y, w, h, u.rotation || 0);
}

// Text helpers ----------------------------------------------------------------------------------------
export const fmtMm = (mm) => `${Math.round(mm).toLocaleString('en-AU')} mm`;
export const fmtM = (mm) => `${(mm / 1000).toFixed(2)} m`;
export const fmtAreaM2 = (m2) => `${m2.toFixed(2)} m²`;
export const angleDeg = (a, b) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
