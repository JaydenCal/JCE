import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
vi.mock('@/lib/viewer/textures', async () => { const T = await import('three'); return { makeSprite: () => new T.Sprite(), makeTextures: () => ({}) }; });
import { buildScene, xrayMeshes, XRAY_GROUND } from '@/lib/viewer/sceneBuilder';
import { AERIAL_NOTE, CAPTURE_DATE_NOT_STATED, XRAY_OPACITY, aerialLegend, aerialNoteVisible, drawAerialNote, setAerialOpacity, terrainLegend } from '@/lib/viewer/aerial';
import { SKIP_LAYERS } from '@/lib/viewer/placeController';
import { validateBundle } from '@/lib/viewer/loadBundle';
import type { SceneBundle } from '@/lib/viewer/types';

const tri = [0, 0, 0, 10, 0, 0, 0, 10, 0];
const bundle = (info: Record<string, unknown> = {}): SceneBundle => validateBundle({
  info: { title: 'T', origin: [0, 0, 0], ...info },
  layers: [{ c: 'surface', n: 'Design surface', on: true }, { c: 'aerial', n: 'Aerial imagery (information only)', on: true }],
  parts: [{ n: 'FS_surface', c: 'surface', col: '#cccccc', v: tri }, { n: 'AERIAL_drape', c: 'aerial', col: '#ffffff', v: tri, uv: [0, 0, 1, 0, 0, 1] }],
});

