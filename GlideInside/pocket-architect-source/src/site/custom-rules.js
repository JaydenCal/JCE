// Site rules the person sets themselves, for a lot outside NSW and Queensland (no council lookup exists there) or any lot where they tick
// "Custom rules". The values start as Australian defaults, labelled as such, and the person overwrites them with the local rule.
// Stored on site.lot.customRules. Metric units only; the currency only changes the symbol (no exchange rate is ever applied).

import { DEFAULT_SETBACKS } from './default-setbacks.js';
import { defaultRulesFor } from '../commercial/rules.js';

export const DEFAULT_LABEL = 'Australian default, set your local rule';
export const CUSTOM_BASIS = 'Set by you (local rule), not checked against any authority';

export const CURRENCIES = Object.freeze([
  { code: 'AUD', symbol: 'A$', label: 'Australian dollar (A$)' },
  { code: 'NZD', symbol: 'NZ$', label: 'New Zealand dollar (NZ$)' },
  { code: 'USD', symbol: 'US$', label: 'US dollar (US$)' },
  { code: 'CAD', symbol: 'C$', label: 'Canadian dollar (C$)' },
  { code: 'GBP', symbol: '£', label: 'Pound sterling (£)' },
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'SGD', symbol: 'S$', label: 'Singapore dollar (S$)' },
  { code: 'ZAR', symbol: 'R', label: 'South African rand (R)' },
  { code: 'AED', symbol: 'AED ', label: 'UAE dirham (AED)' },
  { code: 'OTHER', symbol: '', label: 'Other (type a symbol)' },
]);

