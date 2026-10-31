// Compact plan context for the AI assistant: plain text, one element per line (docs/SCOPE.md 7.6).
// Plain text uses far fewer tokens than JSON. No DOM or Node APIs, so the server can reuse it.

import * as G from '../../model/geometry.js';

export const DEFAULT_TOKEN_CAP = 40000;

/** Token estimate used for the pre-flight credit estimate: characters divided by 3.5, rounded up. */
export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 3.5);

const int = (v) => String(Math.round(Number(v) || 0));
const text = (s) => `"${String(s ?? '').replace(/"/g, "'").replace(/\s+/g, ' ').trim().slice(0, 60)}"`;
const finish = (f) => (f ? [f.material, f.colour].filter(Boolean).join('/') : '');
const pt = (p) => `(${int(p.x)},${int(p.y)})`;
const range = (a, b) => `${int(a)}..${int(b)}`;

// A room is a rectangle when it has four distinct corners on its bounding box.
function rectOf(poly) {
  if (!Array.isArray(poly) || poly.length !== 4) return null;
  const bb = G.bbox(poly);
  const eps = 1;
  const corner = (p) => {
    const cx = Math.abs(p.x - bb.minX) <= eps ? 0 : Math.abs(p.x - bb.maxX) <= eps ? 1 : -1;
    const cy = Math.abs(p.y - bb.minY) <= eps ? 0 : Math.abs(p.y - bb.maxY) <= eps ? 1 : -1;
    return cx < 0 || cy < 0 ? null : `${cx}${cy}`;
  };
  const keys = poly.map(corner);
  return keys.every(Boolean) && new Set(keys).size === 4 ? bb : null;
}

function finishLine(project, detail) {
  const f = project.finishes || {};
  const parts = [`ext_walls=${finish(f.externalWalls)}`, `roof=${finish(f.roof)}`, `frames=${finish(f.frames)}`];
  if (detail) {
    parts.splice(1, 0, `int_walls=${finish(f.internalWalls)}`);
    parts.push(`fascia=${finish(f.fascia)}`, `floors=${finish(f.floors)}`);
  }
  return `FINISH ${parts.join(' ')}`;
}

function roomLine(room, level, detail) {
  const bb = rectOf(room.polygon);
  const shape = bb ? `rect x=${range(bb.minX, bb.maxX)} y=${range(bb.minY, bb.maxY)}` : `poly ${room.polygon.map(pt).join(' ')}`;
  const flags = [];
  if (room.outdoor) flags.push('outdoor');
  if (room.roofed) flags.push('roofed');
  if (room.balustrade) flags.push('balustrade');
  if (room.status && room.status !== 'new') flags.push(room.status);
  if (detail && room.floor) flags.push(`floor=${finish(room.floor)}`);
  const area = (G.polygonArea(room.polygon) / 1e6).toFixed(2);
  return `ROOM ${room.id} ${text(room.name)} ${room.type} ${shape} area=${area}${flags.length ? ` ${flags.join(' ')}` : ''}`;
}

function wallLine(w, detail) {
  const bits = [`WALL ${w.id} ${pt(w.a)}-${pt(w.b)}`, w.kind === 'interior' ? 'int' : 'ext', `t=${int(w.thickness)}`, w.status || 'new'];
  if (w.height != null) bits.push(`h=${int(w.height)}`);
  if (detail && w.finish) bits.push(`finish=${finish(w.finish)}`);
  return bits.join(' ');
}

function openingLine(o, detail) {
  const bits = [`OPEN ${o.id} ${o.kind} on ${o.wallId} centre=${int(o.offset)} w=${int(o.width)} h=${int(o.height)}`];
  if (o.kind === 'window') bits.push(`sill=${int(o.sill)}`);
  if (o.kind === 'door') bits.push(`hinge=${o.hinge || 'a'} side=${o.side === -1 ? -1 : 1}`);
  if (detail && o.style && o.style !== 'none') bits.push(String(o.style));
  if (o.status && o.status !== 'new') bits.push(o.status);
  return bits.join(' ');
}

