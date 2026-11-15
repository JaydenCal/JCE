// The plan terms modal: an accessible dialog with the terms in a scrollable region, a required checkbox and Generate / Cancel.
// Generate stays disabled until the box is ticked. Escape and Cancel resolve false. Focus is trapped and returned. Self contained
// (own styles, tokens with fallbacks) so it works in the editor, the embedded viewer and the portal.

const STYLE_ID = 'gi-terms-css';
const CSS = `
.gi-terms-scrim{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,18,24,.62);font-family:var(--ps-font-ui,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif)}
.gi-terms{box-sizing:border-box;width:min(560px,100%);max-height:min(640px,100%);display:flex;flex-direction:column;background:var(--ps-panel,#fff);color:var(--ps-text,#1a1c20);border:1px solid var(--ps-border-strong,#b6b8bd);border-radius:8px;box-shadow:0 18px 60px rgba(0,0,0,.35)}
.gi-terms *{box-sizing:border-box}
.gi-terms-head{padding:16px 18px 10px}
.gi-terms-head h2{margin:0;font-size:18px;line-height:1.25}
.gi-terms-ver{margin:4px 0 0;font-size:12.5px;color:var(--ps-muted,#5a5e66)}
.gi-terms-draft{margin:10px 18px 0;padding:8px 10px;border-radius:5px;background:var(--ps-warning-soft,#f7e9cc);color:var(--ps-warning,#935800);font-size:13px;font-weight:600}
.gi-terms-body{margin:10px 18px 0;padding:10px 12px;flex:1 1 auto;min-height:96px;overflow:auto;border:1px solid var(--ps-border,#dcdde0);border-radius:5px;background:var(--ps-panel-2,#f5f5f6);font-size:14px;line-height:1.5;-webkit-overflow-scrolling:touch}
.gi-terms-body:focus-visible{outline:2px solid var(--ps-focus,#1b4fd1);outline-offset:2px}
.gi-terms-body h3{margin:12px 0 4px;font-size:14px}
.gi-terms-body h3:first-child,.gi-terms-body p:first-child{margin-top:0}
.gi-terms-body p{margin:0 0 8px}
.gi-terms-body ol,.gi-terms-body ul{margin:0 0 6px;padding-left:20px}
.gi-terms-body li{margin:0 0 8px}
.gi-terms-check{display:flex;gap:10px;align-items:flex-start;margin:12px 18px 0;font-size:14px;line-height:1.4;cursor:pointer}
.gi-terms-check input{flex:0 0 auto;width:20px;height:20px;margin:1px 0 0;accent-color:var(--ps-accent,#1b4fd1)}
.gi-terms-err{margin:8px 18px 0;color:var(--ps-danger,#b52828);font-size:13px}
.gi-terms-foot{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;padding:14px 18px 16px}
.gi-terms-btn{min-height:40px;padding:0 18px;border-radius:5px;border:1px solid var(--ps-border-strong,#b6b8bd);background:var(--ps-panel,#fff);color:var(--ps-text,#1a1c20);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.gi-terms-btn--pri{background:var(--ps-accent,#1b4fd1);border-color:var(--ps-accent,#1b4fd1);color:var(--ps-accent-ink,#fff)}
.gi-terms-btn:disabled{opacity:.5;cursor:not-allowed}
.gi-terms-btn:focus-visible,.gi-terms-check input:focus-visible{outline:2px solid var(--ps-focus,#1b4fd1);outline-offset:2px}
@media (max-width:480px){.gi-terms-scrim{padding:8px}.gi-terms{max-height:100%}.gi-terms-head,.gi-terms-foot{padding-left:14px;padding-right:14px}.gi-terms-draft,.gi-terms-body,.gi-terms-check,.gi-terms-err{margin-left:14px;margin-right:14px}.gi-terms-foot .gi-terms-btn{flex:1 1 0}}
`;

