# Kiro native-credit cache estimates

Kiro cache simulation estimates cache reads from native-credit observations when
Kiro does not report cache-token metrics. The existing 90% bound covers
proven prefix reuse while dynamic calibration is still gathering observations.

## Prefix reuse and calibration

`open-sse/services/kiroCreditCache.js` canonicalizes the outbound request and hashes
an ordered ladder of tools and message prefixes. Current and historical user
wrappers share a canonical form, allowing append-only conversations to reuse an
observed prefix. Text, images, tool arguments, ordering, continuation ID and other
model-visible configuration remain significant; volatile text is not stripped to
manufacture reuse. Prefix token weights approximate serialized characters / 4.

A reuse index records successfully observed prefix fingerprints and their expiry.
Calibration compares native credits per total token for matching prefixes and
inference configuration, so cold and warm calls may have different output lengths.
Each call uses its own valid total token count, with a validated input-plus-output
fallback. Late input estimation refreshes the total before recording an observation.
Missing or invalid normalization data cannot train billing pairs.

With fewer than two valid pairs, the existing `LIMIT.maxSavings` ratio (0.9)
applies only to canonically matched, unexpired prefixes. Cold requests and changed scopes receive
no fallback. Once two valid pairs exist, dynamic calibration takes precedence,
including a legitimate zero; it never falls back merely because savings are zero.
The lowest observed cold density is retained. The dynamic estimate selects the
lowest credit-savings fraction among the last eight unexpired pairs, capped at 90%.
Cached input still incurs credits, so credit savings are converted to inferred
reuse with `reuse = clamp(credit_savings / (1 - d), 0, 1)`: GPT uses `d = 0.523`,
and Claude uses `d = 0.525`. This conversion applies only after two valid pairs;
it does not alter startup fallback or turn zero savings into positive reuse.

Inferred reuse is weighted by the canonical matched prefix's share of input. Thus
calibrated reads can exceed 90% but never exceed that structural bound. Policies
without a discount retain their raw-savings behavior; unknown models remain
estimator-disabled. The family constants are fixed modeling assumptions, not
provider-reported cache measurements. Total-token normalization and differing
input/output costs can bias the inference; model/traffic variation is not modeled,
and an exact cache-hit rate is not guaranteed.

The estimate is frozen before the upstream request. A later successful observation
can affect subsequent requests, but cannot change that request's frozen estimate.
Positive estimates populate existing cache-read usage fields in Chat Completions,
Responses and Messages, for JSON and SSE. Explicit native cache fields, including
zero, take precedence. Cache creation is never invented from credits. OpenAI input
counts include cached tokens; Messages input counts exclude them to avoid double
counting. Existing public `kiro_credits` and `kiro_credit_unit` serialization is
preserved; estimator and delivery metadata stay private.

## Family policy and isolated state

| Family | Sliding prefix window | Minimum prefix | Conversation isolation |
| --- | --- | --- | --- |
| Claude, including Opus/Sonnet/Haiku forms | 5 minutes | 4,096 tokens | No |
| GPT, including Sol/Terra/Luna codenames | 30 minutes | 1,024 tokens | Required; a different conversation starts cold |

`open-sse/config/kiroConstants.js` classifies clear family names across versions,
case and supported separator/namespace forms. Unknown or conflicting families are
disabled. Recognizing a codename's family does not create a model-routing alias.

Shared family policy does **not** mean shared calibration: state is isolated by the
original native model ID, account or credential identity, API key, principal/profile,
endpoint and inference configuration, with conversation ID added for GPT. Model ID
normalization selects policy only; distinct native IDs retain separate state.

## Successful delivery and limits

Learning requires a complete successful native event stream, valid positive metering
and successful HTTP delivery of the selected response. Parse/CRC/terminal failures,
truncation, aborted or failed writes, retries, fallbacks and internal side generations
cannot train calibration. Overlapping requests may renew exact prefixes after
successful delivery, but cannot train billing pairs. Completion is idempotent.

Prefix warmth expires relative to request start and is renewed only on success.
Calibration samples and pairs expire after 30 minutes. State is process-local, resets
on restart, and is bounded to 1,024 scopes globally, 32 per account, 256 prefixes and
64 cold samples per scope, and eight recent pairs. Stored state contains hashes and
numeric observations, not prompts or credentials.

Learning requires the `custom-server.js` HTTP delivery hook used by `npm start` and
the standalone wrapper. Hosts without that hook retain normal usage but do not
learn. HTTP finish confirms local writes, not remote application acknowledgement.
Estimates are not provider-reported measurements, guaranteed retention or a
distributed cache tracker.

Regression coverage is in `kiro-credit-cache.test.js`, `kiro-credit-delivery.test.js`,
`kiro-credit-protocols.test.js` and `kiro-credit-http.test.js` under `tests/unit/`.
