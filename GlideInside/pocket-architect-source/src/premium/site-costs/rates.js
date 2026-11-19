// Default rates for the indicative site cost estimate, and the builder's own overrides.
// Every rate has a default for regional NSW and for regional QLD, a source note and a date. The builder edits the "likely" figure in the
// Site costs panel; the low and high figures follow from the spread factors (lowF, highF) set here. Reset puts every default back.
// Wording: indicative only. Not a quote. No dashes in text. Dates DD/MM/YYYY. Pure, Node compatible (storage is optional and guarded).

export const RATES_DATE = '18/11/2026';
const SRC_EARTH = 'Glide Inside planning default: typical regional NSW and QLD earthmoving rates for residential lots, small plant, GST excluded. Not a published schedule. Replace with your own rates.';
const SRC_RETAIN = 'Glide Inside planning default: block or sleeper retaining wall per square metre of wall face, to about 1.0 m high, supply and install. Taller walls need engineering. Replace with your own rates.';
const SRC_DRIVE = 'Glide Inside planning default: 100 mm reinforced concrete driveway on prepared base, and a council kerb crossover. The council sets the crossover standard and any fee. Replace with your own rates.';
const SRC_SERVICES = 'Glide Inside planning default: trench, pipe or cable and one connection to the main in the street. The utility sets its own connection charges. Replace with your own rates.';
const SRC_SURCHARGE = 'Glide Inside planning default: an allowance on site works for steep ground or restricted access. Replace with your own percentages.';

