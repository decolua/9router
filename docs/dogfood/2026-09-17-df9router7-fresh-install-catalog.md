# DF-9ROUTER-7 re-verification — fresh-install model discovery (2026-09-17)

**Board row:** DF-9ROUTER-7 (P1, source dogfood-dagger, cycle 2026-09-13)
**Original finding:** `GET /v1/models` exposed 635 models without identifying configured or
routable entries; the first listed model failed with no active credentials, so a client could
not reliably select a working model.

**Verdict: NOT REPRODUCIBLE at HEAD `e141a786` (federation) — premise stale.**

## Why the original cycle saw it

The credential-filter fix for this lookup path landed in `672f2deb`
("fix(models): hide unconfigured providers from fresh catalog", 2026-09-11 18:56 -0500), with
the client-only-credentialless refinement in `cf61e714` (tick 361, 2026-09-17). The published
npm artifact in play during the 2026-09-13 dogfood cycle is version `0.5.75`, whose last
publish timestamp is 2026-09-10T17:12:44Z — it predates the fix, which is why a fresh-install
run still advertised the full static catalog.

## Live probe (fresh install, current tree)

Build and boot:

```
npm run build                    # BUILD_EXIT=0, BUILD_ID written 2026-09-17 12:53
DATA_DIR=/tmp/9r362-fresh PORT=20131 HOSTNAME=127.0.0.1 FEDERATION_MODE=standalone node custom-server.js
# -> Next.js 16.3.5, Ready
```

`DATA_DIR` is an empty directory: zero provider connections, no API keys.

| Probe | Result |
|---|---|
| `GET /v1/models` | `200 {"object":"list","data":[]}` — **0 models** (was 635) |
| `GET /v1/models/gpt-4o` (credential-required) | `404 model_not_found` — list/exact-model parity holds |
| `POST /v1/chat/completions` model=`gpt-4o` | `404 {"error":{"message":"No active credentials for provider: openai","code":"model_not_found"}}` |
| `GET /api/models` (dashboard surface, unauthenticated) | `401 Unauthorized` — no unauthenticated catalog exposure |

Interpretation: with nothing configured the endpoint advertises **no** model, and every
credential-required model is both absent from the list and `model_not_found` by exact lookup —
so an unusable route can no longer be presented as available, and the "first listed model
fails with no active credentials" failure mode cannot occur (the list is empty).

Regression coverage in-tree: `tests/unit/fresh-install-model-catalog-339.test.js` — 9/9 pass on
this HEAD, covering the zero-connection filter, the fail-open lookup-failure path, the
active-connection path, and list/exact-model agreement.

## Residual notes (not part of this row)

- A fresh install now lists **zero** LLM models; the dashboard renders an amber
  "OpenCode client only" badge for the one credentialless LLM provider rather than a green
  Ready badge (`cf61e714`). Onboarding guidance for a fresh install is a separate, smaller
  concern and is not tracked by DF-9ROUTER-7.
- The published artifact picks this up only at the next release; releases are human-gated in
  this fork, so a dogfood cycle run against the published package can legitimately observe
  the pre-fix behavior until then.
