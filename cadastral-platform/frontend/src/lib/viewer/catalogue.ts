import type { CatalogueItem, PlacedItem } from './types';

export interface CatalogueProvider {
  list(): Promise<CatalogueItem[]>;
  listPlaced?(projectId: string): Promise<PlacedItem[]>;
}
export const mockProvider = (items: CatalogueItem[], placed: PlacedItem[] = []): CatalogueProvider => ({
  list: async () => items, listPlaced: async () => placed,
});
/** Real provider: GET {base}/catalogue and GET {base}/projects/{id}/items */
export function fetchProvider(base = '', headers: Record<string, string> = {}): CatalogueProvider {
  const get = async <T,>(path: string): Promise<T> => {
    const r = await fetch(`${base}${path}`, { headers, credentials: 'include' });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  };
  return {
    list: async () => { const j = await get<CatalogueItem[] | { items: CatalogueItem[] }>('/catalogue'); return Array.isArray(j) ? j : j.items; },
    listPlaced: async (id) => { const j = await get<PlacedItem[] | { items: PlacedItem[] }>(`/projects/${encodeURIComponent(id)}/items`); return Array.isArray(j) ? j : j.items; },
  };
}
export const filterCatalogue = (items: CatalogueItem[], q: string, cat: string) => {
  const s = q.trim().toLowerCase();
  return items.filter((i) => (cat === 'All' || i.category === cat) && (!s || `${i.title} ${i.brand ?? ''} ${i.retailer} ${i.category}`.toLowerCase().includes(s)));
};
export const money = (v: number, cur = 'AUD') => new Intl.NumberFormat('en-AU', { style: 'currency', currency: cur }).format(v);
