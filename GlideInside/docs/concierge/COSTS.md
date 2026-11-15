# Concierge cost report (15/11/2026)

All figures are estimates from a stubbed model run. Prices were read from the vendors' own pages on 15/11/2026 (sources at the end). Currency: USD where a vendor quotes it, AUD at A$1.67 per US$1 (the repo's FX_AUD_PER_USD default). Nothing here was paid or activated.

## 1. What can pay for what (the question the owner asked)

| Allowance | Pays for production API calls from the Worker? | Notes |
|---|---|---|
| Claude subscription usage (Pro, Max, Ultra) in the Claude apps | No | Covers Claude on web, desktop and mobile. The Claude API is billed separately. |
| Claude Code usage allowance | No | Interactive Claude Code is explicitly not covered by the API credits, and Claude Code allowance cannot be spent on an API key used by the Worker. Use it for development only (this build used none of the Worker's API budget). |
| Anthropic Console API credits (bought, or Console promotional credits) | Yes | Only these can pay live inference from `api.anthropic.com` with a Console API key. |
| Monthly API credits included with Max, Ultra and Team plans | Yes, once claimed | See below. |

Confirmed from the docs: the owner is on Ultra, which includes US$200 a month of Claude Platform credits. They are claimed by linking a Console organisation (claude.ai, Settings, Billing, "API credits"). They then show in the Console under Billing, "Promotional credits", with amount and expiry. They cover the Claude API, Managed Agents, the Agent SDK and the playground, so **they do apply to live inference from the concierge**. They do **not** cover Claude Code or extra usage in the Claude apps. They expire at the end of each billing cycle with no rollover, are spent before any purchased credits, and do not change usage limits in Claude or Claude Code. If the organisation has no purchased credits and auto reload is off, API requests stop when the credits run out (the API returns "Your credit balance is too low to access the Anthropic API"). Each plan links to one Console organisation and the link cannot be changed by the owner afterwards, so link the organisation that will run production.

How to tell which allowance he has: claude.ai, Settings, Billing shows an "API credits" section only for eligible plans (Max, Ultra, Team). In the Console, Billing shows a "Promotional credits" balance with an expiry date. If that balance is zero or missing, the monthly credits have not been claimed yet. A subscription alone is not an API balance.

## 2. Prices used (USD per million tokens)

| Model | Input | Output | 5 minute cache write | Cache read |
|---|---|---|---|---|
| Claude Haiku 5.5 (prompt up to 100,000 tokens) | 0.10 | 0.50 | 0.125 | 0.01 |
| Claude Sonnet 5.5 | 0.625 | 6.250 | 31.25 | 18.71 |
| Workers AI llama-3.1-8b-instruct-fp8-fast | 0.045 | 0.384 | no cache | no cache |
| Workers AI llama-3.2-3b-instruct | 0.051 | 0.335 | no cache | no cache |

Minimum cacheable prompt is 512 tokens for both Claude models, and the concierge system prompt plus tools is about 1356 tokens, so caching applies. Workers AI also gives 10,000 neurons a day free (about US$0.11 a day of value at US$0.011 per 1,000 neurons).

## 3. How tokens were measured

`tools/concierge-cost.mjs` runs 10 scripted conversations through the real app (real system prompt, real knowledge block, real tool definitions, real FAQ routing) against a stubbed model that returns canned replies. Tokens are counted with the repo's estimator (characters divided by 3.5, the one the design assistant uses), which is slightly conservative for English. The first model call of each conversation is priced as a cache write (the 5 minute cache will have expired between visitors), later calls as cache reads. Questions the FAQ answers cost nothing, which is why several conversations show zero model calls.

System prompt plus knowledge plus tool definitions: **1356 tokens** (cached). Average per conversation across the 10: **1.5 model calls, 2142 prompt tokens (cached and uncached), 104 output tokens.**

| Conversation | Visitor turns | Model calls | Prompt tokens | Output tokens | Haiku 5.5 (US$) | Sonnet 5.5 (US$) |
|---|---|---|---|---|---|---|
| 1 Homeowner, FAQ only | 3 | 0 | 0 | 0 | 0.000000 | 0.000000 |
| 2 Homeowner, two model questions then books | 3 | 2 | 2840 | 142 | 0.000267 | 0.005202 |
| 3 Builder, FAQ then books | 2 | 0 | 0 | 0 | 0.000000 | 0.000000 |
| 4 Builder, one model question | 2 | 1 | 1408 | 78 | 0.000214 | 0.004274 |
| 5 Developer, FAQ and one model question | 3 | 1 | 1435 | 86 | 0.000220 | 0.004408 |
| 6 Agent, three model questions | 4 | 3 | 4294 | 239 | 0.000339 | 0.006503 |
| 7 Prompt injection attempt | 1 | 1 | 1418 | 63 | 0.000207 | 0.004144 |
| 8 Off topic chat | 2 | 2 | 2817 | 90 | 0.000239 | 0.004636 |
| 9 Long chat, six model questions | 6 | 5 | 7208 | 347 | 0.000440 | 0.008258 |
| 10 Click through booking, no questions | 1 | 0 | 0 | 0 | 0.000000 | 0.000000 |

## 4. Cost per conversation and at volume (AUD unless stated)

Per conversation (average of the 10) and the worst case for one conversation (12 model calls, the per conversation message cap, with 300 token replies):

| Option | US$ per conversation | A$ per conversation | A$ worst case, one conversation |
|---|---|---|---|
| Claude Haiku 5.5 (default) | 0.000193 | 0.00032 | 0.00446 |
| Claude Sonnet 5.5 | 0.003742 | 0.00625 | 0.08611 |
| Workers AI llama-3.1-8b-instruct-fp8-fast | 0.000137 | 0.00023 | 0.00401 |
| Deterministic only (no model) | 0.000000 | 0.00000 | 0.00000 |

At volume (average conversation mix: about 55 percent of visitor turns (15 model calls in 27 turns) are answered by the FAQ or booking logic for free):

| Option | A$ for 100 | A$ for 1,000 | A$ for 5,000 | US$ for 5,000 |
|---|---|---|---|---|
| Claude Haiku 5.5 (default) | 0.032 | 0.322 | 1.61 | 0.96 |
| Claude Sonnet 5.5 | 0.584 | 5.84 | 29.22 | 17.50 |
| Workers AI llama-3.1-8b-instruct-fp8-fast | 0.023 | 0.228 | 1.14 | 0.68 |
| Deterministic only (no model) | 0.00000 | 0.00000 | 0.00000 | 0.00 |

Reading it: Haiku 5.5 costs about three hundredths of a cent per conversation, so 5,000 conversations is about A$1.61. Sonnet 5.5 is roughly 19 times dearer (about A$31 for 5,000), with no quality need for it on a FAQ style task. Workers AI is cheaper by a few cents at this volume but needs a different integration (no Anthropic tool calling, no prompt caching, and a smaller model that I expect, but have not tested, to be weaker against prompt injection), so it saves under A$1 per 1,000 conversations and is not recommended. Deterministic only is free but cannot answer free text. The hybrid (this build) answers the common questions free and uses Haiku for the rest.

## 5. Booking and call back cost (updated 15/11/2026: owner decision, no calendar for now)

| Item | Cost | Notes |
|---|---|---|
| Calendar provider (Cal.com or Calendly) | **A$0, not used** | The default flow is "Request a call back". No calendar account is needed. The Cal.com code stays in the repository behind `BOOKING_PROVIDER=calcom` and is off. Earlier research (Cal.com free plan API access unconfirmed, Teams US$12 per user per month, Calendly free plan limit of 5 bookings per day) is kept in DESIGN.md for the day a calendar is wanted. |
| Email to the owner | **A$0 extra** | Uses the existing Resend setup of the enquiry form (`RESEND_API_KEY`, `ENQUIRY_TO`). One email per request, no email to the visitor. Resend is not priced here because the account already exists for the enquiry form. |
| Storage | **A$0 extra** | One row in the existing `jce_enquiries` table per request. |
| Cloudflare Turnstile | Free | |

The only running cost of the concierge is the model (section 4), and that is bounded by `AI_MONTHLY_BUDGET_AUD`.

## 6. Sharing the US$200 monthly credits (recommendation)

One Console organisation, linked to the Ultra plan, serves the **concierge and the existing assistants (residential design assistant, commercial assistant and portal assistant) together**, because every key and workspace in the linked organisation draws from the same balance.

| Pool | Setting | Monthly ceiling | Notes |
|---|---|---|---|
| Existing assistants (design, commercial, portal) | `AI_MONTHLY_CAP_USD` (existing, default 50) | US$100 (recommended to raise from 50 only when real demand needs it) | Their own daily cap `AI_DAILY_CAP_USD` still applies |
| Concierge | `AI_MONTHLY_BUDGET_AUD` (new) | A$100 (about US$60) | Expected real use is under A$5 a month, so this is a ceiling, not a forecast |
| Margin | not spent | about US$40 (20 percent) | Absorbs the billing cycle versus calendar month mismatch, retries and price changes |
| Total | | US$200 | The Ultra monthly credit |

Today's safe starting point is the shipped default for the existing pool (US$50) plus `AI_MONTHLY_BUDGET_AUD=50` (about US$30), a combined ceiling of US$80 of the US$200. Raise either only when real usage justifies it. The numbers only guarantee the split if both counters are respected: the two counters are separate (existing: `m:YYYY-MM` spend rows; concierge: `cc:m:YYYY-MM`), each reset on the 1st of the UTC month, while Anthropic credits refresh on the billing cycle, which is why a margin is kept.

Operating rules:
- Keep **auto reload OFF** in the Console, and do not add a payment method for this organisation. Then the credits are a hard wall: when they run out, API calls fail instead of billing the card.
- The concierge treats Anthropic's "credit balance is too low" response as a **hard stop**: it records an exhausted marker for the rest of the UTC day, stops calling the model, and serves deterministic answers (FAQ, booking, enquiry form) until the next day, when one probe call checks again. Booking keeps working with no AI.
- The existing assistants map the same API error to their generic AI error today. **PROPOSED enhancement** (not changed in this build, because their code is owned by other work): make them treat the credit error as `AI_PAUSED` too.
- Set a Console workspace spend limit for the concierge key as a second wall (Anthropic documents workspace limits), for example US$40 a month.
- Credits expire each cycle with no rollover, so unused credit is not banked. There is no reason to throttle the concierge below its need.

## 7. Assumptions (labelled)

1. Token counts use characters / 3.5, not the real tokenizer (no key was available to call the token counting endpoint). Real counts will differ by about plus or minus 15 percent.
2. Replies are 160 to 320 characters, about 45 to 90 tokens. Output is capped at 300 tokens.
3. Cache: first call of each conversation is a cache write, later calls are reads. If visitors arrive faster than every 5 minutes the real cost is slightly lower.
4. Conversation mix is the 10 scripted ones. Real visitors may ask more free text questions. The per conversation message cap (12) and the monthly ceiling bound the worst case.
5. FX A$1.67 per US$1.
6. No calendar cost is included: the default flow is a call back request (section 5).
7. No batch discount, no fast mode.

## Sources

- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Prompt caching minimums: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- API credits for Max, Ultra and Team: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers and https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans
- Credit terms: https://www.anthropic.com/legal/credit-terms
- Subscription versus API billing: https://support.claude.com/en/articles/9876003-i-have-a-paid-claude-subscription-why-do-i-need-to-pay-separately-for-api-usage
- Cloudflare Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Cal.com pricing: https://cal.com/pricing and API intro https://cal.com/docs/api-reference/v2/introduction
- Calendly Scheduling API: https://developer.calendly.com/api-docs/calendly-api/scheduled-events/create-event-invitee and the Free plan announcement https://community.calendly.com/developer-faq-62/scheduling-api-post-invitees-and-webhooks-now-available-on-the-free-plan-6162


Note 15/11/2026: figures refreshed after the call back change (the system prompt grew by about 130 tokens for the no promise rules, and the model sees two tools in the default flow instead of three). Worst case column is scaled by 1.09 from the earlier measurement, not re-simulated.
