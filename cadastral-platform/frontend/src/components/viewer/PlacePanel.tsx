'use client';
import { useMemo, useState } from 'react';
import type { CatalogueItem } from '@/lib/viewer/types';
import type { PlaceState } from '@/lib/viewer/placeController';
import { filterCatalogue, money } from '@/lib/viewer/catalogue';
import { shoppingCsv, shoppingList } from '@/lib/viewer/snapping';

export interface PlaceProps {
  catalogue: CatalogueItem[]; state: PlaceState; loading?: string;
  onPick(id: string): void; onMove(): void; onDuplicate(): void; onDelete(): void; onSelect(id: string): void; onUndo(): void; onRedo(): void; onCancel(): void;
}
const dims = (c: CatalogueItem) => `${c.dims.w} × ${c.dims.d} × ${c.dims.h} m`;

export function PlacePanel(p: PlaceProps) {
  const [q, setQ] = useState(''), [cat, setCat] = useState('All');
  const map = useMemo(() => new Map(p.catalogue.map((c) => [c.id, c])), [p.catalogue]);
  const cats = useMemo(() => ['All', ...Array.from(new Set(p.catalogue.map((c) => c.category)))], [p.catalogue]);
  const list = filterCatalogue(p.catalogue, q, cat), s = p.state;
  const sel = s.items.find((i) => i.id === s.selectedId), selCat = sel && map.get(sel.itemId);
  const shop = shoppingList(s.items, map);
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([shoppingCsv(s.items, map)], { type: 'text/csv' })); const a = document.createElement('a');
    a.href = url; a.download = 'shopping-list.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <section>
        <h2>Catalogue</h2>
        <input className="search" placeholder="Search items, brands, retailers" aria-label="Search catalogue" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">{cats.map((c) => <button key={c} className={'chip' + (c === cat ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}</div>
        {p.loading && <div className="note">{p.loading}</div>}
        <div className="cards">
          {list.map((c) => (
            <button key={c.id} className={'card' + (s.ghostCatId === c.id ? ' on' : '')} onClick={() => p.onPick(c.id)} aria-label={`Place ${c.title}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.image} alt="" />
              <span><span className="t">{c.title}</span><br /><span className="m">{c.brand ? c.brand + ' · ' : ''}{c.retailer}</span><br /><span className="m">{dims(c)}{c.model_kind === 'proxy' ? ' · proxy box' : ''}</span><br /><span className="p">{money(c.price, c.currency)}</span></span>
            </button>
          ))}
          {!list.length && <div className="note">No items match.</div>}
        </div>
      </section>
      <section>
        <h2>Placement</h2>
        <div className="note" style={{ marginBottom: 8 }}>{s.hint}</div>
        <div className="btns">
          <button className="view" onClick={p.onUndo} disabled={!s.canUndo}>Undo<kbd>Ctrl+Z</kbd></button>
          <button className="view" onClick={p.onRedo} disabled={!s.canRedo}>Redo<kbd>Ctrl+Y</kbd></button>
          {s.mode !== 'idle' && <button className="view" onClick={p.onCancel}>Cancel<kbd>Esc</kbd></button>}
        </div>
        {sel && selCat && (
          <div className="sel" style={{ marginTop: 10 }}>
            <b>{selCat.title}</b><div className="m note">{dims(selCat)} · yaw {sel.yaw}° · {sel.surface ?? ''}</div>
            {sel.warnings?.map((w) => <span key={w} className="badge">{w}</span>)}
            <div className="btns" style={{ marginTop: 8 }}>
              <button className="view" onClick={p.onMove}>Move<kbd>G</kbd></button><button className="view" onClick={p.onDuplicate}>Duplicate<kbd>D</kbd></button><button className="view" onClick={p.onDelete}>Delete<kbd>Del</kbd></button>
            </div>
          </div>
        )}
      </section>
      <section>
        <h2>Shopping list ({s.items.length} placed)</h2>
        {!shop.rows.length ? <div className="note">Nothing placed yet.</div> : (
          <table><tbody>
            {shop.rows.map((r) => <tr key={r.item.id}><td>{r.qty} × {r.item.url ? <a href={r.item.url} target="_blank" rel="noreferrer noopener">{r.item.title}</a> : r.item.title}<div className="note">{r.item.retailer}</div></td><td className="v">{money(r.item.price * r.qty, r.item.currency)}</td></tr>)}
            <tr><th>Total</th><th className="v">{money(shop.total)}</th></tr>
          </tbody></table>
        )}
        {shop.asAt && <div className="note" style={{ marginTop: 6 }}>Prices as at {shop.asAt}. Illustrative only; check with the retailer.</div>}
        {s.items.some((i) => i.warnings?.length) && (
          <div style={{ marginTop: 8 }}><h2>Compliance</h2>
            {s.items.filter((i) => i.warnings?.length).map((i) => <div key={i.id} className="note"><button className="chip" onClick={() => p.onSelect(i.id)}>{map.get(i.itemId)?.title ?? i.itemId}</button>{i.warnings!.map((w) => <span key={w} className="badge">{w}</span>)}</div>)}
          </div>
        )}
        <div className="btns" style={{ marginTop: 10 }}><button className="view" onClick={exportCsv} disabled={!shop.rows.length}>Export CSV</button></div>
      </section>
    </>
  );
}
