---
name: testing-model-health-check
description: Test the magi-model-health-check monitor (index.js) end-to-end. Use when verifying model-name (MAGI_MODELS) changes or debugging MODEL NOT FOUND Telegram alerts.
---

# Testing magi-model-health-check

This Cloud Run job (`index.js`, ESM, `node-fetch`) runs monthly and Telegram-alerts when a configured
model becomes unavailable. It is the emitter of the `MAGI Model Health Check - ISSUES DETECTED` Telegram
messages (e.g. `[XAI] BALTHASAR: MODEL NOT FOUND`).

## KEY GOTCHA: it checks the /models LISTING, not a chat call
`index.js` fetches each provider's `GET /models` and tests membership:
`available.some(m => m.includes(model) || model.includes(m))` (around index.js:102-103).
So a model ID can report **NOT FOUND here even though it still works via chat/completions** as a legacy
alias (e.g. `deepseek-chat`, `grok-4-1-fast` returned HTTP 200 on chat but were dropped from `/models`).
This is why this monitor and magi-core's `health-monitor.js` (which does a live chat call) can disagree.
The model list lives in `MAGI_MODELS` at the top of `index.js` — fix model-name alerts HERE, not only in magi-core.
`main()` runs at import time (bottom of index.js).

## KEY GOTCHA: 403/billing errors vs actual MODEL NOT FOUND
Provider APIs may return HTTP 403 when credits are exhausted or spending limits are reached.
With the `!res.ok` throw guard, these now correctly report as **API ERROR** (not false "MODEL NOT FOUND").
If you see `[XAI] Error: HTTP 403` in test output, the root cause is **billing/credits**, not model deprecation.
Check xAI team billing status before assuming a model was removed.
An empty `Available:` field in the alert is a strong signal of 403/auth issues (real model listings are never empty).

## How to test (shell-only, no GUI / no recording)
1. `npm install` in the repo (only dep is `node-fetch`).
2. Fetch the 7 provider keys from Secret Manager (project `screen-share-459802`):
   `MISTRAL_API_KEY GEMINI_API_KEY GROQ_API_KEY DEEPSEEK_API_KEY TOGETHER_API_KEY QWEN_API_KEY XAI_API_KEY`.
   Use a GoogleAuth + REST fetch wrapper (gcloud CLI is NOT installed); creds file at `/home/ubuntu/gcp-key.json`.
   `google-auth-library` is not a dep here — import it from the magi-core node_modules, or run the key-fetch from the magi-core dir.
3. Write a wrapper `_run.mjs` that sets `process.env[KEY]` for all 7 keys, then `await import('./index.js')`.
   **Do NOT set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`** -> `sendTelegram()` logs `[TELEGRAM] Skipped - no credentials`
   and sends nothing (avoids spamming the prod chat).
4. Adversarial baseline: `git checkout origin/main -- index.js`, run -> expect the flagged units `-> NOT FOUND`
   and the `ISSUES DETECTED` alert text to be built.
5. Fix verification: `git checkout HEAD -- index.js` (or your branch), run -> expect those units `-> OK`,
   `[SUMMARY]` all `OK`, and `[HEALTH CHECK] All models OK` (no ISSUES alert).
6. Assert on exact console strings (e.g. `[XAI] grok-4.3 -> OK`). Clean up temp `.mjs` after.

## Testing error handling (403/auth scenarios)
When a provider returns non-200 (e.g. 403 credit exhaustion):
- **Expected with fix**: `[PROVIDER] Error: HTTP 403: {...}` and `[SUMMARY] provider: ERROR`
- **Old broken behavior**: `[PROVIDER] model -> NOT FOUND` with empty `Available:` (misleading)
- To reproduce: use an API key with exhausted credits (xAI is prone to this).
- The catch block at ~line 109 routes thrown errors to `status: "ERROR"` and alert shows `API ERROR`.

## Verifying a new model ID is valid
The monitor only accepts IDs present in the provider's `/models` listing. Before changing `MAGI_MODELS`,
confirm the new ID appears in `GET /models` for that provider. Mirror whatever magi-core actually uses.
If the API returns 403, check billing first — the model might still be valid.

## Devin Secrets Needed
All fetched from GCP Secret Manager (project `screen-share-459802`) via `/home/ubuntu/gcp-key.json`:
`MISTRAL_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `TOGETHER_API_KEY`, `QWEN_API_KEY`, `XAI_API_KEY`.
Deliberately leave `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` unset during tests.
