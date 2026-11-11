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
        // STAGING ONLY: the staging Worker (staging/wrangler.staging.toml sets STAGING=1) offers a free test Plan Pack so PDF, DXF, 3D and HTML
        // exports can be tried. Never on a Worker that holds a Stripe key, so it cannot exist on the live Worker.
        devGrant: env.STAGING === '1' && !env.STRIPE_SECRET_KEY,
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

// STAGING ONLY (STAGING=1, set by staging/wrangler.staging.toml and nowhere else). The staging Worker serves the website and the app as
// static assets and the API on the same workers.dev origin, so the site and app URLs are the request's own origin (no CORS, share links
// point back at staging). The live Worker has no STAGING variable, so none of this runs there.
const stagingEnvs = new Map();
function stagingEnv(env, origin) {
  if (!stagingEnvs.has(origin)) stagingEnvs.set(origin, { ...env, SITE_URL: origin, APP_URL: `${origin}/plan-studio/app/` });
  return stagingEnvs.get(origin);
}

export default {
  async fetch(request, env) {
    if (env.STAGING === '1') {
      const url = new URL(request.url);
      // /api/* is routed here first (assets run_worker_first); anything else is a page or file of the staging site.
      if (!/^\/api(\/|$)/.test(url.pathname) && env.ASSETS) return env.ASSETS.fetch(request);
      return appFor(stagingEnv(env, url.origin)).fetch(request);
    }
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
