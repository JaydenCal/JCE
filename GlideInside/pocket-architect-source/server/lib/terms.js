// Plan set terms acceptance (src/legal/plan-terms.js is the one source of the text and the version).
//   POST /api/terms/accept { version, context }   records that the signed in account (Plan Pack token, commercial login or portal session)
//                                                 accepted the CURRENT version: subject id, version, UTC timestamp, hashed IP, user agent.
//                                                 An anonymous caller (the free preview) gets { recorded: false }: that acceptance is kept in the
//                                                 browser only.
//   GET  /api/terms/admin/counts                  owner only (bearer ADMIN_TOKEN): acceptances per version.
// The export endpoints call requireAccepted(subject, type) first: a PDF or DXF for an account that has not accepted the current version
// is refused with 409 TERMS_REQUIRED (the page then asks and records, and retries once).

import { HttpError, json, readJson, clientIp, bearerToken } from './http.js';
import { secretEqual } from './password.js';
import { PLAN_TERMS } from '../../src/legal/plan-terms.js';

export const TERMS_EXPORT_TYPES = ['pdf', 'dxf'];
const enc = new TextEncoder();
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const rid = () => `tac_${[...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

export function createTerms({ store, config, now, resolveSubject }) {
  const current = () => PLAN_TERMS.version;
  const required = () => config.termsRequired !== false;

  async function accept(request, url) {
    const ip = clientIp(request);
    if ((await store.hitRate(`terms:${ip}`, 3600, now())) > 120) throw new HttpError('RATE_LIMITED', 'Too many attempts. Please wait a while and try again.', { retryAfter: 600 });
    const body = await readJson(request, 2048);
    const subject = await resolveSubject(request, url);
    if (body?.version !== current()) throw new HttpError('CONFLICT', 'The plan set terms have been updated. Reload the page and try again.', { currentVersion: current() });
    if (!subject) return json({ recorded: false, reason: 'anonymous', version: current() });
    const context = typeof body.context === 'string' ? body.context.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60) : '';
    const rec = await store.recordTermsAcceptance({
      id: rid(), subjectId: subject.id, subjectKind: subject.kind, version: current(), context: context || null, acceptedAt: new Date(now()).toISOString(),
      ipHash: ip && ip !== 'unknown' ? await sha(config.ipHashSalt + ip) : null,
      userAgent: (request.headers.get('user-agent') || '').slice(0, 200) || null,
    });
    return json({ recorded: true, version: rec.version, acceptedAt: rec.acceptedAt });
  }

  /** Resolves the acceptance { version, acceptedAt } or null when terms are switched off; throws 409 TERMS_REQUIRED when it is not on record. */
  async function requireAccepted(subject, type) {
    if (!required() || !TERMS_EXPORT_TYPES.includes(type)) return null;
    const rec = subject ? await store.getTermsAcceptance(subject.id, current()) : null;
    if (!rec) throw new HttpError('TERMS_REQUIRED', 'Please accept the plan set terms of use before generating plans.', { version: current() });
    return { version: rec.version, acceptedAt: rec.acceptedAt };
  }

  async function adminCounts(request) {
    if (!config.adminToken) throw new HttpError('PORTAL_NOT_CONFIGURED', 'ADMIN_TOKEN is not set.');
    if ((await store.hitRate(`admin:${clientIp(request)}`, 600, now())) > 30) throw new HttpError('RATE_LIMITED', 'Too many attempts.', { retryAfter: 600 });
    const given = bearerToken(request);
    if (!given || !(await secretEqual(given, config.adminToken))) throw new HttpError('UNAUTHORISED', 'Not authorised.');
    return json({ currentVersion: current(), versions: await store.termsAcceptanceCounts() });
  }

  async function route(request, url, path) {
    const only = (m) => { if (request.method !== m) throw new HttpError('BAD_REQUEST', `Use ${m} for this endpoint.`, {}, 405); };
    if (path === '/terms/accept') return only('POST'), accept(request, url);
    if (path === '/terms/admin/counts') return only('GET'), adminCounts(request);
    return null;
  }
  return { route, requireAccepted, current };
}
