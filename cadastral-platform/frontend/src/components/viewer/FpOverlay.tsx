'use client';
import { useRef } from 'react';
import type { FirstPersonController } from '@/lib/viewer/fpController';
import type { Settings } from '@/lib/viewer/types';

export function FpOverlay({ fp, locked, touch, onExit }: { fp: FirstPersonController | null; locked: boolean; touch: boolean; onExit(): void }) {
  const knob = useRef<HTMLElement>(null), look = useRef<{ x: number; y: number; id: number } | null>(null);
  const stick = (e: React.PointerEvent, end = false) => {
    if (!fp) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), m = Math.min(1, Math.hypot(dx, dy) / (r.width / 2)), a = Math.atan2(dy, dx);
    const x = end ? 0 : Math.cos(a) * m, y = end ? 0 : Math.sin(a) * m; fp.setStick(x, y);
    if (knob.current) knob.current.style.transform = `translate(${x * 40}px,${y * 40}px)`;
  };
  return (
    <>
      <div className="cross" aria-hidden="true" />
      <canvas className="minimap" width={280} height={280} data-minimap aria-label="Minimap" />
      {!locked && !touch && <div className="fpmsg">Click the view to look around<br />WASD move · Shift sprint · Space jump · C crouch · Esc exit</div>}
      {touch && fp && (
        <>
          <div className="stick" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stick(e); }} onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') stick(e); }} onPointerUp={(e) => stick(e, true)} onPointerCancel={(e) => stick(e, true)}><i ref={knob as React.RefObject<HTMLElement>} /></div>
          <div className="lookpad" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); look.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; }}
            onPointerMove={(e) => { const l = look.current; if (!l || l.id !== e.pointerId) return; fp.look(e.clientX - l.x, e.clientY - l.y, 0.005); l.x = e.clientX; l.y = e.clientY; }} onPointerUp={() => (look.current = null)} onPointerCancel={() => (look.current = null)} />
          <div className="tbtns"><button onClick={() => fp.jump()}>Jump</button><button onPointerDown={() => fp.setCrouchToggle(true)} onPointerUp={() => fp.setCrouchToggle(false)}>Crouch</button><button onClick={onExit}>Exit</button></div>
        </>
      )}
    </>
  );
}

export function SettingsPanel({ s, set }: { s: Settings; set(p: Partial<Settings>): void }) {
  const R = (label: string, k: keyof Settings, min: number, max: number, step: number, unit = '') => (
    <div className="row"><span>{label}</span><input type="range" aria-label={label} min={min} max={max} step={step} value={s[k] as number} onChange={(e) => set({ [k]: +e.target.value })} /><output>{(s[k] as number).toFixed(step < 1 ? 1 : 0)}{unit}</output></div>
  );
  return (
    <section><h2>Walk settings</h2>
      {R('Eye height', 'eyeHeight', 1.2, 2, 0.05, ' m')}{R('Field of view', 'fov', 50, 110, 1, '°')}{R('Look speed', 'sensitivity', 0.3, 3, 0.1, '×')}
      <label className="row" style={{ gridTemplateColumns: 'auto 1fr' }}><input type="checkbox" checked={s.headBob} onChange={(e) => set({ headBob: e.target.checked })} /><span>Head bob</span></label>
    </section>
  );
}
