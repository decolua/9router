---
name: 9router-combos
description: >-
  How to build and drive 9router model COMBOS as a user: create a chain, use
  the combo name as a model id, choose fallback / round-robin / fusion strategy,
  nest combos, restrict an API key to one combo, and read the failover logs.
  Use when a task touches "combo", "auto-fallback", "model chain", "round
  robin", "fusion panel", per-key model restriction, or when a combo answers
  503 and you need to know which seat actually failed.
version: 1.0.0
---

# 9router — combos (model chains) end to end

Verified 2026-10-23 against a live instance (`/api/version` 0.5.99) and HEAD
`9e50cba4`. Companion to `skills/9router` (core gateway) and
`skills/9router-token-saving-and-accounting-usage` (accounting).

## What a combo is

A named list of models. The **name is a model id**: once created you send
`{"model":"my-chain"}` to `/v1/chat/completions` exactly as if it were a
provider model. Combos appear in `/v1/models` with `owned_by:"combo"`, so any
CLI that lists models can find them.

## Create and use (the whole loop)

```bash
H=http://localhost:20128
# 1. create (dashboard equivalent: Dashboard → Combos → Create New)
curl -s -X POST $H/api/combos -H 'Content-Type: application/json' \
  -d '{"name":"my-chain","models":["ocg/glm-5.3-flash","gemini/gemini-3.5-flash-lite"]}'
#    name charset: [a-zA-Z0-9_.-]; duplicate names are refused with 400

# 2. confirm it is visible to clients
curl -s $H/v1/models -H "Authorization: Bearer $KEY" | jq -r '.data[]|select(.owned_by=="combo")|.id'

# 3. use it — the combo name IS the model
curl -s $H/v1/chat/completions -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"my-chain","messages":[{"role":"user","content":"hi"}],"max_tokens":20}'
```

Strategies (per combo, `settings.comboStrategies[<combo name>].fallbackStrategy`,
default `settings.comboStrategy` = `fallback`):

- **fallback** — tries seats in order, next on failure. The normal choice.
- **round-robin** — rotates the starting seat per request (`comboStickyRoundRobinLimit`
  / `stickyRoundRobinLimit` control stickiness). Verified: with 2 dead + 1 live
  seat, 4/4 requests still returned 200 because a rotation that lands on a dead
  seat falls through to the next one.
- **fusion** — queries every seat in parallel and a judge model synthesizes one
  answer. Bills N+1 calls; only worth it when N seats are healthy.

Set the strategy through the dashboard `<select>` on the combo card (persists
immediately) or by PATCHing settings. Editing a combo's models/name resets its
rotation state on purpose.

**Nesting:** a combo name is a valid seat of another combo. Verified working
(`outer -> [inner, gemini/…]` answered 200).

## What the runtime does that the card doesn't say

- `reorderByCapabilities()` **stably reorders** seats so the ones that satisfy
  the request's hard modalities (vision/pdf/audio/video input) go first. It never
  drops a seat, so fallback stays whole — but the seat that answers may not be the
  one you listed first when the request carries an image.
- A **failed seat gets locked**, and later requests skip it entirely. Consequence
  a user feels: the FIRST request after a lane dies is slow (measured 7.64s with
  two dead seats), subsequent ones are fast (0.89-1.42s). Don't profile the first
  call and call the combo slow.
- Streaming through a combo is clean: the SSE chunks name the **resolved seat**
  in `model`, and exactly one `data: [DONE]` is emitted.
- An **all-seats-fail** combo answers fast (8ms) but the error names only the
  LAST seat's raw upstream message (open row DF-9ROUTER-65). To find which seat
  really broke, read the server log: `docker logs <container> | grep '\[COMBO\]'`.

## Restricting an API key to a combo

`POST /api/keys` only takes `{name}`; the access list is set with a separate PUT
(undocumented in README — open row DF-9ROUTER-66):

```bash
curl -s -X PUT $H/api/keys/<key-id> -H 'Content-Type: application/json' \
  -d '{"access":{"restricted":true,"allow":["my-chain","gemini/gemini-3.5-flash-lite"]}}'
```

An allowed combo grants the members it routes to (verified: combo call 200,
direct model call 403). The deny body is `type:"permission_error"` but
`code:"insufficient_quota"` — branch on the HTTP 403, not the code.

## Pitfalls that will waste your afternoon

1. **Don't test a combo against dead lanes and call the feature broken.** Check
   `GET /api/providers` first — `testStatus:"unavailable"` plus a `lastError`
   tells you the seat is already dead before your probe touches it.
2. **A combo of dead seats is indistinguishable from a broken combo** unless you
   read `[COMBO] Trying model N/M` in the container log.
3. **`ctx 1M · max 384k` on the card is synthesized from the widest seat** — it is
   not a guarantee for every seat in the chain.
4. **Usage/cost of a combo request is attributed to the seat that served it**
   (correct), but for gemini-format providers the ledger records a ~1000x
   UNDER-estimate of prompt tokens while the response reports the upstream count
   (open row DF-9ROUTER-39-R2). Do not trust `/api/usage/stats` cost for gemini
   traffic until that row closes — compare against the response's own `.usage`.
