import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportError, MAX_IMPORT_BYTES, importFile, importFootprintRing, importFootprintSize, lotWkt } from '@/lib/site/buildingImport';

const PAYLOAD = JSON.parse(readFileSync(join(__dirname, '../../../backend/tests/fixtures/building_import_planstudio.json'), 'utf8'));
const LOT: [number, number][] = [[496000, 6650000], [496030, 6650000], [496030, 6650030], [496000, 6650030]];
interface Seen { url: string; init: RequestInit }
function fake(status: number, body: unknown): { fetchImpl: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}
const ep = (fetchImpl: typeof fetch) => ({ base: 'http://api', projectId: 'a/b', headers: { 'X-User-Id': 'u1' }, fetchImpl });
const file = (name: string, text = '{}') => new File([text], name);

describe('building import client', () => {
  it('posts a Plan Studio file with the use and returns a checked payload', async () => {
    const { fetchImpl, seen } = fake(200, PAYLOAD);
    const p = await importFile(ep(fetchImpl), file('house.planstudio.json'), 'granny_flat');
    expect(p.schema).toBe('building_import.v1');
    expect(seen[0].url).toBe('http://api/projects/a%2Fb/site-design/import-building');
    expect(seen[0].init.method).toBe('POST'); expect((seen[0].init.headers as Record<string, string>)['X-User-Id']).toBe('u1');
    const form = seen[0].init.body as FormData;
    expect(form.get('building_use')).toBe('granny_flat'); expect((form.get('file') as File).name).toBe('house.planstudio.json'); expect(form.get('lot_wkt')).toBeNull();
  });
  it('a PDF carries the lot and the CRS; without them it is refused before any request', async () => {
    const { fetchImpl, seen } = fake(200, PAYLOAD);
    await importFile(ep(fetchImpl), file('plan.pdf'), 'house', { ring: LOT, srid: 7856 }, 100);
    const form = seen[0].init.body as FormData;
    expect(form.get('lot_wkt')).toBe(lotWkt(LOT)); expect(form.get('srid')).toBe('7856'); expect(form.get('scale_denominator')).toBe('100');
    expect(lotWkt(LOT)).toBe('POLYGON((496000 6650000, 496030 6650000, 496030 6650030, 496000 6650030, 496000 6650000))');
    await expect(importFile(ep(fetchImpl), file('plan.pdf'), 'house', { ring: null, srid: 7856 })).rejects.toMatchObject({ code: 'LOT_REQUIRED' });
    await expect(importFile(ep(fetchImpl), file('plan.pdf'), 'house')).rejects.toMatchObject({ code: 'LOT_REQUIRED' });
    expect(seen).toHaveLength(1);
  });
  it('refuses a file over the size cap without uploading it', async () => {
    const { fetchImpl, seen } = fake(200, PAYLOAD);
    const big = { name: 'big.dxf', size: MAX_IMPORT_BYTES + 1 } as unknown as File;
    await expect(importFile(ep(fetchImpl), big, null)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE', status: 413 });
    expect(seen).toHaveLength(0);
  });
  it('server refusals carry the code and message (SA7 refusal, bad file)', async () => {
    const refused = fake(422, { code: 'ALIGN_REFUSED', message: 'alignment RMSE 0.41 m is above the 0.30 m limit' });
    const e = await importFile(ep(refused.fetchImpl), file('plan.dxf'), null).catch((x) => x);
    expect(e).toBeInstanceOf(ImportError); expect(e).toMatchObject({ status: 422, code: 'ALIGN_REFUSED' }); expect(e.message).toContain('0.30 m');
    const plain = fake(401, { detail: 'not signed in' });
    expect(await importFile(ep(plain.fetchImpl), file('a.json'), null).catch((x) => x)).toMatchObject({ status: 401, message: 'not signed in' });
    const bad = fake(200, { schema: 'nope' });
    expect(await importFile(ep(bad.fetchImpl), file('a.json'), null).catch((x) => x)).toMatchObject({ code: 'BAD_RESPONSE' });
    const net = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await importFile(ep(net), file('a.json'), null).catch((x) => x)).toMatchObject({ code: 'NETWORK' });
  });
  it('footprint entry sends the size or the drawn ring', async () => {
    const { fetchImpl, seen } = fake(200, PAYLOAD);
    await importFootprintSize(ep(fetchImpl), 12, 7.5, 'shed');
    let f = seen[0].init.body as FormData; expect(f.get('source')).toBe('footprint_entry'); expect(f.get('width_m')).toBe('12'); expect(f.get('depth_m')).toBe('7.5'); expect(f.get('building_use')).toBe('shed');
    await importFootprintRing(ep(fetchImpl), [[1, 2, 3], [4, 5], [6, 7]], 'unit');
    f = seen[1].init.body as FormData; expect(JSON.parse(f.get('ring') as string)).toEqual([[1, 2], [4, 5], [6, 7]]); expect(f.get('building_use')).toBe('unit');
  });
});
