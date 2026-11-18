// Model parity harness. One project is built in every place a person can see it, and the meshes are inventoried so the contexts can be compared:
//   editor   the full editor 3D view (viewer.js uiOptions: all levels, roof on, proposed, full detail)
//   embed    the lot card embed viewer (confirmFrontage in viewer mode, same builder and options)
//   export   the HTML export / GLB: the client path (project as is) and the server path (JSON, migrate), through a real GLB round trip
//   plan     the plan set geometry (wallShapes, schedule, plan text of the PDF plan sets, the HTML plan SVG)
// Node only, no DOM. Textures are off in every context (the colours are what is compared).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { catalogue } from '../../src/catalogue/index.js';
import { createProject, migrate } from '../../src/model/schema.js';
import { createStore } from '../../src/model/store.js';
import { placeHouse } from '../../src/portal/place-house.js';
import { lotEnvelope, portalLotToSiteLot, SAMPLE_LOT } from '../../src/portal/envelope.js';
import { autoPose } from '../../src/portal/auto-place.js';
import { buildModel } from '../../src/viewer3d/build.js';
import { createMaterialLibrary } from '../../src/viewer3d/materials.js';
import { confirmFrontage } from '../../src/ui/embed-viewer.js';
import { toGLB } from '../../src/premium/exporters/model3d.js';
import { exportPayload } from '../../src/premium/export-client.js';
import { commercialProject } from './commercial-fixture.mjs';
import * as CL from '../../src/commercial/layouts.js';
import { applyFinishes } from '../../src/commercial/finishes.js';
import { addBuilding } from '../../src/commercial/catalogue/ops.js';

export { catalogue };

// ---- sample projects ---------------------------------------------------------------------------------------------------------------
function houseOnLot(templateId, name) {
  const portal = { name, polygonMm: SAMPLE_LOT.polygonMm, frontEdgeIndices: [2], picked: { front: { minM: 4.5 }, secondaryFront: { minM: 3 }, side: { minM: 0.9 }, rear: { minM: 3 } }, lot: '7', dp: 'DP 99' };
  const p = createProject({ name });
  p.site.lot = portalLotToSiteLot(portal, lotEnvelope(portal));
  const h = catalogue.createFromTemplate(templateId);
  placeHouse(p, h, autoPose(p, h).pose);
  return p;
}

const withTank = (p) => {
  const lot = p.site.lot;
  const xs = lot.boundary.map((q) => q.x);
  const ys = lot.boundary.map((q) => q.y);
  p.site.tanks = [{ id: 'tank_par1', x: Math.min(...xs) + 2500, y: (Math.min(...ys) + Math.max(...ys)) / 2, diameter: 2200, height: 2400, status: 'new', kind: 'poly' }];
  return p;
};

export function sampleProjects() {
  const out = [];
  out.push({ id: 'res-single', label: 'Residential, single storey', project: withTank(houseOnLot('house_single', 'Single')) });
  out.push({ id: 'res-double', label: 'Residential, double storey', project: houseOnLot('house_double', 'Double') });
  out.push({ id: 'granny', label: 'Granny flat', project: houseOnLot('granny_flat', 'Granny') });
  // Commercial warehouse: one catalogue building, a named door colour and cladding.
  {
    const s = createStore(commercialProject({ rows: 'none', width: 90000, depth: 100000, plain: false }), { autosaveKey: null });
    addBuilding(s, 'warehouse', { params: { docks: 3, groundDoors: 1, spanMm: 36000 } });
    s.apply('Finishes', (p) => applyFinishes(p, { cladding: 'sand', door: 'forest-green' }));
    out.push({ id: 'com-warehouse', label: 'Commercial warehouse', project: s.project });
  }
  // Strata units straight off the card (no named colour).
  {
    const s = createStore(commercialProject({ rows: 'none', width: 60000, depth: 80000, plain: false }), { autosaveKey: null });
    CL.applyLayout(s, CL.chooseLayout(s.project));
    out.push({ id: 'com-strata', label: 'Commercial strata units', project: s.project });
  }
  // Strata with a named door colour.
  {
    const s = createStore(commercialProject({ rows: 'none', width: 60000, depth: 80000, plain: false }), { autosaveKey: null });
    CL.applyLayout(s, CL.chooseLayout(s.project));
    s.apply('Finishes', (p) => applyFinishes(p, { cladding: 'pale-grey', door: 'brick-red' }));
    out.push({ id: 'com-strata-red', label: 'Commercial strata units, brick red doors', project: s.project });
  }
  return out;
}

