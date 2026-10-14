'use client';
/**
 * Long section of a driveway as an SVG chart: existing ground against the design line, a grade label on each segment, stations, and the
 * failing chainages in red (hover for the requirement key, its limit and the value). All drawing data comes from `chartModel`
 * (lib/site/driveway.ts); the chart invents nothing. A browser PREVIEW is marked PREVIEW across the chart.
 */
import { chartModel, CHART_BOX, type ProfileView } from '@/lib/site/driveway';

const FAIL = '#d11d1d';

export function LongSection({ view }: { view: ProfileView }) {
  const m = chartModel(view), b = m.box;
  if (m.empty) return <div className="note" role="note">LONG SECTION: {m.empty}</div>;
  const nFail = view.failing.length;
  const summary = `Long section, chainage ${m.range.t0.toFixed(1)} to ${m.range.t1.toFixed(1)} m, ${view.segments.length} segments, ${nFail} failing span${nFail === 1 ? '' : 's'}${view.preview ? ', preview' : ''}`;
  return (
    <svg className="ls-svg" viewBox={`0 0 ${b.width} ${b.height}`} role="img" aria-label={summary} width="100%" style={{ maxWidth: CHART_BOX.width, display: 'block' }}>
      <title>{summary}</title>
      <rect x={b.padLeft} y={b.padTop} width={b.width - b.padLeft - b.padRight} height={b.height - b.padTop - b.padBottom} fill="none" stroke="var(--line)" />
      {m.yTicks.map((t) => <g key={'y' + t.y}><line x1={b.padLeft} x2={b.width - b.padRight} y1={t.y} y2={t.y} stroke="var(--line)" strokeDasharray="2 3" /><text x={b.padLeft - 4} y={t.y + 3} textAnchor="end" fontSize="9" fill="var(--muted)">{t.label}</text></g>)}
      {m.xTicks.map((t) => <g key={'x' + t.x}><line x1={t.x} x2={t.x} y1={b.height - b.padBottom} y2={b.height - b.padBottom + 3} stroke="var(--muted)" /><text x={t.x} y={b.height - b.padBottom + 13} textAnchor="middle" fontSize="9" fill="var(--muted)">{t.label}</text></g>)}
      <text x={b.padLeft} y={b.height - 4} fontSize="9" fill="var(--muted)">CHAINAGE FROM THE ASSUMED KERB LINE (M)</text>
      <text x={4} y={9} fontSize="9" fill="var(--muted)">RL (M)</text>
      <path d={m.existing} fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="4 3"><title>EXISTING GROUND</title></path>
      {m.design && <path d={m.design} fill="none" stroke="var(--accent)" strokeWidth="2"><title>DESIGN LEVEL</title></path>}
      {m.failing.map((f, i) => <path key={i} d={f.d} fill="none" stroke={FAIL} strokeWidth="4" strokeLinecap="round" data-failing="true"><title>{f.title}</title></path>)}
      {m.stations.map((s) => (
        <g key={s.name + s.x}>
          {s.yDesign !== null && <circle cx={s.x} cy={s.yDesign} r={3} fill={s.transition === 'TRANSITION REQUIRED' ? FAIL : 'var(--panel)'} stroke="var(--accent)"><title>{`${s.name}${s.kind ? ` (${s.kind})` : ''}${s.transition ? `: ${s.transition}` : ''}`}</title></circle>}
        </g>
      ))}
      {m.segments.map((s) => {
        const x = (s.x0 + s.x1) / 2, wide = s.x1 - s.x0 > 26;
        const yd = m.stations.find((q) => Math.abs(q.x - s.x0) < 0.5)?.yDesign ?? b.padTop + 12;
        return wide ? <text key={s.fromM} x={x} y={Math.max(b.padTop + 9, yd - 8)} textAnchor="middle" fontSize="10" fontWeight={600} fill={s.failing ? FAIL : 'var(--fg)'} data-grade={s.label} data-failing={s.failing ? 'true' : undefined}><title>{s.failing ? s.title : `${s.fromM} to ${s.toM} m`}</title>{s.label}</text> : null;
      })}
      {view.preview && <text x={b.width / 2} y={b.height / 2} textAnchor="middle" fontSize="34" fontWeight={700} fill="var(--muted)" opacity="0.22" pointerEvents="none">PREVIEW</text>}
    </svg>
  );
}
