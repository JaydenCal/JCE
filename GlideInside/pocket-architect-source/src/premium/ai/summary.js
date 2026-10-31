// Plain-English descriptions of the operations the assistant applies, for the undo label ("AI: Roof colour set to
// Charcoal") and the list of changes under each reply. Describe BEFORE applying, so deleted elements still have names.

import { findEntity } from '../../model/ops.js';
import { humanise, plural } from '../util.js';

const TARGET_NAMES = {
  external_walls: 'External walls',
  internal_walls: 'Internal walls',
  roof: 'Roof',
  fascia: 'Fascia and gutters',
  frames: 'Window and door frames',
  floors: 'Floors',
};
const PALETTE_PREFIX = /^(steel|paint|brick|stone|tile|floor|frame)-/;

/** Display names for catalogue ids. Falls back to a tidied version of the id when the catalogue is missing. */
export function nameResolver(catalogue = null) {
  const fin = catalogue?.finishes || catalogue;
  const lookup = (fn, id) => {
    try {
      return typeof fn === 'function' ? fn(id) : null;
    } catch {
      return null;
    }
  };
  return {
    colour: (id) => lookup(fin?.getColour, id)?.name || humanise(String(id).replace(PALETTE_PREFIX, '')),
    material: (id) => lookup(fin?.getMaterial, id)?.name || humanise(id),
    furniture: (id) => lookup(catalogue?.getFurniture || catalogue?.furniture?.getFurniture, id)?.name || humanise(id),
  };
}

const metres = (mm) => `${(Math.abs(Number(mm)) / 1000).toFixed(1)} m`;
const lower = (s) => String(s || '').toLowerCase();
const upperFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A short noun phrase for an element id, e.g. "the Living room", "a sofa". */
function labelFor(project, id, names) {
  const f = findEntity(project, id);
  if (!f) return 'an element';
  const { kind, item } = f;
  switch (kind) {
    case 'room':
      return item.name || `the ${lower(humanise(item.type))}`;
    case 'furniture':
      return lower(names.furniture(item.item));
    case 'opening':
      return `a ${lower(humanise(item.kind || 'opening'))}`;
    case 'level':
      return item.name || 'the level';
    case 'tank':
      return 'the rainwater tank';
    case 'stair':
      return 'the stairs';
    default:
      return `a ${kind}`;
  }
}

/** One short sentence, no trailing full stop. */
export function describeOp(op, a = {}, project, names = nameResolver(null)) {
  const who = (id) => labelFor(project, id, names);
  switch (op) {
    case 'set_finish': {
      const t = TARGET_NAMES[a.target] || humanise(a.target);
      if (a.material && a.colour) return `${t} set to ${names.colour(a.colour)} ${lower(names.material(a.material))}`;
      if (a.colour) return `${t} colour set to ${names.colour(a.colour)}`;
      return `${t} material set to ${lower(names.material(a.material))}`;
    }
    case 'set_roof': {
      const parts = [];
      if (a.enabled === false) parts.push('Roof turned off');
      if (a.enabled === true) parts.push('Roof turned on');
      if (a.type) parts.push(`Roof changed to ${lower(humanise(a.type))}`);
      if (a.pitch != null) parts.push(`pitch set to ${a.pitch} degrees`);
      if (a.overhang != null) parts.push(`eaves set to ${a.overhang} mm`);
      return parts.length ? upperFirst(parts.join(', ')) : 'Roof changed';
    }
    case 'add_room': {
      const size = a.width && a.depth ? ` (${(Math.abs(a.width) / 1000).toFixed(1)} by ${metres(a.depth)})` : '';
      return `Added ${a.name || lower(humanise(a.type || 'room'))}${size}`;
    }
    case 'add_room_polygon':
      return `Added ${a.name || lower(humanise(a.type || 'room'))}`;
    case 'update_room': {
      const room = who(a.id);
      if (a.name) return `Renamed ${room} to ${a.name}`;
      if (a.floor_material || a.floor_colour) return `Floor of ${room} changed`;
      return `Updated ${room}`;
    }
    case 'resize_room': {
      const grow = Number(a.delta) >= 0;
      return `${upperFirst(who(a.id))} ${grow ? 'extended' : 'reduced'} ${metres(a.delta)} ${a.side}`;
    }
    case 'add_wall':
      return 'Added a wall';
    case 'update_wall':
      return 'Updated a wall';
    case 'move_wall':
      return 'Moved a wall';
    case 'add_opening':
      return `Added a ${lower(humanise(a.kind || 'opening'))}`;
    case 'update_opening':
      return `Updated ${who(a.id)}`;
    case 'add_furniture':
      return `Added ${lower(names.furniture(a.item))}`;
    case 'update_furniture':
      return `Updated ${who(a.id)}`;
    case 'move':
      return `Moved ${who(a.id)}`;
    case 'delete':
      return `Deleted ${who(a.id)}`;
    case 'add_tank':
      return `Added a ${a.capacity_l ? `${a.capacity_l} L ` : ''}rainwater tank`;
    case 'update_tank':
      return 'Updated the rainwater tank';
    case 'mirror_plan':
      return `Flipped the plan ${a.axis === 'top_bottom' ? 'top to bottom' : 'left to right'}`;
    case 'add_level':
      return `Added a level${a.name ? ` (${a.name})` : ''}`;
    case 'update_level':
      return `Updated ${who(a.id)}`;
    case 'add_stair':
      return 'Added stairs';
    case 'set_status': {
      const n = Array.isArray(a.ids) ? a.ids.length : 0;
      const tail = a.status === 'demolish' ? 'for demolition' : `as ${a.status}`;
      return `Marked ${n || 'some'} ${plural(n, 'element')} ${tail}`;
    }
    case 'set_project':
      return a.name ? `Renamed the project to ${a.name}` : 'Updated the project details';
    default:
      return humanise(op);
  }
}

/** The undo label text after "AI: ", at most about 60 characters. */
export function summariseOps(phrases, max = 60) {
  const list = phrases.filter(Boolean);
  if (!list.length) return 'no changes';
  let text = list[0];
  if (list.length > 1) text += ` and ${list.length - 1} more`;
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}
