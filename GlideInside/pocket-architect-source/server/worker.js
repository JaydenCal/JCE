// Cloudflare Worker entry (reference implementation): D1 for storage, Web-standard fetch for Stripe and Anthropic.
//
// Other platforms: build the same app with their own store and call app.fetch(request).
//   import { createApp } from './lib/app.js';
//   const app = createApp({ store, env: process.env });
//   export default (request) => app.fetch(request);          // Deno, Bun, Node 20+ with a Request adapter
// See server/README.md for Vercel and Netlify wrappers.

import { createApp } from './lib/app.js';
import { createD1Store } from './lib/store.js';

let cached = null;

function appFor(env) {
  if (!cached || cached.env !== env) {
    cached = {
      env,
      app: createApp({
        store: createD1Store(env.DB),
        env,
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
};
