// Cloudflare Worker entry (reference implementation): D1 for storage, Web-standard fetch for Stripe and Anthropic.
//
// Other platforms: build the same app with their own store and call app.fetch(request).
//   import { createApp } from './lib/app.js';
//   const app = createApp({ store, env: process.env });
//   export default (request) => app.fetch(request);          // Deno, Bun, Node 20+ with a Request adapter
// See server/README.md for Vercel and Netlify wrappers.

import { createApp } from './lib/app.js';
import { createD1Store } from './lib/store.js';
import { createD1PortalStore } from './lib/portal-store.js';

let cached = null;

function appFor(env) {
  if (!cached || cached.env !== env) {
    cached = {
      env,
      app: createApp({
        store: createD1Store(env.DB),
        portalStore: createD1PortalStore(env.DB),
        env,
        // R2 bucket (binding FILES): shared designs (projects/<id>.json) and issued PDF sets (pdf/<entitlement>.pdf).
        files: env.FILES || null,
        // The catalogue supplies furniture, material and colour ids for the assistant's tools.
        catalogue: () => import('../src/catalogue/index.js').then((m) => m.catalogue ?? m.default ?? m),
        loadJsPDF: () => import('jspdf').then((m) => m.jsPDF || m.default?.jsPDF || m.default),
      }),
    };
  }
  return cached.app;
}

export default {
  async fetch(request, env) {
    return appFor(env).fetch(request);
  },
  // Cron (wrangler.toml [triggers]): month end invoicing at 06:00 on the 1st, Sydney time. The cron fires at 19:00 and 20:00 UTC
  // so one of them is 06:00 in both AEDT and AEST; the handler does nothing at any other Sydney time. Invoices are idempotent per org per month.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      appFor(env)
        .scheduled()
        .then((r) => r && console.log(JSON.stringify({ event: 'billing_run', ...r })))
        .catch((e) => console.error(JSON.stringify({ event: 'billing_run_failed', message: e?.message }))),
    );
  },
};