/** kind: aud (dollars per unit), pct (percent of the site works subtotal), factor (a multiplier). lowF and highF set the low and high figure from the likely one. */
export const RATE_DEFS = [
  { id: 'site_prep', group: 'Earthworks', label: 'Site preparation (strip topsoil, trim pad)', unit: 'm2 of pad', kind: 'aud', nsw: 14, qld: 15, lowF: 0.8, highF: 1.35, source: SRC_EARTH },
  { id: 'cut_excavate', group: 'Earthworks', label: 'Excavate cut', unit: 'm3', kind: 'aud', nsw: 28, qld: 30, lowF: 0.8, highF: 1.4, source: SRC_EARTH },
  { id: 'fill_place', group: 'Earthworks', label: 'Place and compact fill', unit: 'm3', kind: 'aud', nsw: 32, qld: 34, lowF: 0.8, highF: 1.4, source: SRC_EARTH },
  { id: 'export_spoil', group: 'Earthworks', label: 'Cart spoil off site (including tip fee)', unit: 'm3', kind: 'aud', nsw: 46, qld: 48, lowF: 0.75, highF: 1.5, source: SRC_EARTH },
  { id: 'import_fill', group: 'Earthworks', label: 'Import fill (supplied and delivered)', unit: 'm3', kind: 'aud', nsw: 58, qld: 60, lowF: 0.75, highF: 1.5, source: SRC_EARTH },
  { id: 'bulking', group: 'Earthworks', label: 'Spoil bulking factor', unit: 'x', kind: 'factor', nsw: 1.25, qld: 1.25, lowF: 1, highF: 1, source: 'Glide Inside planning default: excavated spoil occupies about 25 percent more volume when carted.' },
  { id: 'flat_allowance', group: 'Earthworks', label: 'Earthworks allowance (no ground levels loaded)', unit: 'm2 of pad', kind: 'aud', nsw: 28, qld: 30, lowF: 0.6, highF: 2, source: 'Glide Inside planning default: used only when the lot has no ground levels, so cut and fill cannot be read.' },
  { id: 'rock_extra', group: 'Earthworks', label: 'Rock excavation, extra over soil', unit: 'm3 of rock', kind: 'aud', nsw: 150, qld: 165, lowF: 0.6, highF: 2.2, source: 'Glide Inside planning default: extra over normal excavation where rock is found. Only counted when the rock option is on. A geotechnical report decides.' },
  { id: 'retain_face', group: 'Retaining', label: 'Retaining wall (to 1.0 m)', unit: 'm2 of face', kind: 'aud', nsw: 380, qld: 400, lowF: 0.8, highF: 1.4, source: SRC_RETAIN },
  { id: 'retain_tall_factor', group: 'Retaining', label: 'Taller wall factor (over 1.0 m, engineered)', unit: 'x', kind: 'factor', nsw: 1.4, qld: 1.4, lowF: 0.9, highF: 1.3, source: SRC_RETAIN },
  { id: 'drive_slab', group: 'Driveway', label: 'Driveway, reinforced concrete', unit: 'm2', kind: 'aud', nsw: 115, qld: 120, lowF: 0.8, highF: 1.35, source: SRC_DRIVE },
  { id: 'crossover', group: 'Driveway', label: 'Kerb crossover', unit: 'm2', kind: 'aud', nsw: 230, qld: 240, lowF: 0.8, highF: 1.5, source: SRC_DRIVE },
  { id: 'water_run', group: 'Services', label: 'Water service, per metre', unit: 'm', kind: 'aud', nsw: 75, qld: 80, lowF: 0.8, highF: 1.4, source: SRC_SERVICES },
  { id: 'water_conn', group: 'Services', label: 'Water connection to the main', unit: 'each', kind: 'aud', nsw: 1600, qld: 1750, lowF: 0.8, highF: 1.6, source: SRC_SERVICES },
  { id: 'sewer_run', group: 'Services', label: 'Sewer line, per metre', unit: 'm', kind: 'aud', nsw: 130, qld: 140, lowF: 0.8, highF: 1.5, source: SRC_SERVICES },
  { id: 'sewer_conn', group: 'Services', label: 'Sewer connection to the main', unit: 'each', kind: 'aud', nsw: 2200, qld: 2400, lowF: 0.8, highF: 1.7, source: SRC_SERVICES },
  { id: 'storm_run', group: 'Services', label: 'Stormwater line to the street, per metre', unit: 'm', kind: 'aud', nsw: 85, qld: 90, lowF: 0.8, highF: 1.4, source: SRC_SERVICES },
  { id: 'storm_conn', group: 'Services', label: 'Stormwater connection to kerb or pit', unit: 'each', kind: 'aud', nsw: 900, qld: 950, lowF: 0.8, highF: 1.5, source: SRC_SERVICES },
  { id: 'power_run', group: 'Services', label: 'Underground power, per metre', unit: 'm', kind: 'aud', nsw: 70, qld: 75, lowF: 0.8, highF: 1.5, source: SRC_SERVICES },
  { id: 'power_conn', group: 'Services', label: 'Power connection', unit: 'each', kind: 'aud', nsw: 1500, qld: 1600, lowF: 0.8, highF: 1.8, source: SRC_SERVICES },
  { id: 'comms_run', group: 'Services', label: 'Telecommunications conduit, per metre', unit: 'm', kind: 'aud', nsw: 25, qld: 27, lowF: 0.8, highF: 1.5, source: SRC_SERVICES },
  { id: 'comms_conn', group: 'Services', label: 'Telecommunications connection', unit: 'each', kind: 'aud', nsw: 600, qld: 650, lowF: 0.8, highF: 1.6, source: SRC_SERVICES },
  { id: 'onsite_wastewater', group: 'Services', label: 'On site wastewater system (rural lots, no sewer)', unit: 'each', kind: 'aud', nsw: 18000, qld: 19000, lowF: 0.8, highF: 1.6, source: 'Glide Inside planning default: replaces the sewer connection on a rural lot. The council approval and a site assessment decide the system.' },
  { id: 'slope_moderate', group: 'Surcharges', label: 'Slope surcharge, moderate (3 to 8 percent)', unit: '% of works', kind: 'pct', nsw: 4, qld: 4, lowF: 0.5, highF: 1.5, source: SRC_SURCHARGE },
  { id: 'slope_steep', group: 'Surcharges', label: 'Slope surcharge, steep (8 to 15 percent)', unit: '% of works', kind: 'pct', nsw: 9, qld: 9, lowF: 0.5, highF: 1.5, source: SRC_SURCHARGE },
  { id: 'slope_very_steep', group: 'Surcharges', label: 'Slope surcharge, very steep (over 15 percent)', unit: '% of works', kind: 'pct', nsw: 16, qld: 16, lowF: 0.5, highF: 1.5, source: SRC_SURCHARGE },
  { id: 'access_restricted', group: 'Surcharges', label: 'Access surcharge, restricted (narrow frontage or long drive)', unit: '% of works', kind: 'pct', nsw: 3, qld: 3, lowF: 0.5, highF: 1.5, source: SRC_SURCHARGE },
  { id: 'access_difficult', group: 'Surcharges', label: 'Access surcharge, difficult (battle axe or very long drive)', unit: '% of works', kind: 'pct', nsw: 8, qld: 8, lowF: 0.5, highF: 1.5, source: SRC_SURCHARGE },
  { id: 'contingency', group: 'Contingency', label: 'Contingency', unit: '% of works', kind: 'pct', nsw: 10, qld: 10, lowF: 0.5, highF: 1.5, source: 'Glide Inside planning default: an allowance for items not yet known. Replace with your own percentage.' },
];