// ---- the contexts ------------------------------------------------------------------------------------------------------------------
export const editorOptions = () => ({ materials: createMaterialLibrary({ textures: false, catalogue }), catalogue, levelFilter: 'all', showRoof: true, statusView: 'proposed', walk: false, detail: 'full' });

export function buildEditor(project) {
  return buildModel(structuredClone(project), editorOptions());
}

/** The embed: the viewer is the same code with the clean cinematic layers (confirmFrontage in viewer mode). */
export function buildEmbed(project, { sameLayers = false } = {}) {
  const store = createStore(structuredClone(project), { autosaveKey: null });
  if (!sameLayers) confirmFrontage(store, true);
  return buildModel(store.project, editorOptions());
}

/** What the HTML export file shows: the GLB after a real round trip (export, then the loader the file uses). `server` sends the project the way the API does. */
export async function buildExport(project, { server = false } = {}) {
  const sent = server ? migrate(JSON.parse(JSON.stringify(exportPayload(project)))) : project;
  const glb = await toGLB(structuredClone(sent), { catalogue });
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(glb, '', resolve, reject));
  return gltf.scene;
}

// ---- inventory ---------------------------------------------------------------------------------------------------------------------
const hex = (m) => (m?.color ? m.color.getHexString() : null);
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * The logical object a mesh belongs to. A mesh with several materials comes back from a GLB as a group of primitive meshes, with the
 * builder's name kept in userData.name, so the unit is the nearest object that carries one. Meshes with neither are their own unit.
 */
export function unitOf(o) {
  let top = null;
  for (let p = o; p; p = p.parent) {
    const n = String(p.userData?.name || p.name || '');
    if (/^[a-z-]+:/.test(n) && !n.startsWith('level:')) top = p;
  }
  if (top) return top;
  for (let p = o; p; p = p.parent) if (p.userData?.name) return p;
  return o;
}

/** The kind a unit is counted under: the part of its name before the colon (floor:r_1 is a floor), else its name or its userData.kind. */
export function kindOf(u) {
  const ud = u.userData || {};
  const n = String(ud.name || u.name || '');
  const base = n.includes(':') ? n.split(':')[0] : /^mesh_\d+/.test(n) ? '' : n;
  const kind = base || ud.kind || 'unnamed';
  if (kind === 'opening' || kind === 'leaf') return `${kind === 'leaf' ? 'leaf' : 'opening'}:${ud.openingKind || 'any'}`;
  return kind;
}

/**
 * Inventory of a model: per kind { count, tris, bounds [minx,miny,minz,maxx,maxy,maxz] (m, 2 dp), colours [hex...] (sorted, unique) }.
 * count is the number of logical objects. `skip` is a list of kinds to leave out (documented differences).
 */
export function inventory(root, { skip = [] } = {}) {
  root.updateMatrixWorld(true);
  const kinds = {};
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.visible === false) return;
    const u = unitOf(o);
    const k = kindOf(u);
    if (skip.includes(k)) return;
    const e = kinds[k] || (kinds[k] = { units: new Set(), tris: 0, box: new THREE.Box3(), colours: new Set() });
    e.units.add(u);
    const g = o.geometry;
    e.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    e.box.union(new THREE.Box3().setFromObject(o));
    for (const m of [].concat(o.material || [])) { const c = hex(m); if (c) e.colours.add(c); }
  });
  const out = {};
  for (const k of Object.keys(kinds).sort()) {
    const e = kinds[k];
    out[k] = { count: e.units.size, tris: Math.round(e.tris), bounds: e.box.isEmpty() ? null : [e.box.min.x, e.box.min.y, e.box.min.z, e.box.max.x, e.box.max.y, e.box.max.z].map(r2), colours: [...e.colours].sort() };
  }
  return out;
}

