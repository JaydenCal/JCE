#!/usr/bin/env node
// Live smoke test for the Pocket Architect AI assistant, run by the owner with his own key. Calls Anthropic directly, no Worker, no D1.
//
// USAGE (from the repo root):
//   ANTHROPIC_API_KEY=sk-ant-... node server/test/ai-live-smoke.mjs
//   optional: AI_MODEL=claude-haiku-5-5  AI_MAX_TOKENS=1024  PRICE_IN=1 PRICE_OUT=5   (US$ per million tokens, check the Anthropic pricing page)
// Uses the same system prompt, tools (server/ai/tools.json), request builder and reply parser as the Worker (imported from server/ai.js).
// Sends 5 realistic prompts about a saved template project, validates every returned edit against tools.json, and prints edits, tokens,
// credits and an estimated US$ cost. Expected total cost: a few US cents. Nothing is written anywhere.
import fs from "node:fs"; import { loadConfig, cleanBody, buildUpstream, parseReply, creditsFor, weightedTokens, estimate } from "../ai.js";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error("Set ANTHROPIC_API_KEY first. Usage: ANTHROPIC_API_KEY=sk-ant-... node server/test/ai-live-smoke.mjs"); process.exit(2); }
const fx = JSON.parse(fs.readFileSync(new URL("./fixtures/ai-plan-4bed.json", import.meta.url), "utf8"));
const cfg = loadConfig(process.env);
const PRICE = { in: +process.env.PRICE_IN || 1, out: +process.env.PRICE_OUT || 5 }; // ASSUMED: US$ per million tokens. Confirm for the model you set.
const usd = (u) => ((u.input_tokens || 0) * PRICE.in + (u.cache_creation_input_tokens || 0) * PRICE.in * 1.25 + (u.cache_read_input_tokens || 0) * PRICE.in * 0.1 + (u.output_tokens || 0) * PRICE.out) / 1e6;
const prompts = [
  "Add a 3 x 4 m study on the east side",
  "Make the Master bedroom 600 mm wider",
  "Change the roof colour to charcoal",
  "Flip the plan left to right",
  "Mark the garage as existing and the rest as new",
];
console.log(`model ${cfg.model}  context ${fx.context.length} chars  tools ${cfg.tools.length}  assumed price US$${PRICE.in}/US$${PRICE.out} per Mtok\n`);
const tot = { usd: 0, credits: 0, calls: 0, bad: 0 };
for (const message of prompts) {
  const body = cleanBody({ message, context: fx.context, history: [], activeLevelId: fx.activeLevelId }, cfg);
  const est = estimate(body, cfg), t0 = Date.now();
  const r = await fetch(`${cfg.base}/v1/messages`, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(buildUpstream(body, cfg)) });
  const j = await r.json().catch(() => ({}));
  console.log(`> ${message}`);
  if (!r.ok) { console.log(`  HTTP ${r.status}: ${j?.error?.type || ""} ${j?.error?.message || ""}\n`); tot.bad++; continue; }
  const out = parseReply(j, cfg), u = j.usage || {}, credits = creditsFor(u, cfg), cost = usd(u);
  console.log(`  reply: ${out.reply || "(none)"}`);
  for (const o of out.ops) console.log(`  edit:  ${o.op} ${JSON.stringify(o.args)}`);
  for (const x of out.rejected) console.log(`  REJECTED: ${x.op}: ${x.error}`);
  console.log(`  tokens: input ${u.input_tokens} cache-write ${u.cache_creation_input_tokens || 0} cache-read ${u.cache_read_input_tokens || 0} output ${u.output_tokens}   weighted ${Math.round(weightedTokens(u, cfg))}`);
  console.log(`  credits: ${credits} charged (pre-call estimate ${est.expected}, reservation ${est.worst})   cost ~US$${cost.toFixed(4)}   ${Date.now() - t0} ms\n`);
  tot.usd += cost; tot.credits += credits; tot.calls++; tot.bad += out.rejected.length + (out.ops.length || /\?/.test(out.reply) ? 0 : 1);
}
console.log(`TOTAL ${tot.calls}/${prompts.length} calls, ${tot.credits} credits, ~US$${tot.usd.toFixed(4)} (about US$${(tot.usd / Math.max(1, tot.calls)).toFixed(4)} per request; a 500 credit pack at this rate is ${Math.floor(500 / Math.max(1, tot.credits / Math.max(1, tot.calls)))} requests)`);
console.log(tot.bad ? `CHECK: ${tot.bad} prompt(s) returned an error, a rejected edit, or no edit and no question. Read the lines above.` : "OK: every prompt returned valid edits that match tools.json.");
process.exit(tot.bad ? 1 : 0);
