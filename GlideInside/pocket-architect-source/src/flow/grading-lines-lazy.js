// The flows' view of grading-lines.js. That module pulls in the whole 3D stack (three.js, about 850 KB) through the grading report, so the
// first load of the app does not import it: this wrapper loads it in the background once the page has loaded and is idle, and the step 4
// card repaints when it arrives. Where a synchronous answer is needed (plan set export, tests) import ./grading-lines.js directly.
let mod = null; let pending = null; const waiters = new Set();
export function loadGrading() {
  if (!pending) pending = import('./grading-lines.js').then((m) => { mod = m; for (const f of [...waiters]) { try { f(); } catch { /* a repaint that fails must not stop the others */ } } waiters.clear(); return m; }).catch(() => null);
  return pending;
}
/** Same answer as grading-lines.js; [] until that module has loaded, when repaint (if given) is called once. */
export function gradingLinesOf(project, repaint) {
  if (mod) return mod.gradingLinesOf(project);
  if (project?.site?.lot?.terrain) { loadGrading(); if (repaint) waiters.add(repaint); }
  return [];
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const idle = () => { if ('requestIdleCallback' in window) requestIdleCallback(() => loadGrading(), { timeout: 4000 }); else setTimeout(loadGrading, 3000); };
  if (document.readyState === 'complete') idle(); else window.addEventListener('load', idle, { once: true });
}