/** Opening meshes of one kind, with the brightest colour on each (the door or panel colour, not the frame). */
export function openingColours(root) {
  const out = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    const k = kindOf(unitOf(o));
    if (!k.startsWith('opening:')) return;
    const kind = k.slice('opening:'.length);
    (out[kind] || (out[kind] = new Set()));
    for (const m of [].concat(o.material || [])) { const c = hex(m); if (c) out[kind].add(c); }
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

/**
 * Compare two inventories. Returns a list of problems (empty when they match). tol is the bounds tolerance in metres.
 * `ignore` is a list of kinds not compared. Colours are compared as sets per kind.
 */
export function compareInventories(a, b, { tol = 0.02, ignore = [], colours = true, bounds = true, label = '' } = {}) {
  const probs = [];
  const kinds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of kinds) {
    if (ignore.includes(k)) continue;
    const x = a[k]; const y = b[k];
    if (!x) { probs.push(`${label}${k}: missing on the left (right has ${y.count})`); continue; }
    if (!y) { probs.push(`${label}${k}: missing on the right (left has ${x.count})`); continue; }
    if (x.count !== y.count) probs.push(`${label}${k}: count ${x.count} vs ${y.count}`);
    if (colours && x.colours.join() !== y.colours.join()) probs.push(`${label}${k}: colours ${x.colours.join(',')} vs ${y.colours.join(',')}`);
    if (bounds && x.bounds && y.bounds && x.bounds.some((v, i) => Math.abs(v - y.bounds[i]) > tol)) probs.push(`${label}${k}: bounds ${x.bounds.join(',')} vs ${y.bounds.join(',')}`);
  }
  return probs;
}

// ---- plan geometry -----------------------------------------------------------------------------------------------------------------
import { wallShapes, openingLines, scheduleData, levelsSorted } from '../../src/premium/exporters/shared.js';
import { levelSvg } from '../../src/premium/exporters/html.js';
import { furnitureStrokes } from '../../src/premium/exporters/symbols.js';
import * as G from '../../src/model/geometry.js';

/** Ids a model carries, read from the builder's names (wall:ID, panels:ID, opening:ID, floor:ID, furniture:ID, stair:ID). */
export function modelIds(root) {
  const ids = { wall: new Set(), opening: new Map(), floor: new Set(), furniture: new Set(), stair: new Set(), tank: 0, wallBox: new THREE.Box3() };
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const u = unitOf(o);
    if (seen.has(u)) return;
    seen.add(u);
    const n = String(u.userData?.name || u.name || '');
    const [prefix, id] = n.split(':');
    if (['wall', 'panels', 'wall-upper', 'wall-lining'].includes(prefix) && id) { ids.wall.add(id); ids.wallBox.union(new THREE.Box3().setFromObject(u)); }
    else if (prefix === 'opening' && id) ids.opening.set(id, u.userData?.openingKind || 'any');
    else if (prefix === 'floor' && id && !id.endsWith('default')) ids.floor.add(id);
    else if (prefix === 'furniture' && id) ids.furniture.add(id);
    else if (prefix === 'stair' || u.userData?.kind === 'stair') ids.stair.add(id || u.uuid);
    else if (prefix === 'tank' || prefix === 'tanks') ids.tank++;
  });
  return ids;
}

/**
 * What the plan set draws, from the data the PDF plans, the DXF and the HTML plan share (wallShapes, openingLines, furnitureStrokes,
 * scheduleData) and the HTML plan SVG itself. { walls:Set, openings:Map id->kind (every opening that is drawn or leaves a gap), rooms:Set,
 * furniture:Set, stairs:number, wallBox (mm), svgRoomLabels }.
 */
