// Indicative yield and value for a commercial layout. Pure functions, no DOM. Data: market-portal.json (real portal evidence, the
// primary source, 13/11/2026) and market.json (researched ranges for NSW and Queensland areas, mostly ESTIMATE, 15/11/2026; used for yields,
// land, build costs, the regional cost factor, council charges and as the fallback where the portal evidence is missing or weak).
// All figures are AUD ex GST. Indicative only, not a valuation.

import { activeSymbol, syncCurrency } from '../site/custom-rules.js';
import market from './data/market.json' with { type: 'json' };
import portal from './data/market-portal.json' with { type: 'json' };
import { layoutUnits, mezzanineOf } from './layout.js';
import { lotAreaM2 } from './stats.js';
import { parkingLayout, doorStrips } from './parking.js';
import { siteAccess } from './access.js';
import { rowPoint } from './layout.js';
import { bayOffsetMm } from './schema.js';
import * as G from '../model/geometry.js';
import { buildingsOf } from './catalogue/buildings.js';
import { buildingParking } from './catalogue/bays.js';
import { buildingCost, wallCost } from './catalogue/rates.js';
import { chargeRule, computeCharges, statusLabel } from './charges.js';
import { constructionSpec, rowsWallBasis, constructionLine } from './catalogue/construction.js';
import { hardstandList } from './catalogue/pavements/hardstand.js';

export const DATA_DATE = '13/11/2026'; // the portal evidence
export const MARKET_DATE = market.generated; // the researched ranges, yields, cost factors and charges
export const MIN_N = 4; // portal medians from fewer listings than this are weak evidence and are not used
export const SMALL_UNIT_M2 = 400; // the ranges target 100 to 400 m2 strata units
export const CAVEAT = 'Estimates only, not a valuation. Enter your own values in any field. Defaults come from portal listings and published reports; check with a registered valuer and quantity surveyor before relying on them.';
export const GST_NOTE = 'All figures are ex GST.';
export const RENT_NOTE = 'Gross rent less outgoings gives net rent, which is capitalised at the net yield. The net yield is an investor yield set from published industrial yield evidence, not from asking prices. Small strata units usually sell to owner occupiers at prices above the value their rent implies, so compare the sell result with the hold result. Mezzanine floor area is valued at a fraction of the ground floor rate. Agent and selling costs, stamp duty, finance and holding costs are not included. Council charges are an allowance you can edit.';
export const SOURCES_TEXT = `Sale and rent rates: commercialrealestate.com.au Factory, Warehouse and Industrial listings and sold statistics, read ${DATA_DATE}, and NSW and Queensland listing research read ${MARKET_DATE}. Yields: Herron Todd White and Opteon industrial reports, as at ${MARKET_DATE}. Land values, build costs, regional cost factors and council charges: published ranges and council resolutions, mostly analyst estimates, as at ${MARKET_DATE}.`;

/**
 * The areas: key (the portal key), label, state, the market.json name and the council names (upper case, as the cadastre gives them) that map to it.
 * `towns` are suburb or town names looked for in the lot's suburb, locality or the end of its address when the council did not match.
 * `refine` (a Brisbane City lot) tries the named areas' towns first. Queensland councils are matched by the name the Queensland cadastre gives
 * (shire_name or the LGA layer, for example "Townsville City", "Cairns Regional").
 */
