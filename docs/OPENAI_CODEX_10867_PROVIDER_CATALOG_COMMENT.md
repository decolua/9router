I rechecked this against Codex CLI `0.144.5`. The current source now has most of
the transport needed for a custom provider to own its remote model catalog, but
not yet the provider-scoped authoritative semantics a gateway needs.

Current `0.144.5` behavior:

- `ModelProviderInfo` supports command-backed bearer auth through `auth`, and
  command-auth providers are eligible for remote model refresh.
- Codex requests `{base_url}/models?client_version=...` with the provider's auth,
  expects the Codex `{ "models": [ModelInfo...] }` schema, captures the response
  `ETag`, and applies a five-second request deadline.
- `OnlineIfUncached` uses `models_cache.json` with a five-minute TTL; an ETag
  change can trigger an online refresh.
- Remote catalogs replace bundled models only for ChatGPT account auth. For a
  custom command-auth provider, remote entries are merged into the bundled
  OpenAI catalog.
- The cache is not keyed by provider identity. The source contains a TODO noting
  that switching providers can reuse another provider's fresh cache entry.
- `model_catalog_json` is global and startup-only. It is not a catalog contract
  attached to one `model_providers.<id>` entry.

Pinned source evidence:

- [`ModelProviderInfo` and command auth](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/model-provider-info/src/lib.rs)
- [remote `/models` transport and five-second timeout](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/model-provider/src/models_endpoint.rs)
- [`{ models }` decoding and ETag capture](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/codex-api/src/endpoint/models.rs)
- [merge-versus-replace and provider-cache TODO](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/models-manager/src/manager.rs)
- [cache schema and five-minute TTL inputs](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/models-manager/src/cache.rs)
- [`0.144.5` generated config schema](https://github.com/openai/codex/blob/rust-v0.144.5/codex-rs/core/config.schema.json)

Could custom providers opt into an explicit provider-scoped mode, for example:

```toml
[model_providers.gateway]
name = "Internal gateway"
base_url = "https://gateway.example/v1"
wire_api = "responses"
model_catalog_mode = "authoritative_remote"

[model_providers.gateway.auth]
command = "gateway-token"
refresh_interval_ms = 300000
```

Suggested semantics for `authoritative_remote`:

1. It applies only to the selected custom provider. A successful schema-valid
   remote catalog replaces bundled models for that provider instead of merging
   unrelated OpenAI presets.
2. Cache identity includes the provider config key, normalized base URL, catalog
   mode, and Codex client version. It never includes or persists bearer tokens.
3. Startup with `OnlineIfUncached` may use only a fresh matching provider cache.
   On a cache miss, run command auth and fetch within the existing deadline. A
   failure must not fall back to another provider's cache or bundled catalog;
   retain the explicit configured model and surface the catalog error instead.
4. Persist the provider-scoped ETag with the snapshot. A same-ETag notification
   renews that cache's TTL; a changed ETag forces an online refresh.
5. Send `If-None-Match` during refresh. `304` retains the scoped snapshot and
   renews its TTL; a valid `200` atomically replaces models and ETag.
6. Reject an ambiguous combination with global `model_catalog_json`, or document
   one deterministic precedence rule.

Useful acceptance tests:

- two command-auth providers sharing one `CODEX_HOME` never reuse each other's
  models or ETag;
- a restart with a fresh matching cache does not invoke the auth command;
- a stale/missing cache invokes the command once and refreshes the selected
  provider;
- `304` preserves the snapshot, while `200` replaces rather than merges it;
- a network/auth/schema failure never exposes unrelated bundled models;
- switching back to the first provider restores only its scoped snapshot.

This complements, but does not by itself close, #10867. Provider-scoped catalog
truth is the backend requirement; Desktop still needs to render and select the
models returned for a custom provider. If #10867 should remain focused on the
picker, this catalog-mode work could be tracked as a linked model-provider issue.
