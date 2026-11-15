// Local preview of the concierge for screenshots and manual checks. Serves website-live and the real /api/concierge routes on one origin.
// Mock calendar, stubbed model (no network, no key, no real booking). site.config.js is served with conciergeEnabled switched on.
//   node tools/concierge-dev-server.mjs [port]      env: CALENDAR=1 switches the mock calendar on (default is the call back flow only), RESEND=0 leaves email unconfigured, OFF=1 turns the Worker flag off (shows the non-AI fallback), TURNSTILE=1 serves a stub Turnstile and requires a token; SLOW=1 makes confirm time out once
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/lib/app.js';
import { createMemoryStore } from '../server/lib/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../website-live');
const port = Number(process.argv[2]) || 8741;
const origin = `http://127.0.0.1:${port}`;
const T = () => Date.now();
const env = {
  CONCIERGE_IP_PER_MIN: '500', CONCIERGE_IP_CONFIRMS_PER_HOUR: '50', CONCIERGE_IP_SESSIONS_PER_HOUR: '50', // preview only: one machine plays every visitor
  SITE_URL: origin, ENTITLEMENT_SECRET: 'dev-secret', ANTHROPIC_API_KEY: 'sk-dev', CONCIERGE_ENABLED: process.env.OFF ? '' : '1', CONCIERGE_ALLOW_MOCK: '1', CONCIERGE_IP_CALLBACKS_PER_HOUR: '200', RESEND_API_KEY: process.env.RESEND === '0' ? '' : 're_dev', ENQUIRY_TO: 'owner@example.test',
  ...(process.env.CALENDAR ? {} : { BOOKING_PROVIDER: 'calcom' }), // calcom with no key: no calendar at all, the call back flow only
  CONCIERGE_APPROVED_TYPES: process.env.TYPES ?? 'homeowner,builder,developer,agent', AI_MONTHLY_BUDGET_AUD: process.env.BUDGET ?? '5',
  ...(process.env.TURNSTILE ? { TURNSTILE_SECRET_KEY: 'dev-ts', TURNSTILE_SITE_KEY: '1x00000000000000000000AA' } : {}),
};
const MAIL = []; // what would have been emailed to the owner (never sent)
const fetchImpl = async (url, init) => {
  if (String(url).includes('anthropic.com')) {
    const msg = JSON.parse(init.body).messages[0].content;
    const text = /loft/i.test(msg) ? 'The site does not mention lofts, so I am not sure. You can ask the team through the enquiry form.' : 'I can help with questions about what Glide Inside does. Would you like to request a call back?';
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 1100, output_tokens: 40 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url) === 'https://api.resend.com/emails') { const m = JSON.parse(init.body); MAIL.push({ to: m.to, reply_to: m.reply_to, subject: m.subject, text: m.text }); return new Response(JSON.stringify({ id: 'em_dev' }), { status: 200 }); }
  if (String(url).includes('challenges.cloudflare.com')) return new Response(JSON.stringify({ success: JSON.parse(init.body).response === 'dev-ok' }), { status: 200 });
  throw new Error(`blocked fetch ${url}`);
};
const store = createMemoryStore();
const app = createApp({ store, env, fetchImpl, now: T });
if (process.env.SLOW && app.concierge.provider) app.concierge.provider.failNext('timeout', { created: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json' };
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, origin);
    if (u.pathname === '/__dev/mail') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ mail: MAIL, saved: await store.listEnquiries() })); }
    if (u.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await app.handle(new Request(u, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }));
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    let body = fs.readFileSync(file);
    if (p === '/site.config.js') body = Buffer.from(body.toString().replace('conciergeEnabled: false', 'conciergeEnabled: true').replace(/ga4Id: "[^"]*"/, 'ga4Id: "G-TEST000000"'));
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e?.stack || e)); }
}).listen(port, '127.0.0.1', () => console.log(`concierge preview on ${origin}`));
