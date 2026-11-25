// Make the sample lot files (the real aerial and contours the home page viewer opens on). Run it once, on a computer that can reach the NSW
// services, then check the files in. See src/site/sample-lot.js for what the app does with them.
//
//   node tools/export-sample-lot.mjs "<street address of a VACANT lot in a new regional NSW estate>" [--out ../website-live/plan-studio/sample]
//
// Steps (the exact export steps):
//   1. Pick a vacant, titled lot in a new regional NSW estate with no house, shed or pool on it, so no private home is shown.
//      Look at the NSW aerial first (the app, or SIX Maps). The lot should be a plain rectangle of about 600 to 900 m2 on a street.
//   2. From GlideInside/pocket-architect-source run the command above with that address. It uses the same server code and the same requests
//      as a searched address (/api/site/lot, /aerial, /contours), so the files are exactly what a visitor would get.
//   3. Open the written sample-lot-aerial.jpg and check it: sharp (the tool warns above 120 mm per pixel), the lot clear of buildings and cars,
//      nothing identifiable beside it that should not be shown.
//   4. Commit sample-lot.json, sample-lot-aerial.jpg and sample-lot-aerial-wide.jpg. Nothing else changes: the app reads the manifest, and
//      while its status is "placeholder" the old synthetic lot is used.
//   5. Tell the owner the address, so it can be approved before it goes live. Credit stays NSW Spatial Services, as the app already shows.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';
import { searchAddresses, fetchSite } from '../src/site/client.js';
import { buildSampleManifest, SAMPLE_MANIFEST } from '../src/site/sample-lot.js';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const out = resolve(root, outArg >= 0 ? args[outArg + 1] : '../website-live/plan-studio/sample');
const address = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out').join(' ').trim();
if (address.length < 5) { console.error('Give the street address of a vacant lot, in quotes.'); process.exit(1); }

const app = createApp({ store: createMemoryStore(), env: { SITE_URL: 'http://local.invalid', ENTITLEMENT_SECRET: 'x', PORTAL_ENABLED: '0', ADMIN_TOKEN: 'export-sample-lot-0123456789abcdef' } });
const fetchImpl = (url, init) => app.fetch(new Request(new URL(String(url), 'http://local.invalid'), init));

const found = await searchAddresses(address, { fetchImpl });
if (!found.length) { console.error(`No address matched "${address}".`); process.exit(1); }
const pick = found[0];
console.log(`Using ${pick.label} (${pick.state || 'NSW'})`);
const site = await fetchSite(pick, { fetchImpl, aerialTimeoutMs: 60000 });
for (const w of site.warnings || []) console.warn(`Warning: ${w}`);
if (site.lot?.state !== 'NSW') { console.error('The sample lot must be in NSW.'); process.exit(1); }
if (!site.aerial) { console.error('No aerial came back, so there is nothing to ship.'); process.exit(1); }
if (!site.contours) console.warn('Warning: no contours came back. The sample will show the aerial without ground levels.');

mkdirSync(out, { recursive: true });
const files = { aerial: 'sample-lot-aerial.jpg', wide: 'sample-lot-aerial-wide.jpg' };
writeFileSync(join(out, files.aerial), Buffer.from(await site.aerial.blob.arrayBuffer()));
if (site.aerialWide) writeFileSync(join(out, files.wide), Buffer.from(await site.aerialWide.blob.arrayBuffer()));
const mm = Number(site.aerial.meta.mmPerPx);
if (!(mm > 0) || mm > 120) console.warn(`Warning: the aerial is ${mm || 'an unknown number of'} mm per pixel. It should be 120 or finer to look sharp. Do not ship a soft one.`);
const manifest = buildSampleManifest(site, { files, address: pick.label, exportedOn: new Date().toISOString().slice(0, 10) });
writeFileSync(join(out, SAMPLE_MANIFEST), `${JSON.stringify(manifest)}\n`);
console.log(`Wrote ${join(out, SAMPLE_MANIFEST)} and the aerial (${mm ? `${mm.toFixed(0)} mm per pixel` : 'resolution unknown'}). Check the picture, then commit and tell the owner the address.`);
