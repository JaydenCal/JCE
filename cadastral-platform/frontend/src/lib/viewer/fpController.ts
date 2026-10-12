import * as THREE from 'three';
import { MOVE_DEFAULTS, eyeOffset, newPlayer, stepPlayer, type GroundFn, type MoveInput, type MoveSettings, type PlayerState } from './movement';
import type { BoxCollider, Settings, Vec3 } from './types';

export class FirstPersonController {
  state: PlayerState; yaw = 0; pitch = 0; locked = false; enabled = false;
  private keys = new Set<string>(); private stick = [0, 0]; private jumpQ = false; private bob = 0; private eyeZ = 0; private wasLocked = false;
  cfg: MoveSettings; speed = 0;
  onExit: () => void = () => {}; onLockChange: (l: boolean) => void = () => {};
  private bound: Array<[EventTarget, string, EventListener]> = [];

  constructor(public camera: THREE.PerspectiveCamera, private dom: HTMLElement, private world: { colliders: BoxCollider[]; ground: GroundFn },
    private spawn: { p: Vec3; yaw?: number }, public settings: Settings, private minZ: number) {
    this.cfg = this.mkCfg(); this.state = newPlayer(...(spawn.p as [number, number, number]));
  }
  private mkCfg(): MoveSettings { const s = this.settings; return { ...MOVE_DEFAULTS, eyeHeight: s.eyeHeight, stepUp: s.stepUp, slopeDeg: s.slopeDeg }; }
  applySettings() { this.cfg = this.mkCfg(); this.camera.fov = this.settings.fov; this.camera.updateProjectionMatrix(); }
  respawn(at?: { p: Vec3; yaw?: number }) { const s = at ?? this.spawn; this.state = newPlayer(...(s.p as [number, number, number])); this.yaw = ((s.yaw ?? 0) * Math.PI) / 180; this.pitch = 0; this.eyeZ = s.p[2] + this.cfg.eyeHeight; }

  private on(t: EventTarget, ev: string, fn: (e: any) => void) { t.addEventListener(ev, fn as EventListener); this.bound.push([t, ev, fn as EventListener]); }
  enable() {
    if (this.enabled) return; this.enabled = true; this.respawn(); this.applySettings();
    this.on(window, 'keydown', (e: KeyboardEvent) => { if (isTyping(e)) return; this.keys.add(e.code); if (e.code === 'Space' && !e.repeat) this.jumpQ = true; if (e.code === 'Escape') this.onExit(); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); });
    this.on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code));
    this.on(window, 'blur', () => this.keys.clear());
    this.on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === this.dom; this.onLockChange(this.locked); if (this.wasLocked && !this.locked) this.onExit(); this.wasLocked = this.locked; });
    this.on(document, 'mousemove', (e: MouseEvent) => { if (this.locked || (e.buttons & 1 && e.target === this.dom)) this.look(e.movementX, e.movementY); });
    this.on(this.dom, 'pointerdown', () => { if (!this.locked && this.enabled) this.requestLock(); });
    this.requestLock();
  }
  disable() {
    this.enabled = false; for (const [t, e, f] of this.bound) t.removeEventListener(e, f); this.bound = []; this.keys.clear(); this.wasLocked = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }
  requestLock() { try { const p = (this.dom as any).requestPointerLock?.(); if (p?.catch) p.catch(() => {}); } catch { /* unsupported */ } }
  look(dx: number, dy: number, k = 0.0022) { const s = k * this.settings.sensitivity; this.yaw += dx * s; this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * s)); }
  setStick(x: number, y: number) { this.stick = [x, y]; }
  jump() { this.jumpQ = true; }
  setCrouchToggle(on: boolean) { if (on) this.keys.add('KeyC'); else this.keys.delete('KeyC'); }

  update(dt: number) {
    const k = this.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.stick[1];
    const right = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.stick[0];
    const inp: MoveInput = { fwd: clamp(fwd), right: clamp(right), sprint: k.has('ShiftLeft') || k.has('ShiftRight') || Math.hypot(...(this.stick as [number, number])) > 0.9, jump: this.jumpQ, crouch: k.has('KeyC'), yaw: this.yaw };
    this.jumpQ = false;
    const prev = this.state; this.state = stepPlayer(prev, inp, this.cfg, this.world, dt);
    if (this.state.z < this.minZ - 30) this.respawn();
    this.speed = Math.hypot(this.state.vx, this.state.vy);
    const s = this.state; const target = s.z + eyeOffset(s, this.cfg);
    this.eyeZ += (target - this.eyeZ) * Math.min(1, dt * 16); if (Math.abs(target - this.eyeZ) > 1.5) this.eyeZ = target;
    this.bob += s.grounded ? this.speed * dt * 2.4 : 0;
    const bob = this.settings.headBob && s.grounded ? Math.sin(this.bob) * 0.03 * Math.min(1, this.speed / this.cfg.walk) : 0;
    this.camera.position.set(s.x, s.y, this.eyeZ + bob);
    const cp = Math.cos(this.pitch); this.camera.lookAt(s.x + Math.sin(this.yaw) * cp, s.y + Math.cos(this.yaw) * cp, this.camera.position.z + Math.sin(this.pitch));
  }
}
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
function isTyping(e: KeyboardEvent) { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