export const RATE_BY_ID = Object.fromEntries(RATE_DEFS.map((d) => [d.id, d]));
export const REGIONS = { nsw: 'Regional NSW', qld: 'Regional QLD' };

/** Slope (percent) and access thresholds for the surcharge bands. */
export const SLOPE_BANDS = [{ id: null, upToPct: 3, label: 'Gentle, under 3 percent' }, { id: 'slope_moderate', upToPct: 8, label: 'Moderate, 3 to 8 percent' }, { id: 'slope_steep', upToPct: 15, label: 'Steep, 8 to 15 percent' }, { id: 'slope_very_steep', upToPct: Infinity, label: 'Very steep, over 15 percent' }];
export const ACCESS_BANDS = [{ id: null, label: 'Standard access' }, { id: 'access_restricted', label: 'Restricted access' }, { id: 'access_difficult', label: 'Difficult access' }];
export const CONTINGENCY_ID = 'contingency';

export const defaultSettings = () => ({ region: 'auto', rates: {}, rock: { enabled: false, fractionOfCut: 0.3 } });

const KEY = 'ps.siteCosts.v1';
const store = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

/** The builder's saved settings (this browser), merged over the defaults. Never throws. */
export function loadSettings() {
  const out = defaultSettings();
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return out;
    const s = JSON.parse(raw);
    if (['auto', 'nsw', 'qld'].includes(s?.region)) out.region = s.region;
    if (s?.rates && typeof s.rates === 'object') {
      for (const [id, v] of Object.entries(s.rates)) {
        if (!RATE_BY_ID[id] || !v || typeof v !== 'object') continue;
        for (const r of ['nsw', 'qld']) if (Number.isFinite(v[r]) && v[r] >= 0) (out.rates[id] ||= {})[r] = v[r];
      }
    }
    if (s?.rock) out.rock = { enabled: s.rock.enabled === true, fractionOfCut: Number.isFinite(s.rock.fractionOfCut) ? Math.min(1, Math.max(0, s.rock.fractionOfCut)) : 0.3 };
  } catch { /* storage blocked or damaged: defaults */ }
  return out;
}

export function saveSettings(settings) {
  try { store()?.setItem(KEY, JSON.stringify(settings)); return true; } catch { return false; }
}

/** Reset: every rate, the region and the rock option back to the defaults. */
export function resetSettings() {
  try { store()?.removeItem(KEY); } catch { /* nothing to clear */ }
  return defaultSettings();
}

