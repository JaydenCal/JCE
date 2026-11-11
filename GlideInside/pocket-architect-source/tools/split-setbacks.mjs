// Splits setbacks-data/setback-rules.json (about 5 MB, 128 councils) into small static files the app loads on demand:
//   <out>/index.json      { meta, councils: [{ lga_slug, council, lgaNames, fallbackSet, status, bytes }] }
//   <out>/fallbacks.json  { NSW, NSW_INLAND, QLD }  (Housing Code, Inland Code, QDC MP1.1)
//   <out>/<lga_slug>.json one council with its rules
// Usage: node tools/split-setbacks.mjs [--out website-live/plan-studio/data/setbacks]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? resolve(process.argv[outArg + 1]) : resolve(root, '../website-live/plan-studio/data/setbacks');
const src = resolve(root, '../setbacks-data/setback-rules.json');
const all = JSON.parse(readFileSync(src, 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const index = [];
let total = 0;
for (const c of all.councils) {
  if (!/^[a-z0-9-]+$/.test(c.lga_slug)) throw new Error(`unsafe slug ${c.lga_slug}`);
  const text = JSON.stringify(c);
  writeFileSync(resolve(out, `${c.lga_slug}.json`), text);
  total += text.length;
  index.push({ lga_slug: c.lga_slug, council: c.council, lgaNames: c.lgaNames || [], fallbackSet: c.fallbackSet || null, status: c.status || null, bytes: text.length });
}
writeFileSync(resolve(out, 'index.json'), JSON.stringify({ meta: { generated: all.meta?.generated || null, councilCount: all.councils.length }, councils: index }));
writeFileSync(resolve(out, 'fallbacks.json'), JSON.stringify(all.fallbacks));
console.log(`wrote ${index.length} council files (${(total / 1e6).toFixed(2)} MB), index.json and fallbacks.json to ${out}`);
