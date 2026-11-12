# DF-9ROUTER-54 live evidence — fresh-install model discovery guidance (2026-10-11)

**Board row:** DF-9ROUTER-54 (fresh install advertises a catalog through `/v1/models`
while every chat request outside it answers a bare `404 No active credentials for
provider: openai`, leaving a new user no way to discover what is callable).

**Verdict: FIXED and verified live at commit HEAD of `federation` (`fix(ux): improve
fresh-install model discovery error messages`).**

## Probe setup

Same recipe as the row's predecessor evidence
(`2026-09-17-df9router7-fresh-install-catalog.md`):

```
npm run build      # BUILD_EXIT=0, BUILD_ID=QMWeu5iXRUPTmkBILknaL
DATA_DIR=/tmp/df54-fresh PORT=20131 HOSTNAME=127.0.0.1 FEDERATION_MODE=standalone node custom-server.js
# -> readiness: GET /v1/models answered 200
```

`DATA_DIR` is an empty directory: zero provider connections, no API keys. Host loadavg
12.78 at probe time.

## Results

| Probe | Result |
|---|---|
| `GET /v1/models` | `200`, **1 model** — `mmf/mimo-auto` (the credentialless MiMo channel). Not the static catalog: 838 LLM ids are advertised in the fail-open state, 1 here. |
| `POST /v1/chat/completions` `model=anthropic/claude-sonnet-4-20250514` | `404` with guidance (below) |
| `POST /v1/chat/completions` `model=openai/gpt-4o` (the row's literal example) | `404` with guidance |
| `POST /v1/chat/completions` `model=openai/gpt-4o` `stream:true` | `404` — same branch, same body |

Response bodies, verbatim:

```json
{"error":{"message":"No active credentials for provider: anthropic. See /v1/models for models usable without credentials.","type":"invalid_request_error","code":"model_not_found"}}
```

```json
{"error":{"message":"No active credentials for provider: openai. See /v1/models for models usable without credentials.","type":"invalid_request_error","code":"model_not_found"}}
```

101 characters in the wire message (budget: <200); the legacy
`No active credentials for provider: X` prefix is unchanged, so existing clients and
log greps keep matching. With a connection store that has entries the message names
them instead of relying on `/v1/models` alone
(`Active connections exist for: …`, capped at five, inactive rows excluded) — covered
by `tests/unit/no-credentials-guidance-54.test.js`, which drives the real `handleChat`
against the real credential lookup; that branch is not reproducible on a live scratch
instance without inserting a fake provider connection.

## Why the two surfaces now agree

`buildModelsList` (zero active connections, lookup succeeded) advertises only
`providerIsUsableWithoutCredentials` providers, and the chat 404 names the same
discovery surface. `tests/unit/fresh-install-catalog-servable-54.test.js` pins the
cross-artifact half of that agreement: every advertised id must resolve, through
`resolveProviderId`, to a provider that `src/sse/services/auth.js` serves with **no**
stored connection (`FREE_PROVIDERS[...].noAuth === true`), which is exactly the code
that decides `credentials === null` and therefore the 404.

## Residual notes (not part of this row)

- **Pre-existing build gap in an incomplete install.** On this checkout `npm run build`
  failed at `./open-sse/shared/awsCredentials.js — Module not found: Can't resolve
  '@aws-sdk/credential-providers'` (import trace `open-sse/executors/bedrock.js` →
  `src/app/api/providers/validate/route.js`). The package is declared in
  `optionalDependencies` ("kept in optionalDependencies (npm still installs these by
  default) and imported lazily in shared/awsCredentials.js"), but the whole
  `@aws-sdk` scope was absent from `node_modules` — an install made with optional deps
  omitted. Installing the declared optional dep
  (`npm install --no-save --no-package-lock @aws-sdk/credential-providers`;
  `package.json`/`package-lock.json` unchanged) made the build green. The lazy runtime
  import does not stop webpack resolving the static specifier, so a tree without
  optional deps cannot build at all — unrelated to this row's diff, and unaddressed
  here because the row's constraints limit the change to the error message.
- Releases are human-gated in this fork, so the published npm artifact picks this up
  at the next release.