describe('aerial imagery layer (information only)', () => {
  it('the legend always carries the persistent wording, the source and the capture date', () => {
    expect(AERIAL_NOTE).toBe('AERIAL IMAGERY FOR INFORMATION ONLY, TO BE CONFIRMED ON SITE');
    const l = aerialLegend(bundle({ ground_texture: 'data:image/jpeg;base64,AA==', ground_texture_source: 'NSW_Imagery', ground_texture_date: '18/10/2011' }))!;
    expect(l).toMatchObject({ note: AERIAL_NOTE, source: 'NSW_Imagery', capture: '18/10/2011' });
  });
  it('a missing capture date reads CAPTURE DATE NOT STATED and a missing source is flagged, never invented', () => {
    const l = aerialLegend(bundle({ ground_texture: 'x' }))!;
    expect(l.capture).toBe(CAPTURE_DATE_NOT_STATED); expect(l.source).toBe('SOURCE NOT STATED'); expect(l.note).toBe(AERIAL_NOTE);
  });
  it('no aerial layer and no image means no legend', () => {
    const b = validateBundle({ info: { title: 'T', origin: [0, 0, 0] }, layers: [], parts: [{ n: 'a', c: 'surface', col: '#fff', v: tri }] });
    expect(aerialLegend(b)).toBeNull();
  });
  it('terrain legend shows the provenance status', () => {
    expect(terrainLegend(bundle({ terrain: { status: 'INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY', source: 's' } }))).toBe('TERRAIN: INDICATIVE 5 M DEM, LIDAR PENDING, NOT SURVEY');
    expect(terrainLegend(bundle())).toBeNull();
  });
  it('the aerial part becomes an unlit, textured, toggleable mesh that casts and receives no shadow', () => {
    const built = buildScene(bundle({ ground_texture: 'data:image/jpeg;base64,AA==' }), '#000');
    const m = built.meshes.find((x) => x.userData.c === 'aerial')!;
    expect(m).toBeTruthy(); expect(m.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(m.castShadow).toBe(false); expect(m.receiveShadow).toBe(false); expect(m.geometry.getAttribute('uv').count).toBe(3);
    expect(SKIP_LAYERS).toContain('aerial');
  });
  it('opacity control: below 1 is transparent and stops writing depth, 1 restores it, values are clamped', () => {
    const built = buildScene(bundle(), '#000');
    const m = built.meshes.find((x) => x.userData.c === 'aerial')!, surf = built.meshes.find((x) => x.userData.c === 'surface')!;
    setAerialOpacity(built.meshes, 0.4);
    expect((m.material as THREE.Material).opacity).toBeCloseTo(0.4); expect((m.material as THREE.Material).transparent).toBe(true); expect((m.material as THREE.Material).depthWrite).toBe(false);
    expect((surf.material as THREE.Material).opacity).toBe(1);
    setAerialOpacity(built.meshes, 7); expect((m.material as THREE.Material).opacity).toBe(1); expect((m.material as THREE.Material).transparent).toBe(false);
    setAerialOpacity(built.meshes, -1); expect((m.material as THREE.Material).opacity).toBe(0);
  });
  it('the review panel shows the legend note and an opacity control, and the engine exposes setAerialOpacity', () => {
    const root = join(__dirname, '..', '..', 'src');
    const panel = readFileSync(join(root, 'components/viewer/ReviewPanel.tsx'), 'utf8');
    expect(panel).toMatch(/data-aerial-note/); expect(panel).toMatch(/type="range"[^>]*Aerial imagery opacity|Aerial imagery opacity[^>]*type="range"/);
    expect(readFileSync(join(root, 'lib/viewer/engine.ts'), 'utf8')).toMatch(/setAerialOpacity\(v: number\)/);
    expect(readFileSync(join(root, 'components/viewer/ViewerShell.tsx'), 'utf8')).toMatch(/aerialOpacity=\{aerialOp\}/);
  });
});

describe('aerial wording is persistent (every tab, walk mode, exports) and the ground see-through includes the aerial layer', () => {
  const src = (f: string) => readFileSync(join(__dirname, '..', '..', 'src', f), 'utf8');
  it('the note is visible whenever the aerial layer is on with opacity above zero, whatever the tab, and never otherwise', () => {
    const b = bundle({ ground_texture: 'data:image/jpeg;base64,AA==' });
    expect(aerialNoteVisible(b, { aerial: true })).toBe(true);
    expect(aerialNoteVisible(b, { aerial: true }, 0.3)).toBe(true);
    expect(aerialNoteVisible(b, { aerial: false })).toBe(false);
    expect(aerialNoteVisible(b, { aerial: true }, 0)).toBe(false);
    expect(aerialNoteVisible(b, {})).toBe(false);
    const none = validateBundle({ info: { title: 'T', origin: [0, 0, 0] }, layers: [], parts: [{ n: 'a', c: 'surface', col: '#fff', v: tri }] });
    expect(aerialNoteVisible(none, { aerial: true })).toBe(false);
  });
  it('the stage note is drawn outside the review tab and outside the not-walking condition, so walk mode shows it', () => {
    const shell = src('components/viewer/ViewerShell.tsx');
    const line = shell.split('\n').find((l) => l.includes('data-aerial-stage-note'))!;
    expect(line).toMatch(/aerialNoteVisible\(bundle, on, aerialOp\)/);
    expect(line).not.toMatch(/tab === 'review'|!fpOn/);
    expect(shell.indexOf('data-aerial-stage-note')).toBeLessThan(shell.indexOf('<aside className="dock">'));       // on the stage, not in a tab panel
  });
  it('the screenshot export burns the wording into the image whenever the aerial is visible', () => {
    const eng = src('lib/viewer/engine.ts');
    const snap = eng.slice(eng.indexOf('snapshotPng(): string'), eng.indexOf('snapshotState()'));
    expect(snap).toMatch(/aerialVisible\(\)/); expect(snap).toMatch(/drawAerialNote\(/); expect(snap).toMatch(/toDataURL\('image\/png'\)/);
    expect(eng).toMatch(/aerialVisible\(\): boolean/);
  });
  it('drawAerialNote paints a band and the wording on the canvas, wrapped to the width', () => {
    const texts: string[] = []; const rects: number[][] = [];
    const ctx = { save() {}, restore() {}, font: '', fillStyle: '', textBaseline: '', measureText: (t: string) => ({ width: t.length * 8 }),
      fillRect: (...a: number[]) => rects.push(a), fillText: (t: string) => texts.push(t) } as unknown as CanvasRenderingContext2D;
    drawAerialNote(ctx, 400, 300, AERIAL_NOTE, 'SOURCE: S. CAPTURE DATE: 18/10/2011.');
    expect(rects.length).toBe(1); expect(rects[0][0]).toBe(0); expect(rects[0][0] + rects[0][2]).toBe(400); expect(rects[0][1] + rects[0][3]).toBe(300);       // band along the bottom edge
    expect(texts.join(' ')).toContain(AERIAL_NOTE.split(' ').join(' ')); expect(texts.length).toBeGreaterThan(1);                                           // wrapped
    expect(texts.join(' ')).toContain('CAPTURE DATE: 18/10/2011.');
  });
  it('XRAY_GROUND includes the aerial layer and the see-through material keeps the texture, is transparent and follows the aerial opacity', () => {
    expect(XRAY_GROUND).toContain('aerial');
    const built = buildScene(bundle({ ground_texture: 'data:image/jpeg;base64,AA==' }), '#000');
    const m = built.meshes.find((x) => x.userData.c === 'aerial')!, normal = m.material;
    xrayMeshes(built.meshes, XRAY_GROUND, true);
    const xm = m.material as THREE.MeshBasicMaterial;
    expect(xm).not.toBe(normal); expect(xm.transparent).toBe(true); expect(xm.depthWrite).toBe(false); expect(xm.opacity).toBeCloseTo(XRAY_OPACITY);
    setAerialOpacity(built.meshes, 0.5);
    expect(xm.opacity).toBeCloseTo(XRAY_OPACITY * 0.5); expect((normal as THREE.Material).opacity).toBeCloseTo(0.5);              // the normal material is kept in step
    xrayMeshes(built.meshes, XRAY_GROUND, false);
    expect(m.material).toBe(normal);
  });
  it('the review panel summary renders the bundle data_status', () => {
    const panel = src('components/viewer/ReviewPanel.tsx');
    expect(panel).toMatch(/p\.bundle\.info\.data_status/); expect(panel).toMatch(/data-data-status/);
  });
});

