/**
 * Outdoor furniture choices. A furniture object is sized from CATALOGUE DIMENSIONS ONLY: the retail catalogue item's real dimensions, or the
 * default size of a Plan Studio catalogue item used as a proxy. An item without dimensions leaves the object DIMENSIONS NOT SET.
 */
import type { CatalogueItem } from '@/lib/viewer/types';
import type { FurnitureChoice } from './designController';

export const PS_REF = 'PLAN STUDIO CATALOGUE DEFAULT SIZE', RETAIL_REF = 'RETAIL CATALOGUE';
/** Plan Studio outdoor items (src/catalogue/furn/work.js), default sizes in metres. They stand in for an item that is not in the retail catalogue. */
export const PLAN_STUDIO_OUTDOOR: FurnitureChoice[] = [
  { item_id: 'plan_studio:bbq', title: 'BBQ (Plan Studio proxy)', source_ref: PS_REF, width_m: 1.3, depth_m: 0.56, height_m: 1.15 },
  { item_id: 'plan_studio:outdoor_table', title: 'Outdoor table with benches (Plan Studio proxy)', source_ref: PS_REF, width_m: 1.8, depth_m: 1.5, height_m: 0.78 },
  { item_id: 'plan_studio:sun_lounge', title: 'Sun lounge (Plan Studio proxy)', source_ref: PS_REF, width_m: 0.65, depth_m: 1.95, height_m: 0.8 },
];
const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
export function choiceFromCatalogue(c: CatalogueItem): FurnitureChoice {
  const d = (c.dims ?? {}) as Partial<CatalogueItem['dims']>;
  return { item_id: c.id, title: c.title, source_ref: RETAIL_REF, width_m: pos(d.w), depth_m: pos(d.d), height_m: pos(d.h) };
}
export function furnitureChoices(catalogue: readonly CatalogueItem[]): FurnitureChoice[] {
  return [...PLAN_STUDIO_OUTDOOR, ...catalogue.map(choiceFromCatalogue)];
}
