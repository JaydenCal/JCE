"use client";
import { useRef, useState } from "react";
import { AppWindow } from "./AppWindow";
import { CAPTION, LEGEND } from "./data";
/** Callout targets are positions on the real SA5 sheet (percent of image width/height). */
const CALLOUTS = [
  { k: "Lot boundary", x: 34.2, y: 31.8, lx: 3, ly: 22 },
  { k: "Building envelope", x: 34, y: 34.7, lx: 3, ly: 46 },
  { k: "Setback 0.90 m", x: 58.5, y: 41.7, lx: 54, ly: 56 },
  { k: "Driveway crossover", x: 25, y: 74, lx: 2, ly: 62 },
  { k: "Swept path B85", x: 35, y: 70.7, lx: 55, ly: 68 },
  { k: "Front setback 6.5 m", x: 31, y: 80.6, lx: 55, ly: 80 },
];
export function PlanShowcase() {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 }); const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null); const box = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(true);
  const clamp = (s: number, x: number, y: number) => { const r = box.current?.getBoundingClientRect(); const w = r?.width ?? 800, h = r?.height ?? 560; const mx = (w * (s - 1)), my = (h * (s - 1)); return { s, x: Math.min(0, Math.max(-mx, x)), y: Math.min(0, Math.max(-my, y)) }; };
  const zoom = (f: number, cx?: number, cy?: number) => setT((o) => { const s = Math.min(6, Math.max(1, o.s * f)); const r = box.current?.getBoundingClientRect(); const px = cx ?? (r ? r.width / 2 : 0), py = cy ?? (r ? r.height / 2 : 0); const k = s / o.s; return clamp(s, px - (px - o.x) * k, py - (py - o.y) * k); });
  const down = (e: React.PointerEvent) => { drag.current = { px: e.clientX, py: e.clientY, x: t.x, y: t.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent) => { const d = drag.current; if (d) setT((o) => clamp(o.s, d.x + e.clientX - d.px, d.y + e.clientY - d.py)); };
  const onKey = (e: React.KeyboardEvent) => { const st = 40; if (e.key === "+" || e.key === "=") zoom(1.3); else if (e.key === "-") zoom(1 / 1.3); else if (e.key === "0") setT({ s: 1, x: 0, y: 0 }); else if (e.key.startsWith("Arrow")) { e.preventDefault(); setT((o) => clamp(o.s, o.x + (e.key === "ArrowLeft" ? st : e.key === "ArrowRight" ? -st : 0), o.y + (e.key === "ArrowUp" ? st : e.key === "ArrowDown" ? -st : 0))); } };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <AppWindow title="Civil plan &middot; A3 sheet">
        <div className="relative bg-scene p-3 sm:p-4">
          <div ref={box} role="group" tabIndex={0} aria-label="Civil plan sheet viewer. Drag to pan, plus and minus to zoom, zero to reset." onKeyDown={onKey}
            onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); } }}
            className="relative aspect-[2000/1414] w-full touch-pan-y cursor-grab overflow-hidden rounded border border-line bg-white active:cursor-grabbing">
            <div className="absolute inset-0 origin-top-left will-change-transform" style={{ transform: `translate(${t.x}px,${t.y}px) scale(${t.s})` }}>
              <img src="/samples/gunnedah-plan.webp" alt="Generated plan sheet for Lot 2 DP227508, Gunnedah: lot boundary, building envelope, setbacks, driveway crossover, swept path and title block" width={2400} height={1697} draggable={false} className="pointer-events-none block h-full w-full select-none" />
              {show && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 70.7" aria-hidden>{CALLOUTS.map((c) => <g key={c.k}><line x1={c.x} y1={c.y * .707} x2={c.lx + (c.lx > c.x ? 0 : 12)} y2={c.ly * .707} stroke="#a8842f" strokeWidth={.18 / t.s * 1.5} /><circle cx={c.x} cy={c.y * .707} r={.5 / Math.sqrt(t.s)} fill="#a8842f" stroke="#fff" strokeWidth={.15 / t.s} /></g>)}</svg>}
              {show && CALLOUTS.map((c) => <span key={c.k} className="pointer-events-none absolute whitespace-nowrap rounded-sm border border-brand bg-surface px-2 py-1 font-mono text-[10.5px] font-medium text-ink shadow-card" style={{ left: `${c.lx}%`, top: `${c.ly}%`, transform: `translateY(-50%) scale(${1 / Math.sqrt(t.s)})`, transformOrigin: "left center" }}>{c.k}</span>)}
            </div>
            <div className="absolute right-2 top-2 flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
              {[["+", () => zoom(1.4), "Zoom in"], ["−", () => zoom(1 / 1.4), "Zoom out"], ["1:1", () => setT({ s: 1, x: 0, y: 0 }), "Reset view"]].map(([l, f, a]) => <button key={a as string} aria-label={a as string} onClick={f as () => void} className="h-8 min-w-8 rounded border border-ink/30 bg-surface px-2 font-mono text-xs text-ink hover:border-ink">{l as string}</button>)}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-muted"><span>{CAPTION}. Zoom {Math.round(t.s * 100)}%. Drag to pan.</span><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="accent-[rgb(var(--brand-strong))]" />Callouts</label></div>
        </div>
      </AppWindow>
      <aside aria-label="Layer legend" className="h-fit border border-ink/40 bg-surface">
        <div className="border-b border-ink/40 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[.18em] text-muted">Layer legend</div>
        <ul className="divide-y divide-line">{LEGEND.map(([n, c, k]) => <li key={n} className="flex items-center gap-3 px-4 py-2 text-[13px]">
          <svg width="34" height="10" aria-hidden><line x1="0" y1="5" x2="34" y2="5" stroke={c} strokeWidth="2" strokeDasharray={k === "dash" ? "7 4" : k === "hatch" ? "2 2" : undefined} /></svg>{n}</li>)}</ul>
        <div className="border-t border-ink/40 px-4 py-3 font-mono text-[10.5px] leading-snug text-muted">Legend as printed on the sheet.</div>
      </aside>
    </div>
  );
}
