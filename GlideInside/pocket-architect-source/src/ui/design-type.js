// Design type: swap the whole design for a generic template of another type (House, Granny flat, Duplex, Shed) while
// keeping the design's identity and title block details. One undo step. Used by the design summary and the template picker.

import { migrate } from '../model/schema.js';
import { toast } from './toast.js';

export const DESIGN_TYPES = [
  { id: 'house', label: 'House', template: 'house_single', generic: 'a generic 4 bedroom house' },
  { id: 'granny_flat', label: 'Granny flat', template: 'granny_flat', generic: 'a generic 2 bedroom granny flat' },
  { id: 'duplex', label: 'Duplex', template: 'duplex', generic: 'a generic duplex with two 3 bedroom units' },
  { id: 'shed', label: 'Shed', template: 'shed_workshop', generic: 'a generic garage and workshop shed' },
];
const BY_TEMPLATE = Object.fromEntries(DESIGN_TYPES.map((d) => [d.template, d.id]));
BY_TEMPLATE.house_double = 'house';
BY_TEMPLATE.shed_farm = 'shed';

/** The design type of a project: its stored designType, else read from its type and name. 'extension' is its own. */
export function designTypeOf(project) {
  if (DESIGN_TYPES.some((d) => d.id === project?.designType)) return project.designType;
  if (project?.type === 'shed') return 'shed';
  if (project?.type === 'extension') return 'extension';
  if (project?.type === 'unit') return /duplex/i.test(project.name || '') ? 'duplex' : 'granny_flat';
  return 'house';
}

export const designTypeFor = (templateId) => BY_TEMPLATE[templateId] || null;

const hasContent = (p) => p.levels.some((l) => l.rooms.length || l.walls.length || l.furniture.length);

/**
 * The project that replaces `current` for design type `typeId`: the template's levels, settings, finishes and tanks, with
 * the current id, title block, drawing setup, north point and underlay kept. A template-named design takes the new name.
 */
export function buildDesignType(current, typeId, catalogue) {
  const type = DESIGN_TYPES.find((d) => d.id === typeId);
  if (!type) throw new Error(`Unknown design type ${typeId}`);
  const tpl = catalogue?.templates?.find((t) => t.id === type.template);
  if (!tpl) throw new Error('That design type is not available.');
  const fresh = migrate(catalogue.createFromTemplate ? catalogue.createFromTemplate(tpl.id) : tpl.create());
  const templateNames = new Set((catalogue.templates || []).map((t) => t.name));
  const keepName = current.name && current.name !== 'Untitled design' && !templateNames.has(current.name);
  const next = {
    ...fresh,
    id: current.id,
    name: keepName ? current.name : fresh.name,
    designType: type.id,
    createdAt: current.createdAt || fresh.createdAt,
    titleBlock: structuredClone(current.titleBlock || fresh.titleBlock),
    drawing: structuredClone(current.drawing || fresh.drawing),
    site: { ...fresh.site, northDeg: current.site?.northDeg ?? fresh.site.northDeg, underlay: current.site?.underlay ?? null },
  };
  return migrate(next);
}

/** Replace the store's project contents in place as one undoable step. */
export function applyDesignType(store, typeId, catalogue) {
  const next = buildDesignType(store.project, typeId, catalogue);
  const label = DESIGN_TYPES.find((d) => d.id === typeId).label;
  store.apply(`Change to ${label.toLowerCase()}`, (p) => {
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, structuredClone(next));
  });
  store.select(null);
  store.setUI({ activeLevelId: store.project.levels[0].id, levelFilter: 'all' });
  return store.project;
}

/**
 * Ask (in page) and then change the design type. Resolves true when the design was changed.
 * An empty design changes without asking. Choosing the current type does nothing.
 */
const askInPage = async (o) => (await import('./modal.js')).askConfirm(o);

export async function changeDesignType(store, typeId, catalogue, { confirm = askInPage } = {}) {
  const type = DESIGN_TYPES.find((d) => d.id === typeId);
  if (!type || typeId === designTypeOf(store.project)) return false;
  if (hasContent(store.project)) {
    const ok = await confirm({
      title: `Change to ${type.label.toLowerCase()}?`,
      message: `Replace this design with ${type.generic}? You can undo.`,
      confirmLabel: 'Replace design',
      cancelLabel: 'Keep my design',
    });
    if (!ok) return false;
  }
  try {
    applyDesignType(store, typeId, catalogue);
  } catch (e) {
    toast(e?.message || 'That design type could not be loaded.', { kind: 'error' });
    return false;
  }
  toast(`Changed to ${type.generic}. Title block details kept.`, { kind: 'ok', action: { label: 'Undo', onClick: () => store.undo() } });
  return true;
}
