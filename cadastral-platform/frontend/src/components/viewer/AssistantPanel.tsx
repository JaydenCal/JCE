'use client';
import { useEffect, useRef, useState } from 'react';
import { SUGGESTIONS, chipLabel, elementId, isSelectable, selectionLabel, type AssistantProvider, type AssistantTurn } from '@/lib/assistant';

interface Msg { who: 'user' | 'bot'; text: string; turn?: AssistantTurn; error?: boolean }
export interface AssistantPanelProps {
  provider: AssistantProvider;
  /** name of the part last clicked in the 3D view */
  picked: string | null;
  /** names of building parts, so only the house (not terrain) can be selected */
  buildingParts: Set<string>;
  /** called with every turn that carries parts, to update the model in place */
  onTurn(t: AssistantTurn): void;
}

export function AssistantPanel({ provider, picked, buildingParts, onTurn }: AssistantPanelProps) {
  const [msgs, setMsgs] = useState<Msg[]>([]), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null), [hist, setHist] = useState({ undo: false, redo: false });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (picked && isSelectable(picked, buildingParts)) setSel(picked); }, [picked, buildingParts]);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [msgs, busy]);

  const handle = (t: AssistantTurn, show = true) => {
    setHist({ undo: t.can_undo, redo: t.can_redo });
    if (t.parts?.length && (t.ops.some((o) => o.ok) || !show)) onTurn(t);
    if (show) setMsgs((m) => [...m, { who: 'bot', text: t.message, turn: t }]);
  };
  const run = async (fn: () => Promise<AssistantTurn>, show = true) => {
    setBusy(true);
    try { handle(await fn(), show); } catch (e) { setMsgs((m) => [...m, { who: 'bot', text: e instanceof Error ? e.message : 'Request failed', error: true }]); } finally { setBusy(false); }
  };
  const send = (message: string) => {
    const s = message.trim(); if (!s || busy) return;
    setMsgs((m) => [...m, { who: 'user', text: s }]); setText('');
    void run(() => provider.send(s, sel ? elementId(sel) : null));
  };
  const history = (which: 'undo' | 'redo') => void run(async () => { const t = await provider[which](); t.ops = []; onTurn(t); return t; });

  return (
    <section className="asst" aria-label="Design assistant">
      <h2>Design assistant</h2>
      {provider.demo && <div className="asst-demo" role="note">Demo, no AI model connected. Replies are scripted.</div>}
      <div className="asst-sel">
        {sel ? <><span>Selected: <b>{selectionLabel(sel)}</b></span><button className="view" onClick={() => setSel(null)} aria-label="Clear selection">Clear</button></>
          : <span className="note">Click a wall, window or roof in the 3D view to talk about it.</span>}
      </div>
      <div className="asst-log" role="log" aria-live="polite">
        {!msgs.length && <div className="note">Describe a change in plain English. Edits are applied to the 3D model and can be undone.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={'asst-msg ' + m.who + (m.error ? ' err' : '')}>
            <div>{m.text}</div>
            {m.turn && m.turn.ops.filter((o) => o.ok).length > 0 && <div className="asst-chips">{m.turn.ops.filter((o) => o.ok).map((o, j) => <span key={j} className="asst-chip">{chipLabel(o)}</span>)}</div>}
            {m.turn?.ops.filter((o) => !o.ok).map((o, j) => <div key={j} className="asst-fail">Could not apply {o.op.replace(/_/g, ' ')}: {o.errors?.[0]?.message}</div>)}
            {m.turn?.warnings.map((w, j) => <div key={j} className="asst-warn" role="note">{w.message}</div>)}
            {m.turn?.clarification?.options?.length ? <div className="asst-chips">{m.turn.clarification.options.map((o) => <button key={o} className="chip" onClick={() => send(o)}>{o}</button>)}</div> : null}
          </div>
        ))}
        {busy && <div className="asst-msg bot note">Working…</div>}
        <div ref={end} />
      </div>
      <div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" disabled={busy} onClick={() => send(s)}>{s}</button>)}</div>
      <form className="asst-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input className="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Make the roof Colorbond Monument" aria-label="Describe a change" maxLength={2000} />
        <button className="view" type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
      <div className="btns">
        <button className="view" onClick={() => history('undo')} disabled={busy || !hist.undo}>Undo</button>
        <button className="view" onClick={() => history('redo')} disabled={busy || !hist.redo}>Redo</button>
      </div>
      <div className="note">Checks are advisory drawing aids, not NCC/BCA or council compliance.</div>
    </section>
  );
}
