/**
 * Grouped layer toggles of the viewer (stage 11): terrain, aerial, context, design objects by type, services by kind and stormwater results.
 *
 * Keys: a scene bundle layer keeps its class code (`surface`, `aerial`, ...); a site design object type is `type:<object type>`; a service is `service:<kind>`; the overland flow layer
 * of the stormwater helper is `sw:overland`. A key that has no entry in the state is ON. Pure functions only (the component and the engine apply the result).
 */
import { SERVICE_KINDS, SERVICE_KIND_LABEL, OBJECT_KINDS, type ObjectType, type ServiceKind, type SiteDesign, type SiteObject } from '../site/types';
import { isServiceType, serviceKind } from '../site/services';
import { AERIAL_LAYER } from './aerial';
import type { LayerDef } from './types';

export type GroupId = 'terrain' | 'aerial' | 'context' | 'design' | 'services' | 'stormwater';
export interface LayerEntry { key: string; label: string; /** how many site design objects this entry holds (absent for a bundle layer) */ count?: number }
export interface LayerGroup { id: GroupId; title: string; entries: LayerEntry[] }

export const OVERLAND_KEY = 'sw:overland';
export const GROUP_TITLES: Record<GroupId, string> = { terrain: 'Terrain', aerial: 'Aerial imagery', context: 'Context', design: 'Design objects', services: 'Services', stormwater: 'Stormwater results' };
const TERRAIN = new Set(['surface', 'existing', 'contours', 'cutfill']);
const SERVICE_BUNDLE = new Set(['services', 'buffers', 'lab_svc']);
const DESIGN_BUNDLE = new Set(['buildings', 'drainage', 'tanks', 'walls', 'driveway', 'sweptpath', 'items', 'design']);

export const typeKey = (t: string) => `type:${t}`;
export const serviceKey = (k: string) => `service:${k}`;
/** The layer key of a site design object: a service by its kind (a drain or water service by its own kind), anything else by its type. */
export function objectLayerKey(o: SiteObject): string {
  if (!isServiceType(o.type)) return typeKey(o.type);
  const k: ServiceKind = o.type === 'sewer_drain' ? 'sewer' : o.type === 'water_service' ? 'water' : serviceKind(o) ?? 'other';
  return serviceKey(k);
}
export const isOn = (state: Record<string, boolean>, key: string): boolean => state[key] !== false;

export function groupLayers(bundleLayers: readonly LayerDef[], doc: SiteDesign | null): LayerGroup[] {
  const groups: Record<GroupId, LayerEntry[]> = { terrain: [], aerial: [], context: [], design: [], services: [], stormwater: [] };
  for (const L of bundleLayers) {
    const e = { key: L.c, label: L.n };
    if (L.c === AERIAL_LAYER) groups.aerial.push(e);
    else if (TERRAIN.has(L.c)) groups.terrain.push(e);
    else if (SERVICE_BUNDLE.has(L.c)) groups.services.push(e);
    else if (DESIGN_BUNDLE.has(L.c)) groups.design.push(e);
    else groups.context.push(e);                                  // context, road, boundary, overlays, the labels and any class this list does not know
  }
  const types = new Map<string, number>(), kinds = new Map<string, number>();
  for (const o of doc?.objects ?? []) {
    const k = objectLayerKey(o);
    if (k.startsWith('service:')) kinds.set(k, (kinds.get(k) ?? 0) + 1); else types.set(k, (types.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...types].sort((a, b) => a[0].localeCompare(b[0]))) {
    const t = k.slice(5) as ObjectType;
    groups.design.push({ key: k, label: `${(OBJECT_KINDS[t]?.label ?? t.toUpperCase()).toLowerCase().replace(/^./, (c) => c.toUpperCase())} (design)`, count: n });
  }
  for (const kind of SERVICE_KINDS) {
    const k = serviceKey(kind), n = kinds.get(k);
    if (n) groups.services.push({ key: k, label: `${SERVICE_KIND_LABEL[kind].charAt(0)}${SERVICE_KIND_LABEL[kind].slice(1).toLowerCase()} (design)`, count: n });
  }
  groups.stormwater.push({ key: OVERLAND_KEY, label: 'Flow paths and ponding (after a stormwater run)' });
  return (Object.keys(groups) as GroupId[]).filter((id) => groups[id].length).map((id) => ({ id, title: GROUP_TITLES[id], entries: groups[id] }));
}

/** Every key a state can hold for these layers (used to switch a whole group). */
export const groupKeys = (g: LayerGroup): string[] => g.entries.map((e) => e.key);
/** True / false when every entry of the group is on / off, null when mixed. */
export function groupState(g: LayerGroup, state: Record<string, boolean>): boolean | null {
  const on = g.entries.map((e) => isOn(state, e.key));
  return on.every(Boolean) ? true : on.some(Boolean) ? null : false;
}
/** The hidden object types and service kinds in a state, for the scene. */
export function hiddenFromState(state: Record<string, boolean>): { types: string[]; services: string[]; overland: boolean } {
  const types: string[] = [], services: string[] = [];
  for (const [k, v] of Object.entries(state)) if (v === false) { if (k.startsWith('type:')) types.push(k.slice(5)); else if (k.startsWith('service:')) services.push(k.slice(8)); }
  return { types, services, overland: state[OVERLAND_KEY] === false };
}