function furnitureLines(level, mode) {
  if (!level.furniture.length || mode === 'none') {
    return level.furniture.length ? [`FURN omitted ${level.furniture.length} items`] : [];
  }
  const roomOf = (f) => G.roomAt(level, f)?.id || null;
  if (mode === 'summary') {
    const byRoom = new Map();
    for (const f of level.furniture) {
      const key = roomOf(f) || 'none';
      const counts = byRoom.get(key) || new Map();
      counts.set(f.item, (counts.get(f.item) || 0) + 1);
      byRoom.set(key, counts);
    }
    return [...byRoom].map(([room, counts]) => `FURN in ${room}: ${[...counts].map(([item, c]) => `${item} x${c}`).join(', ')}`);
  }
  return level.furniture.map((f) => {
    const room = roomOf(f);
    const size = f.w != null || f.d != null ? ` w=${int(f.w)} d=${int(f.d)}` : '';
    return `FURN ${f.id} ${f.item} at ${pt(f)} rot=${int(f.rotation)}${size}${room ? ` in ${room}` : ''}`;
  });
}

function render(project, activeLevelId, tier) {
  const detail = tier < 1;
  const furnitureMode = tier < 1 ? 'full' : tier < 2 ? 'summary' : 'none';
  const collapseOthers = tier >= 3;
  const lines = [];
  const north = Number(project.site?.northDeg) || 0;
  lines.push(`PROJECT ${text(project.name)} type=${project.type} units=mm x=right y=down(south)${north ? ` north=${int(north)}deg` : ''}`);
  const bb = G.projectBounds(project);
  if (bb) lines.push(`BOUNDS x=${range(bb.minX, bb.maxX)} y=${range(bb.minY, bb.maxY)}`);
  lines.push(finishLine(project, detail));
  lines.push(`ACTIVE_LEVEL ${activeLevelId || project.levels[0]?.id}`);
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation);
  for (const level of levels) {
    const active = level.id === activeLevelId;
    const roof = level.roof?.enabled === false ? 'roof=off' : `roof=${level.roof?.type} ${level.roof?.pitch}deg eaves=${int(level.roof?.overhang)}`;
    lines.push(`LEVEL ${level.id} ${text(level.name)} ffl=${int(level.elevation)} ceiling=${int(level.height)} ${roof}${active ? ' active' : ''}`);
    for (const r of level.rooms) lines.push(roomLine(r, level, detail));
    if (collapseOthers && !active) {
      lines.push(`WALLS omitted ${level.walls.length} walls, ${level.openings.length} openings`);
    } else {
      for (const w of level.walls) lines.push(wallLine(w, detail));
      for (const o of level.openings) lines.push(openingLine(o, detail));
    }
    for (const s of level.stairs) lines.push(`STAIR ${s.id} at ${pt(s)} w=${int(s.width)} len=${int(s.length)} rot=${int(s.rotation)}`);
    lines.push(...furnitureLines(level, collapseOthers && !active ? 'none' : furnitureMode));
  }
  for (const t of project.site?.tanks || []) {
    lines.push(`TANK ${t.id} ${int(t.capacityL)}L at ${pt(t)} d=${int(t.diameter)}${detail ? ` colour=${t.colour}` : ''}${t.status && t.status !== 'new' ? ` ${t.status}` : ''}`);
  }
  return lines;
}

/**
 * Build the context text. Returns { text, tokens, trimmed }.
 * Over the token cap, furniture and finish detail are summarised first, then furniture is dropped,
 * then wall detail on levels other than the active one, and finally the text is cut at a line end.
 */
export function buildContext(project, { activeLevelId, maxTokens = DEFAULT_TOKEN_CAP } = {}) {
  let tier = 0;
  let out = render(project, activeLevelId, tier).join('\n');
  while (estimateTokens(out) > maxTokens && tier < 3) {
    tier += 1;
    out = render(project, activeLevelId, tier).join('\n');
  }
  let trimmed = tier > 0;
  if (estimateTokens(out) > maxTokens) {
    const limit = Math.floor(maxTokens * 3.5) - 40;
    out = `${out.slice(0, Math.max(0, out.lastIndexOf('\n', limit)))}\nCONTEXT TRUNCATED`;
    trimmed = true;
  }
  return { text: out, tokens: estimateTokens(out), trimmed };
}

export function compactContext(project, opts = {}) {
  return buildContext(project, opts).text;
}

export default compactContext;
