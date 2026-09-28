# Model sync catalog (per-account `/models` sync)

Per-account automatic provider/model catalog, inspired by OmniRoute's
`modelSyncScheduler` / `modelsDevSync` / `freeModels` / `openrouterCatalog`
ideas. This implementation is native to 9Router: no OmniRoute code was copied.

## What syncs, and when

- Each active connection with a declarative GET `/models` endpoint
  (`modelsFetcher.url` in its registry entry, or a custom node's `baseUrl`)
  syncs its real model list into `connection.modelCatalog`.
- First sync: fire-and-forget right after `POST /api/providers` creates the
  connection (fail-open — creation never fails because sync failed).
- Recurring: every 24h via `startConnectionCatalogSync()` (boot + 90s);
  failures retry in 30min. `CONNECTION_MODEL_SYNC=off` disables ALL
  automatic syncs (scheduler, creation-time, migration-suggestions) via the
  `syncConnectionCatalog({automatic})` chokepoint — the manual button and
  API POST keep working (that path passes `{automatic:false}`).
- Manual: dashboard "Models" button per connection → `POST
  /api/providers/[id]/model-catalog`, or `GET` to inspect status/counts.
  Concurrent calls share one in-flight sync per connection; repeats within
  30s get the cached result with `deduped:true` (no upstream quota burn).
- Safety: 15s timeout, 3 attempts with backoff, no retry on 401/403/404,
  empty 200 responses never wipe the previous list, SSRF guard on the URL,
  and no keys/tokens/response bodies in logs.

## Discovery scope

`GET /v1/models` lists combos plus the models each provider page shows
(built-in list minus disabled, curated `enabledModels`, custom models,
aliases); the synced catalogue only enriches those with tier/pricing. The
catalogue's own ids are advertised only with `?scope=all`, which is what the
rules below describe — tooling that audits routability must read that scope.

## Removal rule (two consecutive valid syncs)

- A model missing from one valid sync becomes `temporarily-absent` and stays
  advertised in `/v1/models`.
- Missing from two consecutive valid syncs → `unavailable`: hidden from
  `/v1/models` and skipped during combo fallback. The stored combo is never
  edited.
- Statuses: `never-synced` (no data yet), `error` (sync failing, previous
  list kept), `stale` (last attempt failed but an older success exists),
  `ok`. `temporarily-absent` vs `unavailable` is the "might come back" vs
  "confirmed gone" distinction.
- Multi-account union: a model stays advertised while ANY active account of
  that provider still lists it as available.

## Tier precedence (free / credits / paid / unknown)

1. Provider-reported price (`pricing.prompt/completion`).
2. models.dev cost overlay (`COST_PROVIDERS` in `src/lib/modelCatalog/sync.js`,
   read via `getCatalogCost`) — fills `unknown` tiers only. When the provider
   has no cost row, **OpenRouter's models.dev prices** are used as the
   universal fallback (same base model id; paid beats `:free` zeros).
3. Explicit markers: `:free`/`-free` suffix, `free`/`is_free` flag.
4. Curated per-provider rules (currently only `orcarouter/free`).
5. `unknown` — missing price data is never called paid.

Usage cost estimation (`getPricingForModel`) follows the same idea: static
tables first, then the catalog/OpenRouter fallback when nothing matches.

Per-request pricing (`pricing.request` with no token prices, e.g. image
models) classifies as `credits`. Curated classifications show a "may change"
warning in the dashboard. Programmatic free listing: `/v1/models/free` and
`/v1/models?tier=free`.

## What can and cannot be automated (honest list)

Can:
- Discover models for any provider with a GET `/models` endpoint (the five
  native connectors below, Alibaba MaaS hosts, custom OpenAI-compatible
  nodes, opencode-go).
- Enrich tiers/limits from the public models.dev feed (metadata only — no
  remote code is downloaded or executed, and a discovered models.dev entry
  never becomes an executable provider on its own).
- Suggest custom → native migration on exact endpoint-host match
  (API `/api/providers/migration-suggestions`; dashboard panel removed).

Cannot (requires code, stays manual):
- Turning a newly discovered provider name into a working connector:
  auth scheme, chat endpoint shape, quirks and capability tables need a
  registry entry + review. Such providers are simply absent from the
  dashboard until added.
- Alibaba Token Plan `/models` needs the account key (401 without one);
  alicode `/v1/models` is public.
- Local Qwen endpoints (Hugging Face / Modal, localhost/LAN hosts) stay
  custom by design — no public native host will ever match them.

## PROVIDER_REFERENCE (OmniRoute) — what it is and what it is not

- Source: `docs/reference/PROVIDER_REFERENCE.md` in OmniRoute
  ([`9d1a896/docs/reference/PROVIDER_REFERENCE.md`](https://github.com/diegosouzapw/OmniRoute/blob/9d1a896c6058b2ade94c9078c2e54377b9aa76d3/docs/reference/PROVIDER_REFERENCE.md)),
  header-verified as **auto-generated from `src/shared/constants/providers.ts`**
  (`npm run gen:provider-reference`, 356 providers, version 3.8.51, 2026-09-03).
  It is a markdown catalog of registry entries already present in that codebase,
  not an independent remote registry fetched at runtime.
- Nature of discovery in this fork: `models.dev` (`https://models.dev/api.json`)
  is likewise **metadata only** — provider names, model ids, pricing, context
  windows and capability flags. No code is downloaded or executed from a remote
  URL, and a name that appears in `models.dev` never becomes an executable
  provider by itself.
- Guardrail: a remote URL (whether from `PROVIDER_REFERENCE`, `models.dev`, or
  any other feed) MUST NOT be turned into an executable provider. Adding a new
  provider still requires a reviewed registry entry (`open-sse/providers/registry/*.js`)
  with transport, auth, `modelsFetcher` and quirk tables. This keeps unreviewed
  third-party hosts from becoming a code-execution or credential-exfiltration
  surface.


- `openrouter`, `opencode`, `kilocode`: same OpenAI-shaped `/models` list (fetcher type `openrouter-free` / `opencode-free`); free models classified via zero price or `:free`/`-free` id suffix — **Import free** appears once synced.
- `clinepass`, `nvidia`: `/models` listings synced like other OpenAI-compatible hosts.
- `bai`, `orcarouter`, `dahl`: OpenAI-compatible gateways, Bearer auth,
  `modelsFetcher` + `validateUrl` on `/v1/models`, `passthroughModels`,
  static seed fallback (orcarouter/dahl; b.ai's list needs a key so it
  ships empty and fills on first sync).
- Alibaba MaaS: `alicode`, `alicode-intl`, `alims-intl` gained
  `modelsFetcher` on their official hosts; `alitp-intl` on the official
  Singapore token-plan host (the only region serving the plan — official
  endpoint, not installation-specific). No private base URL is hardcoded.
- `opencode-go`: `modelsFetcher` on the public `/zen/go/v1/models`.
- Muse/OpenCode Zen (`opencode`): unchanged — already native.
- Local Qwen (HF/Modal): untouched, remain custom nodes.

## Migration (API remains; dashboard panel removed)

The one-shot custom→native migration UI (`MigrationPanel`) was removed after
the known custom hosts were migrated. The backend endpoint
`/api/providers/migration-suggestions` still exists for scripted/manual use:

1. `GET /api/providers/migration-suggestions` — exact host match only; lists
   affected combos/aliases/custom models per suggestion.
2. `POST /api/providers/migration-suggestions` — creates a JSON backup under
   `DATA_DIR/migration-backups/`, then a native connection duplicating the key.
3. The custom connection stays. Update combos/aliases to the native prefix
   yourself — nothing is retargeted automatically.

Local Qwen (HF/Modal) and other non-public hosts stay custom by design.

## Import picker and daily auto-import

The import picker and daily auto-import feature work in tandem with the per-connection catalog sync described above. They answer a different question: **which discovered models should be added to Available Models?** The relationship is:

- **Catalog sync** discovers what models exist and are reachable by each connection (each account via its `/models` endpoint), and marks the ones that become unavailable after two consecutive missing syncs. Discovery is automatic and always happens (unless `CONNECTION_MODEL_SYNC=off`).
- **Import picker** runs on-demand: open the provider page, click "Import models", and select which discovered models you want to add to your Available Models list. The picker lists models via a **live `/models` call on the active connection** (not the synced catalog) — falling back to the provider's public catalog for providers without an active connection — filters by search/tier/kind/context/patterns, tests each selected model through the gateway before import, and records their actual working kind (llm vs image vs embedding, etc.) from the probes.
- **Daily auto-import** saves the picker's filters and test setting as a recurring rule per provider, so new models matching those filters are discovered and tested automatically once per day at a configurable hour. Rules are created and removed only from a provider's own Import dialog (the "Use these filters for daily auto-import" checkbox); the Profile page's "Daily Model Auto-Import" settings card only has the global enable toggle, the run hour, and "Run now" — it does not create or edit per-provider rules. Each daily run imports only **new** models (ones not already in Available Models); it never removes models you've already added. A model becomes available the moment it passes a test probe, so the same model tested via the picker (on-demand) or auto-import (scheduled) behaves identically.

The three flows are composable: a connection's catalog sync provides the discovery data; the picker lets you manually curate; and auto-import runs the picker's logic on a schedule. Together, they give you full control over which models are exposed to clients, while keeping discovery automatic and test-before-import as a safeguard against adding broken or misconfigured models.
