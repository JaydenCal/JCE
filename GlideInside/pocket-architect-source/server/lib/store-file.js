// Local JSON file store for development: the same behaviour as the in-memory store, kept in one file
// (for the Next.js site: frontend/.data/plan-studio.json). Node only. Not for production: use Upstash on Vercel.
//
// The file is re-read when it changes on disk (Next.js development reloads modules) and rewritten after every
// call that is not a plain read. Calls run one at a time, and the file is replaced by writing a temp file first.

import fs from 'node:fs';
import path from 'node:path';
import { createMemoryStore } from './store.js';

const READS = new Set(['getEntitlement', 'getEntitlementBySession', 'getEntitlementByPaymentIntent', 'findForRestore', 'listAiRequests', 'getSpend', 'listEvents']);

export function createFileStore(file) {
  const inner = createMemoryStore();
  let loadedStamp = '';
  let queue = Promise.resolve();

  const reload = () => {
    let stamp = '';
    try {
      const st = fs.statSync(file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      if (loadedStamp !== 'none') inner._load({});
      loadedStamp = 'none';
      return;
    }
    if (stamp === loadedStamp) return;
    try {
      inner._load(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch {
      inner._load({}); // an unreadable file starts a fresh store rather than breaking the site
    }
    loadedStamp = stamp;
  };

  const persist = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(inner._dump(), null, 1));
    fs.renameSync(tmp, file);
    const st = fs.statSync(file);
    loadedStamp = `${st.mtimeMs}:${st.size}`;
  };

  const store = { kind: 'file', file, _ents: undefined };
  for (const [name, fn] of Object.entries(inner)) {
    if (typeof fn !== 'function' || name.startsWith('_')) continue;
    store[name] = (...args) => {
      const run = queue.then(async () => {
        reload();
        const out = await fn.apply(inner, args);
        if (!READS.has(name)) persist();
        return out;
      });
      queue = run.catch(() => {});
      return run;
    };
  }
  return store;
}
