// Local testing without Stripe. Prints the SQL for a test entitlement and the token that goes with it.
//
//   ENTITLEMENT_SECRET=... node server/dev-entitlement.mjs --project p_abc123 [--email you@example.com] [--credits 500] [--days 30]
//
// Run the printed command against the LOCAL database, then paste the printed line into the browser console on the
// app page. Never use this against a production database. See server/README.md.

import { signToken } from './lib/entitlement.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']] : pairs), []),
);

const secret = process.env.ENTITLEMENT_SECRET;
const projectId = args.project;
if (!secret || !projectId || !/^[A-Za-z0-9_-]+$/.test(projectId)) {
  console.error('Usage: ENTITLEMENT_SECRET=... node server/dev-entitlement.mjs --project <project id> [--email you@example.com] [--credits 500] [--days 30]');
  console.error('The project id is shown by the app: run `__ps.store.project.id` in the browser console.');
  process.exit(1);
}

const credits = Math.max(1, Math.round(Number(args.credits) || 500));
const days = Math.max(1, Number(args.days) || 30);
const email = String(args.email || 'dev@example.com').replace(/'/g, '');
const now = new Date();
const expires = new Date(now.getTime() + days * 86400000);
const id = `ent_dev${Math.random().toString(16).slice(2, 12)}`;

const sql = [
  'INSERT INTO entitlements (id, project_id, email, stripe_session_id, stripe_payment_intent, amount_cents, currency, credits_total, status, created_at, expires_at)',
  `VALUES ('${id}', '${projectId}', '${email}', 'cs_dev_${id}', 'pi_dev_${id}', 3000, 'aud', ${credits}, 'active', '${now.toISOString()}', '${expires.toISOString()}');`,
].join(' ');

const token = await signToken({ eid: id, pid: projectId, exp: Math.floor(expires.getTime() / 1000) }, secret);

console.log('1. Create the entitlement in the local database:\n');
console.log(`   wrangler d1 execute plan-studio --local --command "${sql}"\n`);
console.log('2. Give the browser the token (paste in the console on the app page, then reload):\n');
console.log(`   localStorage.setItem('ps.ent.${projectId}', '${token}')\n`);
console.log(`Receipt reference ${id}. Restore purchase also works with ${email} and that reference.`);