function injectCss(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  doc.head.append(s);
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * opts: { terms, onConfirm?: async () => void (throw to keep the dialog open), host?: Element, confirmLabel? }
 * Resolves true after onConfirm succeeds, false on Cancel or Escape.
 */
export function openTermsModal({ terms, onConfirm = null, host = null, confirmLabel = 'Generate' } = {}) {
  const doc = (host && host.ownerDocument) || document;
  injectCss(doc);
  const previous = doc.activeElement;
  const uid = Math.random().toString(36).slice(2, 7);
  const mk = (tag, attrs = {}, ...kids) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else n.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids) if (kid) n.append(kid);
    return n;
  };
  const draft = /-draft$/i.test(String(terms.version));
  const check = mk('input', { type: 'checkbox', id: `gi-terms-ck-${uid}`, 'data-ps': 'terms-check' });
  const err = mk('p', { class: 'gi-terms-err', role: 'alert', hidden: true, 'data-ps': 'terms-error' });
  const go = mk('button', { type: 'button', class: 'gi-terms-btn gi-terms-btn--pri', 'data-ps': 'terms-generate', disabled: true, text: confirmLabel });
  const cancel = mk('button', { type: 'button', class: 'gi-terms-btn', 'data-ps': 'terms-cancel', text: 'Cancel' });
  const body = mk('div', { class: 'gi-terms-body', tabindex: '0', role: 'region', 'aria-label': `${terms.title} text, scrollable`, id: `gi-terms-body-${uid}`, 'data-ps': 'terms-body', html: terms.bodyHtml });
  const dialog = mk('div', { class: 'gi-terms', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `gi-terms-h-${uid}`, 'aria-describedby': `gi-terms-body-${uid}`, 'data-ps': 'terms-dialog' },
    mk('div', { class: 'gi-terms-head' }, mk('h2', { id: `gi-terms-h-${uid}`, text: terms.title }), mk('p', { class: 'gi-terms-ver', text: `Version ${terms.version}, effective ${terms.effectiveDate}` })),
    draft ? mk('p', { class: 'gi-terms-draft', text: 'Draft wording, pending legal review.' }) : null,
    body,
    mk('label', { class: 'gi-terms-check', for: check.id }, check, mk('span', { text: terms.checkboxLabel })),
    err,
    mk('div', { class: 'gi-terms-foot' }, cancel, go));
  const scrim = mk('div', { class: 'gi-terms-scrim', 'data-ps': 'terms-modal' }, dialog);

  return new Promise((resolve) => {
    let busy = false;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      doc.removeEventListener('keydown', onKey, true);
      scrim.remove();
      try { previous?.focus?.({ preventScroll: true }); } catch { /* element gone */ }
      resolve(value);
    };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) finish(false); return; }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === doc.activeElement);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = doc.activeElement;
      if (!dialog.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
    check.addEventListener('change', () => { go.disabled = !check.checked || busy; err.hidden = true; });
    cancel.addEventListener('click', () => { if (!busy) finish(false); });
    scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim && !busy) finish(false); });
    go.addEventListener('click', async () => {
      if (!check.checked || busy) return; // generation is blocked until the box is ticked
      busy = true;
      go.disabled = true;
      cancel.disabled = true;
      go.textContent = 'Recording';
      err.hidden = true;
      try {
        if (onConfirm) await onConfirm();
        finish(true);
      } catch (e) {
        busy = false;
        go.textContent = confirmLabel;
        go.disabled = !check.checked;
        cancel.disabled = false;
        err.textContent = e?.message && !/^(Failed to fetch|Load failed)/i.test(e.message) ? e.message : 'Your acceptance could not be recorded. Check your connection and try again.';
        err.hidden = false;
      }
    });
    doc.addEventListener('keydown', onKey, true);
    (host || doc.body).append(scrim);
    setTimeout(() => body.focus({ preventScroll: true }), 0);
  });
}

export default openTermsModal;