export const AREAS = Object.freeze([
  { key: 'tamworth', label: 'Tamworth', state: 'NSW', m: 'Tamworth', lga: ['TAMWORTH REGIONAL', 'TAMWORTH'], towns: ['TAMWORTH', 'WESTDALE', 'CALALA', 'OXLEY VALE', 'KOOTINGAL', 'HILLVUE'] },
  { key: 'gunnedah', label: 'Gunnedah', state: 'NSW', m: 'Gunnedah', lga: ['GUNNEDAH'], towns: ['GUNNEDAH'] },
  { key: 'narrabri', label: 'Narrabri', state: 'NSW', m: 'Narrabri', lga: ['NARRABRI'], towns: ['NARRABRI'] },
  { key: 'moree', label: 'Moree', state: 'NSW', m: 'Moree', lga: ['MOREE PLAINS', 'MOREE'], towns: ['MOREE'] },
  { key: 'armidale', label: 'Armidale', state: 'NSW', m: 'Armidale', lga: ['ARMIDALE REGIONAL', 'ARMIDALE'], towns: ['ARMIDALE'] },
  { key: 'glen-innes', label: 'Glen Innes', state: 'NSW', m: 'Glen Innes', lga: ['GLEN INNES SEVERN', 'GLEN INNES'], towns: ['GLEN INNES'] },
  { key: 'inverell', label: 'Inverell', state: 'NSW', m: 'Inverell', lga: ['INVERELL'], towns: ['INVERELL'] },
  { key: 'dubbo', label: 'Dubbo', state: 'NSW', m: 'Dubbo', lga: ['DUBBO REGIONAL', 'DUBBO'], towns: ['DUBBO'] },
  { key: 'orange', label: 'Orange', state: 'NSW', m: 'Orange', lga: ['ORANGE'], towns: ['ORANGE'] },
  { key: 'bathurst', label: 'Bathurst', state: 'NSW', m: 'Bathurst', lga: ['BATHURST REGIONAL', 'BATHURST'], towns: ['BATHURST'] },
  { key: 'mudgee', label: 'Mudgee', state: 'NSW', m: 'Mudgee', lga: ['MID WESTERN REGIONAL', 'MID-WESTERN REGIONAL', 'MID WESTERN'], towns: ['MUDGEE'] },
  { key: 'wagga-wagga', label: 'Wagga Wagga', state: 'NSW', m: 'Wagga Wagga', lga: ['WAGGA WAGGA'], towns: ['WAGGA WAGGA'] },
  { key: 'albury', label: 'Albury', state: 'NSW', m: 'Albury', lga: ['ALBURY'], towns: ['ALBURY'] },
  { key: 'kempsey', label: 'Kempsey', state: 'NSW', m: 'Kempsey', lga: ['KEMPSEY'], towns: ['KEMPSEY'] },
  { key: 'port-macquarie', label: 'Port Macquarie', state: 'NSW', m: 'Port Macquarie', lga: ['PORT MACQUARIE HASTINGS', 'PORT MACQUARIE-HASTINGS', 'PORT MACQUARIE'], towns: ['PORT MACQUARIE'] },
  { key: 'coffs-harbour', label: 'Coffs Harbour', state: 'NSW', m: 'Coffs Harbour', lga: ['COFFS HARBOUR'], towns: ['COFFS HARBOUR'] },
  { key: 'grafton', label: 'Grafton (Clarence Valley)', state: 'NSW', m: 'Grafton (Clarence Valley)', lga: ['CLARENCE VALLEY'], towns: ['GRAFTON'] },
  { key: 'lismore', label: 'Lismore', state: 'NSW', m: 'Lismore', lga: ['LISMORE'], towns: ['LISMORE'] },
  { key: 'ballina', label: 'Ballina', state: 'NSW', m: 'Ballina', lga: ['BALLINA'], towns: ['BALLINA'] },
  { key: 'muswellbrook', label: 'Muswellbrook', state: 'NSW', m: 'Muswellbrook', lga: ['MUSWELLBROOK'], towns: ['MUSWELLBROOK'] },
  { key: 'singleton', label: 'Singleton', state: 'NSW', m: 'Singleton', lga: ['SINGLETON'], towns: ['SINGLETON'] },
  { key: 'cessnock', label: 'Cessnock', state: 'NSW', m: 'Cessnock', lga: ['CESSNOCK'], towns: ['CESSNOCK'] },
  { key: 'maitland', label: 'Maitland', state: 'NSW', m: 'Maitland', lga: ['MAITLAND'], towns: ['MAITLAND'] },
  { key: 'lake-macquarie', label: 'Lake Macquarie', state: 'NSW', m: 'Lake Macquarie', lga: ['LAKE MACQUARIE'], towns: ['LAKE MACQUARIE'] },
  { key: 'newcastle', label: 'Newcastle', state: 'NSW', m: 'Newcastle', lga: ['NEWCASTLE', 'CITY OF NEWCASTLE'], near: ['PORT STEPHENS'], towns: ['NEWCASTLE'] },
  { key: 'wollongong', label: 'Wollongong', state: 'NSW', m: 'Wollongong', lga: ['WOLLONGONG', 'SHELLHARBOUR'], towns: ['WOLLONGONG', 'UNANDERRA', 'KEMBLA GRANGE', 'PORT KEMBLA', 'WARRAWONG', 'CORRIMAL', 'FAIRY MEADOW', 'DAPTO', 'ALBION PARK RAIL', 'ALBION PARK', 'SHELLHARBOUR'] },
  { key: 'central-coast', label: 'Central Coast (Gosford/Wyong)', state: 'NSW', m: 'Central Coast (Gosford/Wyong)', lga: ['CENTRAL COAST'], towns: ['GOSFORD', 'WYONG', 'SOMERSBY', 'WARNERVALE', 'TUGGERAH', 'ERINA', 'NORTH GOSFORD', 'WEST GOSFORD', 'NIAGARA PARK', 'TOUKLEY'] },
  { key: 'nowra', label: 'Nowra (Shoalhaven)', state: 'NSW', m: 'Nowra (Shoalhaven)', lga: ['SHOALHAVEN'], towns: ['NOWRA', 'SOUTH NOWRA', 'BOMADERRY', 'ULLADULLA'] },
  { key: 'goulburn', label: 'Goulburn', state: 'NSW', m: 'Goulburn', lga: ['GOULBURN MULWAREE', 'GOULBURN'], towns: ['GOULBURN'] },
  { key: 'queanbeyan', label: 'Queanbeyan', state: 'NSW', m: 'Queanbeyan', lga: ['QUEANBEYAN PALERANG', 'QUEANBEYAN PALERANG REGIONAL', 'QUEANBEYAN'], towns: ['QUEANBEYAN', 'QUEANBEYAN EAST', 'QUEANBEYAN WEST'] },
  { key: 'tweed-heads', label: 'Tweed Heads', state: 'NSW', m: 'Tweed Heads', lga: ['TWEED'], towns: ['TWEED HEADS', 'TWEED HEADS SOUTH', 'TWEED HEADS WEST', 'CHINDERAH', 'BANORA POINT', 'MURWILLUMBAH', 'SOUTH MURWILLUMBAH', 'KINGSCLIFF'] },
  { key: 'griffith', label: 'Griffith', state: 'NSW', m: 'Griffith', lga: ['GRIFFITH'], towns: ['GRIFFITH'] },
  { key: 'parkes', label: 'Parkes', state: 'NSW', m: 'Parkes', lga: ['PARKES'], towns: ['PARKES'] },
  { key: 'broken-hill', label: 'Broken Hill', state: 'NSW', m: 'Broken Hill', lga: ['BROKEN HILL'], towns: ['BROKEN HILL'] },
  { key: 'western-sydney', label: 'Western Sydney fringe (Penrith/Campbelltown)', state: 'NSW', m: 'Western Sydney fringe (Penrith/Campbelltown)', lga: ['PENRITH', 'CAMPBELLTOWN', 'CAMDEN'], near: ['LIVERPOOL', 'BLACKTOWN', 'FAIRFIELD', 'WOLLONDILLY', 'HAWKESBURY'], towns: ['PENRITH', 'CAMPBELLTOWN', 'MINTO', 'INGLEBURN', 'SMEATON GRANGE', 'KEMPS CREEK'] },
  { key: 'default', label: 'Regional NSW default', state: 'NSW', m: 'Regional NSW default', lga: [], towns: [] },
  // Queensland
  { key: 'townsville', label: 'Townsville', state: 'QLD', m: 'Townsville', lga: ['TOWNSVILLE'], near: ['BURDEKIN'], towns: ['TOWNSVILLE', 'GARBUTT', 'MOUNT LOUISA', 'MUNDINGBURRA', 'THURINGOWA CENTRAL', 'KIRWAN', 'BOHLE', 'BOHLE PLAINS', 'CURRAJONG', 'AITKENVALE', 'STUART', 'OONOONBA', 'CLUDEN'] },
  { key: 'cairns', label: 'Cairns', state: 'QLD', m: 'Cairns', lga: ['CAIRNS REGIONAL', 'CAIRNS'], near: ['CASSOWARY COAST', 'TABLELANDS'], towns: ['CAIRNS', 'WESTCOURT', 'PORTSMITH', 'BUNGALOW', 'MANOORA', 'EDMONTON', 'WOREE', 'SMITHFIELD', 'BENTLEY PARK', 'MANUNDA'] },
  { key: 'mackay', label: 'Mackay', state: 'QLD', m: 'Mackay', lga: ['MACKAY REGIONAL', 'MACKAY'], near: ['WHITSUNDAY', 'ISAAC'], towns: ['MACKAY', 'PAGET', 'NORTH MACKAY', 'ANDERGROVE', 'MOUNT PLEASANT', 'WALKERSTON', 'SARINA'] },
  { key: 'rockhampton', label: 'Rockhampton', state: 'QLD', m: 'Rockhampton', lga: ['ROCKHAMPTON REGIONAL', 'ROCKHAMPTON'], near: ['LIVINGSTONE'], towns: ['ROCKHAMPTON', 'GRACEMERE', 'PARK AVENUE', 'NORTH ROCKHAMPTON'] },
  { key: 'gladstone', label: 'Gladstone', state: 'QLD', m: 'Gladstone', lga: ['GLADSTONE REGIONAL', 'GLADSTONE'], towns: ['GLADSTONE', 'CALLIOPE', 'KIN KORA', 'TANNUM SANDS', 'BOYNE ISLAND'] },
  { key: 'bundaberg', label: 'Bundaberg', state: 'QLD', m: 'Bundaberg', lga: ['BUNDABERG REGIONAL', 'BUNDABERG'], towns: ['BUNDABERG', 'BUNDABERG EAST', 'BUNDABERG WEST', 'AVOCA', 'KALKIE', 'BARGARA', 'SVENSSON HEIGHTS', 'KEPNOCK', 'WALKERVALE'] },
  { key: 'toowoomba', label: 'Toowoomba', state: 'QLD', m: 'Toowoomba', lga: ['TOOWOOMBA REGIONAL', 'TOOWOOMBA'], towns: ['TOOWOOMBA', 'HARRISTOWN', 'TORRINGTON', 'GLENVALE', 'WELLCAMP', 'CHARLTON', 'DRAYTON', 'KEARNEYS SPRING', 'WILSONTON'] },
  { key: 'sunshine-coast', label: 'Sunshine Coast', state: 'QLD', m: 'Sunshine Coast', lga: ['SUNSHINE COAST REGIONAL', 'SUNSHINE COAST', 'NOOSA'], near: ['GYMPIE'], towns: ['MAROOCHYDORE', 'KUNDA PARK', 'CALOUNDRA', 'BIRTINYA', 'NAMBOUR', 'COOLUM BEACH', 'MOOLOOLABA', 'WARANA', 'PACIFIC PARADISE', 'YANDINA'] },
  { key: 'gold-coast', label: 'Gold Coast', state: 'QLD', m: 'Gold Coast', lga: ['GOLD COAST'], towns: ['SOUTHPORT', 'BURLEIGH HEADS', 'MOLENDINAR', 'ARUNDEL', 'CARRARA', 'NERANG', 'MERMAID WATERS', 'VARSITY LAKES', 'TUGUN', 'CURRUMBIN', 'COOMERA', 'GOLD COAST'] },
  { key: 'ipswich', label: 'Ipswich', state: 'QLD', m: 'Ipswich', lga: ['IPSWICH'], near: ['SCENIC RIM', 'LOCKYER VALLEY', 'LOCKYER', 'SOMERSET'], towns: ['IPSWICH', 'RIPLEY', 'YAMANTO', 'AUGUSTINE HEIGHTS', 'WULKURAKA'] },
  { key: 'logan', label: 'Logan', state: 'QLD', m: 'Logan', lga: ['LOGAN'], towns: ['LOGAN', 'SLACKS CREEK', 'BETHANIA', 'LOGANHOLME', 'BROWNS PLAINS', 'MEADOWBROOK'] },
  { key: 'brisbane-north', label: 'Brisbane North industrial fringe', state: 'QLD', m: 'Brisbane North industrial fringe', lga: ['MORETON BAY REGIONAL', 'MORETON BAY'], towns: ['GEEBUNG', 'VIRGINIA', 'BANYO', 'NUDGEE', 'ZILLMERE', 'BRIDGEMAN DOWNS', 'BOONDALL', 'NORTHGATE', 'EAGLE FARM', 'PINKENBA', 'NARANGBA', 'BRENDALE', 'CABOOLTURE', 'REDCLIFFE', 'STRATHPINE', 'KEDRON', 'STAFFORD'] },
  { key: 'brisbane-south', label: 'Brisbane South industrial fringe', state: 'QLD', m: 'Brisbane South industrial fringe', lga: ['BRISBANE'], near: ['REDLAND'], refine: ['brisbane-north'], towns: ['ACACIA RIDGE', 'ARCHERFIELD', 'ROCKLEA', 'COOPERS PLAINS', 'SALISBURY', 'YEERONGPILLY', 'DARRA', 'RICHLANDS', 'SUNNYBANK', 'MACGREGOR', 'EIGHT MILE PLAINS', 'TINGALPA', 'MURARRIE', 'HEMMANT', 'LYTTON', 'MOOROOKA'] },
  { key: 'hervey-bay', label: 'Hervey Bay', state: 'QLD', m: 'Hervey Bay', lga: ['FRASER COAST REGIONAL', 'FRASER COAST'], towns: ['HERVEY BAY', 'PIALBA', 'URRAWEEN', 'TORQUAY', 'POINT VERNON', 'MARYBOROUGH'] },
  { key: 'mount-isa', label: 'Mount Isa', state: 'QLD', m: 'Mount Isa', lga: ['MOUNT ISA'], towns: ['MOUNT ISA'] },
  { key: 'default-qld', label: 'Regional QLD default', state: 'QLD', m: 'Regional QLD default', lga: [], towns: [] },
]);
const AREA_BY_KEY = new Map(AREAS.map((a) => [a.key, a]));
const AREA_BY_M = new Map(AREAS.map((a) => [a.m, a]));
export const DEFAULT_AREA = 'default';
export const DEFAULT_AREA_BY_STATE = Object.freeze({ NSW: 'default', QLD: 'default-qld' });
export const OUTGOINGS_PCT = Object.freeze({ low: 5, high: 15, value: 10 }); // assumption, % of gross rent
export const MEZZ_FACTOR = Object.freeze({ low: 0.4, high: 0.7, value: 0.5 }); // assumption, fraction of the ground floor rate
export const LANDSCAPE_RATE = Object.freeze({ low: 10, high: 25, value: 15 }); // owner allowance 13/11/2026, $/m2 of the lot outside the developed area

