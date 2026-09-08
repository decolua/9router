# Codex compatibility and model health

9Router sends its own Codex client identity. Updating a caller's CLI does not update
these outbound headers. Discovery, chat, images and credential probes share
`CODEX_CLIENT_VERSION` and `CODEX_USER_AGENT` in `open-sse/config/codexConstants.js`.

A request rejected with “requires a newer version of Codex” needs a gateway update.
Rotating through accounts cannot repair it, so this error does not lock accounts.
A model-access 400/404 is different: availability can vary by account. The affected
account/model pair is temporarily locked using the existing fallback cooldown, and
another account can be tried. The dashboard shows a model warning while preserving
the account's connection status. Other models remain eligible on that account.
Authentication, quota and server errors retain their existing handling.

## Quota auto-ping

On the Codex provider page, select **Auto-ping model** to choose an accessible model.
The default is `gpt-5.6-luna` with low reasoning. The selection is stored in
`settings.codexAutoPing.model`; changing it preserves the existing per-account
opt-ins. Only opted-in accounts are pinged after a quota reset. A ping is recorded
as successful only after a completed Responses event, not merely HTTP 200.

## Optional image aliases

Prefer updating clients to request an accessible model directly. For clients that
cannot be updated immediately, operators can explicitly configure exact aliases:

```dotenv
CODEX_IMAGE_MODEL_ALIASES={"gpt-5.5-image":"gpt-5.6-luna-image"}
```

Restart 9Router after changing the environment. Aliases apply only to Codex image
requests, before account selection and cooldown tracking. Both sides are unprefixed
image IDs; aliases are single-hop, and unrelated models/providers are unchanged.
Invalid JSON or non-image IDs produce a configuration error before an upstream call.
The configured substitution is logged. The target must be accessible to the accounts
being used; an alias cannot grant model access. With the variable unset, requests
retain their original model. A 404 does not establish global model retirement.

Image streams preserve upstream errors, including failed/incomplete events inside
HTTP 200. JSON/binary clients receive the mapped failure status; SSE clients receive
an `error` event with message, status and code when supplied, without a successful
`done` event. A response without an image reports a neutral no-result error.

## Reproducible checks

```sh
npm install
npm install --prefix tests
npm test --prefix tests -- unit/codex-client-identity.test.js unit/codex-image-stream-errors.test.js unit/codex-image-framing.test.js unit/codex-model-health.test.js unit/codex-image-alias.test.js unit/quota-auto-ping.test.js unit/image-generation.test.js
npm run build
```

These tests use synthetic upstream responses. They cover framing, error propagation,
account/model isolation, opt-in aliasing, API-key rejection and quota-ping completion;
they do not claim availability of any model on every live account.

For an isolated HTTP and dashboard check (Node 22.13+), run the fixture server after
building, then the check script in another terminal:

```sh
node tests/fixtures/codex-http-server.cjs
node tests/fixtures/codex-http-check.mjs
```

Open `http://127.0.0.1:20139/dashboard/providers/codex`. Confirm the synthetic
account stays active with a separate model warning; select another auto-ping model
and reload to verify persistence. To check failed saves, create an empty file named
`fail-next-settings-save` under the printed `FIXTURE_DATA_DIR`, then change the model:
the selection should revert and an error should appear. The fixture binds only to
loopback, creates a fresh temporary database, and replaces all upstream fetches with
synthetic responses. It uses `fixture-key` for API requests; no real account is needed.
Stop with Ctrl-C and remove its printed temporary data directory when done.
