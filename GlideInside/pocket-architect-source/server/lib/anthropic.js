// Anthropic Messages API over fetch (no SDK). One model call per request, with the system prompt and the
// tool definitions cached. Tool calls come back as operations for the browser to apply (docs/SCOPE.md 7.2).

import { HttpError } from './http.js';
import { ANTHROPIC_VERSION } from './config.js';
import { systemPromptFor } from '../../src/premium/ai/prompt.js';
import { checkToolCall, isCommercialContext } from '../../src/premium/ai/tools.js';

const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 1500;

const INSIDE = 'inside the indicative setback envelope';
/** The assistant must not call a design compliant. Any such wording becomes the plain envelope statement. */
export function scrubClaims(text) {
  return String(text ?? '')
    .replace(/\b(?:fully\s+)?compliant(?:\s+with\s+[^.,;:]*)?/gi, INSIDE)
    .replace(/\bcompl(?:ies|y|iance)\s+with\s+[^.,;:]*/gi, INSIDE)
    .replace(/\b(meets?|passes|satisfies)\s+(?:all\s+)?(?:the\s+)?(?:council\s+|planning\s+)?(?:setbacks?|requirements|rules|controls)\b/gi, `is ${INSIDE}`);
}

/** Keep the last turns, user first, roles alternating. */
export function cleanHistory(history) {
  const out = [];
  for (const h of Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : []) {
    const role = h?.role === 'assistant' ? 'assistant' : h?.role === 'user' ? 'user' : null;
    const content = typeof h?.content === 'string' ? h.content.trim().slice(0, MAX_HISTORY_CHARS) : '';
    if (!role || !content) continue;
    if (!out.length && role !== 'user') continue;
    if (out.length && out.at(-1).role === role) out.at(-1).content += `\n${content}`;
    else out.push({ role, content });
  }
  if (out.length && out.at(-1).role === 'user') out.pop(); // the new user turn follows
  return out;
}

/** Request body for the Messages API. `tools` is the list from buildTools(). */
export function buildRequest({ config, tools, history, context, message, activeLevelId, mode = isCommercialContext(context) ? 'commercial' : null }) {
  const toolList = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const turn = `${activeLevelId ? `Active level: ${activeLevelId}\n\n` : ''}${context}\n\nRequest: ${message}`;
  return {
    model: config.anthropicModel,
    max_tokens: config.maxOutputTokens,
    system: [{ type: 'text', text: systemPromptFor(mode), cache_control: { type: 'ephemeral' } }],
    tools: toolList,
    tool_choice: { type: 'auto' },
    messages: [...cleanHistory(history), { role: 'user', content: turn }],
  };
}

/**
 * Turn a Messages API response into { reply, ops, rejected, usage }. Text blocks form the reply. Each tool_use
 * block becomes { op, args }; unknown tool names are dropped and arguments that break the schema are rejected.
 */
export function parseResponse(data, tools) {
  const reply = [];
  const ops = [];
  const rejected = [];
  for (const block of Array.isArray(data?.content) ? data.content : []) {
    if (block.type === 'text' && block.text) reply.push(block.text.trim());
    else if (block.type === 'tool_use') {
      const check = checkToolCall(block.name, block.input, tools);
      if (check.ok) ops.push({ op: block.name, args: check.args });
      else if (!/^Unknown operation/.test(check.error)) rejected.push({ op: block.name, error: check.error });
    }
  }
  return { reply: scrubClaims(reply.join(' ').trim()), ops, rejected, usage: data?.usage || {}, stopReason: data?.stop_reason || null };
}

/** Anthropic answers an empty or unpaid account with 400 "Your credit balance is too low ..." (invalid_request_error), 402 or a billing_error. */
export function isBillingError(status, data) {
  const type = String(data?.error?.type || '');
  const msg = String(data?.error?.message || '');
  return status === 402 || type === 'billing_error' || /credit balance|billing|plans\s*&\s*billing|purchase credits|insufficient (?:credit|fund)/i.test(msg);
}

/** Call the API. Throws HttpError AI_TIMEOUT or AI_ERROR (nothing is charged for those). */
export async function callAnthropic({ config, fetchImpl, body }) {
  if (!config.anthropicApiKey) throw new HttpError('AI_ERROR', 'The assistant is not configured yet.');
  let res;
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': config.anthropicApiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(config.aiTimeoutMs) : undefined,
    });
  } catch (e) {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new HttpError('AI_TIMEOUT', 'The assistant took too long to answer. Nothing was charged. Try again.');
    throw new HttpError('AI_ERROR', 'The assistant could not be reached. Nothing was charged. Try again shortly.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    console.warn(JSON.stringify({ event: 'anthropic_error', status: res.status, type: data?.error?.type }));
    // CON-006: an empty Anthropic account is the owner's problem, not the customer's. It is shown as the paused state (503 AI_PAUSED,
    // credits untouched), never as a generic failure.
    if (isBillingError(res.status, data)) throw new HttpError('AI_PAUSED', 'The assistant is paused for now. Your credits are untouched. Try again later.');
    throw new HttpError('AI_ERROR', res.status === 429 || res.status === 529 ? 'The assistant is busy. Nothing was charged. Try again in a moment.' : 'The assistant had a problem. Nothing was charged. Try again.');
  }
  return data;
}
