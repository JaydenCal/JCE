import * as THREE from 'three';
import type { PartDef } from './viewer/types';

export interface AssistantOp { op: string; ok: boolean; summary: string; errors?: { code: string; message: string }[] }
export interface AssistantWarning { code: string; message: string; source?: string }
export interface AssistantTurn {
  status: 'ok' | 'clarify' | 'not_configured' | 'error' | 'budget';
  message: string;
  clarification?: { question: string; options: string[] } | null;
  ops: AssistantOp[]; warnings: AssistantWarning[];
  parts: PartDef[]; parts_origin: [number, number];
  undo_token: number; can_undo: boolean; can_redo: boolean;
}
export interface AssistantProvider {
  /** shown in the panel; demo providers are labelled so nobody mistakes them for a connected model */
  demo?: boolean; label?: string;
  send(message: string, selectedId: string | null): Promise<AssistantTurn>;
  undo(): Promise<AssistantTurn>;
  redo(): Promise<AssistantTurn>;
}

export const SUGGESTIONS = [
  'Make the roof Colorbond Monument',
  'White render with black window frames',
  'Add a study nook off the entry',
  'Flip the plan so the garage is on the other side',
  'Make the deck off the living room 2 m deeper',
];

/** Real provider: POST {base}/projects/{id}/design/assistant | undo | redo */
export function httpAssistant(base: string, projectId: string, headers: Record<string, string> = {}): AssistantProvider {
  let token: number | undefined;
  const call = async (path: string, body?: unknown): Promise<AssistantTurn> => {
    const r = await fetch(`${base}/projects/${encodeURIComponent(projectId)}/design/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, credentials: 'include', body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && typeof j.undo_token === 'number') token = j.undo_token;
    if (!r.ok) throw new Error(j.message ?? `${path}: ${r.status}`);
    token = (j as AssistantTurn).undo_token;
    return j as AssistantTurn;
  };
  return {
    label: 'Design assistant',
    send: (message, selectedId) => call('assistant', { message, selected_element_id: selectedId, history_token: token }),
    undo: () => call('undo'), redo: () => call('redo'),
  };
}

const KIND: Record<string, string> = { wl: 'Wall W', op: 'Opening O', rf: 'Roof R', rm: 'Room R', dk: 'Deck D', st: 'Stair S', lv: 'Level L' };
/** Human label for a picked part: server ids like "wl3" become "Wall W3"; other names (demo parts) pass through. */
export function selectionLabel(part: string): string {
  const m = /^([a-z]{2})(\d+)(?::\w+)?$/i.exec(part.trim());
  return m && KIND[m[1].toLowerCase()] ? KIND[m[1].toLowerCase()] + m[2] : part.trim().replace(/_/g, ' ');
}
export const isSelectable = (part: string, known: Set<string>) => known.has(part) || known.has(part.replace(/ /g, '_')) || /^(wl|op|rf|rm|dk|st)\d+(:\w+)?$/i.test(part.trim());
/** Server id for a picked part (glass/gable/roof sub-parts fold into their element). */
export const elementId = (part: string) => part.trim().replace(/ /g, '_').split(':')[0];

/** Short chip text for an applied op, e.g. "Roof colour: Monument". */
export function chipLabel(o: AssistantOp): string {
  const s = o.summary || o.op.replace(/_/g, ' ');
  const m: [RegExp, (r: RegExpExecArray) => string][] = [
    [/^roof material set to (.+)$/, (r) => `Roof colour: ${r[1]}`], [/^roof type set to (.+)$/, (r) => `Roof: ${r[1].replace(/_/g, ' ')}`],
    [/^roof pitch set to (.+) deg$/, (r) => `Roof pitch: ${r[1]}°`], [/^(\d+) opening frame\(s\) set to (.+)$/, (r) => `Window frames: ${r[2]}`],
    [/^(\d+) wall\(s\) finished in (.+)$/, (r) => `Walls: ${r[2]}`],
  ];
  for (const [re, f] of m) { const r = re.exec(s); if (r) return f(r); }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------- 3D: replace the 'buildings' layer in place
interface EngineLike { built: { root: THREE.Group; meshes: THREE.Mesh[]; edgeLines: THREE.LineSegments[] }; applyVis(): void; setLayer(c: string, v: boolean): void; cOn: Record<string, boolean> }
const disposeObj = (o: THREE.Object3D) => { const x = o as THREE.Mesh; x.geometry?.dispose?.(); const m = x.material as THREE.Material | THREE.Material[]; (Array.isArray(m) ? m : m ? [m] : []).forEach((k) => k.dispose()); };

/** Swap the parts of layer 'buildings' without touching the camera, controls or other layers. `shift` = parts origin minus bundle origin. */
export function replaceBuildingParts(eng: EngineLike, parts: PartDef[], shift: [number, number] = [0, 0], edgeColour = '#14161a'): void {
  const b = eng.built;
  for (const m of [...b.meshes]) if (m.userData.c === 'buildings') { b.root.remove(m); disposeObj(m); b.meshes.splice(b.meshes.indexOf(m), 1); }
  for (const e of [...b.edgeLines]) if (e.userData.c === 'buildings') { b.root.remove(e); disposeObj(e); b.edgeLines.splice(b.edgeLines.indexOf(e), 1); }
  for (const p of parts) {
    if (!p.v) continue;
    const v = shift[0] || shift[1] ? p.v.map((x, i) => (i % 3 === 0 ? x + shift[0] : i % 3 === 1 ? x + shift[1] : x)) : p.v;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    if (p.f) g.setIndex(p.f);
    g.computeVertexNormals();
    const a = p.a ?? 1;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.col), roughness: p.ro ?? 0.8, metalness: p.me ?? 0, transparent: a < 1, opacity: a, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = !p.n.includes(':glass'); mesh.receiveShadow = true;
    mesh.userData = { name: p.n, c: 'buildings', mat, xmat: null, eml: false };
    b.root.add(mesh); b.meshes.push(mesh);
    if (a >= 1) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({ color: edgeColour, transparent: true, opacity: 0.28 }));
      e.userData = { c: 'buildings', owner: mesh }; b.root.add(e); b.edgeLines.push(e);
    }
  }
  eng.applyVis();
}

// ---------------------------------------------------------------- local scripted demo (no AI model connected)
const ROOF_COLOURS: Record<string, string> = { monument: '#323233', surfmist: '#e4e2d6', basalt: '#6d6c6e', 'shale grey': '#bdbfb9', 'woodland grey': '#4b4c46', 'night sky': '#1d1e20', dune: '#b0a695', 'classic cream': '#e7dcb9' };
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const clone = (p: PartDef[]): PartDef[] => p.map((x) => ({ ...x, v: x.v ? [...x.v] : x.v, f: x.f ? [...x.f] : x.f }));

/** Scripted stand-in so the UX can be shown without an API key. Understands a few phrasings and edits the sample house parts. */
export function demoAssistant(initial: PartDef[], origin: [number, number] = [0, 0]): AssistantProvider {
  let cur = clone(initial.filter((p) => p.c === 'buildings'));
  const past: PartDef[][] = [], future: PartDef[][] = [];
  const turn = (message: string, ops: AssistantOp[] = [], warnings: AssistantWarning[] = [], status: AssistantTurn['status'] = 'ok', clarification: AssistantTurn['clarification'] = null): AssistantTurn =>
    ({ status, message, clarification, ops, warnings, parts: clone(cur), parts_origin: origin, undo_token: past.length, can_undo: past.length > 0, can_redo: future.length > 0 });
  const commit = (next: PartDef[]) => { past.push(cur); future.length = 0; cur = next; };
  const bbox = () => { const b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, z0: 1e9 }; for (const p of cur) for (let i = 0; i < (p.v?.length ?? 0); i += 3) { const [x, y, z] = [p.v![i], p.v![i + 1], p.v![i + 2]]; b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); } return b; };
  const op = (name: string, summary: string): AssistantOp => ({ op: name, ok: true, summary });
  return {
    demo: true, label: 'Demo, no AI model connected',
    async send(message, sel) {
      const t = message.toLowerCase();
      const next = clone(cur); const ops: AssistantOp[] = []; const warnings: AssistantWarning[] = [];
      const colour = Object.keys(ROOF_COLOURS).find((k) => t.includes(k));
      if (/\bwall\b/.test(t) && /\bmove\b/.test(t) && !sel) return turn('Which wall do you mean? Click one in the 3D view, then ask again.', [], [], 'clarify', { question: 'Which wall do you mean?', options: ['Front wall', 'Rear wall'] });
      if (/roof/.test(t) && colour || (sel && /roof/i.test(sel) && colour)) {
        for (const p of next) if (/^roof/i.test(p.n)) p.col = ROOF_COLOURS[colour!];
        ops.push(op('set_roof_colour', `roof material set to ${title(colour!)}`)); warnings.push({ code: 'APPROXIMATE_COLOUR', message: `${title(colour!)} is an approximate screen colour; check the manufacturer sample.` });
      }
      if (/white render|render/.test(t)) { for (const p of next) if (p.n === 'Walls') p.col = '#f1efe9'; ops.push(op('set_wall_finish', '4 wall(s) finished in Render White')); }
      if (/black (window )?frame|frames? black|black window/.test(t)) ops.push(op('set_window_frame', '8 opening frame(s) set to Black Frame'));
      if (/flip|mirror|other side/.test(t)) {
        const b = bbox(), cx = (b.x0 + b.x1) / 2;
        for (const p of next) { if (!p.v) continue; for (let i = 0; i < p.v.length; i += 3) p.v[i] = 2 * cx - p.v[i]; if (p.f) for (let i = 0; i < p.f.length; i += 3) [p.f[i + 1], p.f[i + 2]] = [p.f[i + 2], p.f[i + 1]]; }
        ops.push(op('flip_plan', 'plan flipped left-right'));
      }
      if (/deck/.test(t)) {
        const b = bbox(), d = /deeper|2 ?m/.test(t) ? 4 : 3, w = 4.2, cx = (b.x0 + b.x1) / 2, z = b.z0 + 0.35;
        const v: number[] = [], f: number[] = [], q = (a: number[], bb: number[], c: number[], dd: number[]) => { const i = v.length / 3; v.push(...a, ...bb, ...c, ...dd); f.push(i, i + 1, i + 2, i, i + 2, i + 3); };
        const [x0, x1, y0, y1, z0, z1] = [cx - w / 2, cx + w / 2, b.y1, b.y1 + d, z - 0.15, z];
        q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
        q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]);
        q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]); q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
        next.push({ n: 'Deck_demo', c: 'buildings', col: '#9c7a54', v, f, ro: 0.9 });
        ops.push(op('add_deck', `added deck ${w.toFixed(1)} × ${d.toFixed(1)} m`)); warnings.push({ code: 'ENVELOPE_ENCROACHMENT', message: 'Demo check: the deck may extend beyond the building envelope (advisory only).' });
      }
      if (!ops.length) return turn('This is a scripted demo with no AI model connected. It understands: roof colour (Monument, Surfmist, Basalt…), white render, black window frames, adding a deck, and flipping the plan. Try a suggestion below.');
      commit(next);
      return turn('Done. (Demo: scripted response, not an AI model.)', ops, warnings);
    },
    async undo() { const p = past.pop(); if (p) { future.push(cur); cur = p; } return turn(p ? 'Undone.' : 'Nothing to undo.'); },
    async redo() { const n = future.pop(); if (n) { past.push(cur); cur = n; } return turn(n ? 'Redone.' : 'Nothing to redo.'); },
  };
}