/**
 * The developed area in m2: building footprint plus hardstand (the truck apron, car aisles, bays and accessible zones as one paved block
 * per parking row, and the waste pad). Overlaps count once (grid sample at 250 mm), never more than the lot. Driveways are not modelled.
 */
export function developedAreaM2(commercial, lot) {
  const units = layoutUnits(commercial);
  const polys = units.map((u) => u.poly);
  const park = parkingLayout(commercial);
  const off = bayOffsetMm(commercial.parking);
  for (const pr of park.rows) {
    if (!pr.slots.length) continue;
    const fr = pr.frame;
    const far = pr.depth + (pr.off ?? off) + commercial.parking.bayL;
    polys.push([rowPoint(fr, 0, pr.depth), rowPoint(fr, pr.length, pr.depth), rowPoint(fr, pr.length, far), rowPoint(fr, 0, far)]);
  }
  for (const s of doorStrips(commercial, park)) polys.push(s.poly);
  const access = siteAccess(commercial, lot);
  if (access?.driveway) polys.push(access.driveway);
  // Catalogue buildings: footprint, paved extras (truck apron, yard) and the bay rows.
  const bsAll = buildingsOf(commercial);
  for (const b of bsAll) {
    polys.push(b.outline);
    for (const e of b.extras) if (['apron', 'yard', 'dock-recess', 'fuel-canopy', 'canopy'].includes(e.kind)) polys.push(e.polygon);
  }
  for (const r of buildingParking(commercial).rows) for (const sl of r.slots) polys.push(sl.poly);
  for (const a of hardstandList(commercial)) polys.push(a.polygon); // areas drawn with the Hardstand tool count as developed ground
  const w = commercial.waste;
  if (w) {
    const a = ((w.rotationDeg || 0) * Math.PI) / 180;
    const ax = { x: Math.cos(a), y: Math.sin(a) };
    const ay = { x: -Math.sin(a), y: Math.cos(a) };
    const c = (sx, sy) => ({ x: w.x + ax.x * sx * w.widthMm / 2 + ay.x * sy * w.depthMm / 2, y: w.y + ax.y * sx * w.widthMm / 2 + ay.y * sy * w.depthMm / 2 });
    polys.push([c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)]);
  }
  if (!polys.length) return 0;
  const bbs = polys.map((q) => G.bbox(q));
  const x0 = Math.min(...bbs.map((b) => b.minX)); const x1 = Math.max(...bbs.map((b) => b.maxX));
  const y0 = Math.min(...bbs.map((b) => b.minY)); const y1 = Math.max(...bbs.map((b) => b.maxY));
  const step = 250;
  let n = 0;
  for (let y = y0 + step / 2; y < y1; y += step) {
    for (let x = x0 + step / 2; x < x1; x += step) {
      const pt = { x, y };
      for (let i = 0; i < polys.length; i++) {
        const b = bbs[i];
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        if (G.pointInPolygon(pt, polys[i])) { n++; break; }
      }
    }
  }
  const m2 = (n * step * step) / 1e6;
  const lotM2 = lotAreaM2(lot);
  return lotM2 ? Math.min(m2, lotM2) : m2;
}

