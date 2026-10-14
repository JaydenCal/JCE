/**
 * Stage 8: wording and colours of the existing services (from a DBYD plan or traced by hand), the sewer drain, the service node and the water service.
 *
 * Nothing is defaulted. A service without a verification is UNVERIFIED, INDICATIVE ONLY and is drawn dashed. A plan whose stored expiry date is before
 * today is PLAN EXPIRED. Where the expiry date is not stored, the frontend does not work it out: the server check SVC_PLAN_EXPIRY uses the requirement key
 * dbyd.plan_validity_days and reports UNRESOLVED when that key is not set.
 */
import { SERVICE_COLOUR, SERVICE_KINDS, SERVICE_KIND_LABEL, DEPTH_BASIS_LABEL, DEPTH_BASES, PLAN_EXPIRED, UNVERIFIED_LABEL, dimOf, textOf, type ServiceKind, type SiteObject } from './types';

/** An ISO date (YYYY-MM-DD) shown as DD/MM/YYYY; '' for anything else. */
export function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
/**
 * The time zone in which "today" is worked out for plan expiry: the same zone as the server (backend service_model.PLAN_TIME_ZONE), so the browser and the server agree on
 * the date whatever the zone of the computer. The project has no time zone of its own.
 */
export const PLAN_TIME_ZONE = 'Australia/Sydney';
const SYDNEY_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: PLAN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** The calendar date (YYYY-MM-DD) of an instant in Australia/Sydney, not in the browser's zone. */
export const todayIso = (now: Date = new Date()): string => {
  const p = Object.fromEntries(SYDNEY_DATE.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

export const isServiceType = (t: string): boolean => t === 'service_existing' || t === 'sewer_drain' || t === 'service_node' || t === 'water_service';

export function serviceKind(o: SiteObject): ServiceKind | null {
  const k = textOf(o, 'service_kind');
  return k !== null && (SERVICE_KINDS as readonly string[]).includes(k) ? (k as ServiceKind) : null;
}
/** The display colour of an existing service: by its kind, a neutral grey while the kind is NOT SET. */
export function serviceColour(o: SiteObject): string {
  if (o.type === 'sewer_drain') return SERVICE_COLOUR.sewer;
  if (o.type === 'water_service') return SERVICE_COLOUR.water;
  const k = serviceKind(o);
  return k ? SERVICE_COLOUR[k] : '#999999';
}
/** True while an existing service has no user verification: it is drawn dashed. */
export const isUnverified = (o: SiteObject): boolean => o.type === 'service_existing' && !o.verified;
/** PLAN EXPIRED when the stored expiry date is before `today` (ISO); false when the date is not stored. */
export function planExpired(o: SiteObject, today: string = todayIso()): boolean {
  if (o.type !== 'service_existing') return false;
  const d = textOf(o, 'plan_expiry_date');
  return d !== null && /^\d{4}-\d{2}-\d{2}$/.test(d) && d < today;
}

/** The 3D label lines of the stage 8 types (upper case, no dashes). */
export function serviceLabelLines(o: SiteObject, today: string = todayIso()): string[] {
  const L: string[] = [];
  if (o.type === 'service_existing') {
    const k = serviceKind(o);
    L.push(k ? SERVICE_KIND_LABEL[k] : 'SERVICE KIND NOT SET');
    const own = textOf(o, 'asset_owner'); L.push(own ? own.toUpperCase() : 'OWNER NOT SET');
    const d = dimOf(o, 'diameter_mm'); if (d !== null) L.push(`DIA ${d.toFixed(0)} MM`);
    const depth = dimOf(o, 'depth_m'), basis = textOf(o, 'depth_basis');
    L.push(depth !== null && basis && basis !== 'unknown' ? `DEPTH ${depth.toFixed(2)} M ${(DEPTH_BASIS_LABEL[basis as (typeof DEPTH_BASES)[number]] ?? basis.toUpperCase())}` : 'DEPTH NOT AVAILABLE');
    if (planExpired(o, today)) L.push(PLAN_EXPIRED);
    if (!o.verified) L.push(UNVERIFIED_LABEL);
    else L.push(`VERIFIED ${fmtDate(o.verified_on)}`);
  } else if (o.type === 'sewer_drain') {
    const d = dimOf(o, 'diameter_mm'); if (d !== null) L.push(`DIA ${d.toFixed(0)} MM`);
  } else if (o.type === 'service_node') {
    const k = textOf(o, 'node_kind'); L.push(k ? k.replace(/_/g, ' ').toUpperCase() : 'NODE KIND NOT SET');
  } else if (o.type === 'water_service') {
    const d = dimOf(o, 'diameter_mm'); if (d !== null) L.push(`DIA ${d.toFixed(0)} MM`);
  }
  return L;
}

/** Dash and gap lengths (metres) of an unverified service line in the model. */
export const DASH_M = 0.6, GAP_M = 0.4;
/** Split a polyline into dash segments of `dash` metres separated by `gap` metres (plan lengths). Pure, for the scene and the tests. */
export function dashSegments(pts: readonly (readonly number[])[], dash = DASH_M, gap = GAP_M): [number, number][][] {
  const out: [number, number][][] = [];
  if (pts.length < 2 || !(dash > 0) || !(gap >= 0)) return out;
  if (gap === 0) return [pts.map((p) => [p[0], p[1]] as [number, number])];
  let on = true, left = dash, cur: [number, number][] = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    let ax = pts[i - 1][0], ay = pts[i - 1][1];
    const bx = pts[i][0], by = pts[i][1];
    let rem = Math.hypot(bx - ax, by - ay);
    if (rem < 1e-9) continue;
    const ux = (bx - ax) / rem, uy = (by - ay) / rem;
    while (rem > 1e-9) {
      const step = Math.min(left, rem);
      ax += ux * step; ay += uy * step; rem -= step; left -= step;
      if (on) cur.push([ax, ay]);
      if (left <= 1e-9) {
        if (on) { out.push(cur); cur = []; } else cur = [[ax, ay]];
        on = !on; left = on ? dash : gap;
      }
    }
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}