export const FIELDS = Object.freeze([
  { key: 'front', label: 'Front setback', unit: 'm', min: 0, max: 100, step: 0.1 },
  { key: 'secondaryFront', label: 'Secondary street setback (corner lots)', unit: 'm', min: 0, max: 100, step: 0.1 },
  { key: 'side', label: 'Side setback', unit: 'm', min: 0, max: 100, step: 0.1 },
  { key: 'rear', label: 'Rear setback', unit: 'm', min: 0, max: 100, step: 0.1 },
  { key: 'coveragePct', label: 'Maximum site coverage', unit: '%', min: 1, max: 100, step: 1 },
  { key: 'landscapePct', label: 'Minimum landscaped area', unit: '%', min: 0, max: 90, step: 1 },
  { key: 'parkingPer100m2', label: 'Parking rate per 100 m² of floor area', unit: 'bays', min: 0, max: 20, step: 0.05, commercialOnly: true },
  { key: 'accessiblePer100Bays', label: 'Accessible bays per 100 bays', unit: 'bays', min: 0.5, max: 100, step: 0.5, commercialOnly: true },
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const currencyOf = (code) => CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];

/** The Australian default values for the mode and zone class: { front, secondaryFront, side, rear, coveragePct, landscapePct, parkingPer100m2, accessiblePer100Bays }. */
export function australianDefaults({ commercial = false, cls = 'industrial' } = {}) {
  if (commercial) {
    const r = defaultRulesFor(cls);
    return { ...r.setbacks, coveragePct: r.coverageMaxPct, landscapePct: r.landscapeMinPct, parkingPer100m2: Math.round(r.parkingPerM2Gfa * 100 * 100) / 100, accessiblePer100Bays: 1 };
  }
  return { front: DEFAULT_SETBACKS.front, secondaryFront: DEFAULT_SETBACKS.secondaryFront, side: DEFAULT_SETBACKS.side, rear: DEFAULT_SETBACKS.rear, coveragePct: 50, landscapePct: 20, parkingPer100m2: 0, accessiblePer100Bays: 1 };
}

/** A fresh customRules object: values from the defaults, `edited` empty so every value still reads as a default. */
export function newCustomRules({ commercial = false, cls = 'industrial', on = true, currency = 'AUD' } = {}) {
  const c = currencyOf(currency);
  return { on, ...australianDefaults({ commercial, cls }), edited: {}, currency: c.code, symbol: c.symbol };
}

export const customRulesOn = (lot) => !!lot && !!lot.customRules && lot.customRules.on === true;

/** A lot that has no council data: an uploaded boundary outside NSW and Queensland. */
export const needsCustomRules = (lot) => !!lot && lot.source === 'upload' && !String(lot.state || '').trim();

/** True when a value is still the Australian default (the person has not changed it). */
export const isDefaultValue = (rules, key) => !(rules?.edited && rules.edited[key]);

/** Merge a patch into customRules, tracking which keys the person edited. Returns the new object. */
export function patchCustomRules(cur, patch) {
  const next = { ...cur, edited: { ...(cur?.edited || {}) } };
  for (const [k, v] of Object.entries(patch || {})) {
    if (k === 'edited') continue;
    if (k === 'currency') {
      const c = currencyOf(v);
      next.currency = c.code;
      if (c.code !== 'OTHER') next.symbol = c.symbol;
      continue;
    }
    if (k === 'symbol') { next.symbol = String(v ?? '').slice(0, 6); continue; }
    if (k === 'on') { next.on = !!v; continue; }
    const f = FIELDS.find((x) => x.key === k);
    if (!f) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    next[k] = Math.min(f.max, Math.max(f.min, n));
    next.edited[k] = true;
  }
  return next;
}

/** The currency symbol for money text: '$' for a normal looked up lot, the chosen symbol (A$ by default) for a custom rules lot. */
export const currencySymbol = (lot) => (customRulesOn(lot) ? (lot.customRules.symbol ?? 'A$') : '$');

let active = '$';
/** Set the symbol money() prints. Called with the project's lot before text is made. */
export function syncCurrency(project) {
  active = currencySymbol(project?.site?.lot || null);
  return active;
}
export const activeSymbol = () => active;

/**
 * The rules in force for a project: custom values when custom rules are on, else the commercial defaults for the class.
 * { custom, setbacks: {front, secondaryFront, side, rear}, coverageMaxPct, landscapeMinPct, parkingPerM2Gfa, accessiblePerBays }
 */
export function effectiveRules(project, cls = 'industrial') {
  const lot = project?.site?.lot || null;
  const d = defaultRulesFor(cls);
  if (!customRulesOn(lot)) return { custom: false, setbacks: d.setbacks, coverageMaxPct: d.coverageMaxPct, landscapeMinPct: d.landscapeMinPct, parkingPerM2Gfa: d.parkingPerM2Gfa, accessiblePerBays: 100 };
  const c = lot.customRules;
  return {
    custom: true,
    setbacks: { front: c.front, secondaryFront: c.secondaryFront, side: c.side, rear: c.rear },
    coverageMaxPct: c.coveragePct,
    landscapeMinPct: c.landscapePct,
    parkingPerM2Gfa: isNum(c.parkingPer100m2) && c.parkingPer100m2 > 0 ? c.parkingPer100m2 / 100 : d.parkingPerM2Gfa,
    accessiblePerBays: isNum(c.accessiblePer100Bays) && c.accessiblePer100Bays > 0 ? 100 / c.accessiblePer100Bays : 100,
  };
}

/** Copy the custom parking and accessible bay rates onto the commercial spec (or take them off again). Mutates p; safe on any project. */
export function syncCustomToCommercial(p) {
  const c = p?.commercial;
  if (!c) return p;
  const lot = p.site?.lot || null;
  if (customRulesOn(lot)) {
    const e = effectiveRules(p, c.useClass || 'industrial');
    c.rates = { ...(c.rates || {}), parkingPerM2Gfa: e.parkingPerM2Gfa, source: 'Set by you (local rule), not checked against any authority' };
    c.parking = { ...(c.parking || {}), accessiblePerBays: e.accessiblePerBays };
  } else if (c.parking && 'accessiblePerBays' in c.parking) {
    delete c.parking.accessiblePerBays;
  }
  return p;
}

/** Set custom rules on the open project as one undo step. patch: the fields to change (see FIELDS), plus on, currency and symbol. */
export function applyCustomRules(store, patch, { label = 'Site rules' } = {}) {
  store.apply(label, (p) => {
    const lot = p.site?.lot;
    if (!lot) return;
    const commercial = p.mode === 'commercial';
    const cls = p.commercial?.useClass || 'industrial';
    const base = lot.customRules || newCustomRules({ commercial, cls, on: false });
    lot.customRules = patchCustomRules(base, patch);
    if (needsCustomRules(lot)) lot.customRules.on = true; // outside NSW and Queensland there is nothing else to use
    lot.setbacksKey = null; // the setback stage recomputes
    syncCustomToCommercial(p);
  });
  syncCurrency(store.project);
  return store.project.site?.lot?.customRules || null;
}
