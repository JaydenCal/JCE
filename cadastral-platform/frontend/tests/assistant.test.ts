import { describe, expect, it, vi } from 'vitest';
import { chipLabel, demoAssistant, elementId, httpAssistant, isSelectable, selectionLabel } from '@/lib/assistant';
import { buildSampleBundle } from '@/lib/viewer/sampleBundle';

describe('assistant helpers', () => {
  it('labels selections', () => {
    expect(selectionLabel('wl3')).toBe('Wall W3');
    expect(selectionLabel('op4:glass')).toBe('Opening O4');
    expect(selectionLabel('Roof_gable')).toBe('Roof gable');
    expect(elementId('op4:glass')).toBe('op4');
    expect(isSelectable('rf1', new Set())).toBe(true);
    expect(isSelectable('EG survey TIN', new Set(['Roof gable']))).toBe(false);
  });
  it('makes chips', () => {
    expect(chipLabel({ op: 'set_roof_colour', ok: true, summary: 'roof material set to Monument' })).toBe('Roof colour: Monument');
    expect(chipLabel({ op: 'set_roof_type', ok: true, summary: 'roof type set to hip' })).toBe('Roof: hip');
  });
});

describe('demo assistant', () => {
  const parts = buildSampleBundle().parts;
  it('recolours the roof and supports undo/redo', async () => {
    const a = demoAssistant(parts);
    expect(a.demo).toBe(true);
    const t = await a.send('Make the roof Colorbond Monument', null);
    expect(t.ops[0].summary).toContain('Monument');
    expect(t.parts.find((p) => p.n.startsWith('Roof'))!.col).toBe('#323233');
    expect(t.can_undo).toBe(true);
    const u = await a.undo();
    expect(u.parts.find((p) => p.n.startsWith('Roof'))!.col).not.toBe('#323233');
    expect(u.can_redo).toBe(true);
    expect((await a.redo()).parts.find((p) => p.n.startsWith('Roof'))!.col).toBe('#323233');
  });
  it('asks when ambiguous and explains when unknown', async () => {
    const a = demoAssistant(parts);
    expect((await a.send('Move the wall', null)).status).toBe('clarify');
    expect((await a.send('make it pretty', null)).message).toContain('no AI model connected');
  });
});

describe('http assistant', () => {
  it('sends the history token and surfaces server messages', async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body ?? '') });
      return { ok: true, status: 200, json: async () => ({ status: 'ok', message: 'hi', ops: [], warnings: [], parts: [], parts_origin: [0, 0], undo_token: 3, can_undo: true, can_redo: false }) } as Response;
    }));
    const a = httpAssistant('http://x', 'p1');
    await a.send('hello', 'wl3');
    await a.send('again', null);
    expect(calls[0].url).toBe('http://x/projects/p1/design/assistant');
    expect(JSON.parse(calls[1].body)).toMatchObject({ message: 'again', history_token: 3 });
    expect(JSON.parse(calls[0].body).selected_element_id).toBe('wl3');
    vi.unstubAllGlobals();
  });
});
