import * as THREE from 'three';
import type { MeasureMode, MeasurePoint } from './measure';

/** The points and lines of a measurement, drawn over the model (not depth tested, so they stay visible). Markers keep a constant size on screen. */
export class MeasureOverlay {
  readonly group = new THREE.Group();
  private markers: THREE.Mesh[] = [];
  private line: THREE.Line | null = null;
  private colour: THREE.Color;
  static MARKER_PX = 5;
  constructor(colour = '#a8842f') { this.group.name = 'measure'; this.group.renderOrder = 999; this.colour = new THREE.Color(colour); }
  setColour(c: string) { this.colour.set(c); for (const m of this.markers) (m.material as THREE.MeshBasicMaterial).color.copy(this.colour); (this.line?.material as THREE.LineBasicMaterial | undefined)?.color.copy(this.colour); }
  private clear() {
    for (const m of this.markers) { this.group.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.markers = [];
    if (this.line) { this.group.remove(this.line); this.line.geometry.dispose(); (this.line.material as THREE.Material).dispose(); this.line = null; }
  }
  /** `O` is the scene origin (E, N); points are drawn at their RL (a missing RL is drawn at the level of the nearest known one, or 0). */
  update(pts: readonly MeasurePoint[], mode: MeasureMode, O: readonly [number, number]) {
    this.clear();
    if (!pts.length) return;
    let last = pts.find((p) => p.rl !== null)?.rl ?? 0;
    const v = pts.map((p) => { if (p.rl !== null) last = p.rl; return new THREE.Vector3(p.e - O[0], p.n - O[1], last + 0.05); });
    for (const p of v) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: this.colour, depthTest: false, transparent: true }));
      m.position.copy(p); m.renderOrder = 1000; this.markers.push(m); this.group.add(m);
    }
    if (v.length > 1) {
      const path = mode === 'area' && v.length > 2 ? [...v, v[0]] : v;
      this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineBasicMaterial({ color: this.colour, depthTest: false, transparent: true }));
      this.line.renderOrder = 999; this.group.add(this.line);
    }
  }
  /** Keep the markers a constant size on screen: `mpp(p)` gives the metres per pixel at a world point. */
  frame(mpp: (p: THREE.Vector3) => number) { for (const m of this.markers) m.scale.setScalar(MeasureOverlay.MARKER_PX * mpp(m.position)); }
  dispose() { this.clear(); }
}
