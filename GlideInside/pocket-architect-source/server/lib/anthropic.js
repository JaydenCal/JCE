// Anthropic Messages API over fetch (no SDK). One model call per request, with the system prompt and the
// tool definitions cached. Tool calls come back as operations for the browser to apply (docs/SCOPE.md 7.2).

import { HttpError } from './http.js';
import { ANTHROPIC_VERSION } from './config.js';
import { SYSTEM_PROMPT } from '../../src/premium/ai/prompt.js';
import { checkToolCall } from '../../src/premium/ai/tools.js';

const MAX_HISTORY_MESSAGES = 8;
const MAX_HISTORY_CHARS = 1500;

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
export function buildRequest({ config, tools, history, context, message, activeLevelId }) {
  const toolList = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t));
  const turn = `${activeLevelId ? `Active level: ${activeLevelId}\n\n` : ''}${context}\n\nRequest: ${message}`;
  return {
    model: config.anthropicModel,
    max_tokens: config.maxOutputTokens,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
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
  return { reply: reply.join(' ').trim(), ops, rejected, usage: data?.usage || {}, stopReason: data?.stop_reason || null };
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
    throw new HttpError('AI_ERROR', res.status === 429 || res.status === 529 ? 'The assistant is busy. Nothing was charged. Try again in a moment.' : 'The assistant had a problem. Nothing was charged. Try again.');
  }
  return data;
}
