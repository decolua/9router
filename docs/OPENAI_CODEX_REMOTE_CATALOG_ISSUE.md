## Problem

9Router already has two provider-scoped authoritative catalog paths in
`src/app/api/providers/[id]/models/route.js`:

- OpenAI API-key connections fetch the documented
  `https://api.openai.com/v1/models` endpoint.
- Codex OAuth connections fetch 9Router's existing authenticated ChatGPT Codex
  catalog endpoint and normalize review variants.

The client-facing `src/app/api/v1/models/route.js` does not reuse either path.
Its `LIVE_MODEL_RESOLVERS` allowlist covers Kiro, Qoder, Kimchi, GitHub,
ClinePass, and Grok CLI, while OpenAI and Codex fall back to the static registry.
As a result, the provider detail page can show a current per-connection catalog
while `/v1/models`, Combo selection, and downstream clients see stale or
unavailable entries.

This is especially visible when an account gains or loses a model between
9Router releases. Static model names should remain a resilient fallback, not
the primary truth when an authenticated provider catalog is available.

## Why this is not a duplicate

- #2552 asks for a manual dashboard refresh/update control.
- #2645 fixes discovery for generic OpenAI-compatible nodes.
- #2459 parallelizes existing live resolvers.
- #2242 adds capability metadata and Combo aggregation.
- #1908 asks for a Codex-specific `{ "models": [...] }` response schema.

This proposal is narrower: make the existing provider-scoped OpenAI and Codex
remote catalogs the source for callable IDs in the standard 9Router
`{ "object": "list", "data": [...] }` response. It can compose with those
changes without replacing their schema, performance, or capability work.

## Proposed behavior

1. Extract the authenticated catalog fetch/parse logic from the dashboard route
   into a server-only service shared by provider detail and `/v1/models`.
2. Resolve each active connection independently; never share one account's
   bearer token, catalog response, or cache entry with another connection.
3. Cache successful normalized results for a short bounded TTL keyed by provider
   and connection ID. Deduplicate only after applying the connection's public
   provider prefix.
4. On timeout, auth failure, malformed data, or an empty catalog, retain the
   static registry for that connection and emit a diagnostic warning. Do not
   turn catalog refresh into an inference outage.
5. Preserve the upstream model ID as the callable physical model. Do not invent
   a representative model for a Combo or leak connection/provider credentials.
6. Feed remote capability metadata into `/v1/models` only after validating its
   shape; otherwise use the existing conservative capability floor.
7. Run independent catalog requests concurrently with bounded per-provider
   deadlines, preserving deterministic output ordering.

## Acceptance tests

- An OpenAI connection whose remote catalog contains `provider/model-a` exposes
  the correctly prefixed callable ID without editing a static registry.
- A Codex connection exposes only IDs returned for that authenticated account,
  plus deterministic 9Router review aliases where supported.
- Two connections with different entitlements do not contaminate each other's
  cache or results.
- A remote 401/403, timeout, malformed body, or empty list falls back to the
  static catalog without failing `/v1/models`.
- Disabled models and inactive connections remain excluded.
- No access token, connection ID, raw membership list, or upstream response is
  included in the public response or validator.
- Output ordering and ETag are deterministic for identical public state.

## Codex client boundary

This improves 9Router's catalog truth but cannot by itself guarantee a model
picker in Codex Desktop. OpenAI tracks custom-provider picker/discovery support
in [openai/codex#10867](https://github.com/openai/codex/issues/10867). That issue
remains the authoritative client-side boundary even if some Desktop builds now
appear improved. Likewise, #1908 covers Codex's richer `{ "models": [...] }`
catalog schema. Do not change the standard OpenAI-compatible `/v1/models` shape
or claim Desktop parity as part of this server-side issue.

## Suggested PR split

1. Shared provider-scoped catalog service plus OpenAI/Codex resolver tests.
2. Wire the service into `/v1/models` with isolated caches and fail-open static
   fallback.
3. Separately address #1908 after Codex's remote catalog contract is confirmed
   against current official source and client tests.
