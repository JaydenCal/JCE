// Subdivision check: the "Check subdivision potential" mode of the Glide Inside app (?mode=subdivision-check). A page of its own, not the editor.
//
//   address  ->  lot and aerial  ->  indicative lot count and rough layout  ->  details  ->  full layout and one page PDF
//
// The owner (signed in with the existing admin token) skips the details and gets the PDF straight away: it is a sales tool for meetings.
// Concept only. No pipe sizes, levels or other design numbers are shown anywhere.

import { h, clear } from '../ui/dom.js';
import { createLiveSearch, NOT_FOUND_TEXT, SEARCH_BUSY_TEXT } from '../site/address-search.js';
import { loadLotForCheck, MAX_LOT_M2 } from './load.js';
import { minLotFor, rangeText } from './rules.js';
import { indicativeYield, KIND_TEXT } from './layout.js';
import { drawCheck } from './render.js';
import { buildSnapshotPdf, downloadBlob, fileNameFor, CONTACT } from './pdf.js';
import { CAVEAT, DONE_LINE, CONSENT_TEXT, ROLES, EVENTS, trackSubdiv, validateLead, buildLeadPayload, submitLead } from './lead.js';
import { savedToken, saveToken, clearToken, verifyOwner } from './owner.js';

const CSS = `
.sc{--ink:#1a202c;--mute:#5d6676;--gold:#c7a256;--line:#dfe3ea;--bg:#f5f6f8;font-family:Barlow,Arial,Helvetica,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;display:flex;flex-direction:column;font-size:16px;line-height:1.45}
.sc *{box-sizing:border-box}
.sc-bar{background:var(--ink);color:#fff;padding:12px 18px;display:flex;align-items:center;gap:12px;border-bottom:3px solid var(--gold)}
.sc-bar b{letter-spacing:.04em;font-size:15px}.sc-bar span{color:var(--gold);font-size:13px;letter-spacing:.08em}.sc-bar a{color:#fff;margin-left:auto;font-size:14px;opacity:.9}
.sc-main{flex:1;width:100%;max-width:1120px;margin:0 auto;padding:22px 16px 40px}
.sc h1{font-size:30px;line-height:1.15;margin:6px 0 8px;font-weight:600}
.sc-lead{color:var(--mute);margin:0 0 18px;max-width:640px}
.sc-card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:16px}
.sc-row{display:flex;gap:8px}.sc-row input{flex:1;min-width:0}
.sc input[type=text],.sc input[type=email],.sc input[type=tel],.sc input[type=number],.sc input[type=password],.sc select{width:100%;font:inherit;font-size:16px;padding:12px;border:1px solid #c5cbd6;border-radius:8px;background:#fff;color:var(--ink)}
.sc label{display:block;font-size:13px;font-weight:600;margin:12px 0 4px}
.sc-btn{font:inherit;font-weight:600;border:0;border-radius:8px;padding:12px 18px;background:var(--ink);color:#fff;cursor:pointer;min-height:46px}
.sc-btn:hover{background:#2c3648}.sc-btn.gold{background:var(--gold);color:#1a202c}.sc-btn.ghost{background:#fff;color:var(--ink);border:1px solid #c5cbd6}.sc-btn[disabled]{opacity:.55;cursor:default}
.sc-sug{list-style:none;margin:6px 0 0;padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#fff}
.sc-sug li{padding:12px;border-bottom:1px solid var(--line);cursor:pointer}.sc-sug li:last-child{border-bottom:0}.sc-sug li:hover,.sc-sug li:focus{background:#f3efe3}
.sc-msg{min-height:22px;margin:10px 0 0;color:var(--mute);font-size:14px}.sc-msg.err{color:#b3261e}
.sc-foot{margin-top:18px;font-size:13px;color:var(--mute);display:flex;gap:16px;flex-wrap:wrap}.sc-foot a,.sc-link{color:var(--ink);background:none;border:0;padding:0;font:inherit;text-decoration:underline;cursor:pointer}
.sc-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr);gap:16px;align-items:start}
.sc-plan{position:relative;background:#222;border-radius:10px;overflow:hidden;border:1px solid var(--line)}
.sc-plan canvas{display:block;width:100%;height:auto}
.sc-lock{position:absolute;left:12px;right:12px;bottom:12px;background:rgba(26,32,44,.92);color:#fff;border-radius:8px;padding:10px 12px;font-size:14px;border-left:4px solid var(--gold)}
.sc-facts{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin:0 0 12px}
.sc-facts div{min-width:0}.sc-facts dt{font-size:11px;letter-spacing:.07em;color:var(--mute);text-transform:uppercase}.sc-facts dd{margin:2px 0 0;font-weight:600;overflow-wrap:anywhere}
.sc-answer{background:var(--ink);color:#fff;border-radius:10px;padding:14px 16px;margin:0 0 12px}.sc-answer small{display:block;color:var(--gold);letter-spacing:.08em;font-size:11px;text-transform:uppercase}.sc-answer strong{display:block;font-size:28px;line-height:1.15;margin:4px 0}.sc-answer em{font-style:normal;color:#d5dae4;font-size:14px}
.sc-min{display:flex;gap:8px;align-items:center}.sc-min input{max-width:130px}
.sc-hint{font-size:13px;color:var(--mute);margin:6px 0 0}
.sc-cav{font-size:14px;margin:12px 0;padding:10px 12px;background:#fbf7ea;border-left:4px solid var(--gold);border-radius:4px}
.sc-roles{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sc-roles label{display:flex;gap:8px;align-items:center;margin:0;padding:10px;border:1px solid #c5cbd6;border-radius:8px;font-weight:500;cursor:pointer}.sc-roles input{width:auto}
.sc-consent{display:flex;gap:10px;align-items:flex-start;font-weight:500!important;font-size:14px!important}.sc-consent input{width:20px;height:20px;margin-top:2px;flex:none}
.sc-banner{background:#e8f3ea;border:1px solid #b9d9c0;color:#1d4d2a;border-radius:8px;padding:10px 12px;margin:0 0 12px;font-size:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sc-actions{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0}
.sc-next{margin:14px 0 0;padding:12px;border:1px solid var(--gold);border-radius:8px;background:#fbf7ea}
.sc-spin{display:inline-block;width:14px;height:14px;border:2px solid #c5cbd6;border-top-color:var(--ink);border-radius:50%;animation:scs 0.8s linear infinite;vertical-align:-2px;margin-right:8px}@keyframes scs{to{transform:rotate(360deg)}}
@media (max-width:820px){.sc-lock{position:static;margin:0;border-radius:0}.sc-bar{padding:10px 12px;gap:8px}.sc-bar b,.sc-bar span,.sc-bar a{white-space:nowrap;font-size:12px}.sc-bar a{margin-left:auto}.sc-grid{grid-template-columns:1fr}.sc h1{font-size:25px}.sc-main{padding:16px 12px 32px}.sc-answer strong{font-size:25px}}
`;

