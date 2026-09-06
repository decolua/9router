# Kiro native-credit cache estimates

Design reference: `sub2api-kiro-enhanced` commit
`68603603d603ae39f08d872b5db6699b75ce2d6c`, especially the README estimator
scope/window policy, `backend/internal/service/kiro_dynamic_cache.go`,
`kiro_cache_emulation*.go`, and the native translator/integrity paths.
This is a JavaScript integration with 9router's existing pipeline, not an import
of the source gateway, administration, deployment, or fixed-ratio simulation.

## Feature mapping

| Source feature | 9router implementation |
| --- | --- |
| Canonical prefix ladder | `open-sse/services/kiroCreditCache.js`: hash ordered outbound tools and messages; normalize current/history wrappers; retain continuation and model-visible configuration |
| Native-credit calibration | Same module: compare cold/warm credits for a matching prefix, inference configuration and output count; require two pairs; use the lower envelope of the last eight pairs |
| Account/endpoint/model scope | Hash connection identity (credential identity if absent), API key, principal/profile, endpoint, native model and inference configuration |
| Model windows | `open-sse/config/kiroConstants.js`: Opus 5, five minutes; GPT-5.6 Terra, thirty minutes plus conversation ID |
| Commit only successful observations | `kiroCacheDelivery.js`, `chatCore.js`, outer `src/sse/handlers/chat.js`, and `custom-server.js`: select the final response, then commit on successful HTTP finish; discard on errors/close |
| Native stream integrity | Reuse KiroExecutor's CRC, framing, EOF, terminal and tool validation; exclude malformed/dropped events and truncation from learning without discarding otherwise usable output |
| Fallback and side-generation isolation | Freeze before fetch; exclude HTTP/transport retries, token-refresh retries and integrity repair; only the response selected by the outer router can commit |
| Protocol usage | Reuse existing usage names; nested OpenAI input is cache-inclusive, Anthropic input excludes cache. Preserve explicit native cache metrics (including zero) and existing public credit serialization |

Auth-surface ordering/profile routing, stable session/continuation resolution,
session-start replay, account selection and the Responses request/tool adapters
were already present and remain in use. Account selection has its existing sticky
round-robin policy, not a new conversation-to-account affinity map. Actual account
identity scopes every observation, so rotation cannot reuse another account's state.
The necessary response gaps fixed here are Kiro JSON conversion to Messages and
Responses, and missing Kiro Responses SSE usage. JSON parser errors no longer embed
raw payload excerpts. Existing typed/sized native integrity diagnostics remain.

## Accounting and lifetime

No cache savings are inferred without comparable successful observations. A credit
reduction supplies a conservative savings fraction: appended uncached input and
output cost remain in the warm bill. The 90% bound is a ceiling, not an assigned
ratio. Two pairs are required before a later request uses the frozen estimate;
adverse evidence affects subsequent requests. Cache creation is never invented
from credits. Explicit native cache fields, including zero, override estimates.

Sliding warmth is renewed only by successful observations and expires relative to
request start, conservatively excluding very long generations. Calibration samples
expire after thirty minutes. Overlapping requests can renew exact prefixes after
successful delivery but cannot train cold/warm billing pairs. No asynchronous work
occurs within tracker mutations. Each completion is idempotent.

Limits: 1,024 scopes globally, 32 per account, 256 prefixes and 64 cold samples per
scope, eight recent pairs. New scopes are rejected at capacity rather than evicting
another account's warmth. Stored state contains hashes, counts, credits and expiry
times, not prompts or credentials. Calibration/fingerprint/delivery metadata never
enters response JSON, SSE, headers or usage logs. Existing `kiro_credits` and
`kiro_credit_unit` behavior is retained.

## Limits and verification

- Only native `claude-opus-5` and `gpt-5.6-terra` are eligible, matching the pinned
  reference; aliases resolving to them work. Sol, Luna and other models do not learn.
- Estimates are process-local and reset on restart. They are not provider-reported
  cache measurements, guaranteed retention, or a distributed cache tracker.
- Prefix weights use 9router's existing approximate character/token convention.
  Canonical strings, images, tool arguments and ordering remain significant.
- Conversation ID alone does not isolate Opus. Changing continuation, time context,
  tools, model-visible configuration or text can still make its prefix cold. Nothing
  strips model-visible text to manufacture reuse across sessions.
- Learning requires the `custom-server.js` HTTP delivery hook (`npm start` and the
  standalone wrapper). Bare `next dev`, bare `next start`, or another host without
  that hook retain normal usage but do not learn. HTTP finish confirms local writes,
  not application-level acknowledgement by a remote client.
- Discarded or synthesized response objects cannot commit; internal probes and
  web-search/fusion generations cannot update the final response's observation.
- No live Kiro/AWS requests were used for validation. Native EventStream fixtures
  with valid CRCs exercise the real executor, translators and chatCore; local HTTP
  socket tests verify successful finish, client disconnect, write error and HTTP error.

Focused regression suites: `kiro-credit-cache.test.js`,
`kiro-credit-delivery.test.js`, `kiro-credit-protocols.test.js`, and
`kiro-credit-http.test.js`. Existing Kiro, cache accounting, Responses, base retry,
session, custom-server and standalone tests provide compatibility coverage.