export const regionOf = (lot, settings) => (settings?.region === 'nsw' || settings?.region === 'qld' ? settings.region : String(lot?.state || '').toUpperCase() === 'QLD' ? 'qld' : 'nsw');

/** The rate in force for a region: the builder's override when set, else the default. */
export function rateOf(settings, id, region) {
  const def = RATE_BY_ID[id];
  const o = settings?.rates?.[id]?.[region];
  return Number.isFinite(o) ? o : def[region];
}

export const isCustomised = (settings, id, region) => Number.isFinite(settings?.rates?.[id]?.[region]) && settings.rates[id][region] !== RATE_BY_ID[id][region];
export const anyCustomised = (settings) => RATE_DEFS.some((d) => ['nsw', 'qld'].some((r) => isCustomised(settings, d.id, r)));

// Where rates come from, in order (19/11/2026): this design's own rates (project.siteCosts, saved with the design), else the builder's default
// (the portal, server table site_cost_defaults, handed over as window.__ps.siteCostDefaults.get()), else this browser's saved rates, else the defaults.

/** over laid on base: a region, the rate overrides per id and region, and the rock option. Neither argument is changed. */
export function mergeSettings(base, over) {
  const out = { region: base?.region || 'auto', rates: {}, rock: { ...(base?.rock || { enabled: false, fractionOfCut: 0.3 }) } };
  for (const [id, v] of Object.entries(base?.rates || {})) out.rates[id] = { ...v };
  if (!over || typeof over !== 'object') return out;
  if (['auto', 'nsw', 'qld'].includes(over.region)) out.region = over.region;
  for (const [id, v] of Object.entries(over.rates || {})) {
    if (!RATE_BY_ID[id] || !v || typeof v !== 'object') continue;
    for (const r of ['nsw', 'qld']) if (Number.isFinite(v[r]) && v[r] >= 0) (out.rates[id] ||= {})[r] = v[r];
  }
  if (over.rock && typeof over.rock === 'object') out.rock = { enabled: over.rock.enabled === true, fractionOfCut: Number.isFinite(over.rock.fractionOfCut) ? Math.min(1, Math.max(0, over.rock.fractionOfCut)) : out.rock.fractionOfCut };
  return out;
}

/** What differs between settings and base (the part worth saving with a design), or null when nothing does. */
export function diffSettings(base, settings) {
  const out = {};
  if (settings.region !== (base?.region || 'auto')) out.region = settings.region;
  const rates = {};
  for (const [id, v] of Object.entries(settings.rates || {})) for (const r of ['nsw', 'qld']) if (Number.isFinite(v?.[r]) && v[r] !== (Number.isFinite(base?.rates?.[id]?.[r]) ? base.rates[id][r] : RATE_BY_ID[id]?.[r])) (rates[id] ||= {})[r] = v[r];
  if (Object.keys(rates).length) out.rates = rates;
  const b = base?.rock || { enabled: false, fractionOfCut: 0.3 };
  if (settings.rock && (settings.rock.enabled !== b.enabled || settings.rock.fractionOfCut !== b.fractionOfCut)) out.rock = { ...settings.rock };
  return Object.keys(out).length ? out : null;
}

export const builderDefaults = () => { try { return globalThis.__ps?.siteCostDefaults?.get?.() || null; } catch { return null; } };
/** The base a design's own rates sit on: the builder's default when there is one, else this browser's saved rates. */
export const baseSettings = () => { const b = builderDefaults(); return b ? mergeSettings(defaultSettings(), b) : loadSettings(); };
/** The rates in force for a design. */
export const effectiveSettings = (project) => mergeSettings(baseSettings(), project?.siteCosts || null);
/** 'design' | 'builder' | 'browser' | 'default': where the rates in force mostly come from, for the panel. */
export const settingsSource = (project) => (project?.siteCosts ? 'design' : builderDefaults() ? 'builder' : anyCustomised(loadSettings()) ? 'browser' : 'default');