const norm = (s) => String(s || '').toUpperCase().replace(/\b(CITY|SHIRE|COUNCIL|MUNICIPAL|OF|THE)\b/g, ' ').replace(/-/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const STREET_TYPES = new Set(['ROAD', 'RD', 'STREET', 'ST', 'AVENUE', 'AVE', 'DRIVE', 'DR', 'LANE', 'HIGHWAY', 'HWY', 'CLOSE', 'PLACE', 'PL', 'CRESCENT', 'CRES', 'COURT', 'CT', 'BOULEVARD', 'BLVD', 'PARADE', 'WAY', 'TERRACE', 'CIRCUIT', 'CCT', 'ESPLANADE', 'TRACK', 'CL', 'PDE', 'TCE', 'GR', 'GROVE', 'CRT', 'LOOP', 'RISE', 'ROW', 'LINK', 'CIRCLE', 'PROMENADE', 'PKWY', 'PARKWAY']);

/** The text after the last street type word of an address ("12 Parkes Street Tamworth NSW" gives "TAMWORTH NSW"), so a town is not matched in a street name. */
const afterStreet = (address) => {
  const t = norm(address).split(' ').filter(Boolean);
  let at = -1;
  t.forEach((w, i) => { if (STREET_TYPES.has(w)) at = i; });
  return t.slice(at + 1).join(' ');
};

/** 'NSW' or 'QLD' for a lot: the lot's own state, else the state named in its address, else null. */
export function stateOf(lot) {
  const raw = String(lot?.state || '').toUpperCase().replace(/[^A-Z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (raw === 'NSW' || raw === 'NEW SOUTH WALES') return 'NSW';
  if (raw === 'QLD' || raw === 'QUEENSLAND') return 'QLD';
  const a = ` ${norm([lot?.address, lot?.suburb, lot?.locality].filter(Boolean).join(' '))} `;
  if (/ (QLD|QUEENSLAND) /.test(a)) return 'QLD';
  if (/ (NSW|NEW SOUTH WALES) /.test(a)) return 'NSW';
  // A postcode: 4000 to 4999 is Queensland, 2000 to 2599 and 2619 to 2899 and 2921 to 2999 is New South Wales (the ACT is left out).
  const pc = Number(String(lot?.postcode || lot?.postCode || '').trim() || (String(lot?.address || '').match(/\b([24]\d{3})\s*$/) || [])[1]);
  if (pc >= 4000 && pc <= 4999) return 'QLD';
  if ((pc >= 2000 && pc <= 2599) || (pc >= 2619 && pc <= 2899) || (pc >= 2921 && pc <= 2999)) return 'NSW';
  return null;
}

/**
 * Which area a lot belongs to and how it was found: { key, via, state }. The council (LGA) first, then the suburb or town (suburb, locality or
 * the end of the address), then the default of the lot's state (Regional QLD default for Queensland, Regional NSW default otherwise).
 * via is 'lga', 'town', 'near' (a council with no area of its own, next to one that has) or 'default'. A Brisbane City lot is placed north or south by its suburb.
 */
export function resolveArea(lot) {
  const state = stateOf(lot);
  const pool = AREAS.filter((a) => !state || a.state === state);
  const dflt = DEFAULT_AREA_BY_STATE[state || 'NSW'];
  if (!lot) return { key: DEFAULT_AREA, via: 'default', state: null };
  const hay = ` ${norm([lot.suburb, lot.locality].filter(Boolean).join(' '))} ${afterStreet(lot.address)} `;
  const townHit = (a) => a.towns.some((t) => hay.includes(` ${norm(t)} `));
  const lga = norm(lot.lga);
  if (lga) {
    const hit = pool.find((a) => a.lga.some((n) => norm(n) === lga));
    if (hit) {
      const finer = (hit.refine || []).map((k) => AREA_BY_KEY.get(k)).find((a) => a && townHit(a));
      return { key: (finer || hit).key, via: 'lga', state: state || hit.state };
    }
  }
  const town = pool.find(townHit);
  if (town) return { key: town.key, via: 'town', state: state || town.state };
  if (lga) {
    // A council with no area of its own but next to one that has: the nearest priced area (not a measurement of distance).
    const near = pool.find((a) => (a.near || []).some((n) => norm(n) === lga));
    if (near) return { key: near.key, via: 'near', state: state || near.state };
  }
  return { key: dflt, via: 'default', state };
}

/** The area key for a looked up lot (see resolveArea). Falls back to the default of the lot's state. */
export const areaKeyFor = (lot) => resolveArea(lot).key;

/**
 * The fallbackTo chain of an area (market.json): the area itself, then the areas its figures are anchored to, then the default of its state.
 * Returns area keys, never repeats one, so a cycle in the data cannot loop.
 */
export function areaChain(areaKey) {
  const out = [];
  let a = AREA_BY_KEY.get(areaKey) || AREA_BY_KEY.get(DEFAULT_AREA);
  while (a && !out.includes(a.key)) {
    out.push(a.key);
    const next = market.areas[a.m]?.fallbackTo;
    a = next ? AREA_BY_M.get(next) : null;
  }
  const last = DEFAULT_AREA_BY_STATE[(AREA_BY_KEY.get(areaKey) || AREA_BY_KEY.get(DEFAULT_AREA)).state];
  if (!out.includes(last)) out.push(last);
  return out;
}

const range = (o) => ({ low: o.low, high: o.high });
const mid = (r, step = 1) => Math.round(((r.low + r.high) / 2) / step) * step;
const strong = (v, n) => Number.isFinite(v) && v > 0 && Number.isFinite(n) && n >= MIN_N;
const fmtN = (v) => Math.round(v).toLocaleString('en-AU');

/**
 * The defaults for an area: { areaKey, label, inputs: { saleRate, rentRate, yieldPct, landRate, buildRate, siteRate, feesPct, contPct } }.
 * Every input is { value, low, high, status: 'PORTAL' | 'ESTIMATE', chip, note }. The sale rate for small strata units (average unit GFA
 * up to 400 m2) is the mean of the portal asking and sold medians, each used only with n >= 4; when only one is strong that one is used;
 * when neither is, the middle of the published range (ESTIMATE). Larger units use the sold median when strong.
 */
export function areaDefaults(areaKey, { avgUnitGfaM2 = 0 } = {}) {
  const area = AREA_BY_KEY.get(areaKey) || AREA_BY_KEY.get(DEFAULT_AREA);
  const m = market.areas[area.m] || market.areas[AREA_BY_KEY.get(DEFAULT_AREA_BY_STATE[area.state]).m];
  const p = portal.areas[area.key] || {};
  const bc = market.buildCost;
  // meta is the market.json record of the range (status VERIFIED_LISTING, VERIFIED_REPORT or ESTIMATE, asAt, sources). The chip names that status,
  // the range and the as-at date; `status` stays ESTIMATE (the input is not portal evidence) so the colour classes do not change.
  const est = (r, step, note, extra = {}, meta = {}) => {
    const dataStatus = meta.status || 'ESTIMATE';
    const asAt = meta.asAt || MARKET_DATE;
    return { value: mid(r, step), ...range(r), status: 'ESTIMATE', dataStatus, asAt, sources: meta.sources || [], chip: `${statusLabel(dataStatus)}, range ${fmtN(r.low)} to ${fmtN(r.high)} (${asAt})`, note, ...extra };
  };

  // Sale rate
  const sr = range(m.saleRatePerM2GFA);
  const askOk = strong(p.askMedPsm, p.askN);
  const soldOk = strong(p.soldMedPsm, p.soldN);
  const small = !(avgUnitGfaM2 > SMALL_UNIT_M2);
  let saleRate;
  const evidence = { askMedPsm: p.askMedPsm ?? null, askN: p.askN ?? 0, soldMedPsm: p.soldMedPsm ?? null, soldN: p.soldN ?? 0, askUsed: false, soldUsed: false };
  if (small && askOk && soldOk) {
    evidence.askUsed = evidence.soldUsed = true;
    saleRate = { value: Math.round((p.askMedPsm + p.soldMedPsm) / 2), ...sr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${p.askN} asking, n ${p.soldN} sold)`, note: `Blend of the asking median $${fmtN(p.askMedPsm)} per m² and the sold median $${fmtN(p.soldMedPsm)} per m².` };
  } else if (!small && soldOk) {
    evidence.soldUsed = true;
    saleRate = { value: Math.round(p.soldMedPsm), ...sr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${p.soldN} sold)`, note: `Sold median $${fmtN(p.soldMedPsm)} per m² (larger units).` };
  } else if (askOk || soldOk) {
    const v = askOk ? p.askMedPsm : p.soldMedPsm;
    const n = askOk ? p.askN : p.soldN;
    evidence[askOk ? 'askUsed' : 'soldUsed'] = true;
    saleRate = { value: Math.round(v), ...sr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${n} ${askOk ? 'asking' : 'sold'})`, note: `${askOk ? 'Asking' : 'Sold'} median only, the other portal figure has fewer than ${MIN_N} listings.` };
  } else {
    const weak = [p.askN ? `n ${p.askN} asking` : null, p.soldN ? `n ${p.soldN} sold` : null].filter(Boolean).join(', ');
    saleRate = est(sr, 50, weak ? `Portal evidence is weak (${weak}), the published range is used.` : 'No portal listings for this area, the published range is used.', {}, m.saleRatePerM2GFA);
    if (!small) {
      // A building over 400 m2 sells for less per m2 than the small strata units the range is read from, so start at the low end, not the middle.
      saleRate.value = Math.round(sr.low);
      saleRate.note += ' The building is over 400 m2 average unit size and larger buildings sell for less per m2 than small strata units, so the low end of the range is the default.';
    }
  }
  saleRate.evidence = evidence;

  // Rent
  const rr = range(m.grossRentPerM2PerYr);
  const rentRate = strong(p.rentMedPsmPa, p.rentN)
    ? { value: Math.round(p.rentMedPsmPa), ...rr, status: 'PORTAL', chip: `Portal data ${DATA_DATE} (n ${p.rentN} listings)`, note: `Median advertised rent $${fmtN(p.rentMedPsmPa)} per m² per year.` }
    : est(rr, 5, p.rentN ? `Portal rent evidence is weak (n ${p.rentN}), the published range is used.` : 'No portal rent listings, the published range is used.', {}, m.grossRentPerM2PerYr);

  const bcMeta = bc.constructionPerM2GFA_regionalNSW_strataWorkshopWithMezzanineOffice;
  const cfv = market.regionalCostFactors.factors[m.costRegion || 'regionalNSW'];
  const rule = chargeRule(area.key, area.state);
  const yr = range(m.netYieldPct);
  const lr = range(m.industrialLandPerM2);
  const bR = range(bc.constructionPerM2GFA_regionalNSW_strataWorkshopWithMezzanineOffice);
  const sw = range(bc.civilSiteWorksPerM2Site);
  const fe = range(bc.professionalFeesPct);
  const co = range(bc.contingencyPct);
  const inputs = {
    saleRate,
    rentRate,
    // The yield is the investor yield of the area's tier, set from published industrial yield evidence (market.json yieldMethod), not the yield derived from asking prices.
    yieldPct: { value: Math.round(((yr.low + yr.high) / 2) * 100) / 100, ...yr, status: 'ESTIMATE', dataStatus: m.netYieldPct.status || 'ESTIMATE', asAt: m.netYieldPct.asAt || MARKET_DATE, sources: m.netYieldPct.sources || [], chip: `${statusLabel(m.netYieldPct.status)}, range ${yr.low} to ${yr.high} (${m.netYieldPct.asAt || MARKET_DATE})`, note: 'An investor yield set from published industrial yield evidence for this type of area (Herron Todd White, Opteon). Regional small strata yields are not published, so it is a judgement band. It is not the yield implied by asking prices, which small strata units understate. See the data notes.' },
    landRate: est(lr, 5, 'Serviced industrial land prices are not published for most areas.', {}, m.industrialLandPerM2),
    // Basis: the analyst range sits above the verified references (large metal clad shed Sydney 1,060 to 1,340, precast 1,160 to 1,740, national
    // warehouse 1,150, industrial warehouses 1,300 to 2,800). The default starts at the low end of the range, not the middle.
    buildRate: { ...est(bR, 50, 'Secondary cost guides, not a quantity survey, excludes fees and site works. The default is the low end of the analyst range; the verified references (large metal clad shed 1,060 to 1,340, precast 1,160 to 1,740, national warehouse 1,150, industrial warehouses 1,300 to 2,800) sit below its middle. This is the regional NSW rate; the regional cost factor below scales it for the area. Set your own after a quantity survey.', {}, bcMeta), value: bR.low, chip: `Estimate, low end of the range ${fmtN(bR.low)} to ${fmtN(bR.high)} (${bcMeta.asAt})` },
    outgoingsPct: { value: OUTGOINGS_PCT.value, low: OUTGOINGS_PCT.low, high: OUTGOINGS_PCT.high, status: 'ESTIMATE', chip: `Estimate, assumption ${OUTGOINGS_PCT.low} to ${OUTGOINGS_PCT.high}`, note: 'Percent of gross rent taken by outgoings (rates, insurance, repairs and management). An assumption, no regional figure was published. Set your own or use 0 for a net lease.' },
    mezzFactor: { value: MEZZ_FACTOR.value, low: MEZZ_FACTOR.low, high: MEZZ_FACTOR.high, status: 'ESTIMATE', chip: `Estimate, assumption ${MEZZ_FACTOR.low} to ${MEZZ_FACTOR.high}`, note: 'Mezzanine floor area is valued at this fraction of the ground floor sale and rent rate. An assumption, set your own.' },
    siteRate: { ...est(sw, 5, 'Pavements, drainage, services and detention, per m² of the developed area (building footprint plus hardstand). The default is the low end of the published range, as for the build rate. The regional cost factor scales it for the area.', {}, bc.civilSiteWorksPerM2Site), value: sw.low, chip: `Estimate, low end of the range ${fmtN(sw.low)} to ${fmtN(sw.high)} (${bc.civilSiteWorksPerM2Site.asAt || MARKET_DATE})` },
    landscapeRate: { value: LANDSCAPE_RATE.value, low: LANDSCAPE_RATE.low, high: LANDSCAPE_RATE.high, status: 'ESTIMATE', chip: `Estimate, allowance ${LANDSCAPE_RATE.low} to ${LANDSCAPE_RATE.high}`, note: 'Clearing and landscaping, per m² of the rest of the lot.' },
    feesPct: { value: fe.low, ...fe, status: 'ESTIMATE', chip: `Estimate, published range ${fe.low} to ${fe.high}`, note: 'Percent of construction cost (build plus site works).' },
    contPct: { value: co.low, ...co, status: 'ESTIMATE', chip: `Estimate, published range ${co.low} to ${co.high}`, note: 'Percent of construction cost (build plus site works).' },
    costFactor: { value: cfv.value, low: cfv.value, high: cfv.value, status: 'ESTIMATE', dataStatus: cfv.status, asAt: cfv.asAt, sources: cfv.sources, chip: `${statusLabel(cfv.status)}, midpoint of published ${cfv.low} to ${cfv.high} (${cfv.asAt})`, note: `Regional cost factor for ${area.label}: ${cfv.note} It multiplies the published build rate (strata rows and catalogue buildings) and the site works rate; rates you type are used as entered.` },
    councilCharges: { value: null, low: null, high: null, rule, status: 'ESTIMATE', dataStatus: rule.status, asAt: rule.asAt, sources: rule.sources, chip: `${statusLabel(rule.status)}, ${rule.short} (${rule.asAt})`, note: `${rule.basis} ${rule.note}` },
  };
  const state = area.state;
  return { areaKey: area.key, label: area.label, state, confidence: m.confidence || null, fallbackTo: m.fallbackTo || null, chain: areaChain(area.key), meta: { asAt: MARKET_DATE, saleStatus: m.saleRatePerM2GFA.status, rentStatus: m.grossRentPerM2PerYr.status, yieldStatus: m.netYieldPct.status, landStatus: m.industrialLandPerM2.status }, inputs };
}

/** GFA of every unit including its mezzanine, in m2, in plan order: [{ n, ground, mezz, gfa }]. */
export function unitGfas(commercial) {
  return layoutUnits(commercial).map((u) => {
    const ground = (u.w * u.d) / 1e6;
    const mz = mezzanineOf(u.spec);
    const mezz = mz.enabled ? mz.areaM2 : 0;
    return { n: u.n, ground, mezz, gfa: ground + mezz };
  });
}

/** Upper bounds for the inputs, so a mistyped value cannot produce billions. */
export const INPUT_MAX = Object.freeze({ saleRate: 20000, rentRate: 1500, yieldPct: 25, landRate: 5000, buildRate: 10000, siteRate: 2000, landscapeRate: 500, feesPct: 40, contPct: 40, outgoingsPct: 100, mezzFactor: 1, costFactor: 3, councilCharges: 200000000, landPrice: 500000000 });
const INPUT_KEYS = ['saleRate', 'rentRate', 'yieldPct', 'landRate', 'buildRate', 'siteRate', 'landscapeRate', 'feesPct', 'contPct', 'outgoingsPct', 'mezzFactor', 'costFactor', 'councilCharges'];

/** The effective values: the person's overrides (project.commercial.feasibility.v) on top of the defaults. */
export function effectiveInputs(defaults, overrides = {}) {
  const out = {};
  for (const k of INPUT_KEYS) {
    const d = defaults.inputs[k];
    const o = overrides[k];
    const edited = Number.isFinite(o) && o >= 0;
    out[k] = { ...d, max: INPUT_MAX[k], value: edited ? Math.min(o, INPUT_MAX[k]) : d.value, edited, defaultValue: d.value, status: edited ? 'EDITED' : d.status, chip: edited ? 'Edited by you' : d.chip };
  }
  const price = Number(overrides.landPrice);
  out.landPrice = { value: Number.isFinite(price) && price > 0 ? Math.min(price, INPUT_MAX.landPrice) : null };
  const wr = Number(overrides.wallRate);
  out.wallRate = { value: overrides.wallRate != null && overrides.wallRate !== '' && Number.isFinite(wr) && wr >= 0 ? wr : null };
  return out;
}

/** The Commercial sample lot (lot.demo) shows these example figures so its first look is a plausible regional NSW case. Every input stays visible and editable. */
export const SAMPLE_INPUTS = Object.freeze({ saleRate: 2700, rentRate: 175, yieldPct: 6.5, landRate: 60, outgoingsPct: 8 });
export const SAMPLE_CHIP = 'Example figures, enter your own';

const r0 = (v) => Math.round(v);

/** One scenario. side: 'mid' (the values in use), 'low' (low revenue, high cost) or 'high' (high revenue, low cost). */
function scenario(inp, { gfa, rowsGfa = gfa, mezzM2 = 0, buildings = [], rowWalls = [], devM2, restM2, lotM2 }, side) {
  const pick = (k, revenue) => {
    const x = inp[k];
    if (side === 'mid') return x.value;
    const lo = Math.min(x.low ?? x.value, x.value);
    const hi = Math.max(x.high ?? x.value, x.value);
    const wantHigh = side === 'high' ? revenue : !revenue; // revenue items are high in the high case, costs are high in the low case
    return wantHigh ? hi : lo;
  };
  const sale = pick('saleRate', true);
  const rent = pick('rentRate', true);
  const yieldPct = side === 'mid' ? inp.yieldPct.value : (side === 'high' ? Math.min(inp.yieldPct.low ?? inp.yieldPct.value, inp.yieldPct.value) : Math.max(inp.yieldPct.high ?? inp.yieldPct.value, inp.yieldPct.value));
  const landFixed = inp.landPrice.value;
  const land = landFixed != null ? landFixed : (lotM2 || 0) * pick('landRate', false);
  // The regional cost factor scales the published build and site works rates; a rate the person typed is used as entered. It is a single value
  // (the published ranges already carry the uncertainty), so it does not widen the low to high band.
  const cf = inp.costFactor?.value ?? 1;
  const fBuild = inp.buildRate.edited ? 1 : cf;
  const fSite = inp.siteRate.edited ? 1 : cf;
  const buildRows = rowsGfa * pick('buildRate', false) * fBuild;
  // Catalogue buildings use the ESTIMATE rate of their type (low revenue scenario takes the dear end), scaled by the regional factor.
  const costSide = side === 'mid' ? 'mid' : side === 'low' ? 'high' : 'low';
  const wallOver = inp.wallRate?.value ?? null;
  // Walls: the wall delta rates are stated estimates over the metal clad rate (not scaled by the regional factor); a rate the person typed replaces them.
  const bCosts = buildings.map((b) => {
    const c = buildingCost(b, costSide);
    const wc = wallCost(b.q?.construction, constructionSpec(b.params), costSide, wallOver);
    return { b, total: c.total * cf + wc.total, lines: [...c.lines.map((l) => ({ ...l, rate: l.perM2 ? l.rate * cf : l.rate, amount: l.amount * cf })), ...wc.lines], wallTotal: wc.total };
  });
  const rowWallCosts = rowWalls.map((rw) => ({ rw, ...wallCost(rw, rw.spec, costSide, wallOver) }));
  const buildRowWalls = rowWallCosts.reduce((a, x) => a + x.total, 0);
  const buildBuildings = bCosts.reduce((a, x) => a + x.total, 0);
  const build = buildRows + buildRowWalls + buildBuildings;
  const siteDev = devM2 * pick('siteRate', false) * fSite;
  const siteRest = restM2 * pick('landscapeRate', false);
  const site = siteDev + siteRest;
  const construction = build + site;
  const fees = (construction * pick('feesPct', false)) / 100;
  const contingency = (construction * pick('contPct', false)) / 100;
  // Council charges: the person's total if they typed one, else the default of the area's rule (s7.12 percent of cost, or Queensland per m2 GFA).
  const chargesAuto = computeCharges(inp.councilCharges?.rule, { constructionCost: construction, rowsGroundM2: Math.max(0, rowsGfa - mezzM2), rowsMezzM2: mezzM2, buildings, devM2 });
  const charges = inp.councilCharges?.edited ? inp.councilCharges.value : chargesAuto;
  const cost = land + construction + fees + contingency + charges;
  // Mezzanine floor area earns a fraction of the ground floor rate; the capitalised value uses NET rent (gross less outgoings).
  const mezzFactor = Math.min(1, pick('mezzFactor', true));
  const outgoingsPct = Math.min(100, pick('outgoingsPct', false));
  const revenueGfa = gfa - mezzM2 * (1 - mezzFactor);
  const realisation = revenueGfa * sale;
  const grossRent = revenueGfa * rent;
  const netRent = grossRent * (1 - outgoingsPct / 100);
  const endValue = yieldPct > 0 ? netRent / (yieldPct / 100) : 0;
  const marginSale = realisation - cost;
  const marginHold = endValue - cost;
  return {
    yieldOk: yieldPct > 0,
    saleRate: sale, rentRate: rent, yieldPct, land, build, buildRows, buildRowWalls, rowWallLines: rowWallCosts.flatMap((x) => x.lines), buildBuildings, buildingCosts: bCosts.map((x) => ({ id: x.b.id, n: x.b.n, label: x.b.label, gfa: x.b.gfaM2, total: x.total, lines: x.lines })), siteWorks: site, siteDev, siteRest, fees, contingency, charges, chargesAuto, costFactor: cf, cost,
    realisation, grossRent, netRent, outgoingsPct, mezzFactor, revenueGfa, endValue, marginSale, marginHold,
    marginSalePct: cost > 0 ? (marginSale / cost) * 100 : 0,
    marginHoldPct: cost > 0 && yieldPct > 0 ? (marginHold / cost) * 100 : 0,
    grossYieldOnCostPct: cost > 0 ? (grossRent / cost) * 100 : 0,
  };
}

/**
 * feasibility(commercial, lot, { areaKey, overrides }) -> everything the panel and the C103 section show.
 * Outputs are unrounded numbers; the UI rounds for display. Per unit price and rent use each unit's own GFA.
 */
export function feasibility(commercial, lot, opts = {}) {
  syncCurrency({ site: { lot } });
  const fz = commercial?.feasibility || {};
  const detected = areaKeyFor(lot);
  const areaKey = opts.areaKey || fz.area || detected;
  const units = unitGfas(commercial);
  const rowsGfa = units.reduce((s, u) => s + u.gfa, 0);
  const buildings = buildingsOf(commercial);
  const gfa = rowsGfa + buildings.reduce((s, b) => s + b.gfaM2, 0);
  const lotM2 = lotAreaM2(lot) || 0;
  const count = units.length + buildings.length;
  const defaults = areaDefaults(areaKey, { avgUnitGfaM2: count ? gfa / count : 0 });
  const userV = opts.overrides || fz.v || {};
  const inputs = effectiveInputs(defaults, userV);
  if (lot?.demo && lot.lotLabel === 'Sample lot') {
    for (const [k, v] of Object.entries(SAMPLE_INPUTS)) {
      if (inputs[k].edited) continue;
      inputs[k] = { ...inputs[k], value: v, defaultValue: v, status: 'EXAMPLE', chip: SAMPLE_CHIP, note: 'An example for the sample lot only. Enter your own value.' };
    }
  }
  const devM2 = developedAreaM2(commercial, lot);
  const restM2 = Math.max(0, lotM2 - devM2);
  const mezzM2 = units.reduce((s, u) => s + u.mezz, 0);
  const rowWalls = rowsWallBasis(commercial).map((rw) => ({ ...rw, spec: constructionSpec((commercial.rows || []).find((r) => r.id === rw.rowId)?.unit) }));
  const ctx = { gfa, rowsGfa, mezzM2, buildings, rowWalls, devM2, restM2, lotM2 };
  const mid_ = scenario(inputs, ctx, 'mid');
  const low = scenario(inputs, ctx, 'low');
  const high = scenario(inputs, ctx, 'high');
  // The charges default is worked out from the layout, so it is filled in after the values in use are known.
  inputs.councilCharges = { ...inputs.councilCharges, defaultValue: Math.round(mid_.chargesAuto), ...(inputs.councilCharges.edited ? {} : { value: Math.round(mid_.chargesAuto) }) };
  const perUnit = [...units.map((u) => ({ n: u.n, gfa: u.gfa, price: (u.ground + u.mezz * mid_.mezzFactor) * mid_.saleRate, rent: (u.ground + u.mezz * mid_.mezzFactor) * mid_.rentRate })), ...buildings.map((b) => ({ n: `B${b.n}`, label: b.label, gfa: b.gfaM2, price: b.gfaM2 * mid_.saleRate, rent: b.gfaM2 * mid_.rentRate }))];
  const resolved = resolveArea(lot);
  return { areaKey, detectedKey: detected, detectedVia: resolved.via, rowWalls, areaLabel: defaults.label, areaState: defaults.state, areaMeta: defaults.meta, areaChain: defaults.chain, confidence: defaults.confidence, units, buildings, rowsGfa, perUnit, gfa, lotM2, devM2, restM2, inputs, defaults, mid: mid_, low, high, landFromPrice: inputs.landPrice.value != null, dataDate: DATA_DATE, marketDate: MARKET_DATE };
}

// Formatting, shared by the panel and the C103 section --------------------------------------------------------------------------
const m2 = (v) => (Math.round(v * 10) / 10).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
export const money = (v) => `${v < 0 ? '-' : ''}${activeSymbol()}${Math.round(Math.abs(v)).toLocaleString('en-AU')}`;
export const pct1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}%`;
export const band = (a, b, f = money) => (r0(a) === r0(b) ? f(a) : `${f(Math.min(a, b))} to ${f(Math.max(a, b))}`);

/**
 * One line naming the area, its state, how it was found, the as-at date and the status (Listing, Report or Estimate) of each market figure:
 * "Townsville, QLD. Found from the council area. Market data as at 15/11/2026. Sale rate Estimate, rent Estimate, yield Estimate, land Estimate. Confidence medium."
 */
export function areaStatusLine(f) {
  const m = f.areaMeta || {};
  const how = f.areaKey !== f.detectedKey ? 'Chosen by you.' : f.detectedVia === 'lga' ? 'Found from the council area.' : f.detectedVia === 'town' ? 'Found from the suburb or town.' : f.detectedVia === 'near' ? 'Found from the council area, which has no area of its own: the nearest priced area is used.' : `No area matched this lot, so the ${f.areaLabel} is used.`;
  const anchor = (f.areaChain || []).length > 1 && (f.defaults?.fallbackTo) ? ` Thin evidence is anchored to ${f.defaults.fallbackTo}.` : '';
  return `${f.areaLabel}, ${f.areaState}. ${how} Market data as at ${f.marketDate}. Sale rate ${statusLabel(m.saleStatus)}, rent ${statusLabel(m.rentStatus)}, yield ${statusLabel(m.yieldStatus)}, land ${statusLabel(m.landStatus)}.${f.confidence ? ` Confidence ${f.confidence}.` : ''}${anchor}`;
}

/** The summary lines [label, value, band] for the panel and for C103. Same wording in both. */
export const NEED_YIELD = 'Enter a yield';
/** The headline: profit and margin on cost if the units are sold, and if they are held and leased. [label, value, note] */
export function headlineRows(f) {
  const m = f.mid;
  const holdOk = m.yieldOk !== false;
  return [
    ['Indicative profit, sell the units', `${money(m.marginSale)} (${pct1(m.marginSalePct)} on cost)`, m.marginSale < 0 ? 'A loss at these values' : ''],
    ['Indicative profit, hold and lease', holdOk ? `${money(m.marginHold)} (${pct1(m.marginHoldPct)} on cost)` : NEED_YIELD, holdOk && m.marginHold < 0 ? 'A loss at these values' : ''],
  ];
}

export function summaryRows(f) {
  const { mid: m, low: l, high: h } = f;
  const holdOk = m.yieldOk !== false;
  return [
    ['GFA incl. mezzanine', `${m2(f.gfa)} m²`, ''],
    ['Gross realisation (GFA x sale rate)', money(m.realisation), band(l.realisation, h.realisation)],
    ['Gross rent per year', money(m.grossRent), band(l.grossRent, h.grossRent)],
    [`Net rent per year (after ${Math.round(m.outgoingsPct * 10) / 10}% outgoings)`, money(m.netRent), band(l.netRent, h.netRent)],
    ['End value by capitalisation (net rent / net yield)', holdOk ? money(m.endValue) : NEED_YIELD, holdOk ? band(l.endValue, h.endValue) : ''],
    ['Total development cost', money(m.cost), band(h.cost, l.cost)],
    ['Gross yield on cost', pct1(m.grossYieldOnCostPct), band(l.grossYieldOnCostPct, h.grossYieldOnCostPct, pct1)],
    ['Indicative margin, sell the units', `${money(m.marginSale)} (${pct1(m.marginSalePct)} on cost)`, `${band(l.marginSale, h.marginSale)} (${band(l.marginSalePct, h.marginSalePct, pct1)})`],
    ['Indicative margin, hold and lease', holdOk ? `${money(m.marginHold)} (${pct1(m.marginHoldPct)} on cost)` : NEED_YIELD, holdOk ? `${band(l.marginHold, h.marginHold)} (${band(l.marginHoldPct, h.marginHoldPct, pct1)})` : ''],
  ];
}

/** The cost build up lines [label, value] at the values in use. */
export function costRows(f) {
  const m = f.mid;
  return [
    [f.landFromPrice ? 'Land (listing or purchase price)' : `Land (${money(f.inputs.landRate.value)} per m² x ${Math.round(f.lotM2).toLocaleString('en-AU')} m²)`, money(m.land)],
    ...(f.rowsGfa > 0 || !f.buildings?.length ? [[`Building (${money(f.inputs.buildRate.value)} per m²${factorText(f, 'buildRate')} x ${m2(f.rowsGfa ?? f.gfa)} m² GFA)`, money(m.buildRows ?? m.build)]] : []),
    ...(m.rowWallLines || []).map((l) => [`Unit walls, ${l.label} (${money(l.rate)} per m² x ${m2(l.area)} m² of wall, ${l.status})`, money(l.amount)]),
    ...(m.buildingCosts || []).flatMap((bc) => bc.lines.map((l) => [`Building ${bc.n}, ${l.label} (${l.wall ? `${money(l.rate)} per m² x ${m2(l.area)} m² of wall` : l.perM2 ? `${money(l.rate)} per m² x ${m2(bc.gfa)} m² GFA` : 'lump sum'}, ${l.status})`, money(l.amount)])),
    [`Site works, developed area (${money(f.inputs.siteRate.value)} per m²${factorText(f, 'siteRate')} x ${m2(f.devM2)} m² of footprint and hardstand)`, money(m.siteDev)],
    [`Clearing and landscaping, rest of lot (${money(f.inputs.landscapeRate.value)} per m² x ${m2(f.restM2)} m²)`, money(m.siteRest)],
    [`Fees (${f.inputs.feesPct.value}% of building and site works)`, money(m.fees)],
    [`Contingency (${f.inputs.contPct.value}% of building and site works)`, money(m.contingency)],
    [chargesLabel(f), money(m.charges)],
    ['Total development cost', money(m.cost)],
  ];
}

/** " x 1.12 regional factor" when the factor applies to a rate (it does not when the person typed the rate or the factor is 1). */
const factorText = (f, key) => { const x = f.inputs.costFactor?.value; return x && x !== 1 && !f.inputs[key].edited ? ` x ${x} regional factor` : ''; };
/** The label of the council charges cost line: the rule, its status and its as-at date, or "entered by you". */
export function chargesLabel(f) {
  const c = f.inputs.councilCharges;
  const rule = c.rule;
  if (c.edited) return 'Council charges (entered by you)';
  return `Council charges (${rule.model === 'pctOfCost' ? rule.short : `${rule.short}, per m² GFA by use`}, ${statusLabel(rule.status)}, ${rule.asAt})`;
}
