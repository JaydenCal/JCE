import test from 'node:test';
import assert from 'node:assert/strict';
import { reskin } from '../tools/reskin-subdivision.mjs';

const MID = '\n<main id="x"><h1 class="keep">Subdivision &amp; demo</h1>\r\n<script>var a = "<footer>not real</footer>".length;</script></main>\n';
const sample = `<!doctype html><html><head><meta charset="utf-8"><title>S</title><style>body{margin:0}</style></head><body class="b">
<header class="old-head"><nav>old</nav></header>${MID}<footer class="old"><p>ABN 12 345 678 901</p></footer>
<script>window.x=1</script></body></html>`;
const H = '<header class="gi-head">H</header>';
const F = '<footer class="gi-foot">F ABN 29 699 165 663</footer>';

test('replaces the header and footer and keeps everything else byte for byte', () => {
  const { html, notes } = reskin(sample, { header: H, footer: F });
  assert.ok(html.includes(H) && html.includes(F));
  assert.ok(!html.includes('old-head') && !html.includes('class="old"'));
  assert.ok(html.includes(MID.replace('<footer>not real</footer>', '<footer>not real</footer>')));
  assert.ok(html.includes('<script>window.x=1</script></body>'));
  assert.equal(html.match(/gi-chrome\.css/g).length, 1);
  assert.ok(notes.some((n) => /ABN/.test(n)) === false);
});

test('idempotent: a second run changes nothing', () => {
  const a = reskin(sample, { header: H, footer: F }).html;
  const b = reskin(a, { header: H, footer: F }).html;
  assert.equal(b, a);
});

test('footer replaced is the last <footer>, not text inside a script', () => {
  const { html } = reskin(sample, { header: H, footer: F });
  assert.ok(html.includes('"<footer>not real</footer>".length'));
});

test('page with no header or footer gets both inserted; a nav near the top counts as the header', () => {
  const bare = '<html><head></head><body><nav>top</nav><p>hi</p></body></html>';
  const { html, notes } = reskin(bare, { header: H, footer: F });
  assert.ok(html.includes(H) && html.includes(F) && !html.includes('<nav>top</nav>') && html.includes('<p>hi</p>'));
  assert.equal(notes.length >= 3, true);
});

test('another ABN elsewhere in the page is reported, not edited', () => {
  const s = sample.replace('<h1 class="keep">', '<h1 class="keep">ABN 99 888 777 666 ');
  const { html, notes } = reskin(s, { header: H, footer: F });
  assert.ok(html.includes('ABN 99 888 777 666'));
  assert.ok(notes.some((n) => /WARNING other ABN/.test(n)));
});

test('the shipped snippets carry the right entity and no unscoped class', async () => {
  const { reskin: r } = await import('../tools/reskin-subdivision.mjs');
  const { html } = r('<html><head></head><body></body></html>');
  assert.ok(html.includes('JCE Infrastructure Pty Ltd trading as Glide Inside, ABN 29 699 165 663'));
  for (const c of html.match(/class="[^"]+"/g)) assert.ok(c.slice(7, -1).split(' ').every((k) => k.startsWith('gi-')), c);
});