export function planInventory(project) {
  const out = { walls: new Set(), openings: new Map(), rooms: new Set(), furniture: new Set(), stairs: 0, wallBox: null, svgRoomNames: 0, svgWallPolys: 0, undrawnFurniture: [], openingKinds: {} };
  const pts = [];
  const sched = scheduleData(project);
  out.schedule = sched.openings.reduce((a, r) => ({ ...a, [r.type]: (a[r.type] || 0) + r.count }), {});
  for (const l of levelsSorted(project)) {
    for (const sh of wallShapes(l)) {
      out.walls.add(sh.wall.id);
      pts.push(sh.at(0, -1), sh.at(sh.L, 1));
      for (const sp of sh.spans) out.openings.set(sp.opening.id, sp.opening.kind);
    }
    for (const r of l.rooms) out.rooms.add(r.id);
    for (const f of l.furniture) { out.furniture.add(f.id); if (!furnitureStrokes(catalogue, f).some((op) => op.paths.length)) out.undrawnFurniture.push(f.id); }
    out.stairs += l.stairs.length;
    const svg = levelSvg(project, l, { catalogue, withSite: true });
    out.svgRoomNames += l.rooms.filter((r) => svg.includes(`>${String(r.name || '').replace(/&/g, '&amp;')}</text>`) || !r.name).length;
    out.svgWallPolys += (svg.match(/<polygon points="[^"]*" fill="#(?:26282e|9ea0a6)"/g) || []).length;
    for (const o of l.openings) {
      const sh = wallShapes(l).find((x) => x.wall.id === o.wallId);
      const lines = sh ? (o.kind === 'door' ? 1 : openingLines(sh, o).lines.length) : 0;
      out.openingKinds[o.kind] = out.openingKinds[o.kind] || { count: 0, withLines: 0 };
      out.openingKinds[o.kind].count++;
      if (lines) out.openingKinds[o.kind].withLines++;
    }
  }
  if (pts.length) out.wallBox = G.bbox(pts);
  return out;
}

/** Compare a model against the plan. Returns problems (empty when they agree). */
export function comparePlanToModel(project, root, { tolMm = 30 } = {}) {
  const probs = [];
  const m = modelIds(root);
  const p = planInventory(project);
  const planWalls = [...p.walls].filter((id) => {
    const w = project.levels.flatMap((l) => l.walls).find((x) => x.id === id);
    return w && G.wallLength(w) >= 10 && (w.status || 'new') !== 'demolish';
  });
  const missingIn3d = planWalls.filter((id) => !m.wall.has(id));
  if (missingIn3d.length) probs.push(`walls drawn in the plan but not in 3D: ${missingIn3d.slice(0, 5).join(',')} (${missingIn3d.length})`);
  const missingInPlan = [...m.wall].filter((id) => !p.walls.has(id));
  if (missingInPlan.length) probs.push(`walls in 3D but not in the plan: ${missingInPlan.slice(0, 5).join(',')} (${missingInPlan.length})`);
  // Openings: the 3D builds a fitting for every kind except a plain wall gap ('opening').
  for (const [id, kind] of p.openings) {
    if (kind === 'opening') continue;
    if (!m.opening.has(id)) probs.push(`opening ${id} (${kind}) is in the plan but not in 3D`);
    else if (m.opening.get(id) !== kind) probs.push(`opening ${id} is a ${kind} in the plan and a ${m.opening.get(id)} in 3D`);
  }
  for (const id of m.opening.keys()) if (!p.openings.has(id)) probs.push(`opening ${id} is in 3D but not in the plan`);
  for (const [kind, v] of Object.entries(p.openingKinds)) if (kind !== 'opening' && kind !== 'door' && v.withLines < v.count) probs.push(`${v.count - v.withLines} ${kind} openings have no plan symbol`);
  if (p.undrawnFurniture.length) probs.push(`furniture with no plan symbol: ${p.undrawnFurniture.join(',')}`);
  const furn3d = [...p.furniture].filter((id) => !m.furniture.has(id));
  if (furn3d.length) probs.push(`furniture in the plan but not in 3D: ${furn3d.length}`);
  if (m.stair.size !== p.stairs) probs.push(`stairs: plan ${p.stairs}, 3D ${m.stair.size}`);
  const tanks = (project.site?.tanks || []).length;
  if (tanks !== m.tank && tanks) probs.push(`tanks: project ${tanks}, 3D ${m.tank}`);
  // Walls overall extent (plan mm, y down; 3D metres x, z): the model has the same outline as the plan, within the wall thickness.
  if (p.wallBox && !m.wallBox.isEmpty()) {
    const d = [Math.abs(m.wallBox.min.x * 1000 - p.wallBox.minX), Math.abs(m.wallBox.max.x * 1000 - p.wallBox.maxX), Math.abs(m.wallBox.min.z * 1000 - p.wallBox.minY), Math.abs(m.wallBox.max.z * 1000 - p.wallBox.maxY)];
    if (Math.max(...d) > 300 + tolMm) probs.push(`wall outline differs from the plan by ${Math.round(Math.max(...d))} mm`);
  }
  return probs;
}

// ---- the lot card top view (the 2D mini map) ----------------------------------------------------------------------------------------
import { housingScene } from '../../src/lotcard/topview.js';
import { commercialScene } from '../../src/commercial/topview-scene.js';

/** The scene the lot card top view draws for a project (housing or commercial). */
export async function topViewScene(project) {
  return project.mode === 'commercial' ? commercialScene(project) : housingScene(project);
}

/** The roof colours a model has (the main roof slot is the one that is not the fascia or the gable). */
export function roofColours(root) {
  return inventory(root).roof?.colours || [];
}

/**
 * Compare the top view with the 3D model. The top view must show: the roof colour the model has, the same building footprint
 * (within 300 mm of the walls), one shape for every unit and catalogue building, the driveway when the model has one, and the tanks.
 */
export async function compareTopViewToModel(project, root) {
  const probs = [];
  const sc = await topViewScene(project);
  if (!sc) return ['no top view scene (no lot)'];
  const inv = inventory(root);
  const roofs = inv.roof?.colours || [];
  const fills = [...new Set(sc.shapes.filter((s) => s.kind === 'house' || s.kind === 'building' || s.kind === 'unit').map((s) => (s.fill || '').replace('#', '').toLowerCase()))];
  for (const f of fills) if (!roofs.includes(f)) probs.push(`top view roof colour #${f} is not a roof colour of the 3D model (${roofs.join(',')})`);
  const m = modelIds(root);
  const pts = sc.shapes.filter((s) => s.kind === 'house').flatMap((s) => s.ring);
  if (pts.length && !m.wallBox.isEmpty()) {
    const b = G.bbox(pts);
    const d = Math.max(Math.abs(m.wallBox.min.x * 1000 - b.minX), Math.abs(m.wallBox.max.x * 1000 - b.maxX), Math.abs(m.wallBox.min.z * 1000 - b.minY), Math.abs(m.wallBox.max.z * 1000 - b.maxY));
    if (d > 600) probs.push(`top view footprint differs from the 3D walls by ${Math.round(d)} mm`);
  }
  const drive3d = !!inv.driveway;
  const driveTop = sc.shapes.some((s) => s.kind === 'driveway');
  if (project.mode !== 'commercial' && drive3d !== driveTop) probs.push(`driveway: top view ${driveTop}, 3D ${drive3d}`);
  if (project.mode === 'commercial') {
    const units = sc.shapes.filter((s) => s.kind === 'unit').length;
    const rollerRows = project.commercial.rows?.length ? units : 0;
    if (units !== rollerRows) probs.push('unit shapes');
    const buildings = sc.shapes.filter((s) => s.kind === 'building').length;
    if (buildings !== (project.commercial.buildings || []).length) probs.push(`buildings: top view ${buildings}, project ${(project.commercial.buildings || []).length}`);
  }
  const tanks = sc.shapes.filter((s) => s.kind === 'extra' && s.fill === '#9fb8c9').length;
  if (project.mode !== 'commercial' && tanks !== (inv.tank?.count || 0)) probs.push(`tanks: top view ${tanks}, 3D ${inv.tank?.count || 0}`);
  return probs;
}
