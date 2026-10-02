# API-key provider and model policies

Configure a key's **Access policy** from Dashboard → Endpoint. Existing keys
and keys with empty policy fields retain unrestricted access.

- **Allowed providers** grants every model from each selected provider.
- **Allowed individual models** grants specific stable `providerId/modelId`
  pairs. Provider and individual-model grants are additive (a union), not an
  intersection. Leave the provider list empty to grant individual models only.
- **Force provider** replaces the requested provider while keeping the model ID.
- **Enforced model** replaces the entire requested route, and also supplies the
  model when the client omits it. This takes precedence over Force provider.
  If both fields are set, they must refer to the same provider. The resulting
  route must still satisfy any allow-list grants.

Custom compatible-provider grants use the stable node ID, not the display
prefix. Enforced models use the public model ID from the configured catalogue.
Changing a custom prefix therefore preserves grants but requires updating an
enforced model that used the old prefix.

## Supported API surface

Scoped keys support OpenAI chat completions, Claude messages, Responses,
Responses compact, and the Ollama-compatible chat endpoint. All actual chat
dispatches, including capacity adapters and combo/fusion seats, are checked
before upstream credentials are selected. Restricted keys cannot select combos
directly: a combo is not a single authorized provider/model route.

`GET /v1/models`, kind lists, model detail, and `/v1/models/info` expose only
models permitted by the same policy. A forced model must exist in the catalogue
to be listed. An unavailable policy lookup hides models rather than exposing
an unrestricted catalogue. The dashboard loads its full catalogue through the
session-protected `/api/models/available` endpoint.

Other API services (embeddings, images, audio, video, search/fetch, System One,
and Gemini native endpoints) return 403 for scoped keys until those dispatchers
support equivalent enforcement. Unrestricted keys are unaffected.

Bearer authentication, `x-api-key`, `x-goog-api-key`, and the legacy `?key=`
transport all resolve the same key policy. Prefer headers: query keys can leak
through URL logs/history. Enable `requireApiKey` when all clients must be
authenticated; anonymous local requests otherwise retain existing local mode.

## Storage and compatibility

Permissions are a JSON field in the existing SQLite `apiKeys` table. The
additive schema upgrade preserves existing keys, and backup/import/export
preserves permissions. There is no PostgreSQL dependency, adapter, server
configuration, or internal deployment configuration in this contribution.

Upstream provider credentials remain separate from these client-facing keys.
Treat the database and backups as secrets. These policies do not encrypt keys
or hide private provider data from an authenticated dashboard administrator.