export async function mountSubdivisionCheck(root, { fetchImpl = null } = {}) {
  document.title = 'Subdivision check | Glide Inside';
  const style = h('style', null, CSS);
  const shell = h('div', { class: 'sc' });
  const main = h('main', { class: 'sc-main', id: 'sc-main' });
  const bar = h('div', { class: 'sc-bar' }, h('b', null, 'GLIDE INSIDE'), h('span', null, 'SUBDIVISION CHECK'), h('a', { href: '../../subdivision/' }, 'About subdivisions'));
  shell.append(bar, main);
  clear(root);
  root.append(style, shell);
  root.classList.remove('ps-app');

  const S = { owner: false, token: '', lot: null, bitmap: null, rules: null, userMin: null, result: null, unlocked: false, busy: false, abort: null, role: '' };
  trackSubdiv(EVENTS.start, {});

  const verifySaved = async () => {
    const t = savedToken();
    if (!t) return;
    try { if (await verifyOwner(t, { fetchImpl })) { S.owner = true; S.token = t; } else clearToken(); } catch { /* the server could not be reached: stay public */ }
  };
  const ownerReady = verifySaved();

  // ---- entry screen
  function showEntry(prefill = '') {
    S.lot = null; S.result = null; S.unlocked = false;
    const input = h('input', { type: 'text', id: 'sc-addr', name: 'address', placeholder: 'e.g. 12 Example Street, Tamworth NSW', autocomplete: 'off', autocapitalize: 'words', 'aria-label': 'Street address', enterkeyhint: 'search' });
    input.value = prefill;
    const list = h('ul', { class: 'sc-sug', hidden: true, role: 'listbox' });
    const msg = h('p', { class: 'sc-msg', role: 'status', 'aria-live': 'polite' });
    const go = h('button', { class: 'sc-btn', type: 'button' }, 'Check');
    let rows = [];
    const setMsg = (t, err = false) => { msg.textContent = t || ''; msg.className = `sc-msg${err ? ' err' : ''}`; };
    const pickRow = (row) => runCheck({ pick: row, text: row.label }, setMsg);
    const live = createLiveSearch({
      getText: () => input.value,
      onResults: (r) => {
        rows = r.slice(0, 6);
        clear(list);
        rows.forEach((row) => list.append(h('li', { role: 'option', tabindex: '0', onclick: () => pickRow(row), onkeydown: (e) => { if (e.key === 'Enter') pickRow(row); } }, row.label)));
        list.hidden = !rows.length;
      },
      onBusy: () => setMsg('Busy, trying again'),
      onError: (t) => setMsg(t || SEARCH_BUSY_TEXT, true),
    });
    input.addEventListener('input', () => { setMsg(''); live.trigger(); });
    const submit = async () => {
      const r = await live.now();
      if (r && r.length) pickRow(r[0]);
      else if (r && !r.failed) setMsg(NOT_FOUND_TEXT, true);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    go.addEventListener('click', submit);
    const ownerBox = h('div');
    const foot = h('div', { class: 'sc-foot' },
      h('a', { href: '../../subdivision/' }, 'Back to the subdivision page'),
      S.owner ? h('span', null, 'Signed in as owner. ', h('button', { class: 'sc-link', type: 'button', onclick: () => { clearToken(); S.owner = false; S.token = ''; showEntry(input.value); } }, 'Sign out')) : h('button', { class: 'sc-link', type: 'button', onclick: () => showOwnerSignIn(ownerBox, () => showEntry(input.value)) }, 'Owner sign in'),
      ownerBox);
    clear(main);
    main.append(
      h('h1', null, 'Check subdivision potential'),
      h('p', { class: 'sc-lead' }, 'Type an NSW or Queensland address. You will see roughly how many lots the block could be divided into, with a rough layout drawn on the aerial photo.'),
      h('div', { class: 'sc-card' }, h('label', { for: 'sc-addr', style: { marginTop: 0 } }, 'Street address'), h('div', { class: 'sc-row' }, input, go), list, msg),
      ...(S.owner ? [h('div', { class: 'sc-banner', style: { marginTop: '12px' } }, 'Owner mode. The details form is skipped and the one page snapshot PDF is ready as soon as the layout appears.')] : []),
      foot);
    input.focus({ preventScroll: true });
    if (prefill && prefill.length > 3) live.trigger();
  }

  function showOwnerSignIn(box, done) {
    const tok = h('input', { type: 'password', autocomplete: 'off', 'aria-label': 'Admin token', placeholder: 'Admin token' });
    const err = h('p', { class: 'sc-msg err' });
    const btn = h('button', { class: 'sc-btn', type: 'button' }, 'Sign in');
    btn.addEventListener('click', async () => {
      err.textContent = '';
      btn.disabled = true;
      try {
        const v = tok.value.trim();
        if (await verifyOwner(v, { fetchImpl })) { saveToken(v); S.owner = true; S.token = v; done(); return; }
        err.textContent = 'That token was not accepted.';
      } catch { err.textContent = 'Could not reach the server. Try again.'; }
      btn.disabled = false;
    });
    clear(box);
    box.append(h('div', { class: 'sc-card', style: { marginTop: '8px', width: '100%', maxWidth: '420px' } }, h('p', { class: 'sc-hint', style: { marginTop: 0 } }, 'The same admin token as the private portal admin page. It is kept for this browser tab only.'), tok, h('div', { style: { marginTop: '8px' } }, btn), err));
    tok.focus();
  }

  // ---- looking the address up
  async function runCheck(req, setMsg) {
    if (S.busy) return;
    S.busy = true;
    S.abort?.abort();
    const ctl = new AbortController();
    S.abort = ctl;
    clear(main);
    const status = h('p', { class: 'sc-msg', role: 'status', 'aria-live': 'polite' }, h('span', { class: 'sc-spin' }), 'Finding the lot');
    main.append(h('h1', null, 'Checking the block'), h('div', { class: 'sc-card' }, status));
    const labels = { lot: 'Loading the lot boundary', aerial: 'Loading the aerial photo', busy: 'Busy, trying again' };
    try {
      const out = await loadLotForCheck({ ...req, signal: ctl.signal, onStep: (s) => { status.replaceChildren(h('span', { class: 'sc-spin' }), labels[s] || 'Working'); } });
      if (out.lot.areaM2 > MAX_LOT_M2) throw new Error('That lot is very large. This check is for blocks up to about 200 hectares. Try a smaller one.');
      S.lot = out.lot; S.bitmap = out.bitmap; S.warnings = out.warnings; S.userMin = null;
      trackSubdiv(EVENTS.lotLoaded, { state: out.lot.state, owner: S.owner });
      await ownerReady;
      S.busy = false;
      compute();
      showResult();
    } catch (e) {
      S.busy = false;
      if (e?.name === 'AbortError') return;
      showEntry(req.text || '');
      const m = main.querySelector('.sc-msg');
      if (m) { m.textContent = e?.message || NOT_FOUND_TEXT; m.className = 'sc-msg err'; }
    }
  }

  function compute() {
    const rules = minLotFor(S.lot, { userMinM2: S.userMin });
    const y = indicativeYield(S.lot, rules);
    S.rules = rules;
    S.result = { rules, low: y.low, high: y.high, layout: y.layout };
  }

  // ---- result screen
  function showResult() {
    const { rules, low, high, layout } = S.result;
    const lot = S.lot;
    const open = S.owner || S.unlocked;
    const canvas = h('canvas', { role: 'img', 'aria-label': `Aerial photo of ${lot.address} with the rough subdivision layout` });
    const draw = () => {
      const w = Math.min(1500, Math.round((canvas.parentElement?.clientWidth || 900) * Math.min(2, window.devicePixelRatio || 1)));
      canvas.width = Math.max(600, w); canvas.height = Math.round(canvas.width * 0.75);
      drawCheck(canvas.getContext('2d'), { lot, bitmap: S.bitmap, layout: layout.kind === 'none' ? null : layout, width: canvas.width, height: canvas.height, showLabels: open });
    };
    const plan = h('div', { class: 'sc-plan' }, canvas);
    if (!open && layout.kind !== 'none') plan.append(h('div', { class: 'sc-lock' }, 'Lot numbers, areas and the one page PDF are shown once you leave your details below.'));
    const minInput = h('input', { type: 'number', min: '100', step: '50', value: String(rules.minM2), 'aria-label': 'Minimum lot size in square metres', inputmode: 'numeric' });
    let t = null;
    minInput.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { const v = Number(minInput.value); if (Number.isFinite(v) && v >= 100) { S.userMin = v; compute(); showResult(); } }, 600);
    });
    const dd = (label, val) => h('div', null, h('dt', null, label), h('dd', null, val));
    const info = h('div', null,
      h('dl', { class: 'sc-facts' },
        dd('Lot area', `${Math.round(lot.areaM2).toLocaleString('en-AU')} m²`),
        dd('Zone', [rules.zoneCode, rules.zoneName].filter(Boolean).join(' ') || 'Not found'),
        dd('Lot', [lot.lotNumber && `Lot ${lot.lotNumber}`, lot.planLabel].filter(Boolean).join(' ') || 'Not found'),
        dd('Council area', lot.lga || 'Not found')),
      h('div', { class: 'sc-answer' }, h('small', null, 'Indicative lot count'), h('strong', null, rangeText(low, high)), h('em', null, KIND_TEXT[layout.kind] || '')),
      h('label', { for: 'sc-min', style: { marginTop: 0 } }, 'Minimum lot size used (m²)'),
      h('div', { class: 'sc-min' }, Object.assign(minInput, { id: 'sc-min' }), h('span', { class: 'sc-hint', style: { margin: 0 } }, 'about ' + rules.minFrontM + ' m frontage')),
      h('p', { class: 'sc-hint' }, `${rules.basisText}.${rules.note ? ' ' + rules.note : ''}`),
      h('p', { class: 'sc-cav' }, CAVEAT));
    const side = h('div');
    side.append(info);
    if (S.owner) side.append(ownerPanel());
    else if (S.unlocked) side.append(donePanel());
    else if (layout.kind !== 'none') side.append(leadForm());
    else side.append(h('div', { class: 'sc-card' }, h('p', { style: { marginTop: 0 } }, 'At this minimum lot size the block does not divide into more than one lot. If you know the council figure is smaller, change it above.'), h('button', { class: 'sc-btn ghost', type: 'button', onclick: () => showEntry('') }, 'Check another address')));
    clear(main);
    main.append(...[
      h('h1', null, lot.address || 'Your block'),
      S.warnings?.length ? h('p', { class: 'sc-hint' }, S.warnings.join(' ')) : null,
      h('div', { class: 'sc-grid' }, plan, side)].filter(Boolean));
    requestAnimationFrame(draw);
    trackSubdiv(EVENTS.resultShown, { lots_low: low, lots_high: high, layout: layout.kind, min_basis: rules.basis, state: lot.state, owner: S.owner });
  }

  async function makePdf(btn, note) {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = 'Preparing the PDF';
    try {
      const blob = await buildSnapshotPdf({ lot: S.lot, bitmap: S.bitmap, result: S.result });
      downloadBlob(blob, fileNameFor(S.lot.address));
      trackSubdiv(EVENTS.pdfDownload, { lots_low: S.result.low, lots_high: S.result.high, layout: S.result.layout.kind, owner: S.owner });
    } catch (e) {
      note.textContent = 'The PDF could not be made. Try again.';
      note.className = 'sc-msg err';
    }
    btn.disabled = false;
    btn.textContent = was;
  }

  function pdfButtons() {
    const note = h('p', { class: 'sc-msg', role: 'status' });
    const dl = h('button', { class: 'sc-btn gold', type: 'button', dataset: { act: 'pdf' } }, 'Download the one page PDF');
    dl.addEventListener('click', () => makePdf(dl, note));
    return [h('div', { class: 'sc-actions' }, dl, h('button', { class: 'sc-btn ghost', type: 'button', onclick: () => showEntry('') }, 'Check another address')), note];
  }

  function ownerPanel() {
    return h('div', null, h('div', { class: 'sc-banner' }, 'Owner mode. No details form.'), ...pdfButtons());
  }

  function donePanel() {
    const lot = S.lot;
    const mail = `mailto:${CONTACT.email}?subject=${encodeURIComponent('Subdivision enquiry: ' + (lot.address || ''))}&body=${encodeURIComponent(`Hi Jayden,\n\nI would like to talk about subdividing ${lot.address || 'my site'}.\n`)}`;
    return h('div', null, ...pdfButtons(),
      h('div', { class: 'sc-next' }, h('p', { style: { margin: '0 0 8px', fontWeight: '600' } }, DONE_LINE), h('a', { class: 'sc-btn', style: { display: 'inline-block', textDecoration: 'none' }, href: mail, dataset: { act: 'contact' } }, 'Contact JCE Infrastructure')));
  }

  function leadForm() {
    const f = { name: h('input', { type: 'text', name: 'name', autocomplete: 'name', 'aria-label': 'Name' }), email: h('input', { type: 'email', name: 'email', autocomplete: 'email', inputmode: 'email', 'aria-label': 'Email' }), phone: h('input', { type: 'tel', name: 'phone', autocomplete: 'tel', inputmode: 'tel', 'aria-label': 'Phone (optional)' }), consent: h('input', { type: 'checkbox', name: 'consent' }) };
    const err = h('p', { class: 'sc-msg err', role: 'alert' });
    const roleBox = h('div', { class: 'sc-roles', role: 'radiogroup', 'aria-label': 'I am a' }, ...ROLES.map((r) => h('label', null, h('input', { type: 'radio', name: 'role', value: r, onchange: () => { S.role = r; } }), r)));
    const btn = h('button', { class: 'sc-btn gold', type: 'submit' }, 'Show the full layout and PDF');
    const form = h('form', { class: 'sc-card', novalidate: true, dataset: { form: 'lead' } },
      h('p', { style: { margin: '0 0 4px', fontWeight: '600' } }, 'See the full layout and download the one page PDF'),
      h('label', null, 'Name'), f.name, h('label', null, 'Email'), f.email, h('label', null, 'Phone (optional)'), f.phone,
      h('label', null, 'I am a'), roleBox,
      h('label', { class: 'sc-consent' }, f.consent, h('span', null, CONSENT_TEXT)),
      err, h('div', { style: { marginTop: '10px' } }, btn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = { name: f.name.value, email: f.email.value, phone: f.phone.value, role: S.role, consent: f.consent.checked };
      const bad = validateLead(v);
      err.textContent = bad;
      if (bad) return;
      btn.disabled = true;
      try {
        await submitLead(buildLeadPayload(v, S.lot, S.result), { fetchImpl: fetchImpl || undefined });
        trackSubdiv(EVENTS.leadSubmit, { role: S.role, lots_low: S.result.low, lots_high: S.result.high, layout: S.result.layout.kind, min_basis: S.result.rules.basis, state: S.lot.state });
        S.unlocked = true;
        showResult();
      } catch (ex) {
        err.textContent = ex.message || 'That did not send. Please try again.';
        btn.disabled = false;
      }
    });
    return form;
  }

  await ownerReady;
  const asked = new URLSearchParams(location.search).get('address') || '';
  showEntry(asked.slice(0, 160));
}
