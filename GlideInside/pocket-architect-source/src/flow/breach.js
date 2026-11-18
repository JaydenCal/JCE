// Setback breach guardrail for the guided flow and the editor: the person confirms before a position outside the setbacks is accepted, and
// the wording says by how much. Wording is pure (tested); the dialog loads when asked, because it needs a document.

const EDGE = { front: 'front', secondaryFront: 'side street', rear: 'rear', side: 'side' };

/** Breaches as { kind, name, m } from a placementStatus() result, worst first. */
export function breachList(status) {
  const raw = Array.isArray(status?.breaches) ? status.breaches : [];
  return raw
    .map((b) => ({ kind: b.kind, name: b.name || EDGE[b.kind] || 'lot', m: Math.round((Number(b.breachM) || 0) * 100) / 100 }))
    .filter((b) => b.m > 0)
    .sort((a, b) => b.m - a.m);
}

/** The breach as one plain sentence with the distance, or '' when the position is not outside the setbacks. */
export function breachSentence(status) {
  if (!status || status.state !== 'outside') return '';
  const list = breachList(status);
  if (!list.length) { const t = String(status.text || 'The position is outside the setbacks').trim(); return /[.!?]$/.test(t) ? t : `${t}.`; }
  const parts = list.map((b) => `${b.m.toFixed(2)} m inside the ${b.name} setback`);
  return `This position is ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`;
}

/** The dialog text. */
export function breachDialog(status, { what = 'building' } = {}) {
  return {
    title: 'Outside the setbacks',
    message: `${breachSentence(status)} Council may not accept the ${what} here, and the plan set will say so. Keep this position anyway?`,
    confirmLabel: 'Keep this position',
    cancelLabel: 'Go back and move it',
  };
}

/** Ask the person. Resolves true when there is no breach, or when they chose to keep the position. */
export async function confirmBreach(status, opts = {}) {
  if (!status || status.state !== 'outside') return true;
  const { askConfirm } = await import('../ui/modal.js');
  return askConfirm({ ...breachDialog(status, opts), danger: true });
}

/** The same confirmation for the editor's own checks (src/site/lot-checks.js messages): envelope breaches with their shortfall. */
export const statusFromMessages = (messages) => {
  const env = (messages || []).filter((m) => m.kind === 'envelope' && Number(m.shortByM) > 0);
  return env.length ? { state: 'outside', breaches: env.map((m) => ({ kind: 'edge', name: String(m.text || '').match(/ at the ([^,]+?),/)?.[1] || 'lot', breachM: m.shortByM })) } : null;
};
